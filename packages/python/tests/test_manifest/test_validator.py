"""Tests for v2 manifest validator."""

import pytest
from trikhub.manifest.validator import (
    ValidationResult,
    diagnose_error,
    validate_data,
    validate_manifest,
)


# ============================================================================
# Fixtures
# ============================================================================


def make_conversational_manifest(**overrides):
    """Create a valid conversational manifest dict."""
    data = {
        "schemaVersion": 2,
        "id": "test-trik",
        "name": "Test Trik",
        "description": "A test trik for unit tests",
        "version": "1.0.0",
        "agent": {
            "mode": "conversational",
            "handoffDescription": "A test trik that handles test scenarios for validation",
            "systemPrompt": "You are a helpful test assistant.",
            "domain": ["testing", "validation"],
        },
        "entry": {"module": "./dist/index.js", "export": "default"},
    }
    data.update(overrides)
    return data


def make_tool_manifest(**overrides):
    """Create a valid tool manifest dict."""
    data = {
        "schemaVersion": 2,
        "id": "hash-tool",
        "name": "Hash Tool",
        "description": "Generates hashes for input text",
        "version": "1.0.0",
        "agent": {
            "mode": "tool",
            "domain": ["cryptography", "hashing"],
        },
        "tools": {
            "computeHash": {
                "description": "Compute a hash of input text",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "text": {"type": "string"},
                        "algorithm": {"type": "string", "enum": ["sha256", "md5"]},
                    },
                    "required": ["text", "algorithm"],
                },
                "outputSchema": {
                    "type": "object",
                    "properties": {
                        "hash": {"type": "string", "format": "hex"},
                        "algorithm": {"type": "string", "enum": ["sha256", "md5"]},
                    },
                },
                "outputTemplate": "Hash ({{algorithm}}): {{hash}}",
            }
        },
        "entry": {"module": "./dist/index.js", "export": "default"},
    }
    data.update(overrides)
    return data


# ============================================================================
# Structural validation
# ============================================================================


class TestStructuralValidation:
    def test_valid_conversational_manifest(self):
        result = validate_manifest(make_conversational_manifest())
        assert result.valid is True
        assert result.errors is None

    def test_valid_tool_manifest(self):
        result = validate_manifest(make_tool_manifest())
        assert result.valid is True
        assert result.errors is None

    def test_rejects_schema_version_1(self):
        result = validate_manifest(make_conversational_manifest(schemaVersion=1))
        assert result.valid is False
        assert any("schemaVersion" in e or "const" in e for e in result.errors)

    def test_rejects_missing_id(self):
        data = make_conversational_manifest()
        del data["id"]
        result = validate_manifest(data)
        assert result.valid is False

    def test_rejects_missing_agent(self):
        data = make_conversational_manifest()
        del data["agent"]
        result = validate_manifest(data)
        assert result.valid is False

    def test_rejects_missing_entry(self):
        data = make_conversational_manifest()
        del data["entry"]
        result = validate_manifest(data)
        assert result.valid is False

    def test_rejects_invalid_id_pattern(self):
        result = validate_manifest(make_conversational_manifest(id="Invalid-ID"))
        assert result.valid is False

    def test_rejects_additional_properties(self):
        result = validate_manifest(make_conversational_manifest(unknownField="value"))
        assert result.valid is False

    def test_rejects_invalid_mode(self):
        data = make_conversational_manifest()
        data["agent"]["mode"] = "invalid"
        result = validate_manifest(data)
        assert result.valid is False

    def test_rejects_invalid_runtime(self):
        data = make_conversational_manifest()
        data["entry"]["runtime"] = "ruby"
        result = validate_manifest(data)
        assert result.valid is False

    def test_accepts_python_runtime(self):
        data = make_conversational_manifest()
        data["entry"]["runtime"] = "python"
        result = validate_manifest(data)
        assert result.valid is True

    def test_accepts_node_runtime(self):
        data = make_conversational_manifest()
        data["entry"]["runtime"] = "node"
        result = validate_manifest(data)
        assert result.valid is True


# ============================================================================
# Semantic validation — conversational mode
# ============================================================================


class TestConversationalSemantic:
    def test_requires_handoff_description(self):
        data = make_conversational_manifest()
        del data["agent"]["handoffDescription"]
        result = validate_manifest(data)
        assert result.valid is False
        assert any("handoffDescription" in e for e in result.errors)

    def test_requires_system_prompt(self):
        data = make_conversational_manifest()
        del data["agent"]["systemPrompt"]
        result = validate_manifest(data)
        assert result.valid is False
        assert any("systemPrompt" in e for e in result.errors)

    def test_accepts_system_prompt_file_instead(self):
        data = make_conversational_manifest()
        del data["agent"]["systemPrompt"]
        data["agent"]["systemPromptFile"] = "prompts/system.md"
        result = validate_manifest(data)
        assert result.valid is True

    def test_rejects_both_system_prompt_and_file(self):
        data = make_conversational_manifest()
        data["agent"]["systemPromptFile"] = "prompts/system.md"
        result = validate_manifest(data)
        assert result.valid is False
        assert any("mutually exclusive" in e for e in result.errors)


# ============================================================================
# Semantic validation — tool mode
# ============================================================================


class TestToolModeSemantic:
    def test_requires_at_least_one_tool(self):
        data = make_tool_manifest()
        data["tools"] = {}
        result = validate_manifest(data)
        assert result.valid is False
        assert any("at least one tool" in e for e in result.errors)

    def test_requires_input_schema(self):
        data = make_tool_manifest()
        del data["tools"]["computeHash"]["inputSchema"]
        result = validate_manifest(data)
        assert result.valid is False
        assert any("inputSchema" in e for e in result.errors)

    def test_requires_output_schema(self):
        data = make_tool_manifest()
        del data["tools"]["computeHash"]["outputSchema"]
        result = validate_manifest(data)
        assert result.valid is False
        assert any("outputSchema" in e for e in result.errors)

    def test_requires_output_template(self):
        data = make_tool_manifest()
        del data["tools"]["computeHash"]["outputTemplate"]
        result = validate_manifest(data)
        assert result.valid is False
        assert any("outputTemplate" in e for e in result.errors)

    def test_rejects_handoff_description_in_tool_mode(self):
        data = make_tool_manifest()
        data["agent"]["handoffDescription"] = "This should not be here for tool mode testing"
        result = validate_manifest(data)
        assert result.valid is False
        assert any("should not have handoffDescription" in e for e in result.errors)

    def test_warns_system_prompt_in_tool_mode(self):
        data = make_tool_manifest()
        data["agent"]["systemPrompt"] = "Unnecessary"
        result = validate_manifest(data)
        # Should still be valid but have a warning
        assert result.warnings is not None
        assert any("unnecessary" in w for w in result.warnings)

    def test_rejects_unconstrained_output_schema_string(self):
        data = make_tool_manifest()
        data["tools"]["computeHash"]["outputSchema"] = {
            "type": "object",
            "properties": {
                "result": {"type": "string"},  # unconstrained — not agent-safe
            },
        }
        data["tools"]["computeHash"]["outputTemplate"] = "Result: {{result}}"
        result = validate_manifest(data)
        assert result.valid is False
        assert any("not agent-safe" in e for e in result.errors)

    def test_accepts_constrained_output_schema_strings(self):
        data = make_tool_manifest()
        data["tools"]["computeHash"]["outputSchema"] = {
            "type": "object",
            "properties": {
                "hash": {"type": "string", "format": "hex"},
                "algo": {"type": "string", "enum": ["sha256", "md5"]},
                "pattern_str": {"type": "string", "pattern": "^[a-f0-9]+$"},
            },
        }
        data["tools"]["computeHash"]["outputTemplate"] = "{{hash}} {{algo}} {{pattern_str}}"
        result = validate_manifest(data)
        assert result.valid is True

    def test_rejects_maxlength_only_in_output_schema(self):
        """maxLength alone is NOT agent-safe (stricter than logSchema)."""
        data = make_tool_manifest()
        data["tools"]["computeHash"]["outputSchema"] = {
            "type": "object",
            "properties": {
                "result": {"type": "string", "maxLength": 100},  # not agent-safe
            },
        }
        data["tools"]["computeHash"]["outputTemplate"] = "Result: {{result}}"
        result = validate_manifest(data)
        assert result.valid is False
        assert any("not agent-safe" in e for e in result.errors)

    def test_output_template_placeholder_mismatch(self):
        data = make_tool_manifest()
        data["tools"]["computeHash"]["outputTemplate"] = "Result: {{missing}}"
        result = validate_manifest(data)
        assert result.valid is False
        assert any("missing" in e and "outputSchema" in e for e in result.errors)

    def test_warns_unused_output_schema_property(self):
        data = make_tool_manifest()
        # outputTemplate only references 'hash', not 'algorithm'
        data["tools"]["computeHash"]["outputTemplate"] = "Hash: {{hash}}"
        result = validate_manifest(data)
        assert result.warnings is not None
        assert any("algorithm" in w and "not referenced" in w for w in result.warnings)


# ============================================================================
# Log template validation
# ============================================================================


class TestLogTemplateValidation:
    def test_log_template_with_valid_schema(self):
        data = make_conversational_manifest(
            tools={
                "search": {
                    "description": "Search for items",
                    "logTemplate": "Searched for {{query}} in {{category}}",
                    "logSchema": {
                        "query": {"type": "string", "maxLength": 200},
                        "category": {"type": "string", "enum": ["articles", "docs"]},
                    },
                }
            }
        )
        result = validate_manifest(data)
        assert result.valid is True

    def test_log_template_placeholder_without_schema(self):
        data = make_conversational_manifest(
            tools={
                "search": {
                    "description": "Search for items",
                    "logTemplate": "Searched for {{query}}",
                    # Missing logSchema
                }
            }
        )
        result = validate_manifest(data)
        assert result.valid is False
        assert any("logSchema" in e for e in result.errors)

    def test_log_template_missing_schema_entry(self):
        data = make_conversational_manifest(
            tools={
                "search": {
                    "description": "Search for items",
                    "logTemplate": "Searched for {{query}} in {{category}}",
                    "logSchema": {
                        "query": {"type": "string", "maxLength": 200},
                        # Missing 'category'
                    },
                }
            }
        )
        result = validate_manifest(data)
        assert result.valid is False
        assert any("category" in e for e in result.errors)

    def test_unconstrained_log_schema_string(self):
        data = make_conversational_manifest(
            tools={
                "search": {
                    "description": "Search for items",
                    "logTemplate": "Result: {{output}}",
                    "logSchema": {
                        "output": {"type": "string"},  # unconstrained
                    },
                }
            }
        )
        result = validate_manifest(data)
        assert result.valid is False
        assert any("unconstrained" in e for e in result.errors)

    def test_maxlength_is_constrained_for_log_schema(self):
        """Unlike outputSchema, maxLength IS sufficient for logSchema."""
        data = make_conversational_manifest(
            tools={
                "search": {
                    "description": "Search for items",
                    "logTemplate": "Query: {{query}}",
                    "logSchema": {
                        "query": {"type": "string", "maxLength": 200},
                    },
                }
            }
        )
        result = validate_manifest(data)
        assert result.valid is True

    def test_number_and_boolean_always_constrained(self):
        data = make_conversational_manifest(
            tools={
                "search": {
                    "description": "Search for items",
                    "logTemplate": "Found {{count}} results (cached: {{cached}})",
                    "logSchema": {
                        "count": {"type": "integer"},
                        "cached": {"type": "boolean"},
                    },
                }
            }
        )
        result = validate_manifest(data)
        assert result.valid is True


# ============================================================================
# Generic domain tag warnings
# ============================================================================


class TestDomainTagWarnings:
    def test_warns_on_generic_tags(self):
        data = make_conversational_manifest()
        data["agent"]["domain"] = ["general", "testing"]
        result = validate_manifest(data)
        assert result.warnings is not None
        assert any("general" in w and "generic" in w for w in result.warnings)

    def test_no_warning_on_specific_tags(self):
        data = make_conversational_manifest()
        data["agent"]["domain"] = ["content curation", "web scraping"]
        result = validate_manifest(data)
        assert result.warnings is None or not any("generic" in w for w in result.warnings)


# ============================================================================
# Error diagnosis
# ============================================================================


class TestDiagnoseError:
    def test_diagnoses_agent_error(self):
        diagnosis = diagnose_error("Missing agent block in manifest")
        assert diagnosis is not None
        assert "agent" in diagnosis.explanation.lower()

    def test_diagnoses_handoff_error(self):
        diagnosis = diagnose_error("Missing handoffDescription field")
        assert diagnosis is not None
        assert "handoff" in diagnosis.explanation.lower()

    def test_diagnoses_system_prompt_error(self):
        diagnosis = diagnose_error("Missing systemPrompt")
        assert diagnosis is not None
        assert "system prompt" in diagnosis.explanation.lower()

    def test_diagnoses_agent_safe_error(self):
        diagnosis = diagnose_error("outputSchema: unconstrained string is not agent-safe")
        assert diagnosis is not None
        assert "agent-safe" in diagnosis.explanation.lower() or "pattern" in diagnosis.suggestion.lower()

    def test_returns_none_for_unknown(self):
        diagnosis = diagnose_error("completely unknown error xyz")
        assert diagnosis is None


# ============================================================================
# Data validation
# ============================================================================


# ============================================================================
# Filesystem and Shell capability validation
# ============================================================================


class TestFilesystemCapabilityValidation:
    def test_valid_filesystem_only(self):
        result = validate_manifest(
            make_conversational_manifest(
                capabilities={"filesystem": {"enabled": True}}
            )
        )
        assert result.valid is True

    def test_filesystem_with_max_size(self):
        result = validate_manifest(
            make_conversational_manifest(
                capabilities={"filesystem": {"enabled": True, "maxSizeBytes": 524288000}}
            )
        )
        assert result.valid is True

    def test_filesystem_disabled(self):
        result = validate_manifest(
            make_conversational_manifest(
                capabilities={"filesystem": {"enabled": False}}
            )
        )
        assert result.valid is True

    def test_rejects_filesystem_without_enabled(self):
        result = validate_manifest(
            make_conversational_manifest(
                capabilities={"filesystem": {"maxSizeBytes": 1000}}
            )
        )
        assert result.valid is False

    def test_rejects_filesystem_non_boolean_enabled(self):
        result = validate_manifest(
            make_conversational_manifest(
                capabilities={"filesystem": {"enabled": "yes"}}
            )
        )
        assert result.valid is False

    def test_rejects_filesystem_additional_properties(self):
        result = validate_manifest(
            make_conversational_manifest(
                capabilities={"filesystem": {"enabled": True, "unknownProp": True}}
            )
        )
        assert result.valid is False


class TestShellCapabilityValidation:
    def test_valid_filesystem_plus_shell(self):
        result = validate_manifest(
            make_conversational_manifest(
                capabilities={
                    "filesystem": {"enabled": True},
                    "shell": {"enabled": True},
                }
            )
        )
        assert result.valid is True

    def test_shell_with_options(self):
        result = validate_manifest(
            make_conversational_manifest(
                capabilities={
                    "filesystem": {"enabled": True},
                    "shell": {"enabled": True, "timeoutMs": 60000, "maxConcurrent": 3},
                }
            )
        )
        assert result.valid is True

    def test_rejects_shell_without_filesystem(self):
        result = validate_manifest(
            make_conversational_manifest(
                capabilities={"shell": {"enabled": True}}
            )
        )
        assert result.valid is False
        assert any("shell requires filesystem" in e for e in result.errors)

    def test_rejects_shell_enabled_with_filesystem_disabled(self):
        result = validate_manifest(
            make_conversational_manifest(
                capabilities={
                    "filesystem": {"enabled": False},
                    "shell": {"enabled": True},
                }
            )
        )
        assert result.valid is False
        assert any("shell requires filesystem" in e for e in result.errors)

    def test_accepts_shell_disabled_without_filesystem(self):
        result = validate_manifest(
            make_conversational_manifest(
                capabilities={"shell": {"enabled": False}}
            )
        )
        assert result.valid is True

    def test_rejects_shell_without_enabled(self):
        result = validate_manifest(
            make_conversational_manifest(
                capabilities={
                    "filesystem": {"enabled": True},
                    "shell": {"timeoutMs": 5000},
                }
            )
        )
        assert result.valid is False

    def test_rejects_shell_additional_properties(self):
        result = validate_manifest(
            make_conversational_manifest(
                capabilities={
                    "filesystem": {"enabled": True},
                    "shell": {"enabled": True, "unknownProp": True},
                }
            )
        )
        assert result.valid is False


class TestCapabilityRegression:
    def test_existing_manifest_without_capabilities_passes(self):
        result = validate_manifest(make_conversational_manifest())
        assert result.valid is True

    def test_manifest_with_session_storage_still_passes(self):
        result = validate_manifest(
            make_conversational_manifest(
                capabilities={
                    "session": {"enabled": True},
                    "storage": {"enabled": True},
                }
            )
        )
        assert result.valid is True

    def test_all_capabilities_together(self):
        result = validate_manifest(
            make_conversational_manifest(
                capabilities={
                    "session": {"enabled": True},
                    "storage": {"enabled": True},
                    "filesystem": {"enabled": True, "maxSizeBytes": 524288000},
                    "shell": {"enabled": True, "timeoutMs": 30000, "maxConcurrent": 3},
                }
            )
        )
        assert result.valid is True


class TestValidateData:
    def test_valid_data(self):
        schema = {
            "type": "object",
            "properties": {"name": {"type": "string"}},
            "required": ["name"],
        }
        result = validate_data(schema, {"name": "test"})
        assert result.valid is True

    def test_invalid_data(self):
        schema = {
            "type": "object",
            "properties": {"name": {"type": "string"}},
            "required": ["name"],
        }
        result = validate_data(schema, {"name": 123})
        assert result.valid is False
        assert result.errors is not None

    def test_missing_required_field(self):
        schema = {
            "type": "object",
            "properties": {"name": {"type": "string"}},
            "required": ["name"],
        }
        result = validate_data(schema, {})
        assert result.valid is False
