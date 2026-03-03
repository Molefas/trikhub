"""
TrikHub v2 Manifest Validator

Two-level validation mirroring packages/js/manifest/src/validator.ts:
1. JSON Schema structural validation
2. Semantic validation (mode consistency, log templates, constrained types)
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from jsonschema import Draft7Validator


# ============================================================================
# Validation Result Types
# ============================================================================


@dataclass
class ValidationResult:
    """Result of a validation operation."""

    valid: bool
    errors: list[str] | None = None
    warnings: list[str] | None = None


# ============================================================================
# v2 Manifest JSON Schema
# ============================================================================


_CONFIG_REQUIREMENT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "key": {"type": "string", "minLength": 1},
        "description": {"type": "string"},
        "default": {"type": "string"},
    },
    "required": ["key", "description"],
    "additionalProperties": False,
}

MANIFEST_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "schemaVersion": {"const": 2},
        "id": {"type": "string", "minLength": 1, "pattern": "^[a-z][a-z0-9-]*$"},
        "name": {"type": "string", "minLength": 1},
        "description": {"type": "string", "minLength": 1},
        "version": {"type": "string", "minLength": 1},
        "agent": {
            "type": "object",
            "properties": {
                "mode": {"type": "string", "enum": ["conversational", "tool"]},
                "handoffDescription": {"type": "string", "minLength": 10, "maxLength": 500},
                "systemPrompt": {"type": "string"},
                "systemPromptFile": {"type": "string"},
                "model": {
                    "type": "object",
                    "properties": {
                        "provider": {"type": "string"},
                        "capabilities": {"type": "array", "items": {"type": "string"}},
                        "temperature": {"type": "number", "minimum": 0, "maximum": 2},
                    },
                    "additionalProperties": False,
                },
                "domain": {
                    "type": "array",
                    "items": {"type": "string", "minLength": 1},
                    "minItems": 1,
                },
            },
            "required": ["mode", "domain"],
            "additionalProperties": False,
        },
        "tools": {
            "type": "object",
            "additionalProperties": {
                "type": "object",
                "properties": {
                    "description": {"type": "string", "minLength": 1},
                    "logTemplate": {"type": "string"},
                    "logSchema": {
                        "type": "object",
                        "additionalProperties": {"type": "object"},
                    },
                    "inputSchema": {"type": "object"},
                    "outputSchema": {"type": "object"},
                    "outputTemplate": {"type": "string"},
                },
                "required": ["description"],
                "additionalProperties": False,
            },
        },
        "capabilities": {
            "type": "object",
            "properties": {
                "session": {
                    "type": "object",
                    "properties": {
                        "enabled": {"type": "boolean"},
                        "maxDurationMs": {"type": "number", "minimum": 0},
                    },
                    "required": ["enabled"],
                    "additionalProperties": False,
                },
                "storage": {
                    "type": "object",
                    "properties": {
                        "enabled": {"type": "boolean"},
                        "maxSizeBytes": {"type": "number", "minimum": 0},
                        "persistent": {"type": "boolean"},
                    },
                    "required": ["enabled"],
                    "additionalProperties": False,
                },
                "filesystem": {
                    "type": "object",
                    "properties": {
                        "enabled": {"type": "boolean"},
                        "maxSizeBytes": {"type": "number", "minimum": 0},
                    },
                    "required": ["enabled"],
                    "additionalProperties": False,
                },
                "shell": {
                    "type": "object",
                    "properties": {
                        "enabled": {"type": "boolean"},
                        "timeoutMs": {"type": "number", "minimum": 0},
                        "maxConcurrent": {"type": "integer", "minimum": 1},
                    },
                    "required": ["enabled"],
                    "additionalProperties": False,
                },
            },
            "additionalProperties": False,
        },
        "limits": {
            "type": "object",
            "properties": {
                "maxTurnTimeMs": {"type": "number", "minimum": 0},
            },
            "required": ["maxTurnTimeMs"],
            "additionalProperties": False,
        },
        "config": {
            "type": "object",
            "properties": {
                "required": {"type": "array", "items": _CONFIG_REQUIREMENT_SCHEMA},
                "optional": {"type": "array", "items": _CONFIG_REQUIREMENT_SCHEMA},
            },
            "additionalProperties": False,
        },
        "entry": {
            "type": "object",
            "properties": {
                "module": {"type": "string", "minLength": 1},
                "export": {"type": "string", "minLength": 1},
                "runtime": {"type": "string", "enum": ["node", "python"]},
            },
            "required": ["module", "export"],
            "additionalProperties": False,
        },
        "author": {"type": "string"},
        "repository": {"type": "string"},
        "license": {"type": "string"},
    },
    "required": ["schemaVersion", "id", "name", "description", "version", "agent", "entry"],
    "additionalProperties": False,
}

_compiled_manifest_validator = Draft7Validator(MANIFEST_SCHEMA)


# ============================================================================
# Generic domain tags that are too broad
# ============================================================================

GENERIC_DOMAIN_TAGS = frozenset([
    "general",
    "utility",
    "utilities",
    "misc",
    "miscellaneous",
    "other",
    "helper",
    "tools",
    "tool",
])


# ============================================================================
# Log Template Validation
# ============================================================================


def _extract_placeholders(template: str) -> list[str]:
    """Extract {{placeholder}} names from a template string."""
    return re.findall(r"\{\{(\w+)\}\}", template)


def _is_constrained_type(schema: dict[str, Any]) -> bool:
    """
    Check if a JSON Schema value type is constrained (safe for log context).

    Safe: integers, numbers, booleans, strings with enum/format/pattern, strings with maxLength
    Rejected: unconstrained free-form strings
    """
    schema_type = schema.get("type")

    if schema_type in ("integer", "number", "boolean"):
        return True

    if schema.get("enum"):
        return True

    if schema_type == "string":
        return bool(schema.get("enum") or schema.get("format") or schema.get("pattern") or schema.get("maxLength"))

    return False


def _is_agent_safe_type(schema: dict[str, Any]) -> bool:
    """
    Check if a JSON Schema value type is agent-safe (suitable for outputSchema).

    Stricter than _is_constrained_type: maxLength alone is NOT sufficient.
    """
    schema_type = schema.get("type")

    if schema_type in ("integer", "number", "boolean"):
        return True

    if schema.get("enum"):
        return True

    if schema_type == "string":
        return bool(schema.get("enum") or schema.get("format") or schema.get("pattern"))

    return False


# ============================================================================
# Semantic Validation
# ============================================================================


@dataclass
class _SemanticIssue:
    type: str  # "error" or "warning"
    message: str


def _validate_output_schema_constraints(
    tool_name: str,
    schema: dict[str, Any],
    issues: list[_SemanticIssue],
    path: str | None = None,
) -> None:
    """Recursively validate that all string properties in an outputSchema are agent-safe."""
    if path is None:
        path = f"tools.{tool_name}.outputSchema"

    properties = schema.get("properties")
    if not properties:
        return

    for prop_name, prop_schema in properties.items():
        prop_path = f"{path}.{prop_name}"

        if prop_schema.get("type") == "object" and prop_schema.get("properties"):
            _validate_output_schema_constraints(tool_name, prop_schema, issues, prop_path)
        elif prop_schema.get("type") == "string":
            if not _is_agent_safe_type(prop_schema):
                issues.append(_SemanticIssue(
                    type="error",
                    message=f"{prop_path}: unconstrained string is not agent-safe — use enum, format, or pattern",
                ))


def _validate_semantics(manifest: dict[str, Any]) -> list[_SemanticIssue]:
    """Run semantic validation rules on a structurally valid manifest."""
    issues: list[_SemanticIssue] = []
    agent = manifest["agent"]
    mode = agent["mode"]
    tools = manifest.get("tools")

    # --- Mode consistency ---

    if mode == "conversational":
        if not agent.get("handoffDescription"):
            issues.append(_SemanticIssue(
                type="error",
                message="agent: conversational mode requires handoffDescription",
            ))

        has_prompt = bool(agent.get("systemPrompt"))
        has_prompt_file = bool(agent.get("systemPromptFile"))

        if has_prompt and has_prompt_file:
            issues.append(_SemanticIssue(
                type="error",
                message="agent: systemPrompt and systemPromptFile are mutually exclusive — use one or the other",
            ))
        elif not has_prompt and not has_prompt_file:
            issues.append(_SemanticIssue(
                type="error",
                message="agent: conversational mode requires systemPrompt or systemPromptFile",
            ))

    if mode == "tool":
        if not tools or len(tools) == 0:
            issues.append(_SemanticIssue(
                type="error",
                message="agent: tool mode requires at least one tool in the tools map",
            ))

        if tools:
            for tool_name, tool_def in tools.items():
                if not tool_def.get("inputSchema"):
                    issues.append(_SemanticIssue(
                        type="error",
                        message=f"tools.{tool_name}: tool mode requires inputSchema",
                    ))
                if not tool_def.get("outputSchema"):
                    issues.append(_SemanticIssue(
                        type="error",
                        message=f"tools.{tool_name}: tool mode requires outputSchema",
                    ))
                if not tool_def.get("outputTemplate"):
                    issues.append(_SemanticIssue(
                        type="error",
                        message=f"tools.{tool_name}: tool mode requires outputTemplate",
                    ))

                # Validate outputSchema strings are agent-safe
                if tool_def.get("outputSchema"):
                    _validate_output_schema_constraints(tool_name, tool_def["outputSchema"], issues)

                # Cross-reference outputTemplate placeholders with outputSchema properties
                if tool_def.get("outputTemplate") and tool_def.get("outputSchema"):
                    template = tool_def["outputTemplate"]
                    placeholders = _extract_placeholders(template)
                    output_props = tool_def["outputSchema"].get("properties", {})

                    for ph in placeholders:
                        if ph not in output_props:
                            issues.append(_SemanticIssue(
                                type="error",
                                message=f'tools.{tool_name}: outputTemplate placeholder "{{{{{ph}}}}}" has no entry in outputSchema.properties',
                            ))

                    # Warn about unused outputSchema properties
                    for prop in output_props:
                        if prop not in placeholders:
                            issues.append(_SemanticIssue(
                                type="warning",
                                message=f'tools.{tool_name}: outputSchema property "{prop}" is not referenced in outputTemplate',
                            ))

        if agent.get("handoffDescription"):
            issues.append(_SemanticIssue(
                type="error",
                message="agent: tool mode should not have handoffDescription (tools are exposed directly, not via handoff)",
            ))

        if agent.get("systemPrompt"):
            issues.append(_SemanticIssue(
                type="warning",
                message="agent: systemPrompt is unnecessary for tool mode (no LLM agent)",
            ))
        if agent.get("systemPromptFile"):
            issues.append(_SemanticIssue(
                type="warning",
                message="agent: systemPromptFile is unnecessary for tool mode (no LLM agent)",
            ))

    # --- Capability consistency ---

    capabilities = manifest.get("capabilities")
    if capabilities:
        shell_enabled = capabilities.get("shell", {}).get("enabled") is True
        filesystem_enabled = capabilities.get("filesystem", {}).get("enabled") is True

        if shell_enabled and not filesystem_enabled:
            issues.append(_SemanticIssue(
                type="error",
                message="capabilities: shell requires filesystem to be enabled",
            ))

    # --- Generic domain tags ---

    domain = agent.get("domain", [])
    for tag in domain:
        if tag.lower() in GENERIC_DOMAIN_TAGS:
            issues.append(_SemanticIssue(
                type="warning",
                message=f'agent.domain: "{tag}" is too generic — use specific domain tags for better routing',
            ))

    # --- Log template validation ---

    if tools:
        for tool_name, tool_def in tools.items():
            log_template = tool_def.get("logTemplate")
            log_schema = tool_def.get("logSchema")

            if log_template:
                placeholders = _extract_placeholders(log_template)

                if placeholders and not log_schema:
                    issues.append(_SemanticIssue(
                        type="error",
                        message=f"tools.{tool_name}: logTemplate has placeholders ({', '.join(placeholders)}) but no logSchema",
                    ))
                elif log_schema:
                    for ph in placeholders:
                        if ph not in log_schema:
                            issues.append(_SemanticIssue(
                                type="error",
                                message=f'tools.{tool_name}: logTemplate placeholder "{{{{{ph}}}}}" has no entry in logSchema',
                            ))

            if log_schema:
                for field_name, field_schema in log_schema.items():
                    if not _is_constrained_type(field_schema):
                        issues.append(_SemanticIssue(
                            type="error",
                            message=f"tools.{tool_name}.logSchema.{field_name}: unconstrained string — add enum, format, pattern, or maxLength",
                        ))

    return issues


# ============================================================================
# Public API
# ============================================================================


def _format_errors(errors: list[Any]) -> list[str]:
    """Format jsonschema errors into readable strings."""
    result: list[str] = []
    for error in errors:
        path = "/".join(str(p) for p in error.absolute_path) if error.absolute_path else "root"
        result.append(f"{path}: {error.message}")
    return result


def validate_manifest(manifest: Any) -> ValidationResult:
    """
    Validate a v2 trik manifest.

    Performs two levels of validation:
    1. JSON Schema structure validation
    2. Semantic validation (mode consistency, log templates, constrained strings)
    """
    # 1. Structural validation via JSON Schema
    errors = list(_compiled_manifest_validator.iter_errors(manifest))
    if errors:
        return ValidationResult(
            valid=False,
            errors=_format_errors(errors),
        )

    # 2. Semantic validation
    issues = _validate_semantics(manifest)
    semantic_errors = [i.message for i in issues if i.type == "error"]
    warnings = [i.message for i in issues if i.type == "warning"]

    return ValidationResult(
        valid=len(semantic_errors) == 0,
        errors=semantic_errors if semantic_errors else None,
        warnings=warnings if warnings else None,
    )


# ============================================================================
# Error Diagnosis
# ============================================================================


@dataclass
class DiagnosisResult:
    explanation: str
    suggestion: str


_ERROR_PATTERNS: list[tuple[re.Pattern[str], DiagnosisResult]] = [
    # More specific patterns first, then generic ones
    (
        re.compile(r"agent-safe|not agent-safe", re.IGNORECASE),
        DiagnosisResult(
            explanation="outputSchema strings must use enum, format, or pattern — maxLength alone is not agent-safe.",
            suggestion="Replace maxLength-only strings with enum (fixed values), format (id/date/uuid), or pattern (regex).",
        ),
    ),
    (
        re.compile(r"handoffDescription", re.IGNORECASE),
        DiagnosisResult(
            explanation="The handoff description generates the tool that routes users to your trik.",
            suggestion="Add agent.handoffDescription with a clear description (10-500 chars) of what your trik does.",
        ),
    ),
    (
        re.compile(r"systemPrompt", re.IGNORECASE),
        DiagnosisResult(
            explanation="Conversational triks need a system prompt to define personality and behavior.",
            suggestion="Add agent.systemPrompt (inline) or agent.systemPromptFile (path to .md file). Use one, not both.",
        ),
    ),
    (
        re.compile(r"outputTemplate.*placeholder.*outputSchema|outputSchema.*outputTemplate", re.IGNORECASE),
        DiagnosisResult(
            explanation="Every {{placeholder}} in outputTemplate must match a property in outputSchema.",
            suggestion="Add the missing property to outputSchema.properties or fix the placeholder name in outputTemplate.",
        ),
    ),
    (
        re.compile(r"outputTemplate.*required|requires.*outputTemplate", re.IGNORECASE),
        DiagnosisResult(
            explanation="Tool-mode triks require an outputTemplate to control what the main LLM sees.",
            suggestion="Add an outputTemplate string with {{placeholders}} matching your outputSchema properties.",
        ),
    ),
    (
        re.compile(r"domain.*generic|generic.*domain", re.IGNORECASE),
        DiagnosisResult(
            explanation='Specific domain tags help transfer-back decisions. Generic tags like "general" are too broad.',
            suggestion='Replace generic tags with specific ones like "content curation", "data analysis", etc.',
        ),
    ),
    (
        re.compile(r"unconstrained.*logSchema|logSchema.*unconstrained", re.IGNORECASE),
        DiagnosisResult(
            explanation="Log values flow into the main agent's context. Strings need constraints to prevent injection.",
            suggestion="Add enum, format, pattern, or maxLength to string fields in logSchema.",
        ),
    ),
    (
        re.compile(r"placeholder.*logSchema|logSchema.*placeholder", re.IGNORECASE),
        DiagnosisResult(
            explanation="Every {{placeholder}} in logTemplate must have a matching entry in logSchema.",
            suggestion="Add the missing field to logSchema with a constrained type definition.",
        ),
    ),
    (
        re.compile(r"agent\.mode|agent mode|mode.*conversational|mode.*tool", re.IGNORECASE),
        DiagnosisResult(
            explanation="Valid modes: 'conversational' (agent with LLM, handoff) or 'tool' (native tools exported to main agent).",
            suggestion='Set agent.mode to "conversational" or "tool".',
        ),
    ),
    (
        re.compile(r"agent", re.IGNORECASE),
        DiagnosisResult(
            explanation="v2 manifests require an agent block declaring mode, handoff description, and domain tags.",
            suggestion='Add an "agent" object with "mode", "handoffDescription", and "domain" fields.',
        ),
    ),
]


def diagnose_error(error_message: str) -> DiagnosisResult | None:
    """Diagnose a validation error and provide actionable guidance."""
    for pattern, diagnosis in _ERROR_PATTERNS:
        if pattern.search(error_message):
            return diagnosis
    return None


# ============================================================================
# Data Validation
# ============================================================================


def validate_data(schema: dict[str, Any], data: Any) -> ValidationResult:
    """
    Validate data against a JSON Schema.
    Used by the gateway for tool-mode input/output validation.
    """
    validator = Draft7Validator(schema)
    errors = list(validator.iter_errors(data))

    if not errors:
        return ValidationResult(valid=True)

    return ValidationResult(
        valid=False,
        errors=_format_errors(errors),
    )
