"""
TrikHub Manifest Validator

JSON Schema validation for trik manifests and data.
Mirrors packages/trik-manifest/src/validator.ts
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import jsonschema
from jsonschema import Draft7Validator, ValidationError


# ============================================================================
# Validation Result
# ============================================================================


@dataclass
class ValidationResult:
    """Result of a validation operation."""

    valid: bool
    errors: list[str] | None = None


# ============================================================================
# Manifest Schema
# ============================================================================


# Action definition for template mode
ACTION_SCHEMA_TEMPLATE: dict[str, Any] = {
    "type": "object",
    "properties": {
        "responseMode": {"type": "string", "const": "template"},
        "inputSchema": {"type": "object"},
        "agentDataSchema": {"type": "object"},
        "userContentSchema": {"type": "object"},
        "responseTemplates": {
            "type": "object",
            "additionalProperties": {
                "type": "object",
                "properties": {"text": {"type": "string"}},
                "required": ["text"],
            },
        },
        "description": {"type": "string"},
    },
    "required": ["responseMode", "inputSchema", "agentDataSchema", "responseTemplates"],
}

# Action definition for passthrough mode
ACTION_SCHEMA_PASSTHROUGH: dict[str, Any] = {
    "type": "object",
    "properties": {
        "responseMode": {"type": "string", "const": "passthrough"},
        "inputSchema": {"type": "object"},
        "userContentSchema": {"type": "object"},
        "description": {"type": "string"},
    },
    "required": ["responseMode", "inputSchema", "userContentSchema"],
}

# Common manifest properties
COMMON_MANIFEST_PROPERTIES: dict[str, Any] = {
    "id": {"type": "string", "minLength": 1},
    "name": {"type": "string", "minLength": 1},
    "description": {"type": "string"},
    "version": {"type": "string", "pattern": r"^\d+\.\d+\.\d+"},
    "capabilities": {
        "type": "object",
        "properties": {
            "tools": {"type": "array", "items": {"type": "string"}},
            "canRequestClarification": {"type": "boolean"},
        },
        "required": ["tools", "canRequestClarification"],
    },
    "limits": {
        "type": "object",
        "properties": {
            "maxExecutionTimeMs": {"type": "number", "minimum": 0},
            "maxLlmCalls": {"type": "number", "minimum": 0},
            "maxToolCalls": {"type": "number", "minimum": 0},
        },
        "required": ["maxExecutionTimeMs", "maxLlmCalls", "maxToolCalls"],
    },
    "entry": {
        "type": "object",
        "properties": {
            "module": {"type": "string", "minLength": 1},
            "export": {"type": "string", "minLength": 1},
            "runtime": {"type": "string", "enum": ["node", "python"]},
        },
        "required": ["module", "export"],
    },
    "author": {"type": "string"},
    "repository": {"type": "string"},
    "license": {"type": "string"},
}

# Full manifest schema
MANIFEST_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        **COMMON_MANIFEST_PROPERTIES,
        "actions": {
            "type": "object",
            "additionalProperties": {
                "anyOf": [ACTION_SCHEMA_TEMPLATE, ACTION_SCHEMA_PASSTHROUGH]
            },
            "minProperties": 1,
        },
    },
    "required": [
        "id",
        "name",
        "description",
        "version",
        "actions",
        "capabilities",
        "limits",
        "entry",
    ],
}


# ============================================================================
# Validation Functions
# ============================================================================


def _format_errors(errors: list[ValidationError]) -> list[str]:
    """Format validation errors into readable strings."""
    result: list[str] = []
    for error in errors:
        path = "/".join(str(p) for p in error.absolute_path) if error.absolute_path else "root"
        result.append(f"{path}: {error.message}")
    return result


def validate_manifest(manifest: Any) -> ValidationResult:
    """
    Validate a trik manifest.

    Args:
        manifest: The manifest data to validate

    Returns:
        ValidationResult with valid flag and any errors
    """
    validator = Draft7Validator(MANIFEST_SCHEMA)
    errors = list(validator.iter_errors(manifest))

    if not errors:
        return ValidationResult(valid=True)

    return ValidationResult(valid=False, errors=_format_errors(errors))


def validate_data(schema: dict[str, Any], data: Any) -> ValidationResult:
    """
    Validate data against a JSON Schema.

    Args:
        schema: The JSON Schema to validate against
        data: The data to validate

    Returns:
        ValidationResult with valid flag and any errors
    """
    validator = Draft7Validator(schema)
    errors = list(validator.iter_errors(data))

    if not errors:
        return ValidationResult(valid=True)

    return ValidationResult(valid=False, errors=_format_errors(errors))


# ============================================================================
# Schema Validator Class
# ============================================================================


class SchemaValidator:
    """
    Validator class that caches compiled schemas.
    Mirrors the TypeScript SchemaValidator class.
    """

    def __init__(self) -> None:
        self._cache: dict[str, Draft7Validator] = {}

    def get_validator(self, schema_id: str, schema: dict[str, Any]) -> Draft7Validator:
        """
        Get or create a validator for the given schema.

        Args:
            schema_id: Unique identifier for caching
            schema: The JSON Schema

        Returns:
            A Draft7Validator instance
        """
        if schema_id in self._cache:
            return self._cache[schema_id]

        validator = Draft7Validator(schema)
        self._cache[schema_id] = validator
        return validator

    def validate(
        self, schema_id: str, schema: dict[str, Any], data: Any
    ) -> ValidationResult:
        """
        Validate data against a cached schema.

        Args:
            schema_id: Unique identifier for caching
            schema: The JSON Schema
            data: The data to validate

        Returns:
            ValidationResult with valid flag and any errors
        """
        validator = self.get_validator(schema_id, schema)
        errors = list(validator.iter_errors(data))

        if not errors:
            return ValidationResult(valid=True)

        return ValidationResult(valid=False, errors=_format_errors(errors))

    def clear(self) -> None:
        """Clear the schema cache."""
        self._cache.clear()
