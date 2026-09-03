from __future__ import annotations

import json

from langchain_core.runnables import Runnable

from app.models import Report, ReportRequest
from app.prompts import REPORT_PROMPT


class ReportGenerationError(RuntimeError):
    pass


def build_report_chain(llm: Runnable):
    return REPORT_PROMPT | llm.with_structured_output(Report)


def calculate_score(payload: ReportRequest) -> tuple[int, int, float]:
    answer_map = {item.question_id: item for item in payload.answer_records}
    correct_count = sum(item.is_correct for item in answer_map.values())
    total_count = len(payload.questions)
    accuracy = round(correct_count / total_count * 100, 1) if total_count else 0
    return correct_count, total_count, accuracy


def generate_report(payload: ReportRequest, llm: Runnable, max_attempts: int = 2) -> dict:
    correct_count, total_count, accuracy = calculate_score(payload)
    chain = build_report_chain(llm)
    last_error: Exception | None = None

    for _ in range(max_attempts):
        try:
            result = chain.invoke({
                "topic": payload.topic,
                "quiz_json": json.dumps([question.model_dump() for question in payload.questions], ensure_ascii=False),
                "answer_records": json.dumps([answer.model_dump() for answer in payload.answer_records], ensure_ascii=False),
                "correct_count": correct_count,
                "total_count": total_count,
                "accuracy": accuracy,
            })
            report = result if isinstance(result, Report) else Report.model_validate(result)
            return report.model_dump()
        except Exception as error:
            last_error = error

    raise ReportGenerationError("复盘报告生成失败，请稍后重试") from last_error
