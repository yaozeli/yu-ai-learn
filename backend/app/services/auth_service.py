from datetime import datetime, timezone
from uuid import uuid4

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models_user import UserEntity


class AuthenticationError(RuntimeError):
    pass


def exchange_wechat_code(code: str, settings: Settings) -> tuple[str, str, str]:
    if settings.enable_mock_login and settings.app_env != "production":
        return f"mock-openid-{code}", "开发用户", ""
    if not settings.wechat_app_id or not settings.wechat_app_secret:
        raise AuthenticationError("未配置微信登录参数")
    try:
        response = httpx.get(
            "https://api.weixin.qq.com/sns/jscode2session",
            params={
                "appid": settings.wechat_app_id,
                "secret": settings.wechat_app_secret,
                "js_code": code,
                "grant_type": "authorization_code",
            },
            timeout=10,
        )
        response.raise_for_status()
        result = response.json()
    except (httpx.HTTPError, ValueError) as error:
        raise AuthenticationError("微信登录服务暂时不可用") from error
    if result.get("errcode") or not result.get("openid"):
        raise AuthenticationError("微信登录凭证无效")
    return result["openid"], "", ""


def upsert_user(session: Session, openid: str, nickname: str = "", avatar_url: str = "") -> UserEntity:
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    user = session.scalar(select(UserEntity).where(UserEntity.openid == openid))
    if user is None:
        user = UserEntity(
            id=str(uuid4()),
            openid=openid,
            nickname=nickname,
            avatar_url=avatar_url,
            created_at=now,
            updated_at=now,
            last_login_at=now,
        )
        session.add(user)
    else:
        user.last_login_at = now
        if nickname:
            user.nickname = nickname
        if avatar_url:
            user.avatar_url = avatar_url
    session.commit()
    session.refresh(user)
    return user