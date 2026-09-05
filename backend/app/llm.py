from __future__ import annotations

import logging
from typing import Any

from langchain_core.runnables import Runnable
from langchain_openai import ChatOpenAI

from app.core.config import Settings

logger = logging.getLogger(__name__)


def build_agnes_llm(settings: Settings) -> ChatOpenAI:
    """Build the ChatOpenAI client for Agnes AI (primary provider)."""
    if not settings.agnes_api_key or not settings.agnes_model or not settings.agnes_base_url:
        raise RuntimeError("未配置完整的 Agnes 连接信息（AGNES_API_KEY / AGNES_MODEL / AGNES_BASE_URL）")

    return ChatOpenAI(
        model=settings.agnes_model,
        base_url=settings.agnes_base_url,
        api_key=settings.agnes_api_key,
        temperature=0.4,
        timeout=settings.agnes_request_timeout,
        max_retries=0,
    )


def build_deepseek_llm(settings: Settings) -> ChatOpenAI:
    """Build the ChatOpenAI client for DeepSeek (fallback provider)."""
    if not settings.deepseek_api_key:
        raise RuntimeError("未配置 DEEPSEEK_API_KEY")

    return ChatOpenAI(
        model=settings.deepseek_model,
        base_url=settings.deepseek_base_url,
        api_key=settings.deepseek_api_key,
        temperature=0.4,
        timeout=settings.llm_timeout_seconds,
        max_retries=0,
    )


class FailoverLLM(Runnable[Any, Any]):
    """Runnable wrapper that tries the primary provider first and transparently
    falls back to the secondary provider when the primary fails (timeout,
    network error, HTTP 5xx, rate-limit, or invalid/malformed output).

    It subclasses ``langchain_core.runnables.Runnable`` so it can be composed
    with the LangChain pipe operator (e.g. ``QUIZ_PROMPT | llm``), which is how
    the quiz/report chains are built.

    ``with_structured_output()`` returns a new FailoverLLM that wraps the
    structured-output variants of both providers, and ``invoke()`` runs the
    primary then the secondary on failure.
    """

    def __init__(
        self,
        primary: Runnable,
        secondary: Runnable | None,
        primary_name: str = "primary",
        secondary_name: str = "secondary",
    ) -> None:
        super().__init__()
        self._primary = primary
        self._secondary = secondary
        self._primary_name = primary_name
        self._secondary_name = secondary_name

    def with_structured_output(self, schema) -> "FailoverLLM":
        primary = self._primary.with_structured_output(schema)
        secondary = self._secondary.with_structured_output(schema) if self._secondary is not None else None
        return FailoverLLM(
            primary=primary,
            secondary=secondary,
            primary_name=self._primary_name,
            secondary_name=self._secondary_name,
        )

    def invoke(self, values, config=None):
        try:
            result = (
                self._primary.invoke(values)
                if config is None
                else self._primary.invoke(values, config=config)
            )
            logger.info("LLM request succeeded via primary provider '%s'", self._primary_name)
            return result
        except Exception as primary_error:
            logger.warning(
                "LLM primary provider '%s' failed (%s: %s); falling back to '%s'",
                self._primary_name,
                type(primary_error).__name__,
                primary_error,
                self._secondary_name,
            )
            if self._secondary is None:
                raise
            return (
                self._secondary.invoke(values)
                if config is None
                else self._secondary.invoke(values, config=config)
            )


def build_llm(settings: Settings) -> FailoverLLM:
    """Build a failover LLM wrapper based on the configured primary provider.

    - ``LLM_PRIMARY_PROVIDER=agnes`` (default): Agnes is primary, DeepSeek is
      the fallback.
    - ``LLM_PRIMARY_PROVIDER=deepseek``: DeepSeek is primary, Agnes is the
      fallback (useful during Agnes maintenance).
    - If only one provider is fully configured, ``build_llm`` still returns a
      valid wrapper with a single provider (no fallback), preserving backwards
      compatibility with the previous single-provider behaviour.
    - If the requested primary provider is not configured, the other
      configured provider is used as the single provider instead.

    Raises ``RuntimeError`` when no provider has the required credentials.
    """
    if not settings.agnes_api_key and not settings.deepseek_api_key:
        raise RuntimeError("未配置任何 LLM API Key（AGNES_API_KEY 或 DEEPSEEK_API_KEY）")

    primary_name = (settings.llm_primary_provider or "agnes").lower()

    if primary_name == "agnes" and settings.agnes_api_key:
        primary = build_agnes_llm(settings)
        primary_label = "agnes"
        secondary = build_deepseek_llm(settings) if settings.deepseek_api_key else None
        secondary_label = "deepseek"
    elif primary_name == "deepseek" and settings.deepseek_api_key:
        primary = build_deepseek_llm(settings)
        primary_label = "deepseek"
        secondary = build_agnes_llm(settings) if settings.agnes_api_key else None
        secondary_label = "agnes"
    elif settings.agnes_api_key:
        primary = build_agnes_llm(settings)
        primary_label = "agnes"
        secondary = None
        secondary_label = "deepseek"
    else:
        primary = build_deepseek_llm(settings)
        primary_label = "deepseek"
        secondary = None
        secondary_label = "agnes"

    return FailoverLLM(primary, secondary, primary_label, secondary_label)
