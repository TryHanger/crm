import os
import zipfile

def package_delivery():
    output_zip = "SAAS_PLATFORM_BACKEND_DELIVERY_V2.zip"
    if os.path.exists(output_zip):
        os.remove(output_zip)

    include_dirs = ["apps", "alembic", "docs", "packages", "scripts", "agent_pack"]
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
        "готовый фронт.html"
    ]

    ignore_patterns = ["__pycache__", ".pytest_cache", ".pyc", ".dump"]

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
                    print(f"Added: {rel_path}")

    print(f"\nDelivery ZIP created successfully: {output_zip} ({os.path.getsize(output_zip)} bytes)")

if __name__ == "__main__":
    package_delivery()
