from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.database import get_db
from app.core.errors import ok
from app.core.security import bearer_scheme, require_user_id
from app.llm import build_llm
from app.models import AnswerRecord, QuizOption, QuizQuestion, ReportRequest
from app.models_learning import AnswerRecordEntity, QuestionSnapshotEntity
from app.schemas_learning import AnswerSubmit
from app.services.learning_service import (
    apply_report_result,
    complete_quiz,
    create_review_session,
    get_or_create_report,
    get_owned_quiz,
    get_quiz_detail_data,
    get_wrong_question_data,
    list_hot_topics,
    list_in_progress,
    list_quiz_history,
    list_wrong_questions,
    mark_report_failed,
    submit_answer,
)
from app.services.report_service import ReportGenerationError, generate_report


router = APIRouter(prefix="/api/v1")


def current_user_id(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    settings: Settings = Depends(get_settings),
) -> str:
    return require_user_id(credentials, settings)


@router.post("/quiz/{quiz_id}/answers")
def answer_quiz_question(
    quiz_id: str,
    payload: AnswerSubmit,
    user_id: str = Depends(current_user_id),
    session: Session = Depends(get_db),
):
    try:
        return ok(submit_answer(session, user_id, quiz_id, payload))
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.post("/quiz/{quiz_id}/complete")
def complete_quiz_session(
    quiz_id: str,
    user_id: str = Depends(current_user_id),
    session: Session = Depends(get_db),
):
    try:
        return ok(complete_quiz(session, user_id, quiz_id))
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.get("/hot-topics")
def hot_topics(
    limit: int = 8,
    user_id: str = Depends(current_user_id),
    session: Session = Depends(get_db),
):
    """Real hot topics: most-completed quiz topics across all users."""
    limit = min(max(limit, 1), 20)
    return ok({"items": list_hot_topics(session, limit)})


# NOTE: keep /quiz/in-progress registered before /quiz/{quiz_id} below so the
# literal segment matches first instead of being captured as a quiz id.
@router.get("/quiz/in-progress")
def in_progress_quizzes(
    user_id: str = Depends(current_user_id),
    session: Session = Depends(get_db),
):
    return ok({"items": list_in_progress(session, user_id)})


@router.get("/history/quizzes")
def quiz_history(
    page: int = 1,
    page_size: int = 20,
    user_id: str = Depends(current_user_id),
    session: Session = Depends(get_db),
):
    page = max(page, 1)
    page_size = min(max(page_size, 1), 50)
    items, total = list_quiz_history(session, user_id, page, page_size)
    return ok({
        "items": items,
        "page": page,
        "page_size": page_size,
        "has_more": page * page_size < total,
        "total": total,
    })


@router.get("/history/quizzes/{quiz_id}")
@router.get("/quiz/{quiz_id}")
def quiz_detail(
    quiz_id: str,
    user_id: str = Depends(current_user_id),
    session: Session = Depends(get_db),
):
    try:
        return ok(get_quiz_detail_data(session, user_id, quiz_id))
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.get("/wrong-questions/detail")
@router.get("/wrong-questions")
def wrong_questions(
    page: int = 1,
    page_size: int = 20,
    user_id: str = Depends(current_user_id),
    session: Session = Depends(get_db),
):
    """Return wrong questions with full question snapshot details."""
    page = max(page, 1)
    page_size = min(max(page_size, 1), 50)
    items, total = list_wrong_questions(session, user_id, page, page_size)
    return ok({
        "items": items,
        "page": page,
        "page_size": page_size,
        "has_more": page * page_size < total,
        "total": total,
    })


@router.get("/wrong-questions/{wrong_question_id}")
def wrong_question_detail(
    wrong_question_id: str,
    user_id: str = Depends(current_user_id),
    session: Session = Depends(get_db),
):
    try:
        return ok(get_wrong_question_data(session, user_id, wrong_question_id))
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.post("/wrong-questions/{wrong_question_id}/retry")
def retry_wrong_question(
    wrong_question_id: str,
    user_id: str = Depends(current_user_id),
    session: Session = Depends(get_db),
):
    """Create a single-question review session from a wrong question."""
    try:
        return ok(create_review_session(session, user_id, wrong_question_id))
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.post("/quiz/{quiz_id}/report")
def generate_quiz_report(
    quiz_id: str,
    user_id: str = Depends(current_user_id),
    settings: Settings = Depends(get_settings),
    session: Session = Depends(get_db),
):
    try:
        quiz = get_owned_quiz(session, user_id, quiz_id)
        if quiz.status != "completed":
            raise ValueError("请完成闯关后再生成报告")
        snapshots = session.scalars(select(QuestionSnapshotEntity).where(
            QuestionSnapshotEntity.quiz_session_id == quiz.id,
        ).order_by(QuestionSnapshotEntity.question_order)).all()
        records = session.scalars(select(AnswerRecordEntity).where(
            AnswerRecordEntity.quiz_session_id == quiz.id,
            AnswerRecordEntity.user_id == user_id,
        )).all()
        if len(records) != quiz.question_count:
            raise ValueError("请完成闯关后再生成报告")
        request = ReportRequest(
            quiz_id=quiz.id,
            topic=quiz.topic,
            questions=[QuizQuestion(
                id=item.question_id, type=item.question_type, stem=item.stem,
                options=[QuizOption.model_validate(option) for option in item.options],
                answer=item.correct_answers, explanation=item.explanation,
                knowledge_point=item.knowledge_point, difficulty=item.difficulty,
            ) for item in snapshots],
            answer_records=[AnswerRecord(
                question_id=snapshot.question_id,
                selected_answers=record.selected_answers,
                is_correct=record.is_correct,
                duration_ms=record.duration_ms,
            ) for snapshot in snapshots for record in records if record.question_snapshot_id == snapshot.id],
        )
        entity = get_or_create_report(session, quiz.id)
        try:
            report = generate_report(request, build_llm(settings))
        except (ReportGenerationError, RuntimeError) as error:
            mark_report_failed(session, entity)
            raise HTTPException(status_code=503, detail="复盘报告生成失败，请稍后重试") from error
        apply_report_result(session, entity, report)
        session.commit()
        return ok(report)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
