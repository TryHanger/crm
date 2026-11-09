import os
import zipfile

def package_delivery():
    output_zip = "CRM_PILOT_READINESS_AUDIT_GATE_DELIVERY.zip"
    if os.path.exists(output_zip):
        os.remove(output_zip)

    include_dirs = [
        "apps",
        "packages",
        "tests",
        "docs",
        "scripts",
        "alembic",
        "nginx",
        "backups",
        ".github"
    ]
    include_files = [
        "Dockerfile",
        "Dockerfile.frontend",
        "docker-compose.yml",
        "docker-compose.staging.yml",
        "Makefile",
        ".dockerignore",
        ".env.example",
        ".env.staging.example",
        ".gitignore",
        "openapi.json",
        "pytest.ini",
        "pyproject.toml",
        "requirements.txt",
        "README.md",
        "PILOT_GO_NO_GO.md",
        "STAGING_RUNBOOK.md",
        "RESTORE_RUNBOOK.md",
        "CRM_PILOT_47F5E652_INDEPENDENT_AUDIT_NEXT_GATE.md",
        "CRM_PILOT_CCC916DA_INDEPENDENT_AUDIT_AND_FINAL_RUNTIME_GATE.md",
        "alembic.ini",
        "package.json",
        "package-lock.json",
        "playwright.config.ts"
    ]

    ignore_patterns = [
        "node_modules",
        "dist",
        ".git",
        "__pycache__",
        ".pytest_cache",
        ".pyc",
        ".dump",
        "*.sql",
        "test-results",
        ".playwright-artifacts",
        "privkey.pem",
        ".env.staging",
        ".env"
    ]

    with zipfile.ZipFile(output_zip, "w", zipfile.ZIP_DEFLATED) as zf:
        # Add single files
        for fname in include_files:
            if os.path.exists(fname):
                zf.write(fname, fname)
                print(f"Added file: {fname}")

        # Add directories
        for dname in include_dirs:
            if not os.path.exists(dname):
                continue
            for root, dirs, files in os.walk(dname):
                # Filter out ignored dirs
                dirs[:] = [d for d in dirs if not any(p in d for p in ignore_patterns)]
                for f in files:
                    if any(p in f for p in ignore_patterns) or f.endswith(".sql") or f.endswith(".pyc") or f == "privkey.pem":
                        continue
                    full_path = os.path.join(root, f)
                    rel_path = os.path.relpath(full_path, ".")
                    zf.write(full_path, rel_path)

    print(f"\nAudit Delivery ZIP created successfully: {output_zip} ({os.path.getsize(output_zip)} bytes)")

if __name__ == "__main__":
    package_delivery()
