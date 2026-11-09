#!/usr/bin/env python3
"""
Disaster Recovery: PostgreSQL Encrypted Backup & Integrity Verification Utility
Encapsulates:
  1. Base SQL dump generation & SHA-256 checksumming via scripts/backup_db.py
  2. Gzip compression (.sql.gz)
  3. Authenticated AES-256-GCM encryption (.sql.gz.enc) with strict CSPRNG key requirement
  4. Local encrypted archive integrity assertion (Remote S3 transport explicitly marked BLOCKED)
  5. Decryption, decompression, and end-to-end restore verification measuring local restore duration
"""

import os
import sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
import gzip
import json
import time
import shutil
import hashlib
import secrets
import argparse
import datetime
from typing import Dict, Any, Tuple, Optional

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.exceptions import InvalidTag
from scripts.backup_db import create_backup
from scripts.restore_db import restore_and_verify


def derive_or_get_encryption_key(key_hex: Optional[str] = None) -> Tuple[bytes, str]:
    """
    Validates and parses a 256-bit AES key.
    STRICT FAIL-CLOSED: Requires exactly 64 hexadecimal characters.
    No hardcoded fallback, no silent hashing of arbitrary strings.
    Returns (key_bytes, key_fingerprint).
    """
    raw_key = (key_hex or os.getenv("BACKUP_ENCRYPTION_KEY", "")).strip()
    if not raw_key:
        raise ValueError(
            "FATAL: BACKUP_ENCRYPTION_KEY is required and cannot be empty. "
            "Fail-closed: no fallback key is permitted."
        )

    if len(raw_key) != 64:
        raise ValueError(
            f"FATAL: BACKUP_ENCRYPTION_KEY must be exactly 64 hex characters (256-bit key), "
            f"got {len(raw_key)} characters. Fail-closed."
        )

    try:
        key_bytes = bytes.fromhex(raw_key)
    except ValueError as e:
        raise ValueError(
            "FATAL: BACKUP_ENCRYPTION_KEY must contain valid hexadecimal characters only. Fail-closed."
        ) from e

    # Compute one-way fingerprint (first 16 hex chars of SHA-256) for audit logging without leaking key
    fingerprint = hashlib.sha256(key_bytes).hexdigest()[:16]
    return key_bytes, fingerprint


def generate_new_encryption_key() -> str:
    """Generates a cryptographically strong 256-bit AES key formatted as 64 hex characters."""
    return secrets.token_hex(32)


def encrypt_file_aes_gcm(input_path: str, output_path: str, key_bytes: bytes) -> Dict[str, Any]:
    """Encrypts a file with AES-256-GCM (12-byte nonce prepended, 16-byte tag appended)."""
    aesgcm = AESGCM(key_bytes)
    nonce = os.urandom(12)

    with open(input_path, "rb") as f:
        plaintext = f.read()

    ciphertext = aesgcm.encrypt(nonce, plaintext, None)

    with open(output_path, "wb") as f:
        f.write(nonce + ciphertext)

    sha256 = hashlib.sha256()
    with open(output_path, "rb") as f:
        while chunk := f.read(65536):
            sha256.update(chunk)

    return {
        "encrypted_path": os.path.abspath(output_path),
        "encrypted_size_bytes": os.path.getsize(output_path),
        "encrypted_sha256": sha256.hexdigest(),
        "algorithm": "AES-256-GCM",
        "nonce_length_bytes": 12,
        "tag_length_bytes": 16
    }


def decrypt_file_aes_gcm(encrypted_path: str, output_path: str, key_bytes: bytes) -> str:
    """Decrypts an AES-256-GCM encrypted file. Raises InvalidTag if tampered or wrong key."""
    with open(encrypted_path, "rb") as f:
        data = f.read()

    if len(data) < 28:
        raise ValueError(f"Corrupt or incomplete encrypted payload: length {len(data)} < 28 bytes.")

    nonce = data[:12]
    ciphertext = data[12:]

    aesgcm = AESGCM(key_bytes)
    plaintext = aesgcm.decrypt(nonce, ciphertext, None)

    with open(output_path, "wb") as f:
        f.write(plaintext)

    return output_path


def compress_file_gzip(input_path: str, output_path: str) -> Dict[str, Any]:
    """Compresses a file using gzip."""
    with open(input_path, "rb") as f_in, gzip.open(output_path, "wb", compresslevel=9) as f_out:
        shutil.copyfileobj(f_in, f_out)

    sha256 = hashlib.sha256()
    with open(output_path, "rb") as f:
        while chunk := f.read(65536):
            sha256.update(chunk)

    return {
        "compressed_path": os.path.abspath(output_path),
        "compressed_size_bytes": os.path.getsize(output_path),
        "compressed_sha256": sha256.hexdigest()
    }


def decompress_file_gzip(compressed_path: str, output_path: str) -> str:
    """Decompresses a gzip file."""
    with gzip.open(compressed_path, "rb") as f_in, open(output_path, "wb") as f_out:
        shutil.copyfileobj(f_in, f_out)
    return output_path


def create_encrypted_offsite_package(
    target_dir: str = "backups",
    database: Optional[str] = None,
    key_hex: Optional[str] = None,
    keep_plaintext: bool = False
) -> Tuple[str, Dict[str, Any]]:
    """
    Creates full PostgreSQL backup, compresses with gzip, encrypts with AES-256-GCM,
    and produces audit manifest with honest BLOCKED status for unprovisioned remote S3.
    """
    os.makedirs(target_dir, exist_ok=True)
    t0 = time.time()

    # Step 0: Validate key fail-closed before taking backup
    key_bytes, key_fp = derive_or_get_encryption_key(key_hex=key_hex)

    # Step 1: Base backup
    raw_dump_path = create_backup(target_dir=target_dir, database=database)
    base_name = raw_dump_path.replace(".sql", "")
    manifest_base_path = f"{base_name}.manifest.json"

    with open(manifest_base_path, "r", encoding="utf-8") as f:
        base_manifest = json.load(f)

    # Step 2: Gzip compression
    gz_path = f"{base_name}.sql.gz"
    gz_meta = compress_file_gzip(raw_dump_path, gz_path)
    compression_ratio = round(base_manifest["file_size_bytes"] / max(gz_meta["compressed_size_bytes"], 1), 2)
    print(f"[+] Compressed SQL dump with GZIP: {gz_path} (Ratio: {compression_ratio}:1)")

    # Step 3: AES-256-GCM Encryption
    enc_path = f"{base_name}.sql.gz.enc"
    enc_meta = encrypt_file_aes_gcm(gz_path, enc_path, key_bytes)
    print(f"[+] Encrypted archive with AES-256-GCM (Key FP: {key_fp}): {enc_path}")

    # Remove temporary compressed file
    if os.path.exists(gz_path):
        os.remove(gz_path)

    # Step 4: Honest Remote S3 Status (Strictly BLOCKED until real S3 bucket is provisioned)
    s3_bucket = os.getenv("OFFSITE_S3_BUCKET")
    remote_status = "BLOCKED"
    remote_detail = (
        "Remote cloud object storage (S3) is NOT provisioned. Remote upload is strictly BLOCKED "
        "pending IAM credentials, bucket policy, and provider selection by platform administrator."
    )
    if s3_bucket:
        remote_detail = f"S3 Bucket '{s3_bucket}' configured in env, but remote upload transport is pending cloud IAM verification."

    total_duration = round(time.time() - t0, 3)

    offsite_manifest = {
        "timestamp_utc": base_manifest["timestamp_utc"],
        "database_name": base_manifest["database_name"],
        "raw_dump_file": os.path.basename(raw_dump_path),
        "raw_dump_size_bytes": base_manifest["file_size_bytes"],
        "raw_dump_sha256": base_manifest["sha256_checksum"],
        "compressed_file": os.path.basename(gz_path),
        "compressed_size_bytes": gz_meta["compressed_size_bytes"],
        "compressed_sha256": gz_meta["compressed_sha256"],
        "encrypted_file": os.path.basename(enc_path),
        "encrypted_size_bytes": enc_meta["encrypted_size_bytes"],
        "encrypted_sha256": enc_meta["encrypted_sha256"],
        "encryption": {
            "cipher": "AES-256-GCM",
            "key_fingerprint": key_fp,
            "nonce_bytes": 12,
            "tag_bytes": 16
        },
        "local_package_status": "LOCAL_ENCRYPTED_BACKUP_READY",
        "remote_offsite_status": remote_status,
        "remote_offsite_detail": remote_detail,
        "backup_duration_seconds": total_duration,
        "created_by": "scripts/offsite_backup.py"
    }

    offsite_manifest_path = f"{base_name}.offsite_manifest.json"
    with open(offsite_manifest_path, "w", encoding="utf-8") as f:
        json.dump(offsite_manifest, f, indent=2, ensure_ascii=False)

    print(f"[+] Offsite backup package created successfully: {offsite_manifest_path}")
    print(f"    Local status: LOCAL_ENCRYPTED_BACKUP_READY")
    print(f"    Remote status: {remote_status} ({remote_detail})")

    # Step 5: Safe cleanup of plaintext .sql dump unless explicitly requested to keep
    if not keep_plaintext:
        try:
            os.remove(raw_dump_path)
            print(f"    [+] Cleaned up intermediate unencrypted plaintext dump: {raw_dump_path}")
        except Exception as e:
            print(f"    [!] Warning: failed to clean up plaintext dump: {e}")

    return enc_path, offsite_manifest


def verify_offsite_restore(
    encrypted_path: str,
    target_test_db: str = "saas_crm_offsite_restore_test",
    key_hex: Optional[str] = None
) -> Dict[str, Any]:
    """
    Tests end-to-end disaster recovery restoration from an encrypted package:
      1. Decrypt AES-256-GCM (fails if key or payload tampered)
      2. Decompress GZIP
      3. Verify SHA-256 integrity against raw dump manifest
      4. Re-create schema, load SQL, and execute RLS / negative security validation
      5. Measure local encrypted archive restore duration
    """
    print("\n" + "=" * 80)
    print("  VERIFYING LOCAL RESTORATION FROM ENCRYPTED ARCHIVE")
    print("=" * 80)
    t0 = time.time()

    assert os.path.exists(encrypted_path), f"Encrypted archive not found: {encrypted_path}"
    work_dir = os.path.dirname(encrypted_path)
    base_name = os.path.basename(encrypted_path).replace(".sql.gz.enc", "")
    decrypted_gz = os.path.join(work_dir, f"{base_name}.decrypted.sql.gz")
    restored_sql = os.path.join(work_dir, f"{base_name}.restored.sql")

    key_bytes, key_fp = derive_or_get_encryption_key(key_hex=key_hex)

    # Step 1: Decrypt
    print(f"[*] Step 1: Decrypting AES-256-GCM package using key fingerprint {key_fp}...")
    t_dec0 = time.time()
    decrypt_file_aes_gcm(encrypted_path, decrypted_gz, key_bytes)
    t_decrypt = round(time.time() - t_dec0, 3)
    print(f"    [+] Decrypted in {t_decrypt}s: {decrypted_gz}")

    # Step 2: Decompress
    print(f"[*] Step 2: Decompressing GZIP stream...")
    t_decmp0 = time.time()
    decompress_file_gzip(decrypted_gz, restored_sql)
    t_decompress = round(time.time() - t_decmp0, 3)
    print(f"    [+] Decompressed in {t_decompress}s: {restored_sql}")

    # Step 3: Database Restore & RLS Assertions
    print(f"[*] Step 3: Executing database restore and RLS audit into target DB '{target_test_db}'...")
    restore_report_path = os.path.join(work_dir, f"{base_name}.dr_restore_report.json")
    base_manifest_path = os.path.join(work_dir, f"{base_name}.manifest.json")
    restore_meta = restore_and_verify(
        dump_path=restored_sql,
        target_db=target_test_db,
        manifest_path=base_manifest_path,
        report_output=restore_report_path,
        verbose=True
    )

    total_duration = round(time.time() - t0, 3)

    # Cleanup temporary restored sql & gz
    for tmp_file in [decrypted_gz, restored_sql]:
        if os.path.exists(tmp_file):
            os.remove(tmp_file)

    dr_verification = {
        "status": "SUCCESS",
        "verified_at_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "encrypted_package": encrypted_path,
        "target_database": target_test_db,
        "key_fingerprint": key_fp,
        "decryption_time_seconds": t_decrypt,
        "decompression_time_seconds": t_decompress,
        "database_restore_time_seconds": restore_meta.get("sql_stream_restore_duration_seconds", 0),
        "local_encrypted_archive_restore_duration_seconds": total_duration,
        "recovery_scope": "LOCAL_ARCHIVE_DECRYPTION_AND_SQL_RESTORE_ONLY",
        "rto_note": "Measures only local decryption, decompression, and psql restoration into PostgreSQL. Full operational RTO includes remote S3 download, VM provisioning, DNS/TLS propagation, container startup, and end-to-end smoke verification, which will be measured during standalone multi-host DR drill.",
        "rls_enforcement": restore_meta.get("rls_enforcement"),
        "tenant_tables_rls_verified": restore_meta.get("tenant_tables_rls_verified"),
        "tenant_isolation_ab_verified": restore_meta.get("tenant_isolation_ab_verified"),
        "tables_count": restore_meta.get("tables_count"),
        "tenants_count": restore_meta.get("tenants_count")
    }

    dr_report_path = os.path.join(work_dir, "offsite_dr_verification_report.json")
    with open(dr_report_path, "w", encoding="utf-8") as f:
        json.dump(dr_verification, f, indent=2, ensure_ascii=False)

    print(f"\n[+] Local Restoration Verification SUCCESSFUL! Report saved to {dr_report_path}")
    print(f"    Local Archive Restore Duration: {total_duration} seconds")
    return dr_verification


def run_encryption_negative_tests():
    """Validates fail-closed behavior on missing keys, corrupt tags, and tampered ciphertext."""
    print("\n[*] Running Encryption Fail-Closed Negative Tests...")

    # 1. Missing key
    try:
        derive_or_get_encryption_key(key_hex="")
        assert False, "Failed to reject empty key"
    except ValueError as e:
        print(f"    [+] Correctly rejected empty key: {e}")

    # 2. Key too short
    try:
        derive_or_get_encryption_key(key_hex="abcdef123456")
        assert False, "Failed to reject short key"
    except ValueError as e:
        print(f"    [+] Correctly rejected short key: {e}")

    # 3. Invalid hex characters
    try:
        derive_or_get_encryption_key(key_hex="z" * 64)
        assert False, "Failed to reject non-hex key"
    except ValueError as e:
        print(f"    [+] Correctly rejected non-hex key: {e}")

    # 4. Wrong key decryption
    key1, _ = derive_or_get_encryption_key(secrets.token_hex(32))
    key2, _ = derive_or_get_encryption_key(secrets.token_hex(32))
    test_in = "tmp_plain.txt"
    test_enc = "tmp_cipher.enc"
    test_dec = "tmp_decrypted.txt"
    with open(test_in, "w") as f:
        f.write("Secret database content")

    try:
        encrypt_file_aes_gcm(test_in, test_enc, key1)
        try:
            decrypt_file_aes_gcm(test_enc, test_dec, key2)
            assert False, "Decryption with wrong key unexpectedly succeeded"
        except InvalidTag:
            print("    [+] Correctly rejected decryption with wrong key (InvalidTag).")

        # 5. Tampered ciphertext
        with open(test_enc, "r+b") as f:
            f.seek(15)
            byte = f.read(1)
            f.seek(15)
            f.write(bytes([byte[0] ^ 0xFF]))  # flip bits

        try:
            decrypt_file_aes_gcm(test_enc, test_dec, key1)
            assert False, "Decryption of tampered ciphertext unexpectedly succeeded"
        except InvalidTag:
            print("    [+] Correctly rejected tampered ciphertext (InvalidTag).")
    finally:
        for p in [test_in, test_enc, test_dec]:
            if os.path.exists(p):
                os.remove(p)

    print("[+] All encryption negative tests PASSED!\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Create AES-256 encrypted backup and verify restore.")
    parser.add_argument("--dir", default="backups", help="Target backup directory")
    parser.add_argument("--database", "--db", default=None, help="Source database name")
    parser.add_argument("--key", "-k", default=None, help="64-character hex AES-256 encryption key")
    parser.add_argument("--generate-key", action="store_true", help="Generate a fresh 64-hex AES-256 key and exit")
    parser.add_argument("--verify", action="store_true", help="Perform full decryption and database restore verification")
    parser.add_argument("--target-db", default="saas_crm_offsite_restore_test", help="Target verification database")
    parser.add_argument("--keep-plaintext", action="store_true", help="Retain unencrypted .sql file after encryption")
    parser.add_argument("--test-negative", action="store_true", help="Run fail-closed negative tests for encryption")
    args = parser.parse_args()

    if args.generate_key:
        print(generate_new_encryption_key())
        sys.exit(0)

    if args.test_negative:
        run_encryption_negative_tests()
        sys.exit(0)

    enc_file, manifest = create_encrypted_offsite_package(
        target_dir=args.dir,
        database=args.database,
        key_hex=args.key,
        keep_plaintext=args.keep_plaintext
    )

    if args.verify:
        verify_offsite_restore(
            encrypted_path=enc_file,
            target_test_db=args.target_db,
            key_hex=args.key
        )
