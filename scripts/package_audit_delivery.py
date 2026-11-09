import os
import zipfile

def package_delivery():
    output_zip = "SAAS_PLATFORM_V1_AUDIT_GATE_DELIVERY.zip"
    if os.path.exists(output_zip):
        os.remove(output_zip)

    include_dirs = [
        "apps",
        "packages",
        "tests",
        "docs",
        "scripts",
        "alembic",
        ".github"
    ]
    include_files = [
        "Dockerfile",
        "docker-compose.yml",
        "Makefile",
        ".dockerignore",
        ".env.example",
        ".gitignore",
        "openapi.json",
        "pytest.ini",
        "pyproject.toml",
        "requirements.txt",
        "README.md",
        "alembic.ini",
        "package.json",
        "package-lock.json",
        "playwright.config.ts",
        "PLATFORM_CONSOLE_E317373_INDEPENDENT_AUDIT_NEXT_GATE.md",
        "AUDIT_GATE_E317373_DIFF.patch",
        "AUDIT_GATE_COMMIT_STAT.txt"
    ]

    ignore_patterns = [
        "node_modules",
        "dist",
        ".git",
        "__pycache__",
        ".pytest_cache",
        ".pyc",
        ".dump",
        "test-results",
        ".playwright-artifacts"
    ]

    with zipfile.ZipFile(output_zip, "w", zipfile.ZIP_DEFLATED) as zf:
        # Add single files
        for fname in include_files:
            if os.path.exists(fname):
                zf.write(fname, fname)
                print(f"Added file: {fname}")

        # Add directories
        for dname in include_dirs:
            for root, dirs, files in os.walk(dname):
                # Filter out ignored dirs
                dirs[:] = [d for d in dirs if not any(p in d for p in ignore_patterns)]
                for f in files:
                    if any(p in f for p in ignore_patterns):
                        continue
                    full_path = os.path.join(root, f)
                    rel_path = os.path.relpath(full_path, ".")
                    zf.write(full_path, rel_path)

    print(f"\nAudit Delivery ZIP created successfully: {output_zip} ({os.path.getsize(output_zip)} bytes)")

if __name__ == "__main__":
    package_delivery()
