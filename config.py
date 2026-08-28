"""
Centralized app configuration. All env vars are loaded once here and
imported everywhere else as `settings`.
"""
from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # AI Services
    openai_api_key: str = ""
    anthropic_api_key: str = ""
    transcription_provider: str = "openai_whisper"

    # Storage
    storage_backend: str = "local"
    local_storage_path: str = "./storage"
    s3_bucket_name: str = ""
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""
    aws_region: str = "us-east-1"

    # Job queue
    redis_url: str = "redis://localhost:6379/0"

    # App behavior
    max_upload_size_mb: int = 2048
    clip_min_duration_sec: int = 15
    clip_max_duration_sec: int = 60
    cors_origins: str = "http://localhost:3000"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",")]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
