from app.models import Quiz
from fastapi.testclient import TestClient
import app.main as main
from app.services.quiz_service import generate_quiz


class FakeStructuredModel:
    def with_structured_output(self, schema):
        return self

    def __call__(self, prompt):
        user_input = prompt.messages[-1].content.split("学习内容：", 1)[-1].split("\n", 1)[0]
        return self.invoke({"user_input": user_input})

    def invoke(self, values):
        return Quiz.model_validate({
            "quiz_id": "temporary",
            "title": values["user_input"],
            "summary": "基础知识闯关",
            "user_input": values["user_input"],
            "questions": [
                {
                    "id": f"q{index}",
                    "type": question_type,
                    "stem": f"{values['user_input']} 第 {index} 题",
                    "options": [{"key": key, "text": f"选项 {key}"} for key in ("A", "B")],
                    "answer": ["A"],
                    "explanation": "这是基于题干的解释。",
                    "knowledge_point": "基础概念",
                    "difficulty": "easy",
                }
                for index, question_type in enumerate(("single", "single", "single", "multiple", "judge"), 1)
            ],
        })


def test_generate_quiz_returns_valid_question_structure():
    result = generate_quiz("RAG 是什么", FakeStructuredModel())

    assert result["user_input"] == "RAG 是什么"
    assert isinstance(result["questions"], list)
    assert len(result["questions"]) == 5

    first_question = result["questions"][0]
    assert {"id", "type", "stem", "options", "answer", "explanation"}.issubset(first_question.keys())
    assert isinstance(first_question["options"], list)
    assert len(first_question["options"]) >= 2


def test_generate_quiz_retries_after_invalid_model_output():
    class RetryModel(FakeStructuredModel):
        calls = 0

        def invoke(self, values):
            self.calls += 1
            if self.calls == 1:
                return {"invalid": True}
            return super().invoke(values)

    model = RetryModel()
    result = generate_quiz("快速排序", model)

    assert len(result["questions"]) == 5
    assert model.calls == 2


def test_report_endpoint_calls_report_service(monkeypatch):
    payload = {
        "quiz_id": "quiz_test",
        "topic": "RAG",
        "questions": [],
        "answer_records": [],
    }
    monkeypatch.setattr(main, "build_llm", lambda settings: object())
    monkeypatch.setattr(main, "generate_report_service", lambda payload, llm: {"accuracy": 0})

    response = TestClient(main.app).post("/api/v1/report/generate", json=payload)

    assert response.status_code == 200
    assert response.json() == {"accuracy": 0}
