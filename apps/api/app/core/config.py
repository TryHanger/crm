import os

from typing import List, Optional

from pydantic_settings import BaseSettings

from pydantic import Field, field_validator



class Settings(BaseSettings):

    PROJECT_NAME: str = "SaaS Online Booking & CRM Platform"

    API_V1_STR: str = "/api/v1"

    ENVIRONMENT: str = Field(default=os.getenv("ENVIRONMENT", "development"))  # development, test, production

    ENABLE_DEMO_SEED: bool = Field(default=os.getenv("ENABLE_DEMO_SEED", "false").lower() in ("true", "1", "yes"))

    TRUSTED_PROXIES: List[str] = Field(default_factory=lambda: [p.strip() for p in os.getenv("TRUSTED_PROXIES", "127.0.0.1,::1,localhost").split(",") if p.strip()])

    ENABLE_API_DOCS: bool = Field(default=os.getenv("ENABLE_API_DOCS", "false").lower() in ("true", "1", "yes"))

    ALLOW_EMPTY_PLATFORM_IP_ALLOWLIST: bool = Field(default=os.getenv("ALLOW_EMPTY_PLATFORM_IP_ALLOWLIST", "false").lower() in ("true", "1", "yes"))



    # PostgreSQL Direct Connection Strings (preferred if provided, e.g. from Docker Compose / Cloud)

    DATABASE_URL: Optional[str] = Field(default=os.getenv("DATABASE_URL", None))

    ADMIN_DATABASE_URL: Optional[str] = Field(default=os.getenv("ADMIN_DATABASE_URL", None))



    # PostgreSQL Individual Connection Parameters (fallback if direct URLs not specified)

    DB_HOST: str = Field(default=os.getenv("DB_HOST", "127.0.0.1"))

    DB_PORT: int = Field(default=int(os.getenv("DB_PORT", "5433")))

    DB_USER: str = Field(default=os.getenv("DB_USER", "crm_app_user"))

    DB_PASSWORD: str = Field(default=os.getenv("DB_PASSWORD", "crm_app_secret"))

    ADMIN_DB_USER: str = Field(default=os.getenv("ADMIN_DB_USER", "postgres"))

    ADMIN_DB_PASSWORD: str = Field(default=os.getenv("ADMIN_DB_PASSWORD", "postgres"))

    DB_NAME: str = Field(default=os.getenv("DB_NAME", "saas_crm"))



    def set_test_database_name(self, test_db_name: str):

        """Forces settings to test mode and rebinds all URLs to the verified test database."""

        if not test_db_name.endswith("_test") or test_db_name in ("saas_crm", "postgres", "production"):

            raise RuntimeError(f"FATAL: Unsafe test database name '{test_db_name}'. Must end with '_test'.")

        self.ENVIRONMENT = "test"

        self.DB_NAME = test_db_name

        self.ENABLE_DEMO_SEED = True

        if self.DATABASE_URL:

            base, _ = self.DATABASE_URL.rsplit("/", 1)

            self.DATABASE_URL = f"{base}/{test_db_name}"

        if self.ADMIN_DATABASE_URL:

            base, _ = self.ADMIN_DATABASE_URL.rsplit("/", 1)

            self.ADMIN_DATABASE_URL = f"{base}/{test_db_name}"



    # Dynamic URLs with priority to explicit environment variables

    @property

    def ASYNC_DATABASE_URL(self) -> str:

        if self.DATABASE_URL:

            url = self.DATABASE_URL

            if self.ENVIRONMENT == "test":

                base, db_part = url.rsplit("/", 1)

                db_name = db_part.split("?")[0]

                if not db_name.endswith("_test") or db_name in ("saas_crm", "postgres", "production"):

                    raise RuntimeError(f"FATAL: In test mode, database URL must point to a database ending with '_test', got '{db_name}'!")

            if url.startswith("postgresql://"):

                url = url.replace("postgresql://", "postgresql+asyncpg://", 1)

            elif not url.startswith("postgresql+asyncpg://"):

                url = f"postgresql+asyncpg://{url}"

            return url

        if self.ENVIRONMENT == "test":

            if not self.DB_NAME.endswith("_test") or self.DB_NAME in ("saas_crm", "postgres", "production"):

                raise RuntimeError(f"FATAL: In test mode, DB_NAME must end with '_test', got '{self.DB_NAME}'!")

        pwd = f":{self.DB_PASSWORD}" if self.DB_PASSWORD else ""

        return f"postgresql+asyncpg://{self.DB_USER}{pwd}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"



    @property

    def SYNC_DATABASE_URL(self) -> str:

        if self.DATABASE_URL:

            url = self.DATABASE_URL

            if self.ENVIRONMENT == "test":

                base, db_part = url.rsplit("/", 1)

                db_name = db_part.split("?")[0]

                if not db_name.endswith("_test") or db_name in ("saas_crm", "postgres", "production"):

                    raise RuntimeError(f"FATAL: In test mode, database URL must point to a database ending with '_test', got '{db_name}'!")

            if url.startswith("postgresql+asyncpg://"):

                url = url.replace("postgresql+asyncpg://", "postgresql+psycopg2://", 1)

            elif url.startswith("postgresql://"):

                url = url.replace("postgresql://", "postgresql+psycopg2://", 1)

            return url

        if self.ENVIRONMENT == "test":

            if not self.DB_NAME.endswith("_test") or self.DB_NAME in ("saas_crm", "postgres", "production"):

                raise RuntimeError(f"FATAL: In test mode, DB_NAME must end with '_test', got '{self.DB_NAME}'!")

        pwd = f":{self.DB_PASSWORD}" if self.DB_PASSWORD else ""

        return f"postgresql+psycopg2://{self.DB_USER}{pwd}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"



    @property

    def ADMIN_SYNC_DATABASE_URL(self) -> str:

        if self.ADMIN_DATABASE_URL:

            url = self.ADMIN_DATABASE_URL

            if self.ENVIRONMENT == "test":

                base, db_part = url.rsplit("/", 1)

                db_name = db_part.split("?")[0]

                if not db_name.endswith("_test") or db_name in ("saas_crm", "postgres", "production"):

                    raise RuntimeError(f"FATAL: In test mode, ADMIN_DATABASE_URL must point to a database ending with '_test', got '{db_name}'!")

            if url.startswith("postgresql+asyncpg://"):

                url = url.replace("postgresql+asyncpg://", "postgresql+psycopg2://", 1)

            elif url.startswith("postgresql://"):

                url = url.replace("postgresql://", "postgresql+psycopg2://", 1)

            return url

        if self.ENVIRONMENT == "test":

            if not self.DB_NAME.endswith("_test") or self.DB_NAME in ("saas_crm", "postgres", "production"):

                raise RuntimeError(f"FATAL: In test mode, DB_NAME must end with '_test', got '{self.DB_NAME}'!")

        pwd = f":{self.ADMIN_DB_PASSWORD}" if self.ADMIN_DB_PASSWORD else ""

        return f"postgresql+psycopg2://{self.ADMIN_DB_USER}{pwd}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"



    # JWT / OIDC Security

    JWT_SECRET: str = Field(default=os.getenv("JWT_SECRET_KEY") or os.getenv("JWT_SECRET") or "dev-insecure-jwt-secret-key-change-in-production-1234567890")

    JWT_ALGORITHM: str = "HS256"

    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 24 hours



    # Domains

    PLATFORM_DOMAIN: str = Field(default=os.getenv("PLATFORM_ROOT_DOMAIN") or os.getenv("PLATFORM_DOMAIN") or "console.example.kz")

    CRM_DOMAIN: str = Field(default=os.getenv("CRM_DOMAIN", "app.example.kz"))

    BOOKING_DOMAIN_SUFFIX: str = Field(default=os.getenv("BOOKING_DOMAIN_SUFFIX", ".book.example.kz"))



    # SMTP & Transactional Delivery Transport

    SMTP_HOST: Optional[str] = Field(default=os.getenv("SMTP_HOST", None))

    SMTP_PORT: int = Field(default=int(os.getenv("SMTP_PORT", "587")))

    SMTP_USER: Optional[str] = Field(default=os.getenv("SMTP_USER", None))

    SMTP_PASSWORD: Optional[str] = Field(default=os.getenv("SMTP_PASSWORD", None))

    SMTP_FROM: str = Field(default=os.getenv("SMTP_FROM", "noreply@crm.internal"))



    # Security & IP Allowlist

    PLATFORM_IP_ALLOWLIST: List[str] = Field(

        default_factory=lambda: [ip.strip() for ip in os.getenv("PLATFORM_IP_ALLOWLIST", "").split(",") if ip.strip()]

    )

    RATE_LIMIT_ENABLED: bool = Field(default=os.getenv("RATE_LIMIT_ENABLED", "true").lower() in ("true", "1", "yes"))



    # Default Business / Booking policies

    DEFAULT_BOOK_AHEAD_DAYS: int = 30

    DEFAULT_MIN_ADVANCE_MINUTES: int = 120

    DEFAULT_CANCEL_CUTOFF_MINUTES: int = 180

    DEFAULT_SLOT_STEP_MINUTES: int = 15

    DEFAULT_MAX_SERVICES_PER_BOOKING: int = 5



    # CORS

    CORS_ORIGINS: List[str] = [

        "http://localhost:3000",

        "http://localhost:5173",

        "http://localhost:8000",

        "http://127.0.0.1:3000",

        "http://127.0.0.1:5173",

        "http://127.0.0.1:8000",

    ]



    def validate_environment_security(self):
        """Enforces fail-fast validation when running in staging or production environments."""
        valid_envs = ("development", "test", "staging", "production")
        if self.ENVIRONMENT not in valid_envs:
            raise RuntimeError(f"FATAL: Invalid ENVIRONMENT '{self.ENVIRONMENT}'. Must be one of {valid_envs}.")

        if self.ENVIRONMENT in ("staging", "production"):
            if self.ENABLE_DEMO_SEED:
                raise RuntimeError(f"FATAL: ENABLE_DEMO_SEED is strictly forbidden in {self.ENVIRONMENT} environment!")

            insecure_jwt_patterns = [
                "dev-insecure",
                "staging-secure-jwt-key",
                "test-jwt-secret-key",
                "super-secure-production-jwt",
                "replace-with",
                "secret-key",
                "change-me",
            ]
            if (
                any(pat in self.JWT_SECRET.lower() for pat in insecure_jwt_patterns)
                or len(self.JWT_SECRET) < 32
            ):
                raise RuntimeError(f"FATAL: Insecure or default JWT_SECRET configured in {self.ENVIRONMENT} environment (must be at least 32 characters and not use known defaults)!")

            insecure_db_passwords = {
                "crm_app_secret",
                "staging_app_secret_4412",
                "postgrespassword",
                "postgres",
                "password",
                "password123",
                "123456",
                "admin",
                "changeme",
            }
            if (
                self.DB_PASSWORD.lower() in insecure_db_passwords
                or any(pat in self.DB_PASSWORD.lower() for pat in ["replace-with", "crm_app_secret", "staging_app_secret"])
                or len(self.DB_PASSWORD) < 16
            ):
                raise RuntimeError(f"FATAL: Insecure or default DB_PASSWORD configured in {self.ENVIRONMENT} environment (must be at least 16 characters and not use known defaults)!")

            if self.ADMIN_DB_PASSWORD:
                insecure_admin_passwords = {
                    "postgrespassword",
                    "postgres",
                    "password",
                    "password123",
                    "staging_admin_secret_9921",
                    "admin",
                    "changeme",
                }
                if (
                    self.ADMIN_DB_PASSWORD.lower() in insecure_admin_passwords
                    or any(pat in self.ADMIN_DB_PASSWORD.lower() for pat in ["replace-with", "staging_admin_secret", "postgrespassword"])
                    or len(self.ADMIN_DB_PASSWORD) < 16
                ):
                    raise RuntimeError(f"FATAL: Default or weak admin database password configured in {self.ENVIRONMENT} environment!")

            if not self.PLATFORM_IP_ALLOWLIST and not self.ALLOW_EMPTY_PLATFORM_IP_ALLOWLIST:
                raise RuntimeError(f"FATAL: PLATFORM_IP_ALLOWLIST must not be empty in {self.ENVIRONMENT} environment! Platform Console endpoints must be restricted.")

            if "*" in self.CORS_ORIGINS:
                raise RuntimeError(f"FATAL: Wildcard '*' CORS origin is strictly forbidden in {self.ENVIRONMENT}!")



    class Config:

        env_file = ".env"

        extra = "allow"



settings = Settings()

settings.validate_environment_security()

