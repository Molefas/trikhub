"""
Multi-provider LLM factory for the LangChain agent.

Supports automatic detection based on available API keys.
Priority: Anthropic > OpenAI > Google
"""

from __future__ import annotations

import os
from typing import Literal

from langchain_core.language_models.chat_models import BaseChatModel


LLMProvider = Literal["anthropic", "openai", "google"]

DEFAULT_MODELS: dict[LLMProvider, str] = {
    "anthropic": "claude-sonnet-4-20250514",
    "openai": "gpt-4o-mini",
    "google": "gemini-1.5-flash",
}


def detect_provider() -> tuple[LLMProvider, str] | None:
    """
    Detect which LLM provider to use based on environment variables.

    Returns:
        Tuple of (provider, api_key) or None if no provider found.
    """
    # Check explicit provider override
    explicit = os.getenv("LLM_PROVIDER")
    if explicit:
        provider = explicit.lower()
        if provider == "anthropic":
            key = os.getenv("ANTHROPIC_API_KEY")
            if key:
                return "anthropic", key
        elif provider == "openai":
            key = os.getenv("OPENAI_API_KEY")
            if key:
                return "openai", key
        elif provider == "google":
            key = os.getenv("GOOGLE_API_KEY")
            if key:
                return "google", key

    # Auto-detect in priority order
    if os.getenv("ANTHROPIC_API_KEY"):
        return "anthropic", os.getenv("ANTHROPIC_API_KEY")  # type: ignore
    if os.getenv("OPENAI_API_KEY"):
        return "openai", os.getenv("OPENAI_API_KEY")  # type: ignore
    if os.getenv("GOOGLE_API_KEY"):
        return "google", os.getenv("GOOGLE_API_KEY")  # type: ignore

    return None


def get_llm(
    provider: LLMProvider | None = None,
    model: str | None = None,
) -> tuple[BaseChatModel, LLMProvider]:
    """
    Create and return a LangChain chat model.

    Args:
        provider: Optional explicit provider (auto-detects if not specified)
        model: Optional model name (uses default for provider if not specified)

    Returns:
        Tuple of (chat_model, provider_name)

    Raises:
        ValueError: If no API key is found
    """
    if provider is None:
        detection = detect_provider()
        if detection is None:
            raise ValueError(
                "No LLM API key found. "
                "Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_API_KEY."
            )
        provider, _ = detection

    model_name = model or DEFAULT_MODELS[provider]

    if provider == "anthropic":
        from langchain_anthropic import ChatAnthropic

        return ChatAnthropic(model=model_name, temperature=0), provider

    elif provider == "openai":
        from langchain_openai import ChatOpenAI

        return ChatOpenAI(model=model_name, temperature=0), provider

    elif provider == "google":
        from langchain_google_genai import ChatGoogleGenerativeAI

        return ChatGoogleGenerativeAI(model=model_name, temperature=0), provider

    else:
        raise ValueError(f"Unsupported provider: {provider}")
