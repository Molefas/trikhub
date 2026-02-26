"""
TrikHub v2 Manifest Types

Pydantic models mirroring packages/js/manifest/src/types.ts
These provide type-safe manifest parsing and validation for Python triks.
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Literal, Protocol, runtime_checkable

from pydantic import BaseModel, Field


# ============================================================================
# JSON Schema Types
# ============================================================================


class JSONSchema(BaseModel):
    """JSON Schema type (subset for our needs)."""

    type: str | list[str] | None = None
    properties: dict[str, JSONSchema] | None = None
    items: JSONSchema | None = None
    required: list[str] | None = None
    enum: list[Any] | None = None
    const: Any | None = None
    ref: str | None = Field(None, alias="$ref")
    defs: dict[str, JSONSchema] | None = Field(None, alias="$defs")
    additionalProperties: bool | JSONSchema | None = None
    minLength: int | None = None
    maxLength: int | None = None
    minimum: float | None = None
    maximum: float | None = None
    pattern: str | None = None
    format: str | None = None
    description: str | None = None
    default: Any | None = None

    model_config = {"extra": "allow", "populate_by_name": True}


# ============================================================================
# Manifest Types
# ============================================================================


AgentMode = Literal["conversational", "tool"]
"""Agent mode: 'conversational' (handoff with LLM) or 'tool' (native tools exported)."""


class ModelPreferences(BaseModel):
    """Model preferences for the agent's LLM."""

    provider: str | None = None
    """Provider hint: 'anthropic', 'openai', 'any'."""
    capabilities: list[str] | None = None
    """Required model capabilities, e.g. ['tool_use']."""
    temperature: float | None = None
    """Temperature for generation (0.0-2.0)."""


class AgentDefinition(BaseModel):
    """Agent definition — the core of a v2 manifest."""

    mode: AgentMode
    """How this agent operates."""
    handoffDescription: str | None = None
    """Description used to generate the handoff tool (required for conversational mode)."""
    systemPrompt: str | None = None
    """Inline system prompt (conversational mode)."""
    systemPromptFile: str | None = None
    """Path to system prompt file, relative to manifest (conversational mode)."""
    model: ModelPreferences | None = None
    """LLM model preferences."""
    domain: list[str]
    """Domain tags describing this agent's expertise."""


class ToolDeclaration(BaseModel):
    """Tool declaration in the manifest."""

    description: str
    """What this tool does."""
    logTemplate: str | None = None
    """Template for log entries. Placeholders: {{field}}."""
    logSchema: dict[str, JSONSchema] | None = None
    """Schema for log template placeholder values. Must use constrained types."""
    inputSchema: JSONSchema | None = None
    """Input schema for tool-mode triks."""
    outputSchema: JSONSchema | None = None
    """Output schema for tool-mode triks (constrained types)."""
    outputTemplate: str | None = None
    """Template for output sent to the main LLM. Required for tool-mode."""


# ============================================================================
# Capabilities & Limits
# ============================================================================


class SessionCapabilities(BaseModel):
    """Session capabilities for multi-turn conversations."""

    enabled: bool
    maxDurationMs: int | None = None
    """Maximum session duration in milliseconds (default: 30 minutes)."""


class StorageCapabilities(BaseModel):
    """Storage capabilities for persistent data."""

    enabled: bool
    maxSizeBytes: int | None = None
    """Maximum storage size in bytes (default: 100MB)."""
    persistent: bool | None = None
    """Whether storage persists across sessions (default: true)."""


class ConfigRequirement(BaseModel):
    """Configuration requirement declared in manifest."""

    key: str
    description: str
    default: str | None = None


class TrikConfig(BaseModel):
    """Configuration requirements for a trik."""

    required: list[ConfigRequirement] | None = None
    optional: list[ConfigRequirement] | None = None


class TrikCapabilities(BaseModel):
    """Trik capabilities declared in manifest."""

    session: SessionCapabilities | None = None
    """Session capabilities. Enforced — gateway creates/manages sessions."""
    storage: StorageCapabilities | None = None
    """Storage capabilities. Enforced — gateway provides storage context."""


class TrikLimits(BaseModel):
    """Resource limits for trik execution."""

    maxTurnTimeMs: int
    """Maximum time per turn in milliseconds."""


# ============================================================================
# Runtime & Entry Types
# ============================================================================


class TrikRuntime(str, Enum):
    """Runtime environment for trik execution."""

    NODE = "node"
    PYTHON = "python"


class TrikEntry(BaseModel):
    """Entry point configuration."""

    module: str
    """Path to the compiled module (relative to trik directory)."""
    export: str
    """Export name to use (usually 'default')."""
    runtime: TrikRuntime | None = None
    """Runtime environment: 'node' (default) or 'python'."""


# ============================================================================
# Main Manifest Type
# ============================================================================


class TrikManifest(BaseModel):
    """The trik manifest — v2 with agent-based handoff architecture."""

    schemaVersion: Literal[2]
    """Schema version (must be 2)."""
    id: str
    name: str
    description: str
    version: str

    agent: AgentDefinition
    """Agent definition — how this trik operates."""

    tools: dict[str, ToolDeclaration] | None = None
    """Internal tools the agent uses."""
    capabilities: TrikCapabilities | None = None
    limits: TrikLimits | None = None
    entry: TrikEntry
    config: TrikConfig | None = None

    author: str | None = None
    repository: str | None = None
    license: str | None = None


# ============================================================================
# Runtime Communication Types
# ============================================================================


@runtime_checkable
class TrikConfigContext(Protocol):
    """Configuration context passed to triks."""

    def get(self, key: str) -> str | None:
        """Get a configuration value by key."""
        ...

    def has(self, key: str) -> bool:
        """Check if a configuration key is set."""
        ...

    def keys(self) -> list[str]:
        """Get all configured keys (without values, for debugging)."""
        ...


@runtime_checkable
class TrikStorageContext(Protocol):
    """Storage context passed to triks. Persistent key-value storage scoped to the trik."""

    async def get(self, key: str) -> Any | None: ...
    async def set(self, key: str, value: Any, ttl: int | None = None) -> None: ...
    async def delete(self, key: str) -> bool: ...
    async def list(self, prefix: str | None = None) -> list[str]: ...
    async def get_many(self, keys: list[str]) -> dict[str, Any]: ...
    async def set_many(self, entries: dict[str, Any]) -> None: ...


class TrikContext(BaseModel):
    """Context passed to a trik agent on each message."""

    model_config = {"arbitrary_types_allowed": True}

    sessionId: str
    config: Any  # TrikConfigContext at runtime
    storage: Any  # TrikStorageContext at runtime


class ToolCallRecord(BaseModel):
    """Record of a tool call made by the agent during message processing."""

    tool: str
    input: dict[str, Any]
    output: dict[str, Any]


class TrikResponse(BaseModel):
    """Response from a trik agent after processing a message."""

    message: str
    """The agent's response message to show to the user."""
    transferBack: bool
    """Whether to transfer the conversation back to the main agent."""
    toolCalls: list[ToolCallRecord] | None = None
    """Tool calls made during processing (for log template filling)."""


class ToolExecutionResult(BaseModel):
    """Result from executing a tool-mode trik tool."""

    output: dict[str, Any]


@runtime_checkable
class TrikAgent(Protocol):
    """
    The contract a trik agent must implement.
    Conversational triks implement process_message().
    Tool-mode triks implement execute_tool().
    """

    async def process_message(
        self, message: str, context: TrikContext
    ) -> TrikResponse: ...

    async def execute_tool(
        self, tool_name: str, input: dict[str, Any], context: TrikContext
    ) -> ToolExecutionResult: ...


# ============================================================================
# Gateway Session Types
# ============================================================================


HandoffLogType = Literal["handoff_start", "tool_execution", "handoff_end"]


class HandoffLogEntry(BaseModel):
    """A single log entry in a handoff session."""

    timestamp: int
    type: HandoffLogType
    summary: str


class HandoffSession(BaseModel):
    """A handoff session tracks a conversation with a trik agent."""

    sessionId: str
    trikId: str
    log: list[HandoffLogEntry]
    createdAt: int
    lastActivityAt: int
