from __future__ import annotations

from uuid import uuid4

from langchain_core.runnables import Runnable

from app.models import Quiz
from app.prompts import QUIZ_PROMPT


class QuizGenerationError(RuntimeError):
    pass


BLOCKED_TERMS = ("暴力犯罪", "制作炸弹", "自残")


def validate_user_input(user_input: str) -> str:
    normalized = " ".join(user_input.split())
    if not normalized:
        raise ValueError("学习内容不能为空")
    if any(term in normalized for term in BLOCKED_TERMS):
        raise ValueError("学习内容包含暂不支持的敏感词")
    return normalized


def validate_quiz(quiz: Quiz, user_input: str) -> Quiz:
    if len(quiz.questions) != 5:
        raise QuizGenerationError("模型未生成准确的 5 道题")

    question_types = [question.type for question in quiz.questions]
    if question_types.count("single") != 3 or question_types.count("multiple") != 1 or question_types.count("judge") != 1:
        raise QuizGenerationError("模型生成的题型比例不符合要求")

    for question in quiz.questions:
        question_keys = {option.key for option in question.options}
        if not set(question.answer).issubset(question_keys):
            raise QuizGenerationError("模型生成了无效答案")

    return quiz.model_copy(update={"user_input": user_input})


def build_quiz_chain(llm: Runnable):
    return QUIZ_PROMPT | llm.with_structured_output(Quiz)


def generate_quiz(user_input: str, llm: Runnable, max_attempts: int = 2) -> dict:
    normalized = validate_user_input(user_input)
    chain = build_quiz_chain(llm)
    last_error: Exception | None = None

    for _ in range(max_attempts):
        try:
            result = chain.invoke({"user_input": normalized})
            quiz = result if isinstance(result, Quiz) else Quiz.model_validate(result)
            quiz = validate_quiz(quiz, normalized)
            # CHAR(36) primary key: use the bare 36-char uuid hex, not a prefixed form.
            return quiz.model_copy(update={"quiz_id": uuid4().hex}).model_dump()
        except Exception as error:
            last_error = error

    raise QuizGenerationError("题目生成失败，请稍后重试") from last_error
