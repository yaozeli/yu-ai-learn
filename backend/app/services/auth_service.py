from datetime import datetime, timezone
from uuid import uuid4

import time
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

class WechatApiError(RuntimeError):
    """Raised when a WeChat open-platform API call fails."""


# appid -> (access_token, expires_at). WeChat tokens live ~7200s; refresh
# shortly before expiry so concurrent poster requests share one token.
_ACCESS_TOKEN_CACHE: dict[str, tuple[str, float]] = {}


def _wechat_access_token(settings: Settings) -> str:
    """Fetch (and cache) a WeChat access_token for the configured mini program."""
    if not settings.wechat_app_id or not settings.wechat_app_secret:
        raise WechatApiError("未配置小程序 AppID/Secret")
    cached = _ACCESS_TOKEN_CACHE.get(settings.wechat_app_id)
    if cached and cached[1] > time.time() + 60:
        return cached[0]
    try:
        response = httpx.get(
            "https://api.weixin.qq.com/cgi-bin/token",
            params={
                "grant_type": "client_credential",
                "appid": settings.wechat_app_id,
                "secret": settings.wechat_app_secret,
            },
            timeout=10,
        )
        response.raise_for_status()
        result = response.json()
    except (httpx.HTTPError, ValueError) as error:
        raise WechatApiError("获取微信 access_token 失败，请稍后重试") from error
    if result.get("errcode") or not result.get("access_token"):
        raise WechatApiError(
            f"微信 access_token 获取失败：{result.get('errmsg', '未知错误')}"
        )
    token = result["access_token"]
    expires_in = int(result.get("expires_in", 7200))
    _ACCESS_TOKEN_CACHE[settings.wechat_app_id] = (token, time.time() + expires_in)
    return token


def fetch_wxacode_unlimit(
    settings: Settings,
    scene: str = "poster",
    page: str | None = None,
    width: int = 280,
    env_version: str | None = None,
) -> bytes:
    """Generate a mini-program code (wxacode) via getwxacodeunlimit.

    Returns the raw PNG bytes. The code opens the mini program page carrying
    the scene string. An expired cached access_token triggers one refresh and
    retry.
    """
    payload = {
        "scene": (scene or "poster")[:32],
        "width": width,
        "check_path": False,
        "env_version": env_version or settings.wechat_qrcode_env_version,
    }
    if page:
        payload["page"] = page
    for attempt in range(2):
        token = _wechat_access_token(settings)
        try:
            response = httpx.post(
                f"https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token={token}",
                json=payload,
                timeout=15,
            )
            response.raise_for_status()
            content_type = response.headers.get("content-type", "")
            if "json" in content_type or not response.content:
                result = response.json() if response.content else {}
                errcode = result.get("errcode") if isinstance(result, dict) else None
                if attempt == 0 and errcode in (40001, 42001):
                    # Stale/invalid token: drop the cache entry and retry once.
                    _ACCESS_TOKEN_CACHE.pop(settings.wechat_app_id, None)
                    continue
                message = result.get("errmsg") if isinstance(result, dict) else ""
                raise WechatApiError(f"小程序码生成失败：{message or '未知错误'}")
            return response.content
        except httpx.HTTPError as error:
            raise WechatApiError("调用微信小程序码接口失败，请稍后重试") from error
    raise WechatApiError("小程序码生成失败，请稍后重试")
