"""
TrikHub Manifest Types and Validation

Provides Pydantic models and JSON Schema validation for trik manifests.
Mirrors packages/trik-manifest in TypeScript.
"""

from trikhub.manifest.types import (
    # JSON Schema
    JSONSchema,
    # Session & Storage
    SessionCapabilities,
    StorageCapabilities,
    ConfigRequirement,
    TrikConfig,
    TrikCapabilities,
    TrikLimits,
    # Runtime & Entry
    TrikRuntime,
    TrikEntry,
    # Response Mode
    ResponseMode,
    AllowedAgentStringFormat,
    ResponseTemplate,
    ActionDefinition,
    # Main Manifest
    TrikManifest,
    # Wire Protocol
    ExecuteRequest,
    ClarificationQuestion,
    ClarificationAnswer,
    ClarifyRequest,
    SuccessResponse,
    ClarificationResponse,
    ErrorResponse,
    # Gateway Results
    GatewayErrorCode,
    GatewayError,
    GatewayClarification,
    GatewaySuccessTemplate,
    GatewaySuccessPassthrough,
    GatewaySuccess,
    GatewayResult,
    # Passthrough
    PassthroughContent,
    PassthroughDeliveryReceipt,
    UserContentReference,
    # Session
    SessionHistoryEntry,
    TrikSession,
    SessionContext,
    # Graph Input/Output
    GraphInput,
    GraphResult,
)

from trikhub.manifest.validator import (
    ValidationResult,
    validate_manifest,
    validate_data,
    SchemaValidator,
)

__all__ = [
    # JSON Schema
    "JSONSchema",
    # Session & Storage
    "SessionCapabilities",
    "StorageCapabilities",
    "ConfigRequirement",
    "TrikConfig",
    "TrikCapabilities",
    "TrikLimits",
    # Runtime & Entry
    "TrikRuntime",
    "TrikEntry",
    # Response Mode
    "ResponseMode",
    "AllowedAgentStringFormat",
    "ResponseTemplate",
    "ActionDefinition",
    # Main Manifest
    "TrikManifest",
    # Wire Protocol
    "ExecuteRequest",
    "ClarificationQuestion",
    "ClarificationAnswer",
    "ClarifyRequest",
    "SuccessResponse",
    "ClarificationResponse",
    "ErrorResponse",
    # Gateway Results
    "GatewayErrorCode",
    "GatewayError",
    "GatewayClarification",
    "GatewaySuccessTemplate",
    "GatewaySuccessPassthrough",
    "GatewaySuccess",
    "GatewayResult",
    # Passthrough
    "PassthroughContent",
    "PassthroughDeliveryReceipt",
    "UserContentReference",
    # Session
    "SessionHistoryEntry",
    "TrikSession",
    "SessionContext",
    # Graph Input/Output
    "GraphInput",
    "GraphResult",
    # Validation
    "ValidationResult",
    "validate_manifest",
    "validate_data",
    "SchemaValidator",
]
