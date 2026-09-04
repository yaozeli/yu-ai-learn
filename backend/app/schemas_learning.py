from pydantic import BaseModel, Field


class AnswerSubmit(BaseModel):
    question_id: str = Field(min_length=1)
    selected_answers: list[str] = Field(min_length=1, max_length=4)
    duration_ms: int = Field(default=0, ge=0)


class QuizSummary(BaseModel):
    id: str
    topic: str
    title: str
    status: str
    correct_count: int
    question_count: int
    accuracy: float
    created_at: str


class PageResponse(BaseModel):
    items: list
    page: int
    page_size: int
    has_more: bool
    total: int = 0