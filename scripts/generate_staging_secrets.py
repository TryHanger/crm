#!/usr/bin/env python3
"""
SaaS CRM - Cryptographically Strong Secret Generator for Staging and Production.
Generates unique, high-entropy secrets compliant with fail-fast security constraints.
Zero hardcoded passwords.
"""

import os
import sys
import secrets
import string
import argparse
from typing import Dict, Any


def generate_alphanumeric_secret(length: int = 32, special_chars: str = "!%-_=") -> str:
    """
    Generates a cryptographically strong secret string containing uppercase,
    lowercase, digits, and safe special characters (avoiding URL-delimiters like :, @, /).
    """
    alphabet = string.ascii_letters + string.digits + special_chars
    # Ensure at least one uppercase, lowercase, digit, and special char
    while True:
        password = "".join(secrets.choice(alphabet) for _ in range(length))
        if (any(c.islower() for c in password)
                and any(c.isupper() for c in password)
                and any(c.isdigit() for c in password)
                and any(c in special_chars for c in password)):
            return password


def generate_jwt_secret(bytes_entropy: int = 48) -> str:
    """Generates a high-entropy URL-safe JWT secret key (minimum 48 bytes entropy)."""
    return secrets.token_urlsafe(bytes_entropy)


def generate_staging_env_dict() -> Dict[str, str]:
    """
    Generates full set of runtime and infrastructure secrets.
    Prioritizes existing secure environment variables if set in external vault/CI,
    otherwise dynamically derives fresh cryptographically secure random values.
    """
    postgres_password = os.getenv("CI_POSTGRES_PASSWORD") or generate_alphanumeric_secret(28)
    db_password = os.getenv("CI_DB_PASSWORD") or generate_alphanumeric_secret(28)
    jwt_secret = os.getenv("CI_JWT_SECRET_KEY") or generate_jwt_secret(48)
    owner_password = os.getenv("CI_INITIAL_PLATFORM_OWNER_PASSWORD") or generate_alphanumeric_secret(24)

    return {
        "POSTGRES_DB": os.getenv("POSTGRES_DB", "saas_crm_staging"),
        "POSTGRES_USER": os.getenv("POSTGRES_USER", "postgres"),
        "POSTGRES_PASSWORD": postgres_password,
        "DB_USER": os.getenv("DB_USER", "crm_app_user"),
        "DB_PASSWORD": db_password,
        "JWT_SECRET_KEY": jwt_secret,
        "INITIAL_PLATFORM_OWNER_EMAIL": os.getenv("INITIAL_PLATFORM_OWNER_EMAIL", "admin@staging.crm.internal"),
        "INITIAL_PLATFORM_OWNER_PASSWORD": owner_password,
        "INITIAL_PLATFORM_OWNER_NAME": os.getenv("INITIAL_PLATFORM_OWNER_NAME", "Platform Administrator"),
        "PLATFORM_IP_ALLOWLIST": os.getenv("PLATFORM_IP_ALLOWLIST", "127.0.0.1,::1,172.28.0.0/16,10.0.0.0/8"),
        "BOOKING_DOMAIN_SUFFIX": os.getenv("BOOKING_DOMAIN_SUFFIX", ".book.staging.crm.internal"),
        "CRM_DOMAIN": os.getenv("CRM_DOMAIN", "app.staging.crm.internal"),
        "PLATFORM_DOMAIN": os.getenv("PLATFORM_DOMAIN", "console.staging.crm.internal"),
        "SMTP_HOST": os.getenv("SMTP_HOST", ""),
        "SMTP_PORT": os.getenv("SMTP_PORT", "587"),
        "SMTP_USER": os.getenv("SMTP_USER", ""),
        "SMTP_PASSWORD": os.getenv("SMTP_PASSWORD", ""),
        "SMTP_FROM": os.getenv("SMTP_FROM", "noreply@staging.crm.internal"),
    }


def write_env_file(filepath: str, env_vars: Dict[str, str]) -> None:
    """Writes environment variables to specified file with strict comments and formatting."""
    content = [
        "# ============================================================================",
        "# SaaS CRM Staging Environment Configuration",
        "# Dynamically Generated with Cryptographically Secure Random Secrets",
        "# DO NOT COMMIT THIS FILE OR REUSE CREDENTIALS ACROSS ENVIRONMENTS",
        "# ============================================================================",
        "ENVIRONMENT=staging",
        "DEBUG=false",
        "ENABLE_DEMO_SEED=false",
        "",
        "# Database Credentials",
        f"POSTGRES_DB={env_vars['POSTGRES_DB']}",
        f"POSTGRES_USER={env_vars['POSTGRES_USER']}",
        f"POSTGRES_PASSWORD={env_vars['POSTGRES_PASSWORD']}",
        f"DB_USER={env_vars['DB_USER']}",
        f"DB_PASSWORD={env_vars['DB_PASSWORD']}",
        "",
        "# Cryptographic Security & Tokens",
        f"JWT_SECRET_KEY={env_vars['JWT_SECRET_KEY']}",
        "",
        "# Initial Bootstrap Platform Administrator",
        f"INITIAL_PLATFORM_OWNER_EMAIL={env_vars['INITIAL_PLATFORM_OWNER_EMAIL']}",
        f"INITIAL_PLATFORM_OWNER_PASSWORD={env_vars['INITIAL_PLATFORM_OWNER_PASSWORD']}",
        f"INITIAL_PLATFORM_OWNER_NAME=\"{env_vars['INITIAL_PLATFORM_OWNER_NAME']}\"",
        "",
        "# Network & Routing",
        f"PLATFORM_IP_ALLOWLIST={env_vars['PLATFORM_IP_ALLOWLIST']}",
        f"BOOKING_DOMAIN_SUFFIX={env_vars['BOOKING_DOMAIN_SUFFIX']}",
        f"CRM_DOMAIN={env_vars['CRM_DOMAIN']}",
        f"PLATFORM_DOMAIN={env_vars['PLATFORM_DOMAIN']}",
        "",
        "# Transactional Delivery Transport",
        f"SMTP_HOST={env_vars['SMTP_HOST']}",
        f"SMTP_PORT={env_vars['SMTP_PORT']}",
        f"SMTP_USER={env_vars['SMTP_USER']}",
        f"SMTP_PASSWORD={env_vars['SMTP_PASSWORD']}",
        f"SMTP_FROM={env_vars['SMTP_FROM']}",
        ""
    ]
    with open(filepath, "w", encoding="utf-8") as f:
        f.write("\n".join(content))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate cryptographically secure staging environment secrets")
    parser.add_argument("--output", "-o", default=".env.staging", help="Target output file path")
    parser.add_argument("--force", "-f", action="store_true", help="Force overwrite existing env file")
    args = parser.parse_args()

    if os.path.exists(args.output) and not args.force:
        print(f"[!] Target file '{args.output}' already exists. Use --force to overwrite.")
        sys.exit(0)

    secrets_dict = generate_staging_env_dict()
    write_env_file(args.output, secrets_dict)
    print(f"[+] Successfully generated secure staging secrets in '{args.output}'.")
    print(f"    Platform Admin Email: {secrets_dict['INITIAL_PLATFORM_OWNER_EMAIL']}")
    print(f"    Platform Admin Password: {secrets_dict['INITIAL_PLATFORM_OWNER_PASSWORD'][:4]}*** (randomized)")
