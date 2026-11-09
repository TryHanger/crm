#!/usr/bin/env python3
"""
Disaster Recovery: PostgreSQL Automated Backup Script
Generates clean SQL dump with SHA-256 integrity manifest.
Supports PostgreSQL 17+ and records client/server version metadata.
"""
import os
import sys

# Ensure repository root is on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import json
import time
import shutil
import hashlib
import datetime
import argparse
import subprocess
from apps.api.app.core.config import settings

def create_backup(
    target_dir: str = "backups",
    output_file: str = None,
    database: str = None,
    verbose: bool = False
) -> str:
    """
    Creates PostgreSQL backup with SHA-256 checksum and metadata manifest.
    """
    os.makedirs(target_dir, exist_ok=True)
    timestamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d_%H%M%SZ")
    db_name = database or settings.DB_NAME

    if output_file:
        dump_path = output_file
        dump_filename = os.path.basename(output_file)
        manifest_path = output_file + ".manifest.json" if not output_file.endswith(".sql") else output_file[:-4] + ".manifest.json"
    else:
        dump_filename = f"backup_{db_name}_{timestamp}.sql"
        dump_path = os.path.join(target_dir, dump_filename)
        manifest_path = os.path.join(target_dir, f"backup_{db_name}_{timestamp}.manifest.json")

    print(f"[*] Starting backup for database '{db_name}' at '{settings.DB_HOST}:{settings.DB_PORT}'...")
    start_time = time.time()

    pg_container = os.getenv("PG_CONTAINER", "crm-test-pg")
    has_local_pg_dump = shutil.which("pg_dump") is not None
    pg_dump_version_str = "unknown"

    if has_local_pg_dump:
        try:
            ver_proc = subprocess.run(["pg_dump", "--version"], stdout=subprocess.PIPE, text=True, check=True)
            pg_dump_version_str = ver_proc.stdout.strip()
            if verbose:
                print(f"[*] Using local pg_dump: {pg_dump_version_str}")
        except Exception:
            pass

        pg_env = os.environ.copy()
        pg_env["PGPASSWORD"] = settings.ADMIN_DB_PASSWORD
        pg_dump_cmd = [
            "pg_dump",
            "-h", str(settings.DB_HOST),
            "-p", str(settings.DB_PORT),
            "-U", settings.ADMIN_DB_USER,
            "-d", db_name,
            "--clean",
            "--if-exists"
        ]
        try:
            with open(dump_path, "w", encoding="utf-8") as f:
                subprocess.run(pg_dump_cmd, stdout=f, stderr=subprocess.PIPE, text=True, check=True, env=pg_env)
        except subprocess.CalledProcessError as e:
            # If server version mismatch or failed, try docker container if running
            if "version mismatch" in e.stderr.lower():
                print(f"[!] Local pg_dump failed ({e.stderr.strip()}), falling back to docker container '{pg_container}'...")
                docker_cmd = [
                    "docker", "exec", pg_container,
                    "pg_dump", "-U", settings.ADMIN_DB_USER, "-d", db_name, "--clean", "--if-exists"
                ]
                with open(dump_path, "w", encoding="utf-8") as f:
                    subprocess.run(docker_cmd, stdout=f, stderr=subprocess.PIPE, text=True, check=True)
                pg_dump_version_str = f"Docker container ({pg_container})"
            else:
                print(f"[!] Local pg_dump failed: {e.stderr}", file=sys.stderr)
                raise RuntimeError(f"pg_dump failed: {e.stderr}")
    else:
        # Fallback to docker container
        pg_dump_cmd = [
            "docker", "exec", pg_container,
            "pg_dump", "-U", settings.ADMIN_DB_USER, "-d", db_name, "--clean", "--if-exists"
        ]
        try:
            with open(dump_path, "w", encoding="utf-8") as f:
                subprocess.run(pg_dump_cmd, stdout=f, stderr=subprocess.PIPE, text=True, check=True)
            pg_dump_version_str = f"Docker container ({pg_container})"
        except subprocess.CalledProcessError as e:
            print(f"[!] Docker pg_dump failed: {e.stderr}", file=sys.stderr)
            raise RuntimeError(f"docker pg_dump failed: {e.stderr}")

    duration = time.time() - start_time
    file_size = os.path.getsize(dump_path)

    # Compute SHA256 checksum
    sha256 = hashlib.sha256()
    with open(dump_path, "rb") as f:
        while chunk := f.read(65536):
            sha256.update(chunk)
    checksum = sha256.hexdigest()

    manifest = {
        "timestamp_utc": timestamp,
        "database_name": db_name,
        "dump_file": dump_filename,
        "dump_path": os.path.abspath(dump_path),
        "file_size_bytes": file_size,
        "sha256_checksum": checksum,
        "duration_seconds": round(duration, 3),
        "pg_dump_version": pg_dump_version_str,
        "created_by": "scripts/backup_db.py",
        "status": "SUCCESS"
    }

    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    print(f"[+] Backup completed successfully in {duration:.2f}s!")
    print(f"    Dump:     {dump_path} ({file_size} bytes)")
    print(f"    SHA256:   {checksum}")
    print(f"    Manifest: {manifest_path}")
    print(f"    Tool:     {pg_dump_version_str}")
    return dump_path

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Create PostgreSQL database backup with SHA-256 manifest.")
    parser.add_argument("--output", "-o", help="Target output file path", default=None)
    parser.add_argument("--output-dir", "--dir", "-d", dest="dir", help="Target output directory", default="backups")
    parser.add_argument("--database", "--db", dest="database", help="Target database name (overrides DB_NAME)", default=None)
    parser.add_argument("--verbose", "-v", action="store_true", help="Enable verbose diagnostic output")
    args = parser.parse_args()
    create_backup(target_dir=args.dir, output_file=args.output, database=args.database, verbose=args.verbose)
