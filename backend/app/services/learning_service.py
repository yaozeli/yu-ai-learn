from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session

from app.models import Quiz
from app.models_learning import (
    AnswerRecordEntity,
    QuestionSnapshotEntity,
    QuizSessionEntity,
    ReportEntity,
    WrongQuestionEntity,
)
from app.schemas_learning import AnswerSubmit


def now_utc() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


REVIEW_INTERVAL_DAYS = 3


def _iso(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def _quiz_summary_dict(quiz: QuizSessionEntity) -> dict:
    return {
        "id": quiz.id,
        "topic": quiz.topic,
        "title": quiz.title,
        "status": quiz.status,
        "correct_count": quiz.correct_count,
        "question_count": quiz.question_count,
        "accuracy": float(quiz.accuracy),
        "total_duration_ms": quiz.total_duration_ms,
        "created_at": _iso(quiz.created_at),
        "completed_at": _iso(quiz.completed_at),
        "review": quiz.review_for_wrong_question_id is not None,
    }


def _question_dict(snapshot: QuestionSnapshotEntity) -> dict:
    return {
        "id": snapshot.question_id,
        "type": snapshot.question_type,
        "stem": snapshot.stem,
        "options": snapshot.options,
        "answer": snapshot.correct_answers,
        "explanation": snapshot.explanation,
        "knowledge_point": snapshot.knowledge_point,
        "difficulty": snapshot.difficulty,
    }


def _report_dict(report: ReportEntity | None) -> dict | None:
    if report is None:
        return None
    return {
        "status": report.status,
        "accuracy": float(report.accuracy),
        "mastered_points": report.mastered_points,
        "weak_points": report.weak_points,
        "three_line_summary": report.three_line_summary,
        "advice": report.advice,
        "share_quote": report.share_quote,
        "generation_attempts": report.generation_attempts,
        "created_at": _iso(report.created_at),
        "updated_at": _iso(report.updated_at),
    }


def save_quiz(session: Session, user_id: str, quiz: Quiz) -> QuizSessionEntity:
    created = now_utc()
    quiz_session = QuizSessionEntity(
        id=quiz.quiz_id,
        user_id=user_id,
        topic=quiz.user_input,
        title=quiz.title,
        summary=quiz.summary,
        source_type=quiz.source_type,
        question_count=len(quiz.questions),
        created_at=created,
        updated_at=created,
    )
    session.add(quiz_session)
    # Flush the parent row first: without ORM relationships between these
    # entities, the unit of work does not know snapshots depend on the session
    # and may insert children first, which MySQL rejects with FK error 1452.
    session.flush()
    for index, question in enumerate(quiz.questions):
        session.add(QuestionSnapshotEntity(
            id=str(uuid4()),
            quiz_session_id=quiz.quiz_id,
            question_id=str(question.id),
            question_order=index,
            question_type=question.type,
            stem=question.stem,
            options=[option.model_dump() for option in question.options],
            correct_answers=question.answer,
            explanation=question.explanation,
            knowledge_point=question.knowledge_point,
            difficulty=question.difficulty,
            created_at=created,
        ))
    session.commit()
    session.refresh(quiz_session)
    return quiz_session


def get_owned_quiz(session: Session, user_id: str, quiz_id: str) -> QuizSessionEntity:
    quiz = session.scalar(select(QuizSessionEntity).where(
        QuizSessionEntity.id == quiz_id,
        QuizSessionEntity.user_id == user_id,
    ))
    if quiz is None:
        raise LookupError("闯关记录不存在")
    return quiz


def get_quiz_detail_data(session: Session, user_id: str, quiz_id: str) -> dict:
    """Full quiz payload: session info, question snapshots, the user's answer
    records and the generated report (if any). Used by the detail, resume and
    wrong-question-review flows."""
    quiz = get_owned_quiz(session, user_id, quiz_id)
    snapshots = session.scalars(select(QuestionSnapshotEntity).where(
        QuestionSnapshotEntity.quiz_session_id == quiz.id,
    ).order_by(QuestionSnapshotEntity.question_order)).all()

    records = session.scalars(select(AnswerRecordEntity).where(
        AnswerRecordEntity.quiz_session_id == quiz.id,
        AnswerRecordEntity.user_id == user_id,
    )).all()
    records_by_snapshot = {record.question_snapshot_id: record for record in records}

    answers = []
    for snapshot in snapshots:
        record = records_by_snapshot.get(snapshot.id)
        if record is None:
            continue
        answers.append({
            "question_id": snapshot.question_id,
            "selected_answers": record.selected_answers,
            "is_correct": record.is_correct,
            "duration_ms": record.duration_ms,
            "submitted_at": _iso(record.submitted_at),
        })

    report = session.scalar(select(ReportEntity).where(
        ReportEntity.quiz_session_id == quiz.id,
    ))
    return {
        "id": quiz.id,
        "topic": quiz.topic,
        "title": quiz.title,
        "summary": quiz.summary,
        "status": quiz.status,
        "correct_count": quiz.correct_count,
        "question_count": quiz.question_count,
        "accuracy": float(quiz.accuracy),
        "total_duration_ms": quiz.total_duration_ms,
        "created_at": _iso(quiz.created_at),
        "started_at": _iso(quiz.started_at),
        "completed_at": _iso(quiz.completed_at),
        "updated_at": _iso(quiz.updated_at),
        "review": quiz.review_for_wrong_question_id is not None,
        "questions": [_question_dict(snapshot) for snapshot in snapshots],
        "answers": answers,
        "report": _report_dict(report),
    }


def list_quiz_history(session: Session, user_id: str, page: int, page_size: int) -> tuple[list[dict], int]:
    conditions = [
        QuizSessionEntity.user_id == user_id,
        QuizSessionEntity.review_for_wrong_question_id.is_(None),
    ]
    total = session.scalar(select(func.count()).select_from(QuizSessionEntity).where(*conditions)) or 0
    rows = session.scalars(select(QuizSessionEntity).where(
        *conditions,
    ).order_by(
        QuizSessionEntity.created_at.desc(),
        QuizSessionEntity.id.desc(),
    ).offset((page - 1) * page_size).limit(page_size)).all()
    return [_quiz_summary_dict(quiz) for quiz in rows], total


def list_in_progress(session: Session, user_id: str) -> list[dict]:
    sessions = session.scalars(select(QuizSessionEntity).where(
        QuizSessionEntity.user_id == user_id,
        QuizSessionEntity.status == "in_progress",
        QuizSessionEntity.review_for_wrong_question_id.is_(None),
    ).order_by(
        QuizSessionEntity.updated_at.desc(),
        QuizSessionEntity.id.desc(),
    )).all()
    if not sessions:
        return []
    session_ids = [quiz.id for quiz in sessions]
    counts = dict(session.execute(
        select(AnswerRecordEntity.quiz_session_id, func.count())
        .where(AnswerRecordEntity.quiz_session_id.in_(session_ids))
        .group_by(AnswerRecordEntity.quiz_session_id)
    ).all())
    items = []
    for quiz in sessions:
        item = _quiz_summary_dict(quiz)
        item["answered_count"] = counts.get(quiz.id, 0)
        items.append(item)
    return items


def submit_answer(session: Session, user_id: str, quiz_id: str, payload: AnswerSubmit) -> dict:
    quiz = get_owned_quiz(session, user_id, quiz_id)
    question = session.scalar(select(QuestionSnapshotEntity).where(
        QuestionSnapshotEntity.quiz_session_id == quiz.id,
        QuestionSnapshotEntity.question_id == payload.question_id,
    ))
    if question is None:
        raise LookupError("题目不存在")
    existing = session.scalar(select(AnswerRecordEntity).where(
        AnswerRecordEntity.quiz_session_id == quiz.id,
        AnswerRecordEntity.question_snapshot_id == question.id,
    ))
    if existing is not None:
        return {
            "is_correct": existing.is_correct,
            "already_submitted": True,
            "correct_answers": question.correct_answers,
            "explanation": question.explanation,
        }
    if quiz.status == "completed":
        raise ValueError("闯关已结束，无法继续作答")

    selected = sorted(set(payload.selected_answers))
    correct_answers = sorted(set(question.correct_answers))
    is_correct = selected == correct_answers
    submitted = now_utc()
    session.add(AnswerRecordEntity(
        id=str(uuid4()), user_id=user_id, quiz_session_id=quiz.id,
        question_snapshot_id=question.id, selected_answers=selected,
        is_correct=is_correct, duration_ms=payload.duration_ms, submitted_at=submitted,
    ))

    # Wrong-question book bookkeeping.
    linked_wrong_id = quiz.review_for_wrong_question_id
    if linked_wrong_id is not None:
        # Review session created from a wrong question: mastering it removes the
        # linked record; failing it keeps the record and refreshes its schedule.
        linked = session.scalar(select(WrongQuestionEntity).where(
            WrongQuestionEntity.id == linked_wrong_id,
            WrongQuestionEntity.user_id == user_id,
        ))
        if is_correct:
            if linked is not None:
                session.delete(linked)
        else:
            if linked is None:
                session.add(WrongQuestionEntity(
                    id=str(uuid4()), user_id=user_id, question_snapshot_id=question.id,
                    first_wrong_at=submitted, last_wrong_at=submitted, wrong_count=1,
                    review_at=submitted + timedelta(days=REVIEW_INTERVAL_DAYS),
                ))
            else:
                linked.last_wrong_at = submitted
                linked.wrong_count += 1
                linked.review_at = submitted + timedelta(days=REVIEW_INTERVAL_DAYS)
    elif not is_correct:
        wrong = session.scalar(select(WrongQuestionEntity).where(
            WrongQuestionEntity.user_id == user_id,
            WrongQuestionEntity.question_snapshot_id == question.id,
        ))
        if wrong is None:
            session.add(WrongQuestionEntity(
                id=str(uuid4()), user_id=user_id, question_snapshot_id=question.id,
                first_wrong_at=submitted, last_wrong_at=submitted, wrong_count=1,
                review_at=submitted + timedelta(days=REVIEW_INTERVAL_DAYS),
            ))
        else:
            wrong.last_wrong_at = submitted
            wrong.wrong_count += 1
            wrong.review_at = submitted + timedelta(days=REVIEW_INTERVAL_DAYS)

    session.commit()
    return {
        "is_correct": is_correct,
        "already_submitted": False,
        "correct_answers": question.correct_answers,
        "explanation": question.explanation,
    }


def complete_quiz(session: Session, user_id: str, quiz_id: str) -> dict:
    quiz = get_owned_quiz(session, user_id, quiz_id)
    if quiz.status == "completed":
        return {
            "id": quiz.id,
            "correct_count": quiz.correct_count,
            "question_count": quiz.question_count,
            "accuracy": float(quiz.accuracy),
            "total_duration_ms": quiz.total_duration_ms,
        }
    records = session.scalars(select(AnswerRecordEntity).where(
        AnswerRecordEntity.quiz_session_id == quiz.id,
        AnswerRecordEntity.user_id == user_id,
    )).all()
    if len(records) != quiz.question_count:
        raise ValueError("请完成全部题目后再提交")
    correct = sum(record.is_correct for record in records)
    total_duration = sum(record.duration_ms for record in records)
    completed = now_utc()
    quiz.correct_count = correct
    quiz.accuracy = round(correct / quiz.question_count * 100, 2)
    quiz.total_duration_ms = total_duration
    quiz.status = "completed"
    quiz.completed_at = completed
    quiz.updated_at = completed
    session.commit()
    return {
        "id": quiz.id,
        "correct_count": correct,
        "question_count": quiz.question_count,
        "accuracy": float(quiz.accuracy),
        "total_duration_ms": total_duration,
    }


def get_or_create_report(session: Session, quiz_id: str) -> ReportEntity:
    report = session.scalar(select(ReportEntity).where(
        ReportEntity.quiz_session_id == quiz_id,
    ))
    if report is None:
        now = now_utc()
        report = ReportEntity(
            id=str(uuid4()),
            quiz_session_id=quiz_id,
            status="pending",
            accuracy=0,
            mastered_points=[],
            weak_points=[],
            three_line_summary=[],
            advice=[],
            share_quote="",
            generation_attempts=0,
            created_at=now,
            updated_at=now,
        )
        session.add(report)
    return report


def apply_report_result(session: Session, report: ReportEntity, payload: dict) -> None:
    report.status = "completed"
    report.accuracy = payload["accuracy"]
    report.mastered_points = payload["mastered_points"]
    report.weak_points = payload["weak_points"]
    report.three_line_summary = payload["three_line_summary"]
    report.advice = payload["advice"]
    report.share_quote = payload["share_quote"]
    report.generation_attempts += 1
    report.updated_at = now_utc()


def mark_report_failed(session: Session, report: ReportEntity) -> None:
    report.status = "failed"
    report.generation_attempts += 1
    report.updated_at = now_utc()
    session.commit()


def list_wrong_questions(session: Session, user_id: str, page: int, page_size: int) -> tuple[list[dict], int]:
    conditions = [WrongQuestionEntity.user_id == user_id]
    total = session.scalar(select(func.count()).select_from(WrongQuestionEntity).where(*conditions)) or 0
    rows = session.scalars(select(WrongQuestionEntity).where(
        *conditions,
    ).order_by(
        WrongQuestionEntity.last_wrong_at.desc(),
        WrongQuestionEntity.id.desc(),
    ).offset((page - 1) * page_size).limit(page_size)).all()

    snapshot_ids = {row.question_snapshot_id for row in rows}
    snapshots = {}
    if snapshot_ids:
        snapshots = {
            snapshot.id: snapshot for snapshot in session.scalars(
                select(QuestionSnapshotEntity).where(
                    QuestionSnapshotEntity.id.in_(snapshot_ids),
                )
            ).all()
        }
    items = []
    for row in rows:
        snapshot = snapshots.get(row.question_snapshot_id)
        items.append({
            "wrong_id": row.id,
            "question_snapshot_id": row.question_snapshot_id,
            "wrong_count": row.wrong_count,
            "first_wrong_at": _iso(row.first_wrong_at),
            "last_wrong_at": _iso(row.last_wrong_at),
            "review_at": _iso(row.review_at),
            "question": _question_dict(snapshot) if snapshot else None,
        })
    return items, total


def get_wrong_question_data(session: Session, user_id: str, wrong_question_id: str) -> dict:
    wrong = session.scalar(select(WrongQuestionEntity).where(
        WrongQuestionEntity.id == wrong_question_id,
        WrongQuestionEntity.user_id == user_id,
    ))
    if wrong is None:
        raise LookupError("错题不存在")
    snapshot = session.scalar(select(QuestionSnapshotEntity).where(
        QuestionSnapshotEntity.id == wrong.question_snapshot_id,
    ))
    if snapshot is None:
        raise LookupError("错题题目不存在")
    record = session.scalar(select(AnswerRecordEntity).where(
        AnswerRecordEntity.question_snapshot_id == snapshot.id,
        AnswerRecordEntity.user_id == user_id,
    ).order_by(AnswerRecordEntity.submitted_at.desc()).limit(1))
    return {
        "wrong_id": wrong.id,
        "question_snapshot_id": wrong.question_snapshot_id,
        "wrong_count": wrong.wrong_count,
        "first_wrong_at": _iso(wrong.first_wrong_at),
        "last_wrong_at": _iso(wrong.last_wrong_at),
        "review_at": _iso(wrong.review_at),
        "user_answer": record.selected_answers if record else [],
        "question": _question_dict(snapshot),
    }


def create_review_session(session: Session, user_id: str, wrong_question_id: str) -> dict:
    """Create a one-question review session from a wrong question so the user
    can re-answer it through the regular quiz flow."""
    wrong = session.scalar(select(WrongQuestionEntity).where(
        WrongQuestionEntity.id == wrong_question_id,
        WrongQuestionEntity.user_id == user_id,
    ))
    if wrong is None:
        raise LookupError("错题不存在")
    snapshot = session.scalar(select(QuestionSnapshotEntity).where(
        QuestionSnapshotEntity.id == wrong.question_snapshot_id,
    ))
    if snapshot is None:
        raise LookupError("错题题目不存在")

    now = now_utc()
    review_id = str(uuid4())
    session.add(QuizSessionEntity(
        id=review_id,
        user_id=user_id,
        topic=snapshot.knowledge_point,
        title=f"错题重温：{snapshot.knowledge_point}",
        summary="基于错题的单题复习闯关",
        source_type="text",
        question_count=1,
        review_for_wrong_question_id=wrong.id,
        created_at=now,
        updated_at=now,
    ))
    # Flush parent before child (see save_quiz): MySQL enforces FK ordering.
    session.flush()
    session.add(QuestionSnapshotEntity(
        id=str(uuid4()),
        quiz_session_id=review_id,
        question_id=snapshot.question_id,
        question_order=0,
        question_type=snapshot.question_type,
        stem=snapshot.stem,
        options=snapshot.options,
        correct_answers=snapshot.correct_answers,
        explanation=snapshot.explanation,
        knowledge_point=snapshot.knowledge_point,
        difficulty=snapshot.difficulty,
        created_at=now,
    ))
    session.commit()
    return get_quiz_detail_data(session, user_id, review_id)


def list_hot_topics(session: Session, limit: int = 8) -> list[dict]:
    """Real popularity stats: count completed quiz sessions (excluding wrong-
    question review runs) grouped by the exact topic users typed."""
    rows = session.execute(
        select(
            QuizSessionEntity.topic,
            func.count().label("run_count"),
            func.max(QuizSessionEntity.completed_at).label("last_completed_at"),
        ).where(
            QuizSessionEntity.status == "completed",
            QuizSessionEntity.review_for_wrong_question_id.is_(None),
        ).group_by(
            QuizSessionEntity.topic,
        ).order_by(
            desc("run_count"),
            desc("last_completed_at"),
        ).limit(limit)
    ).all()
    return [
        {
            "topic": row.topic,
            "run_count": row.run_count,
            "last_completed_at": _iso(row.last_completed_at),
        }
        for row in rows
    ]


def get_user_overview(session: Session, user_id: str) -> dict:
    now = now_utc()
    history_total = session.scalar(select(func.count()).select_from(QuizSessionEntity).where(
        QuizSessionEntity.user_id == user_id,
        QuizSessionEntity.review_for_wrong_question_id.is_(None),
    )) or 0
    wrong_total = session.scalar(select(func.count()).select_from(WrongQuestionEntity).where(
        WrongQuestionEntity.user_id == user_id,
    )) or 0
    due_review_total = session.scalar(select(func.count()).select_from(WrongQuestionEntity).where(
        WrongQuestionEntity.user_id == user_id,
        WrongQuestionEntity.review_at <= now,
    )) or 0
    return {
        "history_total": history_total,
        "wrong_total": wrong_total,
        "due_review_total": due_review_total,
    }