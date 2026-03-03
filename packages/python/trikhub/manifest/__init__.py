"""
TrikHub v2 Manifest Types and Validation

Provides Pydantic models and JSON Schema validation for v2 trik manifests.
Mirrors packages/js/manifest in TypeScript.
"""

from trikhub.manifest.types import (
    # JSON Schema
    JSONSchema,
    # Manifest types
    AgentMode,
    AgentDefinition,
    ModelPreferences,
    ToolDeclaration,
    # Capabilities
    TrikCapabilities,
    TrikLimits,
    SessionCapabilities,
    StorageCapabilities,
    FilesystemCapabilities,
    ShellCapabilities,
    # Configuration
    ConfigRequirement,
    TrikConfig,
    # Entry point
    TrikEntry,
    TrikRuntime,
    # Main manifest
    TrikManifest,
    # Runtime communication
    TrikConfigContext,
    TrikStorageContext,
    TrikContext,
    TrikAgent,
    TrikResponse,
    ToolCallRecord,
    ToolExecutionResult,
    # Gateway session
    HandoffLogType,
    HandoffLogEntry,
    HandoffSession,
)

from trikhub.manifest.validator import (
    ValidationResult,
    DiagnosisResult,
    validate_manifest,
    diagnose_error,
    validate_data,
)

__all__ = [
    # JSON Schema
    "JSONSchema",
    # Manifest types
    "AgentMode",
    "AgentDefinition",
    "ModelPreferences",
    "ToolDeclaration",
    # Capabilities
    "TrikCapabilities",
    "TrikLimits",
    "SessionCapabilities",
    "StorageCapabilities",
    "FilesystemCapabilities",
    "ShellCapabilities",
    # Configuration
    "ConfigRequirement",
    "TrikConfig",
    # Entry point
    "TrikEntry",
    "TrikRuntime",
    # Main manifest
    "TrikManifest",
    # Runtime communication
    "TrikConfigContext",
    "TrikStorageContext",
    "TrikContext",
    "TrikAgent",
    "TrikResponse",
    "ToolCallRecord",
    "ToolExecutionResult",
    # Gateway session
    "HandoffLogType",
    "HandoffLogEntry",
    "HandoffSession",
    # Validation
    "ValidationResult",
    "DiagnosisResult",
    "validate_manifest",
    "diagnose_error",
    "validate_data",
]
