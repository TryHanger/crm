import os
from typing import List, Optional
from pydantic_settings import BaseSettings
from pydantic import Field, field_validator

class Settings(BaseSettings):
    PROJECT_NAME: str = "SaaS Online Booking & CRM Platform"
    API_V1_STR: str = "/api/v1"
    ENVIRONMENT: str = Field(default=os.getenv("ENVIRONMENT", "development"))  # development, test, production

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

    # Dynamic URLs with priority to explicit environment variables
    @property
    def ASYNC_DATABASE_URL(self) -> str:
        if self.DATABASE_URL:
            # Ensure asyncpg dialect
            url = self.DATABASE_URL
            if url.startswith("postgresql://"):
                url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
            elif not url.startswith("postgresql+asyncpg://"):
                url = f"postgresql+asyncpg://{url}"
            return url
        pwd = f":{self.DB_PASSWORD}" if self.DB_PASSWORD else ""
        return f"postgresql+asyncpg://{self.DB_USER}{pwd}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"

    @property
    def SYNC_DATABASE_URL(self) -> str:
        if self.DATABASE_URL:
            url = self.DATABASE_URL
            if url.startswith("postgresql+asyncpg://"):
                url = url.replace("postgresql+asyncpg://", "postgresql+psycopg2://", 1)
            elif url.startswith("postgresql://"):
                url = url.replace("postgresql://", "postgresql+psycopg2://", 1)
            return url
        pwd = f":{self.DB_PASSWORD}" if self.DB_PASSWORD else ""
        return f"postgresql+psycopg2://{self.DB_USER}{pwd}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"

    @property
    def ADMIN_SYNC_DATABASE_URL(self) -> str:
        if self.ADMIN_DATABASE_URL:
            url = self.ADMIN_DATABASE_URL
            if url.startswith("postgresql+asyncpg://"):
                url = url.replace("postgresql+asyncpg://", "postgresql+psycopg2://", 1)
            elif url.startswith("postgresql://"):
                url = url.replace("postgresql://", "postgresql+psycopg2://", 1)
            return url
        pwd = f":{self.ADMIN_DB_PASSWORD}" if self.ADMIN_DB_PASSWORD else ""
        return f"postgresql+psycopg2://{self.ADMIN_DB_USER}{pwd}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"

    # JWT / OIDC Security
    JWT_SECRET: str = Field(default=os.getenv("JWT_SECRET_KEY") or os.getenv("JWT_SECRET") or "dev-insecure-jwt-secret-key-change-in-production-1234567890")
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 24 hours

    # Domains
    PLATFORM_DOMAIN: str = Field(default=os.getenv("PLATFORM_ROOT_DOMAIN") or os.getenv("PLATFORM_DOMAIN") or "platform.example.kz")
    CRM_DOMAIN: str = "app.example.kz"
    BOOKING_DOMAIN_SUFFIX: str = ".book.example.kz"

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

    def validate_production_security(self):
        """Enforces fail-fast validation when running in production."""
        if self.ENVIRONMENT == "production":
            if "dev-insecure" in self.JWT_SECRET or len(self.JWT_SECRET) < 32:
                raise RuntimeError("FATAL: Insecure or default JWT_SECRET configured in production environment!")
            if "*" in self.CORS_ORIGINS:
                raise RuntimeError("FATAL: Wildcard '*' CORS origin is strictly forbidden in production!")

    class Config:
        env_file = ".env"
        extra = "allow"

settings = Settings()
settings.validate_production_security()
