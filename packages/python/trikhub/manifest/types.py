"""
TrikHub Manifest Types

Pydantic models mirroring packages/trik-manifest/src/types.ts
These provide type-safe manifest parsing and validation for Python triks.
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Literal

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

    model_config = {"extra": "allow"}


# ============================================================================
# Session & Storage Types
# ============================================================================


class SessionCapabilities(BaseModel):
    """Session capabilities for multi-turn conversations."""

    enabled: bool
    maxDurationMs: int | None = Field(default=30 * 60 * 1000)  # 30 minutes
    maxHistoryEntries: int | None = Field(default=20)


class StorageCapabilities(BaseModel):
    """Storage capabilities for persistent data."""

    enabled: bool
    maxSizeBytes: int | None = Field(default=100 * 1024 * 1024)  # 100MB
    persistent: bool | None = Field(default=True)


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

    tools: list[str]
    canRequestClarification: bool
    session: SessionCapabilities | None = None
    storage: StorageCapabilities | None = None


class TrikLimits(BaseModel):
    """Resource limits for trik execution."""

    maxExecutionTimeMs: int
    maxLlmCalls: int
    maxToolCalls: int


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
    export: str
    runtime: TrikRuntime | None = Field(default=TrikRuntime.NODE)


# ============================================================================
# Response Mode Types
# ============================================================================


class ResponseMode(str, Enum):
    """Response mode for an action."""

    TEMPLATE = "template"
    PASSTHROUGH = "passthrough"


class AllowedAgentStringFormat(str, Enum):
    """Allowed string formats in agentDataSchema."""

    ID = "id"
    DATE = "date"
    DATE_TIME = "date-time"
    UUID = "uuid"
    EMAIL = "email"
    URL = "url"


class ResponseTemplate(BaseModel):
    """Response template for agent responses."""

    text: str
    condition: str | None = None


class ActionDefinition(BaseModel):
    """Action definition for triks."""

    description: str | None = None
    inputSchema: JSONSchema
    responseMode: ResponseMode
    agentDataSchema: JSONSchema | None = None
    responseTemplates: dict[str, ResponseTemplate] | None = None
    userContentSchema: JSONSchema | None = None


# ============================================================================
# Main Manifest Type
# ============================================================================


class TrikManifest(BaseModel):
    """The trik manifest - single source of truth for the trik contract."""

    id: str
    name: str
    description: str
    version: str
    actions: dict[str, ActionDefinition]
    capabilities: TrikCapabilities
    limits: TrikLimits
    entry: TrikEntry
    config: TrikConfig | None = None
    author: str | None = None
    repository: str | None = None
    license: str | None = None


# ============================================================================
# Wire Protocol Types (for remote triks)
# ============================================================================


class ExecuteRequest(BaseModel):
    """Request to execute a trik."""

    requestId: str
    input: Any


class ClarificationQuestion(BaseModel):
    """Clarification question from a trik."""

    questionId: str
    questionText: str
    questionType: Literal["text", "multiple_choice", "boolean"]
    options: list[str] | None = None
    required: bool | None = None


class ClarificationAnswer(BaseModel):
    """Answer to a clarification question."""

    questionId: str
    answer: str | bool


class ClarifyRequest(BaseModel):
    """Request to provide clarification answers."""

    sessionId: str
    answers: list[ClarificationAnswer]


class SuccessResponse(BaseModel):
    """Successful execution response."""

    requestId: str
    type: Literal["result"]
    agentData: Any
    userContent: Any | None = None


class ClarificationResponse(BaseModel):
    """Clarification needed response."""

    requestId: str
    type: Literal["clarification_needed"]
    sessionId: str
    questions: list[ClarificationQuestion]


class ErrorResponse(BaseModel):
    """Error response."""

    requestId: str
    type: Literal["error"]
    code: str
    message: str


# ============================================================================
# Gateway Result Types
# ============================================================================


class GatewayErrorCode(str, Enum):
    """Gateway error codes."""

    TRIK_NOT_FOUND = "TRIK_NOT_FOUND"
    INVALID_INPUT = "INVALID_INPUT"
    INVALID_OUTPUT = "INVALID_OUTPUT"
    TIMEOUT = "TIMEOUT"
    EXECUTION_ERROR = "EXECUTION_ERROR"
    NOT_ALLOWED = "NOT_ALLOWED"
    NETWORK_ERROR = "NETWORK_ERROR"
    CLARIFICATION_NEEDED = "CLARIFICATION_NEEDED"


class GatewayError(BaseModel):
    """Gateway error result."""

    success: Literal[False] = False
    code: GatewayErrorCode
    error: str
    details: Any | None = None


class GatewayClarification(BaseModel):
    """Gateway clarification needed result."""

    success: Literal[False] = False
    code: Literal["CLARIFICATION_NEEDED"] = "CLARIFICATION_NEEDED"
    sessionId: str
    questions: list[ClarificationQuestion]


class GatewaySuccessTemplate(BaseModel):
    """Gateway success for template mode."""

    success: Literal[True] = True
    responseMode: Literal["template"] = "template"
    agentData: Any
    templateText: str | None = None


class GatewaySuccessPassthrough(BaseModel):
    """Gateway success for passthrough mode."""

    success: Literal[True] = True
    responseMode: Literal["passthrough"] = "passthrough"
    userContentRef: str
    contentType: str
    metadata: dict[str, Any] | None = None


# Union type for gateway results
GatewaySuccess = GatewaySuccessTemplate | GatewaySuccessPassthrough
GatewayResult = GatewaySuccess | GatewayError | GatewayClarification


# ============================================================================
# Passthrough Mode Types
# ============================================================================


class PassthroughContent(BaseModel):
    """User content with content type for passthrough mode."""

    contentType: str
    content: str
    metadata: dict[str, Any] | None = None


class PassthroughDeliveryReceipt(BaseModel):
    """Receipt returned to agent after passthrough delivery."""

    delivered: Literal[True] = True
    contentType: str
    metadata: dict[str, Any] | None = None


class UserContentReference(BaseModel):
    """Content reference stored by gateway for later delivery."""

    ref: str
    trikId: str
    actionName: str
    content: PassthroughContent
    createdAt: int
    expiresAt: int


# ============================================================================
# Session State Types
# ============================================================================


class SessionHistoryEntry(BaseModel):
    """Entry in the session history."""

    timestamp: int
    action: str
    input: Any
    agentData: Any
    userContent: Any | None = None


class TrikSession(BaseModel):
    """Session state maintained by the gateway."""

    sessionId: str
    trikId: str
    createdAt: int
    lastActivityAt: int
    expiresAt: int
    history: list[SessionHistoryEntry]


class SessionContext(BaseModel):
    """Session context passed to triks in graph input."""

    sessionId: str
    history: list[SessionHistoryEntry]


# ============================================================================
# Graph Input/Output Types (for local triks)
# ============================================================================


class GraphInput(BaseModel):
    """Input passed to a trik graph."""

    input: Any
    action: str
    clarificationAnswers: dict[str, str | bool] | None = None
    session: SessionContext | None = None
    # Note: config and storage contexts are passed as runtime objects, not in model


class GraphResult(BaseModel):
    """Result returned from a trik graph."""

    responseMode: ResponseMode | None = None
    agentData: Any | None = None
    userContent: Any | None = None
    needsClarification: bool | None = None
    clarificationQuestion: ClarificationQuestion | None = None
    clarificationQuestions: list[ClarificationQuestion] | None = None
    endSession: bool | None = None
