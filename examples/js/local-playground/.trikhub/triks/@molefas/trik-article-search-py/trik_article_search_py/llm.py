"""
Multi-provider LLM abstraction for the Article Search trik.

Supports Anthropic, OpenAI, and Google Gemini with automatic
provider detection based on available API keys.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Literal, Protocol


LLMProvider = Literal["anthropic", "openai", "google"]

# Default models for each provider
DEFAULT_MODELS: dict[LLMProvider, str] = {
    "anthropic": "claude-sonnet-4-20250514",
    "openai": "gpt-4o-mini",
    "google": "gemini-1.5-flash",
}


class ConfigGetter(Protocol):
    """Protocol for config access."""

    def get(self, key: str) -> str | None:
        """Get a config value by key."""
        ...


@dataclass
class LLMConfig:
    """Configuration for an LLM provider."""

    provider: LLMProvider
    api_key: str
    model: str


@dataclass
class LLMMessage:
    """A message in a conversation."""

    role: Literal["user", "assistant"]
    content: str


class LLMClient(ABC):
    """Abstract base class for LLM clients."""

    provider: LLMProvider

    @abstractmethod
    async def complete(
        self, messages: list[LLMMessage], max_tokens: int = 200
    ) -> str:
        """Complete a conversation and return the response text."""
        ...


class AnthropicClient(LLMClient):
    """Anthropic Claude client."""

    provider: LLMProvider = "anthropic"

    def __init__(self, api_key: str, model: str | None = None) -> None:
        self.api_key = api_key
        self.model = model or DEFAULT_MODELS["anthropic"]
        self._client: Any = None

    def _get_client(self) -> Any:
        if self._client is None:
            try:
                import anthropic

                self._client = anthropic.Anthropic(api_key=self.api_key)
            except ImportError:
                raise ImportError(
                    "anthropic package not installed. Run: pip install anthropic"
                )
        return self._client

    async def complete(
        self, messages: list[LLMMessage], max_tokens: int = 200
    ) -> str:
        client = self._get_client()
        response = client.messages.create(
            model=self.model,
            max_tokens=max_tokens,
            messages=[{"role": m.role, "content": m.content} for m in messages],
        )
        if response.content and response.content[0].type == "text":
            return response.content[0].text.strip()
        return ""


class OpenAIClient(LLMClient):
    """OpenAI GPT client using httpx."""

    provider: LLMProvider = "openai"

    def __init__(self, api_key: str, model: str | None = None) -> None:
        self.api_key = api_key
        self.model = model or DEFAULT_MODELS["openai"]

    async def complete(
        self, messages: list[LLMMessage], max_tokens: int = 200
    ) -> str:
        import httpx

        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {self.api_key}",
                },
                json={
                    "model": self.model,
                    "max_tokens": max_tokens,
                    "messages": [
                        {"role": m.role, "content": m.content} for m in messages
                    ],
                },
                timeout=30.0,
            )
            response.raise_for_status()
            data = response.json()
            return data["choices"][0]["message"]["content"].strip()


class GoogleClient(LLMClient):
    """Google Gemini client using httpx."""

    provider: LLMProvider = "google"

    def __init__(self, api_key: str, model: str | None = None) -> None:
        self.api_key = api_key
        self.model = model or DEFAULT_MODELS["google"]

    async def complete(
        self, messages: list[LLMMessage], max_tokens: int = 200
    ) -> str:
        import httpx

        # Convert messages to Gemini format
        contents = [
            {
                "role": "model" if m.role == "assistant" else "user",
                "parts": [{"text": m.content}],
            }
            for m in messages
        ]

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent",
                params={"key": self.api_key},
                headers={"Content-Type": "application/json"},
                json={
                    "contents": contents,
                    "generationConfig": {"maxOutputTokens": max_tokens},
                },
                timeout=30.0,
            )
            response.raise_for_status()
            data = response.json()
            return data["candidates"][0]["content"]["parts"][0]["text"].strip()


def detect_provider(config: ConfigGetter) -> LLMConfig | None:
    """
    Detect which LLM provider to use based on available API keys.

    Priority order: Anthropic > OpenAI > Google
    """
    anthropic_key = config.get("ANTHROPIC_API_KEY")
    if anthropic_key:
        return LLMConfig(
            provider="anthropic",
            api_key=anthropic_key,
            model=DEFAULT_MODELS["anthropic"],
        )

    openai_key = config.get("OPENAI_API_KEY")
    if openai_key:
        return LLMConfig(
            provider="openai",
            api_key=openai_key,
            model=DEFAULT_MODELS["openai"],
        )

    google_key = config.get("GOOGLE_API_KEY")
    if google_key:
        return LLMConfig(
            provider="google",
            api_key=google_key,
            model=DEFAULT_MODELS["google"],
        )

    return None


def create_llm_client(config: LLMConfig) -> LLMClient:
    """Create an LLM client for the specified provider."""
    if config.provider == "anthropic":
        return AnthropicClient(config.api_key, config.model)
    elif config.provider == "openai":
        return OpenAIClient(config.api_key, config.model)
    elif config.provider == "google":
        return GoogleClient(config.api_key, config.model)
    else:
        raise ValueError(f"Unsupported LLM provider: {config.provider}")
