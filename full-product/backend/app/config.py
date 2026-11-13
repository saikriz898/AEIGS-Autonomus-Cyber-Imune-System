import os
from dataclasses import dataclass


@dataclass
class Settings:
    database_url: str = os.getenv("DATABASE_URL", "postgresql+psycopg://aegis@localhost:5432/aegis")
    redis_url: str = os.getenv("REDIS_URL", "redis://redis:6379/0")
    setup_token: str = os.getenv("SETUP_TOKEN", "")
    session_ttl_hours: int = int(os.getenv("SESSION_TTL_HOURS", "12"))
    cookie_secure: bool = os.getenv("COOKIE_SECURE", "false").lower() == "true"
    frontend_origin: str = os.getenv("FRONTEND_ORIGIN", "http://localhost:3000")
    storage_root: str = os.getenv("STORAGE_ROOT", "/storage")
    max_upload_bytes: int = int(os.getenv("MAX_UPLOAD_BYTES", "104857600"))
    code_version: str = os.getenv("CODE_VERSION", "development")


settings = Settings()
if "CHANGE_ME" in settings.database_url or "replace-with" in settings.database_url.lower():
    raise RuntimeError(
        "Database credentials contain an example placeholder. Generate local configuration before starting AEGIS."
    )
