#!/usr/bin/env python3
"""
Disaster Recovery: PostgreSQL Offsite Backup & Encryption Utility
Encapsulates:
  1. Base SQL dump generation & SHA-256 checksumming via scripts/backup_db.py
  2. Gzip compression (.sql.gz)
  3. Authenticated AES-256-GCM encryption (.sql.gz.enc)
  4. Offsite S3-compatible replication (with BLOCKED safeguard when credentials not provisioned)
  5. Decryption, decompression, and end-to-end restore verification measuring real RTO
"""

import os
import sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
import gzip
import json
import time
import shutil
import hashlib
import argparse
import datetime
from typing import Dict, Any, Tuple, Optional

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from scripts.backup_db import create_backup
from scripts.restore_db import restore_and_verify


def derive_or_get_encryption_key(key_hex_or_env: Optional[str] = None) -> Tuple[bytes, str]:
    """
    Retrieves or derives a 256-bit key for AES-GCM.
    Returns (key_bytes, key_fingerprint).
    """
    raw_key = key_hex_or_env or os.getenv("BACKUP_ENCRYPTION_KEY")
    if raw_key:
        if len(raw_key) == 64:
            key_bytes = bytes.fromhex(raw_key)
        else:
            # Hash to 32 bytes
            key_bytes = hashlib.sha256(raw_key.encode("utf-8")).digest()
    else:
        # Default dedicated DR key for staging test verification
        key_bytes = hashlib.sha256(b"saas_crm_staging_disaster_recovery_aes_key_2026").digest()

    fingerprint = hashlib.sha256(key_bytes).hexdigest()[:16]
    return key_bytes, fingerprint


def encrypt_file_aes_gcm(input_path: str, output_path: str, key_bytes: bytes) -> Dict[str, Any]:
    """Encrypts a file with AES-256-GCM (12-byte nonce, 16-byte tag prepended)."""
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
    """Decrypts an AES-256-GCM encrypted file."""
    with open(encrypted_path, "rb") as f:
        data = f.read()

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
    database: Optional[str] = None
) -> Tuple[str, Dict[str, Any]]:
    """
    Creates a full backup, compresses, encrypts with AES-256-GCM, and produces an offsite manifest.
    """
    os.makedirs(target_dir, exist_ok=True)
    t0 = time.time()

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
    key_bytes, key_fp = derive_or_get_encryption_key()
    enc_path = f"{base_name}.sql.gz.enc"
    enc_meta = encrypt_file_aes_gcm(gz_path, enc_path, key_bytes)
    print(f"[+] Encrypted archive with AES-256-GCM (Key FP: {key_fp}): {enc_path}")

    # Step 4: Offsite S3 Dispatch Check
    s3_bucket = os.getenv("OFFSITE_S3_BUCKET")
    s3_endpoint = os.getenv("OFFSITE_S3_ENDPOINT")
    s3_access_key = os.getenv("OFFSITE_S3_ACCESS_KEY") or os.getenv("AWS_ACCESS_KEY_ID")
    s3_secret_key = os.getenv("OFFSITE_S3_SECRET_KEY") or os.getenv("AWS_SECRET_ACCESS_KEY")

    if s3_bucket and s3_access_key and s3_secret_key:
        offsite_status = "READY_TO_UPLOAD"
        offsite_detail = f"Configured remote S3 destination: {s3_bucket} via {s3_endpoint or 'AWS S3'}"
    else:
        offsite_status = "BLOCKED"
        offsite_detail = "Offsite upload BLOCKED pending Cloud S3 Bucket provisioning and IAM credentials by platform administrator."

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
        "offsite_replication": {
            "status": offsite_status,
            "detail": offsite_detail,
            "target_bucket": s3_bucket or "NOT_CONFIGURED"
        },
        "backup_duration_seconds": total_duration,
        "created_by": "scripts/offsite_backup.py"
    }

    offsite_manifest_path = f"{base_name}.offsite_manifest.json"
    with open(offsite_manifest_path, "w", encoding="utf-8") as f:
        json.dump(offsite_manifest, f, indent=2, ensure_ascii=False)

    print(f"[+] Offsite backup package created successfully: {offsite_manifest_path}")
    print(f"    Offsite status: {offsite_status} ({offsite_detail})")

    # Clean up intermediate unencrypted gz file for hygiene
    if os.path.exists(gz_path):
        os.remove(gz_path)

    return enc_path, offsite_manifest


def verify_offsite_restore(
    encrypted_path: str,
    target_test_db: str = "saas_crm_offsite_restore_test"
) -> Dict[str, Any]:
    """
    Tests end-to-end disaster recovery restoration from an encrypted offsite package:
      1. Decrypt AES-256-GCM
      2. Decompress GZIP
      3. Verify SHA-256 integrity against raw dump
      4. Re-create schema, load SQL, and execute RLS / negative security validation
      5. Measure real End-to-End Recovery Time (RTO)
    """
    print("\n" + "=" * 80)
    print("  VERIFYING END-TO-END OFFSITE RESTORATION & MEASURING FULL RTO")
    print("=" * 80)
    t0 = time.time()

    assert os.path.exists(encrypted_path), f"Encrypted archive not found: {encrypted_path}"
    work_dir = os.path.dirname(encrypted_path)
    base_name = os.path.basename(encrypted_path).replace(".sql.gz.enc", "")
    decrypted_gz = os.path.join(work_dir, f"{base_name}.decrypted.sql.gz")
    restored_sql = os.path.join(work_dir, f"{base_name}.restored.sql")

    key_bytes, key_fp = derive_or_get_encryption_key()

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

    total_rto = round(time.time() - t0, 3)

    # Cleanup temporary restored sql & gz
    for tmp_file in [decrypted_gz, restored_sql]:
        if os.path.exists(tmp_file):
            os.remove(tmp_file)

    dr_verification = {
        "status": "SUCCESS",
        "verified_at_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "encrypted_package": encrypted_path,
        "target_database": target_test_db,
        "decryption_time_seconds": t_decrypt,
        "decompression_time_seconds": t_decompress,
        "database_restore_time_seconds": restore_meta.get("sql_stream_restore_duration_seconds", 0),
        "total_measured_platform_rto_seconds": total_rto,
        "rls_enforcement": restore_meta.get("rls_enforcement"),
        "tenant_tables_rls_verified": restore_meta.get("tenant_tables_rls_verified"),
        "tenant_isolation_ab_verified": restore_meta.get("tenant_isolation_ab_verified"),
        "tables_count": restore_meta.get("tables_count"),
        "tenants_count": restore_meta.get("tenants_count")
    }

    dr_report_path = os.path.join(work_dir, "offsite_dr_verification_report.json")
    with open(dr_report_path, "w", encoding="utf-8") as f:
        json.dump(dr_verification, f, indent=2, ensure_ascii=False)

    print(f"\n[+] Offsite Disaster Recovery Verification SUCCESSFUL! Report saved to {dr_report_path}")
    print(f"    Total Measured Platform RTO: {total_rto} seconds")
    return dr_verification


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Create AES-256 encrypted offsite backup and verify full restore.")
    parser.add_argument("--dir", default="backups", help="Target backup directory")
    parser.add_argument("--database", "--db", default=None, help="Source database name")
    parser.add_argument("--verify", action="store_true", help="Perform full decryption and database restore verification")
    parser.add_argument("--target-db", default="saas_crm_offsite_restore_test", help="Target verification database")
    args = parser.parse_args()

    enc_file, manifest = create_encrypted_offsite_package(target_dir=args.dir, database=args.database)

    if args.verify:
        verify_offsite_restore(encrypted_path=enc_file, target_test_db=args.target_db)
