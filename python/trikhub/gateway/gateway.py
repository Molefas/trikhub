"""
TrikGateway - Python gateway for trik execution.

Mirrors packages/trik-gateway/src/gateway.ts
Provides secure trik execution with type-directed privilege separation.

This gateway:
- Executes Python triks natively (in-process)
- Executes JavaScript triks via Node.js worker subprocess (Phase 4)
- Manages session storage, config, and persistent storage
"""

from __future__ import annotations

import asyncio
import importlib.util
import json
import os
import re
import sys
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Coroutine, Protocol, TypeVar

from trikhub.manifest import (
    ActionDefinition,
    ClarificationQuestion,
    GatewayError,
    GatewayErrorCode,
    GatewayClarification,
    GatewaySuccessPassthrough,
    GatewaySuccessTemplate,
    PassthroughContent,
    PassthroughDeliveryReceipt,
    ResponseMode,
    ResponseTemplate,
    TrikManifest,
    TrikRuntime,
    TrikSession,
    UserContentReference,
    validate_manifest,
    SchemaValidator,
)

from trikhub.gateway.session_storage import SessionStorage, InMemorySessionStorage
from trikhub.gateway.config_store import (
    ConfigStore,
    FileConfigStore,
    TrikConfigContext,
)
from trikhub.gateway.storage_provider import (
    StorageProvider,
    JsonFileStorageProvider,
    TrikStorageContext,
)
from trikhub.gateway.node_worker import (
    NodeWorker,
    NodeWorkerConfig,
    ExecuteNodeTrikOptions,
)


# ============================================================================
# Type Variables
# ============================================================================

TAgent = TypeVar("TAgent")


# ============================================================================
# Graph Protocol
# ============================================================================


class TrikGraph(Protocol):
    """Protocol for trik graphs."""

    async def invoke(self, input_data: dict[str, Any]) -> dict[str, Any]:
        """Execute the trik with the given input."""
        ...


# ============================================================================
# Configuration
# ============================================================================


@dataclass
class TrikGatewayConfig:
    """Configuration for TrikGateway."""

    allowed_triks: list[str] | None = None
    on_clarification_needed: (
        Callable[[str, list[ClarificationQuestion]], Coroutine[Any, Any, None]] | None
    ) = None
    session_storage: SessionStorage | None = None
    triks_directory: str | None = None
    config_store: ConfigStore | None = None
    storage_provider: StorageProvider | None = None
    validate_config: bool = True
    # Node.js worker configuration for executing JS triks
    node_worker_config: NodeWorkerConfig | None = None


@dataclass
class ExecuteTrikOptions:
    """Options for executing a trik."""

    session_id: str | None = None


@dataclass
class LoadFromConfigOptions:
    """Options for loading triks from config file."""

    config_path: str | None = None
    base_dir: str | None = None


@dataclass
class TrikHubConfig:
    """Configuration file structure for .trikhub/config.json."""

    triks: list[str] = field(default_factory=list)


@dataclass
class ToolDefinition:
    """Tool definition for AI agent integration."""

    name: str
    description: str
    input_schema: dict[str, Any]
    response_mode: ResponseMode
    is_gateway_tool: bool = False


@dataclass
class TrikInfo:
    """Information about a loaded trik."""

    id: str
    name: str
    description: str
    tools: list[ToolDefinition]
    session_enabled: bool


# ============================================================================
# Internal Types
# ============================================================================


@dataclass
class LoadedTrik:
    """Internal representation of a loaded trik."""

    manifest: TrikManifest
    graph: TrikGraph | None  # None for JS triks (executed via worker)
    path: str
    runtime: TrikRuntime


@dataclass
class TrikOutput:
    """Output from trik execution."""

    response_mode: ResponseMode
    agent_data: Any | None = None
    user_content: PassthroughContent | None = None
    end_session: bool = False
    needs_clarification: bool = False
    clarification_questions: list[ClarificationQuestion] | None = None


# ============================================================================
# Gateway Result Types
# ============================================================================


@dataclass
class GatewayResultWithSession:
    """Gateway result with optional session ID."""

    result: GatewaySuccessTemplate | GatewaySuccessPassthrough | GatewayError | GatewayClarification
    session_id: str | None = None


# ============================================================================
# TrikGateway Implementation
# ============================================================================


class TrikGateway:
    """
    Main gateway class for executing triks in Python.

    This gateway:
    - Executes Python triks natively (in-process)
    - Executes JavaScript triks via Node.js worker subprocess (Phase 4)
    - Manages session storage, config, and persistent storage
    """

    CONTENT_REF_TTL_MS = 10 * 60 * 1000  # 10 minutes

    def __init__(self, config: TrikGatewayConfig | None = None) -> None:
        """Initialize the TrikGateway."""
        self._config = config or TrikGatewayConfig()
        self._session_storage = (
            self._config.session_storage or InMemorySessionStorage()
        )
        self._config_store = self._config.config_store or FileConfigStore()
        self._storage_provider = (
            self._config.storage_provider or JsonFileStorageProvider()
        )
        self._config_loaded = False

        self._triks: dict[str, LoadedTrik] = {}
        self._content_references: dict[str, UserContentReference] = {}
        self._validator = SchemaValidator()

        # Node.js worker for executing JavaScript triks
        self._node_worker: NodeWorker | None = None
        self._node_worker_config = self._config.node_worker_config

    async def initialize(self) -> None:
        """
        Initialize the gateway by loading configuration.
        Should be called before loading any triks.
        """
        if not self._config_loaded:
            await self._config_store.load()
            self._config_loaded = True

    def get_config_store(self) -> ConfigStore:
        """Get the config store (for CLI integration)."""
        return self._config_store

    def get_storage_provider(self) -> StorageProvider:
        """Get the storage provider (for CLI integration)."""
        return self._storage_provider

    async def load_trik(self, trik_path: str) -> TrikManifest:
        """
        Load a trik from a directory.

        Args:
            trik_path: Path to the trik directory containing manifest.json

        Returns:
            The loaded TrikManifest

        Raises:
            ValueError: If the manifest is invalid or trik is not allowed
        """
        manifest_path = os.path.join(trik_path, "manifest.json")

        with open(manifest_path) as f:
            manifest_data = json.load(f)

        validation = validate_manifest(manifest_data)
        if not validation.valid:
            raise ValueError(
                f"Invalid manifest at {manifest_path}: {', '.join(validation.errors or [])}"
            )

        manifest = TrikManifest.model_validate(manifest_data)

        # Check allowlist
        if (
            self._config.allowed_triks
            and manifest.id not in self._config.allowed_triks
        ):
            raise ValueError(f'Trik "{manifest.id}" is not in the allowlist')

        runtime = manifest.entry.runtime or TrikRuntime.NODE

        if runtime == TrikRuntime.PYTHON:
            # Python triks are loaded and executed in-process
            graph = await self._load_python_graph(trik_path, manifest)
            self._triks[manifest.id] = LoadedTrik(
                manifest=manifest, graph=graph, path=trik_path, runtime=runtime
            )
        else:
            # Node.js triks are executed via worker subprocess
            self._triks[manifest.id] = LoadedTrik(
                manifest=manifest, graph=None, path=trik_path, runtime=runtime
            )

        return manifest

    async def _load_python_graph(
        self, trik_path: str, manifest: TrikManifest
    ) -> TrikGraph:
        """Load a Python graph from the trik directory."""
        module_path = os.path.join(trik_path, manifest.entry.module)

        # Load the module dynamically
        spec = importlib.util.spec_from_file_location("trik_module", module_path)
        if spec is None or spec.loader is None:
            raise ValueError(f"Cannot load module from {module_path}")

        module = importlib.util.module_from_spec(spec)
        sys.modules["trik_module"] = module
        spec.loader.exec_module(module)

        # Get the exported graph
        graph = getattr(module, manifest.entry.export, None)

        if graph is None:
            raise ValueError(
                f'Invalid graph at {module_path}: export "{manifest.entry.export}" not found'
            )

        # Check if it has an invoke method
        if not hasattr(graph, "invoke") or not callable(graph.invoke):
            raise ValueError(
                f'Invalid graph at {module_path}: export "{manifest.entry.export}" '
                "must have an invoke function"
            )

        return graph

    async def shutdown(self) -> None:
        """Shutdown the gateway and cleanup resources."""
        # Shutdown Node.js worker if running
        if self._node_worker:
            await self._node_worker.shutdown()
            self._node_worker = None

    async def load_triks_from_directory(self, directory: str) -> list[TrikManifest]:
        """
        Load all triks from a directory.
        Supports scoped directory structure: directory/@scope/trik-name/

        Args:
            directory: Path to the directory containing triks.
                      Use '~' prefix for home directory.

        Returns:
            Array of successfully loaded manifests
        """
        # Resolve ~ to home directory
        if directory.startswith("~"):
            resolved_dir = str(Path.home() / directory[1:].lstrip("/"))
        else:
            resolved_dir = os.path.abspath(directory)

        manifests: list[TrikManifest] = []
        errors: list[dict[str, str]] = []

        if not os.path.exists(resolved_dir):
            return manifests

        try:
            for entry in os.scandir(resolved_dir):
                if not entry.is_dir():
                    continue

                entry_path = entry.path

                # Check if this is a scoped directory (starts with @)
                if entry.name.startswith("@"):
                    # Scoped directory: @scope/trik-name structure
                    for scoped_entry in os.scandir(entry_path):
                        if not scoped_entry.is_dir():
                            continue

                        trik_path = scoped_entry.path
                        manifest_path = os.path.join(trik_path, "manifest.json")

                        if os.path.isfile(manifest_path):
                            try:
                                manifest = await self.load_trik(trik_path)
                                manifests.append(manifest)
                            except Exception as e:
                                errors.append({"path": trik_path, "error": str(e)})
                else:
                    # Non-scoped directory: direct trik-name structure
                    trik_path = entry_path
                    manifest_path = os.path.join(trik_path, "manifest.json")

                    if os.path.isfile(manifest_path):
                        try:
                            manifest = await self.load_trik(trik_path)
                            manifests.append(manifest)
                        except Exception as e:
                            errors.append({"path": trik_path, "error": str(e)})

        except PermissionError:
            pass

        # Log errors for debugging
        if errors:
            print(f"[TrikGateway] Failed to load {len(errors)} trik(s):")
            for err in errors:
                print(f"  - {err['path']}: {err['error']}")

        return manifests

    async def load_installed_triks(self) -> list[TrikManifest]:
        """Load triks from the configured triksDirectory (if set)."""
        if not self._config.triks_directory:
            return []
        return await self.load_triks_from_directory(self._config.triks_directory)

    async def load_triks_from_config(
        self, options: LoadFromConfigOptions | None = None
    ) -> list[TrikManifest]:
        """
        Load triks from a config file (.trikhub/config.json).

        Args:
            options: Configuration options

        Returns:
            Array of successfully loaded manifests
        """
        options = options or LoadFromConfigOptions()
        config_path = options.config_path or str(
            Path.cwd() / ".trikhub" / "config.json"
        )
        base_dir = options.base_dir or os.path.dirname(config_path)

        if not os.path.exists(config_path):
            print(f"[TrikGateway] No config file found at {config_path}")
            return []

        try:
            with open(config_path) as f:
                config_data = json.load(f)
        except Exception as e:
            raise ValueError(f'Failed to read config file "{config_path}": {e}')

        if "triks" not in config_data or not isinstance(config_data["triks"], list):
            print("[TrikGateway] Config file has no triks array")
            return []

        manifests: list[TrikManifest] = []
        errors: list[dict[str, str]] = []

        for trik_name in config_data["triks"]:
            try:
                # Try to find the trik in common locations
                # 1. Check if it's a path
                if os.path.isdir(trik_name):
                    manifest = await self.load_trik(trik_name)
                    manifests.append(manifest)
                    continue

                # 2. Check in .trikhub/triks directory
                triks_dir = os.path.join(base_dir, "triks", trik_name)
                if os.path.isdir(triks_dir):
                    manifest = await self.load_trik(triks_dir)
                    manifests.append(manifest)
                    continue

                # 3. Try to import as Python package
                try:
                    # For scoped packages like @scope/name, convert to Python convention
                    package_name = trik_name.lstrip("@").replace("/", "_").replace("-", "_")
                    spec = importlib.util.find_spec(package_name)
                    if spec and spec.origin:
                        trik_path = os.path.dirname(spec.origin)
                        manifest = await self.load_trik(trik_path)
                        manifests.append(manifest)
                        continue
                except (ImportError, ModuleNotFoundError):
                    pass

                errors.append({"trik": trik_name, "error": f"Could not find trik {trik_name}"})

            except Exception as e:
                errors.append({"trik": trik_name, "error": str(e)})

        # Log errors for debugging
        if errors:
            print(f"[TrikGateway] Failed to load {len(errors)} trik(s) from config:")
            for err in errors:
                print(f"  - {err['trik']}: {err['error']}")

        if manifests:
            print(f"[TrikGateway] Loaded {len(manifests)} trik(s) from config")

        return manifests

    def get_manifest(self, trik_id: str) -> TrikManifest | None:
        """Get the manifest for a loaded trik."""
        loaded = self._triks.get(trik_id)
        return loaded.manifest if loaded else None

    def get_loaded_triks(self) -> list[str]:
        """Get list of loaded trik IDs."""
        return list(self._triks.keys())

    def is_loaded(self, trik_id: str) -> bool:
        """Check if a trik is loaded."""
        return trik_id in self._triks

    def get_available_triks(self) -> list[TrikInfo]:
        """Get information about all loaded triks."""
        result: list[TrikInfo] = []

        for loaded in self._triks.values():
            manifest = loaded.manifest
            tools = [
                self._action_to_tool_definition(manifest.id, action_name, action)
                for action_name, action in manifest.actions.items()
            ]

            result.append(
                TrikInfo(
                    id=manifest.id,
                    name=manifest.name,
                    description=manifest.description,
                    tools=tools,
                    session_enabled=(
                        manifest.capabilities.session.enabled
                        if manifest.capabilities.session
                        else False
                    ),
                )
            )

        return result

    def get_tool_definitions(self) -> list[ToolDefinition]:
        """Get tool definitions for all loaded triks."""
        tools: list[ToolDefinition] = []

        for loaded in self._triks.values():
            manifest = loaded.manifest
            for action_name, action in manifest.actions.items():
                tool = self._action_to_tool_definition(manifest.id, action_name, action)
                tools.append(tool)

        return tools

    def _action_to_tool_definition(
        self, trik_id: str, action_name: str, action: ActionDefinition
    ) -> ToolDefinition:
        """Convert an action definition to a tool definition."""
        return ToolDefinition(
            name=f"{trik_id}:{action_name}",
            description=action.description or f"Execute {action_name} on {trik_id}",
            input_schema=action.inputSchema.model_dump(exclude_none=True),
            response_mode=action.responseMode,
        )

    async def execute(
        self,
        trik_id: str,
        action_name: str,
        input_data: Any,
        options: ExecuteTrikOptions | None = None,
    ) -> GatewayResultWithSession:
        """
        Execute a trik action.

        Args:
            trik_id: The trik identifier
            action_name: The action name to execute
            input_data: Input data for the action
            options: Execution options

        Returns:
            GatewayResultWithSession containing the result and optional session ID
        """
        options = options or ExecuteTrikOptions()

        loaded = self._triks.get(trik_id)
        if not loaded:
            return GatewayResultWithSession(
                result=GatewayError(
                    code=GatewayErrorCode.TRIK_NOT_FOUND,
                    error=f'Trik "{trik_id}" is not loaded. Call load_trik() first.',
                )
            )

        manifest = loaded.manifest
        graph = loaded.graph
        trik_path = loaded.path
        runtime = loaded.runtime

        action = manifest.actions.get(action_name)
        if not action:
            available = ", ".join(manifest.actions.keys())
            return GatewayResultWithSession(
                result=GatewayError(
                    code=GatewayErrorCode.INVALID_INPUT,
                    error=f'Action "{action_name}" not found. Available: {available}',
                )
            )

        # Validate input
        input_schema = action.inputSchema.model_dump(exclude_none=True)
        input_validation = self._validator.validate(
            f"{trik_id}:{action_name}:input", input_schema, input_data
        )
        if not input_validation.valid:
            return GatewayResultWithSession(
                result=GatewayError(
                    code=GatewayErrorCode.INVALID_INPUT,
                    error=f"Invalid input: {', '.join(input_validation.errors or [])}",
                )
            )

        # Handle session
        session: TrikSession | None = None
        if manifest.capabilities.session and manifest.capabilities.session.enabled:
            if options.session_id:
                session = await self._session_storage.get(options.session_id)
            if not session:
                session = await self._session_storage.create(
                    trik_id, manifest.capabilities.session
                )

        try:
            # Get config context for this trik
            config_context = self._config_store.get_for_trik(trik_id)

            # Get storage context if storage is enabled
            storage_context: TrikStorageContext | None = None
            if manifest.capabilities.storage and manifest.capabilities.storage.enabled:
                storage_context = self._storage_provider.for_trik(
                    trik_id, manifest.capabilities.storage
                )

            # Execute based on runtime
            if runtime == TrikRuntime.PYTHON:
                if not graph:
                    return GatewayResultWithSession(
                        result=GatewayError(
                            code=GatewayErrorCode.EXECUTION_ERROR,
                            error="Graph not loaded for Python trik",
                        )
                    )

                result = await self._execute_python_trik(
                    graph,
                    action_name,
                    input_data,
                    session,
                    config_context,
                    storage_context,
                    manifest.limits.maxExecutionTimeMs,
                )
            else:
                # Node.js triks are executed via worker subprocess
                result = await self._execute_node_trik(
                    trik_path,
                    action_name,
                    input_data,
                    session,
                    config_context,
                    storage_context,
                    manifest.limits.maxExecutionTimeMs,
                )

            # Handle clarification
            if result.needs_clarification and result.clarification_questions:
                if self._config.on_clarification_needed:
                    await self._config.on_clarification_needed(
                        trik_id, result.clarification_questions
                    )

                return GatewayResultWithSession(
                    result=GatewayClarification(
                        sessionId=session.sessionId if session else "",
                        questions=result.clarification_questions,
                    ),
                    session_id=session.sessionId if session else None,
                )

            return await self._process_result(
                trik_id, action_name, action, session, result
            )

        except asyncio.TimeoutError:
            return GatewayResultWithSession(
                result=GatewayError(
                    code=GatewayErrorCode.TIMEOUT,
                    error=f"Execution timed out after {manifest.limits.maxExecutionTimeMs}ms",
                )
            )
        except Exception as e:
            return GatewayResultWithSession(
                result=GatewayError(
                    code=GatewayErrorCode.EXECUTION_ERROR,
                    error=str(e),
                )
            )

    async def _execute_python_trik(
        self,
        graph: TrikGraph,
        action_name: str,
        input_data: Any,
        session: TrikSession | None,
        config_context: TrikConfigContext,
        storage_context: TrikStorageContext | None,
        timeout_ms: int,
    ) -> TrikOutput:
        """Execute a Python trik with timeout."""
        trik_input: dict[str, Any] = {
            "action": action_name,
            "input": input_data,
        }

        if session:
            trik_input["session"] = {
                "sessionId": session.sessionId,
                "history": [entry.model_dump() for entry in session.history],
            }

        # Add config and storage to input if needed
        trik_input["config"] = config_context
        if storage_context:
            trik_input["storage"] = storage_context

        # Execute with timeout
        async def execute() -> dict[str, Any]:
            return await graph.invoke(trik_input)

        raw_result = await asyncio.wait_for(execute(), timeout=timeout_ms / 1000)

        # Convert to TrikOutput
        return TrikOutput(
            response_mode=ResponseMode(raw_result.get("responseMode", "template")),
            agent_data=raw_result.get("agentData"),
            user_content=(
                PassthroughContent.model_validate(raw_result["userContent"])
                if raw_result.get("userContent")
                else None
            ),
            end_session=raw_result.get("endSession", False),
            needs_clarification=raw_result.get("needsClarification", False),
            clarification_questions=(
                [
                    ClarificationQuestion.model_validate(q)
                    for q in raw_result.get("clarificationQuestions", [])
                ]
                if raw_result.get("clarificationQuestions")
                else None
            ),
        )

    async def _get_node_worker(self) -> NodeWorker:
        """Get or create the Node.js worker."""
        if self._node_worker is None:
            self._node_worker = NodeWorker(self._node_worker_config)
            await self._node_worker.start()
        return self._node_worker

    async def _execute_node_trik(
        self,
        trik_path: str,
        action_name: str,
        input_data: Any,
        session: TrikSession | None,
        config_context: TrikConfigContext,
        storage_context: TrikStorageContext | None,
        timeout_ms: int,
    ) -> TrikOutput:
        """Execute a JavaScript trik via Node.js worker subprocess."""
        worker = await self._get_node_worker()

        # Build session data for worker
        session_data: dict[str, Any] | None = None
        if session:
            session_data = {
                "sessionId": session.sessionId,
                "history": [entry.model_dump() for entry in session.history],
            }

        # Execute via worker
        options = ExecuteNodeTrikOptions(
            session=session_data,
            config=config_context,
            storage=storage_context,
        )

        result = await worker.invoke(
            trik_path,
            action_name,
            input_data,
            options,
        )

        # Convert InvokeResult to TrikOutput
        return TrikOutput(
            response_mode=ResponseMode(result.response_mode or "template"),
            agent_data=result.agent_data,
            user_content=(
                PassthroughContent.model_validate(result.user_content)
                if result.user_content
                else None
            ),
            end_session=result.end_session,
            needs_clarification=result.needs_clarification,
            clarification_questions=(
                [
                    ClarificationQuestion.model_validate(q)
                    for q in (result.clarification_questions or [])
                ]
                if result.clarification_questions
                else None
            ),
        )

    async def _process_result(
        self,
        trik_id: str,
        action_name: str,
        action: ActionDefinition,
        session: TrikSession | None,
        result: TrikOutput,
    ) -> GatewayResultWithSession:
        """Process the trik result and return gateway result."""
        effective_mode = result.response_mode or action.responseMode

        # Update session
        if session:
            if result.end_session:
                await self._session_storage.delete(session.sessionId)
                session = None
            else:
                await self._session_storage.add_history(
                    session.sessionId,
                    action_name,
                    {},
                    result.agent_data,
                    result.user_content.model_dump() if result.user_content else None,
                )

        session_id = session.sessionId if session else None

        # Handle passthrough mode
        if effective_mode == ResponseMode.PASSTHROUGH:
            if result.user_content is None:
                return GatewayResultWithSession(
                    result=GatewayError(
                        code=GatewayErrorCode.INVALID_OUTPUT,
                        error="Passthrough mode requires userContent",
                    ),
                    session_id=session_id,
                )

            # Validate user content
            if action.userContentSchema:
                user_schema = action.userContentSchema.model_dump(exclude_none=True)
                user_validation = self._validator.validate(
                    f"{trik_id}:{action_name}:userContent",
                    user_schema,
                    result.user_content.model_dump(),
                )
                if not user_validation.valid:
                    return GatewayResultWithSession(
                        result=GatewayError(
                            code=GatewayErrorCode.INVALID_OUTPUT,
                            error=f"Invalid userContent: {', '.join(user_validation.errors or [])}",
                        ),
                        session_id=session_id,
                    )

            content_ref = self._store_passthrough_content(
                trik_id, action_name, result.user_content
            )

            return GatewayResultWithSession(
                result=GatewaySuccessPassthrough(
                    userContentRef=content_ref,
                    contentType=result.user_content.contentType,
                    metadata=result.user_content.metadata,
                ),
                session_id=session_id,
            )

        # Handle template mode
        if result.agent_data is None:
            return GatewayResultWithSession(
                result=GatewayError(
                    code=GatewayErrorCode.INVALID_OUTPUT,
                    error="Template mode requires agentData",
                ),
                session_id=session_id,
            )

        # Validate agent data
        if action.agentDataSchema:
            agent_schema = action.agentDataSchema.model_dump(exclude_none=True)
            agent_validation = self._validator.validate(
                f"{trik_id}:{action_name}:agentData", agent_schema, result.agent_data
            )
            if not agent_validation.valid:
                return GatewayResultWithSession(
                    result=GatewayError(
                        code=GatewayErrorCode.INVALID_OUTPUT,
                        error=f"Invalid agentData: {', '.join(agent_validation.errors or [])}",
                    ),
                    session_id=session_id,
                )

        # Get template text if available
        template_text: str | None = None
        if isinstance(result.agent_data, dict):
            template_id = result.agent_data.get("template")
            if template_id and action.responseTemplates:
                template = action.responseTemplates.get(template_id)
                if template:
                    template_text = template.text

        return GatewayResultWithSession(
            result=GatewaySuccessTemplate(
                agentData=result.agent_data,
                templateText=template_text,
            ),
            session_id=session_id,
        )

    # ============================================
    # Passthrough Content Management
    # ============================================

    def _store_passthrough_content(
        self, trik_id: str, action_name: str, content: PassthroughContent
    ) -> str:
        """Store passthrough content and return a reference."""
        self._cleanup_expired_content_references()

        ref = str(uuid.uuid4())
        now = int(time.time() * 1000)

        self._content_references[ref] = UserContentReference(
            ref=ref,
            trikId=trik_id,
            actionName=action_name,
            content=content,
            createdAt=now,
            expiresAt=now + self.CONTENT_REF_TTL_MS,
        )

        return ref

    def _cleanup_expired_content_references(self) -> None:
        """Clean up expired content references."""
        now = int(time.time() * 1000)
        expired = [
            ref
            for ref, content_ref in self._content_references.items()
            if content_ref.expiresAt < now
        ]
        for ref in expired:
            del self._content_references[ref]

    def deliver_content(
        self, ref: str
    ) -> tuple[PassthroughContent, PassthroughDeliveryReceipt] | None:
        """
        Deliver passthrough content to the user.
        One-time delivery - the reference is deleted after delivery.
        """
        content_ref = self._content_references.get(ref)

        if not content_ref:
            return None

        now = int(time.time() * 1000)
        if content_ref.expiresAt < now:
            del self._content_references[ref]
            return None

        # One-time delivery
        del self._content_references[ref]

        return (
            content_ref.content,
            PassthroughDeliveryReceipt(
                contentType=content_ref.content.contentType,
                metadata=content_ref.content.metadata,
            ),
        )

    def has_content_ref(self, ref: str) -> bool:
        """Check if a content reference exists and is valid."""
        content_ref = self._content_references.get(ref)
        if not content_ref:
            return False

        now = int(time.time() * 1000)
        if content_ref.expiresAt < now:
            del self._content_references[ref]
            return False

        return True

    def get_content_ref_info(
        self, ref: str
    ) -> dict[str, Any] | None:
        """Get information about a content reference."""
        content_ref = self._content_references.get(ref)
        if not content_ref:
            return None

        now = int(time.time() * 1000)
        if content_ref.expiresAt < now:
            return None

        return {
            "contentType": content_ref.content.contentType,
            "metadata": content_ref.content.metadata,
        }

    def resolve_template(
        self, template: ResponseTemplate, agent_data: dict[str, Any]
    ) -> str:
        """Resolve a template with agent data."""
        text = template.text

        def replace_placeholder(match: re.Match[str]) -> str:
            field_name = match.group(1)
            value = agent_data.get(field_name)
            return str(value) if value is not None else f"{{{{{field_name}}}}}"

        return re.sub(r"\{\{(\w+)\}\}", replace_placeholder, text)

    def get_action_templates(
        self, trik_id: str, action_name: str
    ) -> dict[str, ResponseTemplate] | None:
        """Get response templates for an action."""
        loaded = self._triks.get(trik_id)
        if not loaded:
            return None

        action = loaded.manifest.actions.get(action_name)
        if not action:
            return None

        return action.responseTemplates

    async def close(self) -> None:
        """Clean up resources (shutdown workers, close connections)."""
        await self.shutdown()
