from typing import Literal

from pydantic import BaseModel, Field


class QuizOption(BaseModel):
    key: Literal["A", "B", "C", "D"]
    text: str = Field(min_length=1)


class QuizQuestion(BaseModel):
    id: str = Field(min_length=1)
    type: Literal["single", "multiple", "judge"]
    stem: str = Field(min_length=1)
    options: list[QuizOption] = Field(min_length=2, max_length=4)
    answer: list[str] = Field(min_length=1)
    explanation: str = Field(min_length=1)
    knowledge_point: str = Field(min_length=1)
    difficulty: Literal["easy", "medium", "hard"]


class Quiz(BaseModel):
    quiz_id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    summary: str = Field(min_length=1)
    source_type: Literal["text"] = "text"
    user_input: str = Field(min_length=1)
    questions: list[QuizQuestion] = Field(min_length=3, max_length=5)


class AnswerRecord(BaseModel):
    question_id: str
    selected_answers: list[str]
    is_correct: bool
    duration_ms: int = Field(default=0, ge=0)


class QuizRequest(BaseModel):
    user_input: str = Field(min_length=1, max_length=5000)
    question_count: Literal[5] = 5
    difficulty: Literal["mixed"] = "mixed"


class ReportRequest(BaseModel):
    quiz_id: str = ""
    topic: str = ""
    questions: list[QuizQuestion]
    answer_records: list[AnswerRecord]


class Report(BaseModel):
    accuracy: float = Field(ge=0, le=100)
    mastered_points: list[str]
    weak_points: list[str]
    three_line_summary: list[str] = Field(min_length=1, max_length=3)
    advice: list[str] = Field(min_length=1)
    share_quote: str = Field(min_length=1)