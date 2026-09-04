"""Integration tests for learning-flow batches 3-5 (persistence, history,
in-progress continuation and the wrong-question review loop)."""

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import Settings
from app.core.database import Base, get_db
from app.main import app
import app.main as main
import app.api_learning as api_learning
from app.services.report_service import ReportGenerationError
from tests.test_mock_ai_flow import FakeStructuredModel


def _make_session_factory():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    # Enforce foreign keys (like MySQL) so flush-order bugs between related
    # tables surface here instead of only on the real database.
    @event.listens_for(engine, "connect")
    def _enable_sqlite_fk(dbapi_conn, _record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine)


def _enable_overrides(session_factory, *, enable_mock_login=True):
    settings = Settings(
        app_env="development",
        enable_mock_login=enable_mock_login,
        jwt_secret_key="test-secret",
    )
    app.dependency_overrides[get_db] = lambda: session_factory()
    app.dependency_overrides[main.get_settings] = lambda: settings
    return settings


def _login(client: TestClient, code: str = "dev-user") -> str:
    response = client.post("/api/v1/auth/wechat-login", json={"code": code})
    assert response.status_code == 200
    return response.json()["data"]["token"]


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _generate_quiz(client: TestClient, token: str, topic: str = "RAG 是什么") -> dict:
    response = client.post(
        "/api/v1/quiz/generate",
        json={"user_input": topic, "question_count": 5, "difficulty": "mixed"},
        headers=_auth(token),
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _answer(client: TestClient, token: str, quiz_id: str, question_id: str,
            selected: list[str], duration_ms: int = 0) -> dict:
    response = client.post(
        f"/api/v1/quiz/{quiz_id}/answers",
        json={"question_id": question_id, "selected_answers": selected, "duration_ms": duration_ms},
        headers=_auth(token),
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _complete(client: TestClient, token: str, quiz_id: str) -> dict:
    response = client.post(
        f"/api/v1/quiz/{quiz_id}/complete",
        json={},
        headers=_auth(token),
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _wrong_answers(quiz: dict, correct: str = "A", wrong: str = "B") -> dict:
    """Map question id -> selected answers, making the second one wrong."""
    return {
        question["id"]: ([correct] if index != 1 else [wrong])
        for index, question in enumerate(quiz["questions"])
    }


def test_learning_flow_persists_quiz_answers_and_report(monkeypatch):
    session_factory = _make_session_factory()
    monkeypatch.setattr(main, "build_llm", lambda settings: FakeStructuredModel())
    _enable_overrides(session_factory)
    try:
        client = TestClient(app)
        token = _login(client)

        quiz = _generate_quiz(client, token)
        quiz_id = quiz["quiz_id"]
        answers = _wrong_answers(quiz)

        # Session is persisted on generation, still in progress.
        history = client.get("/api/v1/history/quizzes", headers=_auth(token)).json()["data"]
        assert history["total"] == 1
        assert history["items"][0]["status"] == "in_progress"
        ongoing = client.get("/api/v1/quiz/in-progress", headers=_auth(token)).json()["data"]["items"]
        assert len(ongoing) == 1 and ongoing[0]["answered_count"] == 0

        results = {}
        for question_id, selected in answers.items():
            results[question_id] = _answer(client, token, quiz_id, question_id, selected)

        assert results[quiz["questions"][0]["id"]]["is_correct"] is True
        assert results[quiz["questions"][1]["id"]]["is_correct"] is False
        # Server-side judging is authoritative (client may not send is_correct).
        assert "correct_answers" in results[quiz["questions"][1]["id"]]

        # Idempotent duplicate submission does not double count.
        again = _answer(client, token, quiz_id, quiz["questions"][0]["id"], ["A"])
        assert again["already_submitted"] is True

        completed = _complete(client, token, quiz_id)
        assert completed["correct_count"] == 4
        assert completed["question_count"] == 5
        assert completed["accuracy"] == 80
        assert completed["total_duration_ms"] == 0

        # Completed sessions no longer show as in progress.
        ongoing = client.get("/api/v1/quiz/in-progress", headers=_auth(token)).json()["data"]["items"]
        assert ongoing == []

        # Report generation persisted and retryable.
        fake_report = {
            "accuracy": 80,
            "mastered_points": ["基础概念"],
            "weak_points": ["易错点"],
            "three_line_summary": ["a", "b", "c"],
            "advice": ["复习易错点"],
            "share_quote": "加油",
        }
        monkeypatch.setattr(api_learning, "generate_report", lambda request, llm: dict(fake_report))
        report_response = client.post(f"/api/v1/quiz/{quiz_id}/report", json={}, headers=_auth(token))
        assert report_response.status_code == 200
        assert report_response.json()["data"]["accuracy"] == 80

        # Detail includes user answer records and the report.
        detail = client.get(f"/api/v1/history/quizzes/{quiz_id}", headers=_auth(token)).json()["data"]
        assert len(detail["answers"]) == 5
        assert detail["correct_count"] == 4
        assert detail["status"] == "completed"
        assert detail["report"]["status"] == "completed"
        my_wrong = next(a for a in detail["answers"] if not a["is_correct"])
        assert my_wrong["selected_answers"] == ["B"]
        alias = client.get(f"/api/v1/quiz/{quiz_id}", headers=_auth(token)).json()["data"]
        assert alias["id"] == quiz_id

        overview = client.get("/api/v1/users/me/overview", headers=_auth(token)).json()["data"]
        assert overview == {"history_total": 1, "wrong_total": 1, "due_review_total": 0}
    finally:
        app.dependency_overrides.clear()


def test_report_failure_is_persisted_and_can_be_regenerated(monkeypatch):
    session_factory = _make_session_factory()
    monkeypatch.setattr(main, "build_llm", lambda settings: FakeStructuredModel())
    _enable_overrides(session_factory)
    try:
        client = TestClient(app)
        token = _login(client)
        quiz = _generate_quiz(client, token)
        quiz_id = quiz["quiz_id"]
        for question in quiz["questions"]:
            _answer(client, token, quiz_id, question["id"], ["A"])
        _complete(client, token, quiz_id)

        def _fail(request, llm):
            raise ReportGenerationError("boom")

        monkeypatch.setattr(api_learning, "generate_report", _fail)
        failed = client.post(f"/api/v1/quiz/{quiz_id}/report", json={}, headers=_auth(token))
        assert failed.status_code == 503
        assert failed.json()["code"] == 5030

        detail = client.get(f"/api/v1/history/quizzes/{quiz_id}", headers=_auth(token)).json()["data"]
        assert detail["report"]["status"] == "failed"
        assert detail["report"]["generation_attempts"] == 1

        monkeypatch.setattr(api_learning, "generate_report", lambda request, llm: {
            "accuracy": 100,
            "mastered_points": [],
            "weak_points": [],
            "three_line_summary": ["ok"],
            "advice": ["keep going"],
            "share_quote": "q",
        })
        retried = client.post(f"/api/v1/quiz/{quiz_id}/report", json={}, headers=_auth(token))
        assert retried.status_code == 200
        detail = client.get(f"/api/v1/history/quizzes/{quiz_id}", headers=_auth(token)).json()["data"]
        assert detail["report"]["status"] == "completed"
        assert detail["report"]["generation_attempts"] == 2
    finally:
        app.dependency_overrides.clear()


def test_user_data_isolation(monkeypatch):
    session_factory = _make_session_factory()
    monkeypatch.setattr(main, "build_llm", lambda settings: FakeStructuredModel())
    _enable_overrides(session_factory)
    try:
        client = TestClient(app)
        token_a = _login(client, "user-a")
        token_b = _login(client, "user-b")

        quiz = _generate_quiz(client, token_a, "Python 基础")
        quiz_id = quiz["quiz_id"]
        _answer(client, token_a, quiz_id, quiz["questions"][0]["id"], ["B"])

        # User B sees nothing of A's data.
        assert client.get("/api/v1/history/quizzes", headers=_auth(token_b)).json()["data"]["total"] == 0
        assert client.get("/api/v1/quiz/in-progress", headers=_auth(token_b)).json()["data"]["items"] == []
        assert client.get("/api/v1/wrong-questions", headers=_auth(token_b)).json()["data"]["total"] == 0

        other_detail = client.get(f"/api/v1/history/quizzes/{quiz_id}", headers=_auth(token_b))
        assert other_detail.status_code == 404
        assert other_detail.json()["code"] == 4040

        other_answer = client.post(
            f"/api/v1/quiz/{quiz_id}/answers",
            json={"question_id": quiz["questions"][0]["id"], "selected_answers": ["A"]},
            headers=_auth(token_b),
        )
        assert other_answer.status_code == 404

        other_overview = client.get("/api/v1/users/me/overview", headers=_auth(token_b)).json()["data"]
        assert other_overview["history_total"] == 0 and other_overview["wrong_total"] == 0
    finally:
        app.dependency_overrides.clear()


def test_wrong_question_review_removes_on_master(monkeypatch):
    session_factory = _make_session_factory()
    monkeypatch.setattr(main, "build_llm", lambda settings: FakeStructuredModel())
    _enable_overrides(session_factory)
    try:
        client = TestClient(app)
        token = _login(client)
        quiz = _generate_quiz(client, token)
        quiz_id = quiz["quiz_id"]
        wrong_question = quiz["questions"][1]
        _answer(client, token, quiz_id, wrong_question["id"], ["B"])

        wrongs = client.get("/api/v1/wrong-questions", headers=_auth(token)).json()["data"]
        assert wrongs["total"] == 1
        wrong_item = wrongs["items"][0]
        assert wrong_item["wrong_id"]

        detail = client.get(f"/api/v1/wrong-questions/{wrong_item['wrong_id']}", headers=_auth(token)).json()["data"]
        assert detail["user_answer"] == ["B"]
        assert detail["question"]["answer"] == ["A"]

        review = client.post(
            f"/api/v1/wrong-questions/{wrong_item['wrong_id']}/retry",
            json={},
            headers=_auth(token),
        )
        assert review.status_code == 200, review.text
        review_data = review.json()["data"]
        assert review_data["question_count"] == 1
        assert review_data["review"] is True
        assert review_data["questions"][0]["id"] == wrong_question["id"]

        # Answering the review correctly removes the wrong question.
        _answer(client, token, review_data["id"], wrong_question["id"], ["A"])
        _complete(client, token, review_data["id"])

        wrongs = client.get("/api/v1/wrong-questions", headers=_auth(token)).json()["data"]
        assert wrongs["total"] == 0
        # Review session is excluded from history and in-progress lists.
        history = client.get("/api/v1/history/quizzes", headers=_auth(token)).json()["data"]
        assert history["total"] == 1
        assert review_data["id"] not in [item["id"] for item in history["items"]]
        ongoing = client.get("/api/v1/quiz/in-progress", headers=_auth(token)).json()["data"]["items"]
        assert review_data["id"] not in [item["id"] for item in ongoing]
    finally:
        app.dependency_overrides.clear()


def test_review_wrong_keeps_and_updates_record(monkeypatch):
    session_factory = _make_session_factory()
    monkeypatch.setattr(main, "build_llm", lambda settings: FakeStructuredModel())
    _enable_overrides(session_factory)
    try:
        client = TestClient(app)
        token = _login(client)
        quiz = _generate_quiz(client, token)
        quiz_id = quiz["quiz_id"]
        wrong_question = quiz["questions"][2]
        _answer(client, token, quiz_id, wrong_question["id"], ["B"], duration_ms=1000)

        wrongs = client.get("/api/v1/wrong-questions", headers=_auth(token)).json()["data"]
        wrong_id = wrongs["items"][0]["wrong_id"]

        review = client.post(
            f"/api/v1/wrong-questions/{wrong_id}/retry",
            json={},
            headers=_auth(token),
        ).json()["data"]
        _answer(client, token, review["id"], wrong_question["id"], ["B"], duration_ms=2000)

        wrongs = client.get("/api/v1/wrong-questions", headers=_auth(token)).json()["data"]
        assert wrongs["total"] == 1
        updated = wrongs["items"][0]
        assert updated["wrong_id"] == wrong_id
        assert updated["wrong_count"] == 2
    finally:
        app.dependency_overrides.clear()


def test_hot_topics_count_real_completed_runs(monkeypatch):
    session_factory = _make_session_factory()
    monkeypatch.setattr(main, "build_llm", lambda settings: FakeStructuredModel())
    _enable_overrides(session_factory)
    try:
        client = TestClient(app)
        token_a = _login(client, "hot-a")
        token_b = _login(client, "hot-b")

        # Both users complete the same topic -> real popularity 2.
        for token in (token_a, token_b):
            quiz = _generate_quiz(client, token, "RAG 是什么")
            for question in quiz["questions"]:
                _answer(client, token, quiz["quiz_id"], question["id"], ["A"])
            _complete(client, token, quiz["quiz_id"])

        # One in-progress run on another topic must NOT be counted.
        _generate_quiz(client, token_b, "未完成主题")

        hot = client.get("/api/v1/hot-topics", headers=_auth(token_a)).json()["data"]["items"]
        assert hot and hot[0]["topic"] == "RAG 是什么"
        assert hot[0]["run_count"] == 2
        assert hot[0]["last_completed_at"]

        hot_limit = client.get("/api/v1/hot-topics?limit=1", headers=_auth(token_a)).json()["data"]["items"]
        assert len(hot_limit) == 1
    finally:
        app.dependency_overrides.clear()


def test_history_ordering_pagination_and_error_codes(monkeypatch):
    session_factory = _make_session_factory()
    monkeypatch.setattr(main, "build_llm", lambda settings: FakeStructuredModel())
    _enable_overrides(session_factory)
    try:
        client = TestClient(app)
        token = _login(client)
        ids = [_generate_quiz(client, token, f"主题 {index}")["quiz_id"] for index in range(3)]

        page1 = client.get("/api/v1/history/quizzes?page=1&page_size=2", headers=_auth(token)).json()["data"]
        page2 = client.get("/api/v1/history/quizzes?page=2&page_size=2", headers=_auth(token)).json()["data"]
        assert page1["total"] == 3
        assert page1["has_more"] is True
        assert page2["has_more"] is False
        seen = [item["id"] for item in page1["items"] + page2["items"]]
        assert len(seen) == len(set(seen)) == 3
        assert set(seen) == set(ids)

        # Unauthorized / not-found error envelopes.
        unauthorized = client.get("/api/v1/history/quizzes")
        assert unauthorized.status_code == 401
        assert unauthorized.json()["code"] == 4010

        missing = client.get("/api/v1/history/quizzes/does-not-exist", headers=_auth(token))
        assert missing.status_code == 404
        assert missing.json()["code"] == 4040
    finally:
        app.dependency_overrides.clear()
