"""
Multi-provider LLM support for the agent.

Supports OpenAI, Anthropic, and Google providers with auto-detection.
"""

import os
from typing import Literal, Optional, TypedDict

LLMProvider = Literal["openai", "anthropic", "google"]

DEFAULT_MODELS: dict[LLMProvider, str] = {
    "openai": "gpt-4o-mini",
    "anthropic": "claude-sonnet-4-20250514",
    "google": "gemini-1.5-flash",
}

API_KEY_MAP: dict[LLMProvider, str] = {
    "openai": "OPENAI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "google": "GOOGLE_API_KEY",
}


class LLMConfig(TypedDict, total=False):
    provider: LLMProvider
    model: str
    temperature: float


def detect_provider() -> LLMProvider:
    """
    Detect which LLM provider to use.

    Priority:
    1. Explicit LLM_PROVIDER env var
    2. Auto-detect based on available API keys (ANTHROPIC -> GOOGLE -> OPENAI)
    3. Default to OpenAI
    """
    # Check for explicit provider setting
    explicit = os.environ.get("LLM_PROVIDER", "").lower()
    if explicit in ("openai", "anthropic", "google"):
        return explicit  # type: ignore

    # Auto-detect based on available API keys
    if os.environ.get("ANTHROPIC_API_KEY"):
        return "anthropic"
    if os.environ.get("GOOGLE_API_KEY"):
        return "google"
    if os.environ.get("OPENAI_API_KEY"):
        return "openai"

    # Default to OpenAI
    return "openai"


def get_default_config() -> LLMConfig:
    """Get the default LLM configuration based on environment."""
    provider = detect_provider()
    return {
        "provider": provider,
        "model": os.environ.get("LLM_MODEL", DEFAULT_MODELS[provider]),
        "temperature": 0,
    }


def create_llm(config: Optional[LLMConfig] = None):
    """
    Create a LangChain chat model based on configuration.

    Args:
        config: Optional configuration overrides

    Returns:
        A LangChain chat model instance
    """
    default_config = get_default_config()
    final_config: LLMConfig = {**default_config, **(config or {})}

    provider = final_config["provider"]
    model = final_config["model"]
    temperature = final_config.get("temperature", 0)

    if provider == "openai":
        from langchain_openai import ChatOpenAI

        return ChatOpenAI(model=model, temperature=temperature)

    elif provider == "anthropic":
        from langchain_anthropic import ChatAnthropic

        return ChatAnthropic(model=model, temperature=temperature)

    elif provider == "google":
        from langchain_google_genai import ChatGoogleGenerativeAI

        return ChatGoogleGenerativeAI(model=model, temperature=temperature)

    else:
        raise ValueError(f"Unsupported LLM provider: {provider}")


def get_provider_info() -> dict:
    """
    Get information about the current LLM provider.

    Returns:
        Dict with provider, model, and has_key fields
    """
    config = get_default_config()
    provider = config["provider"]
    api_key = get_api_key(provider)

    return {
        "provider": provider,
        "model": config["model"],
        "has_key": bool(api_key),
    }


def get_api_key(provider: LLMProvider) -> Optional[str]:
    """Get the API key for a specific provider."""
    key_name = API_KEY_MAP.get(provider, "")
    return os.environ.get(key_name)
