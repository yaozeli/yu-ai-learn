from langchain_openai import ChatOpenAI

from app.core.config import Settings


def build_llm(settings: Settings) -> ChatOpenAI:
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