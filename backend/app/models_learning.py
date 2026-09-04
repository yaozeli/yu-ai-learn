from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class QuizSessionEntity(Base):
    __tablename__ = "quiz_sessions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    topic: Mapped[str] = mapped_column(String(500), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    source_type: Mapped[str] = mapped_column(String(32), default="text", nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="in_progress", nullable=False)
    question_count: Mapped[int] = mapped_column(Integer, nullable=False)
    correct_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    accuracy: Mapped[float] = mapped_column(Numeric(5, 2), default=0, nullable=False)
    total_duration_ms: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # Set when the session is a single-question review created from a wrong
    # question (POST /wrong-questions/{id}/retry). Such sessions never show up
    # in the history or in-progress lists; answering correctly removes the
    # linked wrong-question record.
    review_for_wrong_question_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class QuestionSnapshotEntity(Base):
    __tablename__ = "question_snapshots"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    quiz_session_id: Mapped[str] = mapped_column(ForeignKey("quiz_sessions.id"), nullable=False)
    question_id: Mapped[str] = mapped_column(String(64), nullable=False)
    question_order: Mapped[int] = mapped_column(Integer, nullable=False)
    question_type: Mapped[str] = mapped_column(String(16), nullable=False)
    stem: Mapped[str] = mapped_column(Text, nullable=False)
    options: Mapped[list] = mapped_column(JSON, nullable=False)
    correct_answers: Mapped[list] = mapped_column(JSON, nullable=False)
    explanation: Mapped[str] = mapped_column(Text, nullable=False)
    knowledge_point: Mapped[str] = mapped_column(String(255), nullable=False)
    difficulty: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class AnswerRecordEntity(Base):
    __tablename__ = "answer_records"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    quiz_session_id: Mapped[str] = mapped_column(ForeignKey("quiz_sessions.id"), nullable=False)
    question_snapshot_id: Mapped[str] = mapped_column(ForeignKey("question_snapshots.id"), nullable=False)
    selected_answers: Mapped[list] = mapped_column(JSON, nullable=False)
    is_correct: Mapped[bool] = mapped_column(Boolean, nullable=False)
    duration_ms: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    submitted_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    __table_args__ = (UniqueConstraint("quiz_session_id", "question_snapshot_id"),)


class ReportEntity(Base):
    __tablename__ = "reports"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    quiz_session_id: Mapped[str] = mapped_column(ForeignKey("quiz_sessions.id"), unique=True, nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="pending", nullable=False)
    accuracy: Mapped[float] = mapped_column(Numeric(5, 2), nullable=False)
    mastered_points: Mapped[list] = mapped_column(JSON, nullable=False)
    weak_points: Mapped[list] = mapped_column(JSON, nullable=False)
    three_line_summary: Mapped[list] = mapped_column(JSON, nullable=False)
    advice: Mapped[list] = mapped_column(JSON, nullable=False)
    share_quote: Mapped[str] = mapped_column(String(500), default="", nullable=False)
    generation_attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class WrongQuestionEntity(Base):
    __tablename__ = "wrong_questions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), nullable=False)
    question_snapshot_id: Mapped[str] = mapped_column(ForeignKey("question_snapshots.id"), nullable=False)
    first_wrong_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    last_wrong_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    wrong_count: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    review_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    __table_args__ = (UniqueConstraint("user_id", "question_snapshot_id"),)