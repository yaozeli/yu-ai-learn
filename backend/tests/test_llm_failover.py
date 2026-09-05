"""Tests for the Agnes + DeepSeek primary/fallback LLM strategy.

Covers FailoverLLM behaviour (primary success, automatic fallback, all-fail)
and build_llm provider selection based on Settings.
"""

import pytest

import app.llm as llm_module
from app.core.config import Settings
from app.llm import FailoverLLM, build_llm


class FakeRunnable:
    """Minimal LangChain-style runnable that supports with_structured_output."""

    def __init__(self, name: str, result=None, error: Exception | None = None):
        self.name = name
        self.result = result if result is not None else {"provider": name}
        self.error = error
        self.calls = 0
        self.structured = False

    def with_structured_output(self, schema):
        copy = FakeRunnable(self.name, self.result, self.error)
        copy.structured = True
        return copy

    def invoke(self, values):
        self.calls += 1
        if self.error is not None:
            raise self.error
        return self.result


def _pair_failover(
    primary_result=None,
    primary_error: Exception | None = None,
    secondary_result=None,
    secondary_error: Exception | None = None,
    secondary: FakeRunnable | None = None,
):
    primary = FakeRunnable("agnes", primary_result, primary_error)
    if secondary is None:
        secondary = FakeRunnable("deepseek", secondary_result, secondary_error)
    wrapper = FailoverLLM(primary, secondary, "agnes", "deepseek")
    return wrapper, primary, secondary


def test_primary_success_no_fallback():
    wrapper, primary, secondary = _pair_failover(primary_result={"ok": True})
    result = wrapper.invoke({"user_input": "x"})

    assert result == {"ok": True}
    assert primary.calls == 1
    assert secondary.calls == 0


def test_primary_failure_falls_back_to_secondary():
    wrapper, primary, secondary = _pair_failover(
        primary_error=TimeoutError("agnes timeout"),
        secondary_result={"ok": "deepseek result"},
    )
    result = wrapper.invoke({"user_input": "x"})

    assert result == {"ok": "deepseek result"}
    assert primary.calls == 1
    assert secondary.calls == 1


def test_all_providers_fail_raises():
    wrapper, primary, secondary = _pair_failover(
        primary_error=RuntimeError("agnes down"),
        secondary_error=RuntimeError("deepseek down"),
    )
    with pytest.raises(RuntimeError, match="deepseek down"):
        wrapper.invoke({"user_input": "x"})
    assert primary.calls == 1
    assert secondary.calls == 1


def test_no_secondary_primary_failure_raises():
    primary = FakeRunnable("agnes", error=RuntimeError("agnes down"))
    wrapper = FailoverLLM(primary, None, "agnes", "")
    with pytest.raises(RuntimeError, match="agnes down"):
        wrapper.invoke({"user_input": "x"})
    assert primary.calls == 1


def test_with_structured_output_wraps_both_and_invokes_primary(monkeypatch):
    primary = FakeRunnable("agnes", {"provider": "agnes"})
    secondary = FakeRunnable("deepseek", {"provider": "deepseek"})
    wrapper = FailoverLLM(primary, secondary, "agnes", "deepseek")
    structured = wrapper.with_structured_output(dict)

    result = structured.invoke({"user_input": "y"})
    assert result == {"provider": "agnes"}
    # with_structured_output returns new wrapped copies with structured=True.
    assert structured._primary.structured is True
    assert structured._secondary.structured is True
    assert structured._primary.calls == 1
    assert structured._secondary.calls == 0


def test_build_llm_agnes_primary_by_default(monkeypatch):
    settings = Settings(
        agnes_api_key="agnes-key",
        agnes_model="agnes-2.5-flash",
        agnes_base_url="https://api.agnes-ai.cn/v1",
        deepseek_api_key="deepseek-key",
        llm_primary_provider="agnes",
        _env_file=None,
    )
    built = []
    monkeypatch.setattr(llm_module, "build_agnes_llm", lambda s: built.append("agnes") or FakeRunnable("agnes"))
    monkeypatch.setattr(llm_module, "build_deepseek_llm", lambda s: built.append("deepseek") or FakeRunnable("deepseek"))

    wrapper = build_llm(settings)

    assert built == ["agnes", "deepseek"]
    assert wrapper._primary_name == "agnes"
    assert wrapper._secondary_name == "deepseek"
    assert wrapper._secondary is not None


def test_build_llm_deepseek_primary_when_configured(monkeypatch):
    settings = Settings(
        agnes_api_key="agnes-key",
        agnes_model="agnes-2.5-flash",
        agnes_base_url="https://api.agnes-ai.cn/v1",
        deepseek_api_key="deepseek-key",
        llm_primary_provider="deepseek",
        _env_file=None,
    )
    built = []
    monkeypatch.setattr(llm_module, "build_agnes_llm", lambda s: built.append("agnes") or FakeRunnable("agnes"))
    monkeypatch.setattr(llm_module, "build_deepseek_llm", lambda s: built.append("deepseek") or FakeRunnable("deepseek"))

    wrapper = build_llm(settings)

    assert built == ["deepseek", "agnes"]
    assert wrapper._primary_name == "deepseek"
    assert wrapper._secondary_name == "agnes"


def test_build_llm_only_deepseek_configured_no_fallback(monkeypatch):
    settings = Settings(
        deepseek_api_key="deepseek-key",
        llm_primary_provider="agnes",  # agnes requested but not configured
        _env_file=None,
    )
    built = []
    monkeypatch.setattr(llm_module, "build_agnes_llm", lambda s: built.append("agnes") or FakeRunnable("agnes"))
    monkeypatch.setattr(llm_module, "build_deepseek_llm", lambda s: built.append("deepseek") or FakeRunnable("deepseek"))

    wrapper = build_llm(settings)

    # Agnes is not configured so DeepSeek is the single provider.
    assert built == ["deepseek"]
    assert wrapper._primary_name == "deepseek"
    assert wrapper._secondary is None


def test_build_llm_only_agnes_configured_no_fallback(monkeypatch):
    settings = Settings(
        agnes_api_key="agnes-key",
        agnes_model="agnes-2.5-flash",
        agnes_base_url="https://api.agnes-ai.cn/v1",
        llm_primary_provider="agnes",
        _env_file=None,
    )
    built = []
    monkeypatch.setattr(llm_module, "build_agnes_llm", lambda s: built.append("agnes") or FakeRunnable("agnes"))
    monkeypatch.setattr(llm_module, "build_deepseek_llm", lambda s: built.append("deepseek") or FakeRunnable("deepseek"))

    wrapper = build_llm(settings)

    assert built == ["agnes"]
    assert wrapper._primary_name == "agnes"
    assert wrapper._secondary is None


def test_build_llm_no_provider_raises(monkeypatch):
    settings = Settings(_env_file=None)  # no keys at all
    with pytest.raises(RuntimeError, match="未配置任何 LLM API Key"):
        build_llm(settings)
