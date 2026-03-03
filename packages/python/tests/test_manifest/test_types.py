"""Tests for v2 manifest Pydantic types."""

import pytest
from trikhub.manifest.types import (
    AgentDefinition,
    FilesystemCapabilities,
    HandoffLogEntry,
    HandoffSession,
    JSONSchema,
    ModelPreferences,
    SessionCapabilities,
    ShellCapabilities,
    StorageCapabilities,
    ToolCallRecord,
    ToolDeclaration,
    ToolExecutionResult,
    TrikCapabilities,
    TrikConfig,
    ConfigRequirement,
    TrikContext,
    TrikEntry,
    TrikLimits,
    TrikManifest,
    TrikResponse,
    TrikRuntime,
)


# ============================================================================
# Fixtures: sample manifests
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
# TrikManifest parsing
# ============================================================================


class TestTrikManifest:
    def test_parse_conversational_manifest(self):
        data = make_conversational_manifest()
        manifest = TrikManifest(**data)
        assert manifest.schemaVersion == 2
        assert manifest.id == "test-trik"
        assert manifest.agent.mode == "conversational"
        assert manifest.agent.domain == ["testing", "validation"]
        assert manifest.entry.module == "./dist/index.js"

    def test_parse_tool_manifest(self):
        data = make_tool_manifest()
        manifest = TrikManifest(**data)
        assert manifest.schemaVersion == 2
        assert manifest.agent.mode == "tool"
        assert "computeHash" in manifest.tools
        assert manifest.tools["computeHash"].outputTemplate == "Hash ({{algorithm}}): {{hash}}"

    def test_schema_version_must_be_2(self):
        data = make_conversational_manifest(schemaVersion=1)
        with pytest.raises(Exception):
            TrikManifest(**data)

    def test_optional_fields_default_to_none(self):
        data = make_conversational_manifest()
        manifest = TrikManifest(**data)
        assert manifest.tools is None
        assert manifest.capabilities is None
        assert manifest.limits is None
        assert manifest.config is None
        assert manifest.author is None

    def test_full_manifest_with_all_fields(self):
        data = make_conversational_manifest(
            tools={
                "search": {
                    "description": "Search for articles",
                    "logTemplate": "Searched for {{query}}",
                    "logSchema": {
                        "query": {"type": "string", "maxLength": 200},
                    },
                }
            },
            capabilities={
                "session": {"enabled": True, "maxDurationMs": 60000},
                "storage": {"enabled": True, "maxSizeBytes": 1048576, "persistent": True},
            },
            limits={"maxTurnTimeMs": 30000},
            config={
                "required": [{"key": "API_KEY", "description": "API key for service"}],
                "optional": [{"key": "TIMEOUT", "description": "Request timeout", "default": "5000"}],
            },
            author="Test Author",
            repository="https://github.com/test/test",
            license="MIT",
        )
        manifest = TrikManifest(**data)
        assert manifest.capabilities.session.enabled is True
        assert manifest.capabilities.storage.maxSizeBytes == 1048576
        assert manifest.limits.maxTurnTimeMs == 30000
        assert manifest.config.required[0].key == "API_KEY"
        assert manifest.config.optional[0].default == "5000"

    def test_python_runtime_entry(self):
        data = make_conversational_manifest(
            entry={"module": "src/main.py", "export": "agent", "runtime": "python"}
        )
        manifest = TrikManifest(**data)
        assert manifest.entry.runtime == TrikRuntime.PYTHON


# ============================================================================
# Individual type tests
# ============================================================================


class TestAgentDefinition:
    def test_conversational_mode(self):
        agent = AgentDefinition(
            mode="conversational",
            handoffDescription="Handles test scenarios for validation",
            systemPrompt="You are helpful.",
            domain=["testing"],
        )
        assert agent.mode == "conversational"
        assert agent.handoffDescription is not None

    def test_tool_mode(self):
        agent = AgentDefinition(
            mode="tool",
            domain=["hashing"],
        )
        assert agent.mode == "tool"
        assert agent.handoffDescription is None

    def test_model_preferences(self):
        agent = AgentDefinition(
            mode="conversational",
            domain=["testing"],
            model=ModelPreferences(provider="anthropic", temperature=0.7),
        )
        assert agent.model.provider == "anthropic"
        assert agent.model.temperature == 0.7


class TestJSONSchema:
    def test_basic_schema(self):
        schema = JSONSchema(type="string", minLength=1, maxLength=100)
        assert schema.type == "string"
        assert schema.minLength == 1

    def test_nested_schema(self):
        schema = JSONSchema(
            type="object",
            properties={
                "name": JSONSchema(type="string"),
                "age": JSONSchema(type="integer"),
            },
        )
        assert "name" in schema.properties
        assert schema.properties["age"].type == "integer"

    def test_extra_fields_allowed(self):
        schema = JSONSchema(type="string", customField="value")
        assert schema.model_extra.get("customField") == "value"


class TestToolDeclaration:
    def test_minimal(self):
        tool = ToolDeclaration(description="Does something")
        assert tool.description == "Does something"
        assert tool.inputSchema is None
        assert tool.outputTemplate is None

    def test_full_tool_mode(self):
        tool = ToolDeclaration(
            description="Compute hash",
            inputSchema=JSONSchema(type="object"),
            outputSchema=JSONSchema(type="object"),
            outputTemplate="Result: {{hash}}",
            logTemplate="Hashing {{input}}",
            logSchema={"input": JSONSchema(type="string", maxLength=50)},
        )
        assert tool.outputTemplate == "Result: {{hash}}"


class TestTrikResponse:
    def test_basic_response(self):
        resp = TrikResponse(message="Hello", transferBack=False)
        assert resp.message == "Hello"
        assert resp.transferBack is False
        assert resp.toolCalls is None

    def test_response_with_tool_calls(self):
        resp = TrikResponse(
            message="Done",
            transferBack=True,
            toolCalls=[
                ToolCallRecord(tool="search", input={"q": "test"}, output={"count": 5})
            ],
        )
        assert len(resp.toolCalls) == 1
        assert resp.toolCalls[0].tool == "search"


class TestHandoffSession:
    def test_session(self):
        session = HandoffSession(
            sessionId="s1",
            trikId="test-trik",
            log=[
                HandoffLogEntry(timestamp=1000, type="handoff_start", summary="Started"),
                HandoffLogEntry(timestamp=2000, type="handoff_end", summary="Ended"),
            ],
            createdAt=1000,
            lastActivityAt=2000,
        )
        assert len(session.log) == 2
        assert session.log[0].type == "handoff_start"


# ============================================================================
# Filesystem and Shell capability types
# ============================================================================


class TestFilesystemCapabilities:
    def test_minimal(self):
        fs = FilesystemCapabilities(enabled=True)
        assert fs.enabled is True
        assert fs.maxSizeBytes is None

    def test_with_max_size(self):
        fs = FilesystemCapabilities(enabled=True, maxSizeBytes=524288000)
        assert fs.maxSizeBytes == 524288000

    def test_disabled(self):
        fs = FilesystemCapabilities(enabled=False)
        assert fs.enabled is False


class TestShellCapabilities:
    def test_minimal(self):
        shell = ShellCapabilities(enabled=True)
        assert shell.enabled is True
        assert shell.timeoutMs is None
        assert shell.maxConcurrent is None

    def test_with_options(self):
        shell = ShellCapabilities(enabled=True, timeoutMs=60000, maxConcurrent=3)
        assert shell.timeoutMs == 60000
        assert shell.maxConcurrent == 3


class TestTrikCapabilitiesWithFilesystemShell:
    def test_capabilities_with_filesystem(self):
        caps = TrikCapabilities(
            filesystem=FilesystemCapabilities(enabled=True),
        )
        assert caps.filesystem.enabled is True
        assert caps.shell is None

    def test_capabilities_with_filesystem_and_shell(self):
        caps = TrikCapabilities(
            filesystem=FilesystemCapabilities(enabled=True),
            shell=ShellCapabilities(enabled=True, timeoutMs=30000),
        )
        assert caps.filesystem.enabled is True
        assert caps.shell.enabled is True

    def test_manifest_with_filesystem_capabilities(self):
        data = make_conversational_manifest(
            capabilities={
                "filesystem": {"enabled": True, "maxSizeBytes": 524288000},
                "shell": {"enabled": True, "timeoutMs": 60000, "maxConcurrent": 3},
            }
        )
        manifest = TrikManifest(**data)
        assert manifest.capabilities.filesystem.enabled is True
        assert manifest.capabilities.filesystem.maxSizeBytes == 524288000
        assert manifest.capabilities.shell.enabled is True
        assert manifest.capabilities.shell.timeoutMs == 60000
        assert manifest.capabilities.shell.maxConcurrent == 3
