from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.core.config import Settings, avatar_upload_dir, get_settings
from app.core.database import get_db
from app.core.errors import ok
from app.core.security import bearer_scheme, create_access_token, require_user_id
from app.schemas_auth import AuthResponse, UserProfile, UserProfileUpdate, WechatLoginRequest
from app.services.auth_service import AuthenticationError, exchange_wechat_code, upsert_user
from app.models_user import UserEntity
from app.services.learning_service import get_user_overview


router = APIRouter(prefix="/api/v1")


def profile(user: UserEntity) -> UserProfile:
    return UserProfile(id=user.id, nickname=user.nickname, avatar_url=user.avatar_url)


@router.post("/auth/wechat-login")
def wechat_login(
    payload: WechatLoginRequest,
    settings: Settings = Depends(get_settings),
    session: Session = Depends(get_db),
):
    try:
        openid, nickname, avatar_url = exchange_wechat_code(payload.code, settings)
        user = upsert_user(session, openid, nickname, avatar_url)
    except AuthenticationError as error:
        raise HTTPException(status_code=401, detail=str(error)) from error
    return ok(AuthResponse(token=create_access_token(user.id, settings), user=profile(user)))


@router.post("/auth/logout")
def logout(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    settings=Depends(get_settings),
):
    require_user_id(credentials, settings)
    return ok(None)


@router.get("/users/me")
def get_current_profile(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    settings=Depends(get_settings),
    session: Session = Depends(get_db),
):
    user_id = require_user_id(credentials, settings)
    user = session.get(UserEntity, user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="登录状态已失效")
    return ok(profile(user))


@router.patch("/users/me")
def update_current_profile(
    payload: UserProfileUpdate,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    settings=Depends(get_settings),
    session: Session = Depends(get_db),
):
    user_id = require_user_id(credentials, settings)
    user = session.get(UserEntity, user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="登录状态已失效")
    if payload.nickname is None and payload.avatar_url is None:
        raise HTTPException(status_code=400, detail="至少提供一项需要修改的资料")
    if payload.nickname is not None:
        user.nickname = payload.nickname.strip()
    if payload.avatar_url is not None:
        user.avatar_url = payload.avatar_url.strip()
    session.commit()
    session.refresh(user)
    return ok(profile(user))


@router.post("/users/me/avatar")
def upload_current_avatar(
    file: UploadFile = File(...),
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    settings: Settings = Depends(get_settings),
    session: Session = Depends(get_db),
):
    """Accept a mini-program avatar image and expose it as a static URL so the
    client can then PATCH /users/me with the returned avatar_url."""
    user_id = require_user_id(credentials, settings)
    user = session.get(UserEntity, user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="登录状态已失效")

    ext = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
    }.get((file.content_type or "").lower())
    if ext is None:
        raise HTTPException(status_code=400, detail="头像仅支持 JPG/PNG/WebP 图片")

    data = file.file.read(2 * 1024 * 1024 + 1)
    if len(data) > 2 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="头像图片不能超过 2MB")
    if not data:
        raise HTTPException(status_code=400, detail="头像图片内容为空")

    upload_dir = avatar_upload_dir(settings)
    upload_dir.mkdir(parents=True, exist_ok=True)
    # Remove any previously uploaded avatar of this user (other extensions).
    for old in upload_dir.glob(f"{user.id}.*"):
        old.unlink(missing_ok=True)
    filename = f"{user.id}.{ext}"
    (upload_dir / filename).write_bytes(data)

    avatar_url = f"{settings.public_base_url.rstrip('/')}/static/avatars/{filename}"
    user.avatar_url = avatar_url
    session.commit()
    session.refresh(user)
    return ok({"avatar_url": avatar_url})


@router.get("/users/me/overview")
def current_user_overview(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    settings: Settings = Depends(get_settings),
    session: Session = Depends(get_db),
):
    user_id = require_user_id(credentials, settings)
    return ok(get_user_overview(session, user_id))