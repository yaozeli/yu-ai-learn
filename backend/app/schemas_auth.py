from pydantic import BaseModel, Field


class WechatLoginRequest(BaseModel):
    code: str = Field(min_length=1, max_length=512)


class UserProfile(BaseModel):
    id: str
    nickname: str
    avatar_url: str


class UserProfileUpdate(BaseModel):
    nickname: str | None = Field(default=None, min_length=1, max_length=64)
    avatar_url: str | None = Field(default=None, max_length=512)


class AuthResponse(BaseModel):
    token: str
    user: UserProfile