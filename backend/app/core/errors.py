"""Unified API response envelope and business error codes.

Every endpoint returns ``{"code": 0, "message": "ok", "data": ...}`` on
success and ``{"code": <business code>, "message": ..., "data": null}`` on
failure (keeping the original HTTP status code so clients can branch on it).
"""

from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

# Success code
OK_CODE = 0

# Business error codes
CODE_BAD_REQUEST = 4000      # invalid/business-rejected request
CODE_UNAUTHORIZED = 4010     # missing/invalid/expired login state
CODE_FORBIDDEN = 4030        # not allowed
CODE_NOT_FOUND = 4040        # resource does not exist
CODE_CONFLICT = 4090         # state conflict (e.g. quiz not completed yet)
CODE_VALIDATION = 4220       # request validation failed
CODE_INTERNAL = 5000         # unexpected server error
CODE_UNAVAILABLE = 5030      # upstream service (AI / WeChat) unavailable

# Fallback business code per HTTP status
_DEFAULT_CODE_BY_STATUS = {
    400: CODE_BAD_REQUEST,
    401: CODE_UNAUTHORIZED,
    403: CODE_FORBIDDEN,
    404: CODE_NOT_FOUND,
    409: CODE_CONFLICT,
    422: CODE_VALIDATION,
    500: CODE_INTERNAL,
    503: CODE_UNAVAILABLE,
}


class ApiError(Exception):
    """Business error carrying an HTTP status, a business code and a message."""

    def __init__(self, status_code: int, code: int, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


def ok(data: Any = None, message: str = "ok") -> dict:
    return {"code": OK_CODE, "message": message, "data": data}


def _envelope(status_code: int, code: int, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"code": code, "message": message, "data": None},
    )


async def _api_error_handler(request: Request, exc: ApiError) -> JSONResponse:
    return _envelope(exc.status_code, exc.code, exc.message)


async def _http_error_handler(request: Request, exc: HTTPException) -> JSONResponse:
    status_code = exc.status_code
    detail = exc.detail
    message = detail if isinstance(detail, str) else "请求处理失败"
    code = _DEFAULT_CODE_BY_STATUS.get(status_code, CODE_INTERNAL)
    return _envelope(status_code, code, message)


async def _validation_error_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    return _envelope(422, CODE_VALIDATION, "参数校验失败")


def register_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(ApiError, _api_error_handler)
    app.add_exception_handler(HTTPException, _http_error_handler)
    app.add_exception_handler(RequestValidationError, _validation_error_handler)
