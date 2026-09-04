from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import Settings, get_settings
from app.core.database import Base, get_db
from app.core.security import create_access_token, decode_access_token
from app.main import app


def test_jwt_round_trip_and_expiration():
    settings = Settings(jwt_secret_key="test-secret", jwt_access_token_expire_minutes=1)
    token = create_access_token("user-1", settings)
    assert decode_access_token(token, settings) == "user-1"

    expired = create_access_token("user-1", settings)
    import jwt
    expired = jwt.encode(
        {"sub": "user-1", "exp": 0}, settings.jwt_secret_key, algorithm=settings.jwt_algorithm
    )
    from fastapi import HTTPException
    try:
        decode_access_token(expired, settings)
    except HTTPException as error:
        assert error.status_code == 401
    else:
        raise AssertionError("expired JWT should be rejected")


def test_mock_login_creates_and_reuses_same_user():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine)
    settings = Settings(
        app_env="development",
        enable_mock_login=True,
        jwt_secret_key="test-secret",
    )
    app.dependency_overrides[get_db] = lambda: session_factory()
    app.dependency_overrides[get_settings] = lambda: settings
    try:
        client = TestClient(app)
        first = client.post("/api/v1/auth/wechat-login", json={"code": "same-code"})
        second = client.post("/api/v1/auth/wechat-login", json={"code": "same-code"})
        assert first.status_code == 200
        assert second.status_code == 200
        assert first.json()["code"] == 0
        assert first.json()["data"]["user"]["id"] == second.json()["data"]["user"]["id"]
    finally:
        app.dependency_overrides.clear()