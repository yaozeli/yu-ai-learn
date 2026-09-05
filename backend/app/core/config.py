from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Primary provider strategy: "agnes" (primary) or "deepseek"
    llm_primary_provider: str = "agnes"

    # Agnes AI (primary provider)
    agnes_api_key: str = ""
    agnes_model: str = ""
    agnes_base_url: str = ""
    agnes_request_timeout: float = 30.0

    # DeepSeek (fallback provider)
    deepseek_api_key: str = ""
    deepseek_model: str = "deepseek-chat"
    deepseek_base_url: str = "https://api.deepseek.com"
    llm_timeout_seconds: float = 30.0
    llm_max_retries: int = 2
    wechat_app_id: str = ""
    wechat_app_secret: str = ""
    mysql_host: str = ""
    mysql_port: int = 3306
    mysql_database: str = ""
    mysql_user: str = ""
    mysql_password: str = ""
    mysql_charset: str = "utf8mb4"
    mysql_timezone: str = ""
    jwt_secret_key: str = ""
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 120
    app_env: str = "development"
    enable_mock_login: bool = False
    # Base URL used to build absolute avatar URLs (must be reachable from the
    # mini program, e.g. the dev server address or a CDN domain).
    public_base_url: str = "http://127.0.0.1:8000"
    # Directory that stores uploaded avatars. Empty means
    # <backend>/uploads/avatars by default.
    avatar_upload_dir: str = ""
    # Mini program code (share poster). env_version: release | trial | develop.
    # "develop" lets developers open the code during development; switch to
    # "release" once the mini program is published.
    wechat_qrcode_env_version: str = "develop"
    # Page the poster code opens.
    wechat_qrcode_page: str = "pages/index/index"

    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()


def avatar_upload_dir(settings: Settings | None = None) -> Path:
    """Single source of truth for where uploaded avatars live. Both the upload
    endpoint and the static file mount must resolve to this same directory.

    Defaults to <backend>/uploads/avatars (config.py lives at
    backend/app/core/config.py).
    """
    settings = settings or get_settings()
    if settings.avatar_upload_dir:
        return Path(settings.avatar_upload_dir)
    return Path(__file__).resolve().parents[2] / "uploads" / "avatars"