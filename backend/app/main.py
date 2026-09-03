from __future__ import annotations

from fastapi import FastAPI, HTTPException

from app.core.config import get_settings
from app.llm import build_llm
from app.models import QuizRequest, ReportRequest
from app.services.quiz_service import QuizGenerationError, generate_quiz
from app.services.report_service import ReportGenerationError, generate_report as generate_report_service

app = FastAPI(title="AI Quiz MVP Backend")


@app.get("/api/v1/health")
@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/v1/quiz/generate")
def generate_quiz_endpoint(payload: QuizRequest) -> dict:
    try:
        return generate_quiz(payload.user_input, build_llm(get_settings()))
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except (QuizGenerationError, RuntimeError) as error:
        raise HTTPException(status_code=503, detail=str(error)) from error


@app.post("/api/v1/report/generate")
def generate_report(payload: ReportRequest) -> dict:
    try:
        return generate_report_service(payload, build_llm(get_settings()))
    except (ReportGenerationError, RuntimeError) as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
