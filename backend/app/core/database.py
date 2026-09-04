from functools import lru_cache

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import Settings, get_settings


class Base(DeclarativeBase):
    pass


def build_database_url(settings: Settings) -> str:
    if not all((settings.mysql_host, settings.mysql_database, settings.mysql_user)):
        raise RuntimeError("未配置完整的 MySQL 连接信息")
    return (
        f"mysql+pymysql://{settings.mysql_user}:{settings.mysql_password}"
        f"@{settings.mysql_host}:{settings.mysql_port}/{settings.mysql_database}"
        f"?charset={settings.mysql_charset}"
    )


@lru_cache
def get_session_factory():
    settings = get_settings()
    engine = create_engine(build_database_url(settings), pool_pre_ping=True)
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Session:
    session = get_session_factory()()
    try:
        yield session
    finally:
        session.close()