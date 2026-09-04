from __future__ import annotations

from fastapi import Depends, FastAPI, HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from fastapi.staticfiles import StaticFiles

from app.core.config import avatar_upload_dir, get_settings
from app.core.errors import ok, register_exception_handlers
from app.llm import build_llm
from app.models import QuizRequest, ReportRequest
from app.services.quiz_service import QuizGenerationError, generate_quiz
from app.services.report_service import ReportGenerationError, generate_report as generate_report_service
from app.api_auth import router as auth_router
from app.core.security import bearer_scheme, require_user_id
from app.core.database import get_db
from app.core.config import Settings
from app.services.learning_service import save_quiz
from app.models import Quiz
from sqlalchemy.orm import Session
from app.api_learning import router as learning_router

app = FastAPI(title="AI Quiz MVP Backend")
register_exception_handlers(app)
app.include_router(auth_router)
app.include_router(learning_router)

# Serve uploaded avatars under /static/avatars/<file>. Mount the parent of
# the avatar directory so the "avatars" URL segment maps onto it. Must stay
# in sync with app.core.config.avatar_upload_dir.
_avatar_upload_dir = avatar_upload_dir()
_avatar_upload_dir.mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory=str(_avatar_upload_dir.parent)), name="static")


@app.get("/api/v1/health")
@app.get("/health")
def health_check() -> dict:
    return ok({"status": "ok"})


@app.post("/api/v1/quiz/generate")
def generate_quiz_endpoint(
    payload: QuizRequest,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    settings: Settings = Depends(get_settings),
    session: Session = Depends(get_db),
) -> dict:
    try:
        user_id = require_user_id(credentials, settings)
        result = generate_quiz(payload.user_input, build_llm(settings))
        save_quiz(session, user_id, Quiz.model_validate(result))
        return ok(result)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except (QuizGenerationError, RuntimeError) as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@app.post("/api/v1/report/generate")
def generate_report(
    payload: ReportRequest,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    settings: Settings = Depends(get_settings),
) -> dict:
    try:
        require_user_id(credentials, settings)
        return ok(generate_report_service(payload, build_llm(settings)))
    except (ReportGenerationError, RuntimeError) as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
