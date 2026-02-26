"""
TrikGateway — loads triks, routes messages, manages handoff sessions.

Mirrors packages/js/gateway/src/gateway.ts.

Python triks are loaded in-process via TrikLoader.
JavaScript triks are executed via NodeWorker subprocess.
"""

from __future__ import annotations

import importlib.util
import json
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from trikhub.manifest import (
    HandoffLogEntry,
    HandoffSession,
    JSONSchema,
    ToolCallRecord,
    ToolDeclaration,
    TrikAgent,
    TrikConfigContext,
    TrikContext,
    TrikManifest,
    TrikResponse,
    TrikRuntime,
    ToolExecutionResult,
    validate_data,
    validate_manifest,
)
from trikhub.worker.trik_loader import TrikLoader

from trikhub.gateway.config_store import ConfigStore, FileConfigStore, InMemoryConfigStore
from trikhub.gateway.node_worker import NodeWorker, NodeWorkerConfig
from trikhub.gateway.session_storage import InMemorySessionStorage, SessionStorage
from trikhub.gateway.storage_provider import InMemoryStorageProvider, SqliteStorageProvider, StorageProvider


# ============================================================================
# Types
# ============================================================================


@dataclass
class _LoadedTrik:
    manifest: TrikManifest
    agent: Any  # TrikAgent (Protocol) — may be proxy for JS triks
    path: str
    runtime: TrikRuntime


@dataclass
class LoadFromConfigOptions:
    """Options for load_triks_from_config()."""
    config_path: str | None = None
    base_dir: str | None = None


@dataclass
class TrikGatewayConfig:
    allowed_triks: list[str] | None = None
    triks_directory: str | None = None
    config_store: ConfigStore | None = None
    storage_provider: StorageProvider | None = None
    session_storage: SessionStorage | None = None
    validate_config: bool = True
    node_worker_config: NodeWorkerConfig | None = None
    max_turns_per_handoff: int = 20


# ============================================================================
# Route Result Types
# ============================================================================


@dataclass
class RouteToMain:
    target: str = "main"
    handoff_tools: list[HandoffToolDefinition] | None = None

    def __post_init__(self) -> None:
        if self.handoff_tools is None:
            self.handoff_tools = []


@dataclass
class RouteToTrik:
    target: str
    trik_id: str
    response: TrikResponse
    session_id: str

    def __init__(self, trik_id: str, response: TrikResponse, session_id: str) -> None:
        self.target = "trik"
        self.trik_id = trik_id
        self.response = response
        self.session_id = session_id


@dataclass
class RouteTransferBack:
    target: str
    trik_id: str
    message: str
    summary: str
    session_id: str

    def __init__(self, trik_id: str, message: str, summary: str, session_id: str) -> None:
        self.target = "transfer_back"
        self.trik_id = trik_id
        self.message = message
        self.summary = summary
        self.session_id = session_id


@dataclass
class RouteForceBack:
    target: str
    trik_id: str
    message: str
    summary: str
    session_id: str

    def __init__(self, trik_id: str, message: str, summary: str, session_id: str) -> None:
        self.target = "force_back"
        self.trik_id = trik_id
        self.message = message
        self.summary = summary
        self.session_id = session_id


RouteResult = RouteToMain | RouteToTrik | RouteTransferBack | RouteForceBack


@dataclass
class HandoffToolDefinition:
    name: str
    description: str
    input_schema: dict[str, Any]


@dataclass
class ExposedToolDefinition:
    trik_id: str
    tool_name: str
    description: str
    input_schema: JSONSchema
    output_schema: JSONSchema
    output_template: str


@dataclass
class _ActiveHandoff:
    trik_id: str
    session_id: str
    turn_count: int


# ============================================================================
# Gateway
# ============================================================================


class TrikGateway:
    """
    Central orchestration point for trik execution.

    - Loads Python triks in-process (fast).
    - Loads JavaScript triks via NodeWorker subprocess (isolated).
    - Routes messages through handoff sessions.
    - Manages exposed tool-mode tools.
    """

    def __init__(self, config: TrikGatewayConfig | None = None) -> None:
        cfg = config or TrikGatewayConfig()
        self._config = cfg
        self._config_store: ConfigStore = cfg.config_store or FileConfigStore()
        self._storage_provider: StorageProvider = cfg.storage_provider or SqliteStorageProvider()
        self._session_storage: SessionStorage = cfg.session_storage or InMemorySessionStorage()
        self._max_turns = cfg.max_turns_per_handoff
        self._config_loaded = False
        self._node_worker: NodeWorker | None = None
        self._trik_loader = TrikLoader()
        self._triks: dict[str, _LoadedTrik] = {}
        self._active_handoff: _ActiveHandoff | None = None

    # -- Initialization -------------------------------------------------------

    async def initialize(self) -> None:
        if not self._config_loaded:
            await self._config_store.load()
            self._config_loaded = True

    @property
    def config_store(self) -> ConfigStore:
        return self._config_store

    @property
    def storage_provider(self) -> StorageProvider:
        return self._storage_provider

    @property
    def session_storage(self) -> SessionStorage:
        return self._session_storage

    # -- Message Routing ------------------------------------------------------

    async def route_message(self, message: str, session_id: str) -> RouteResult:
        # /back escape
        if message.strip() == "/back" and self._active_handoff:
            return self._force_transfer_back()

        # Active handoff — route to trik
        if self._active_handoff:
            return await self._route_to_trik(message, session_id)

        # No handoff — return to main agent
        return RouteToMain(handoff_tools=self.get_handoff_tools())

    async def start_handoff(
        self, trik_id: str, context: str, session_id: str
    ) -> RouteToTrik | RouteTransferBack:
        loaded = self._triks.get(trik_id)
        if loaded is None:
            raise ValueError(f'Trik "{trik_id}" is not loaded')

        handoff_session = self._session_storage.create_session(trik_id)
        self._active_handoff = _ActiveHandoff(
            trik_id=trik_id,
            session_id=handoff_session.sessionId,
            turn_count=0,
        )

        self._session_storage.append_log(
            handoff_session.sessionId,
            HandoffLogEntry(
                timestamp=_now_ms(),
                type="handoff_start",
                summary=f"Handoff to {loaded.manifest.name}",
            ),
        )

        return await self._route_to_trik(context, session_id)

    def get_active_handoff(self) -> dict[str, Any] | None:
        if not self._active_handoff:
            return None
        return {
            "trikId": self._active_handoff.trik_id,
            "sessionId": self._active_handoff.session_id,
            "turnCount": self._active_handoff.turn_count,
        }

    # -- Handoff Tool Generation ----------------------------------------------

    def get_handoff_tools(self) -> list[HandoffToolDefinition]:
        tools: list[HandoffToolDefinition] = []
        for trik_id, loaded in self._triks.items():
            if loaded.manifest.agent.mode != "conversational":
                continue
            tools.append(
                HandoffToolDefinition(
                    name=f"talk_to_{trik_id}",
                    description=loaded.manifest.agent.handoffDescription or "",
                    input_schema={
                        "type": "object",
                        "properties": {
                            "context": {
                                "type": "string",
                                "description": "Context about what the user needs from this agent",
                            }
                        },
                        "required": ["context"],
                    },
                )
            )
        return tools

    def get_exposed_tools(self) -> list[ExposedToolDefinition]:
        tools: list[ExposedToolDefinition] = []
        for trik_id, loaded in self._triks.items():
            if loaded.manifest.agent.mode != "tool":
                continue
            if not loaded.manifest.tools:
                continue
            for tool_name, decl in loaded.manifest.tools.items():
                if not decl.inputSchema or not decl.outputSchema or not decl.outputTemplate:
                    continue
                tools.append(
                    ExposedToolDefinition(
                        trik_id=trik_id,
                        tool_name=tool_name,
                        description=decl.description,
                        input_schema=decl.inputSchema,
                        output_schema=decl.outputSchema,
                        output_template=decl.outputTemplate,
                    )
                )
        return tools

    async def execute_exposed_tool(
        self,
        trik_id: str,
        tool_name: str,
        input: dict[str, Any],
    ) -> str:
        loaded = self._triks.get(trik_id)
        if loaded is None:
            raise ValueError(f'Trik "{trik_id}" is not loaded')
        if loaded.manifest.agent.mode != "tool":
            raise ValueError(f'Trik "{trik_id}" is not a tool-mode trik')

        decl = (loaded.manifest.tools or {}).get(tool_name)
        if not decl or not decl.inputSchema or not decl.outputSchema or not decl.outputTemplate:
            raise ValueError(f'Tool "{tool_name}" not found in trik "{trik_id}"')

        # Validate input
        input_validation = validate_data(decl.inputSchema.model_dump(by_alias=True, exclude_none=True), input)
        if not input_validation.valid:
            raise ValueError(
                f"Invalid input for {trik_id}.{tool_name}: {', '.join(input_validation.errors or [])}"
            )

        agent = loaded.agent
        if not callable(getattr(agent, "execute_tool", None)):
            raise ValueError(f'Trik "{trik_id}" does not implement execute_tool()')

        ctx = self._build_trik_context(f"tool:{trik_id}:{tool_name}", loaded)
        result: ToolExecutionResult = await agent.execute_tool(tool_name, input, ctx)

        # Validate output
        output_validation = validate_data(
            decl.outputSchema.model_dump(by_alias=True, exclude_none=True), result.output
        )
        if not output_validation.valid:
            raise ValueError(
                f'Tool "{tool_name}" returned invalid output: {", ".join(output_validation.errors or [])}'
            )

        # Strip to declared properties
        declared_props = list(
            (decl.outputSchema.properties or {}).keys()
        )
        stripped: dict[str, Any] = {k: result.output[k] for k in declared_props if k in result.output}

        # Fill outputTemplate
        import re

        def _replace(m: re.Match[str]) -> str:
            field = m.group(1)
            val = stripped.get(field)
            if val is None:
                return m.group(0)
            return str(val)

        return re.sub(r"\{\{(\w+)\}\}", _replace, decl.outputTemplate)

    # -- Internal Routing -----------------------------------------------------

    async def _route_to_trik(
        self, message: str, session_id: str
    ) -> RouteToTrik | RouteTransferBack:
        handoff = self._active_handoff
        assert handoff is not None
        loaded = self._triks[handoff.trik_id]

        ctx = self._build_trik_context(handoff.session_id, loaded)
        handoff.turn_count += 1

        if handoff.turn_count > self._max_turns:
            return self._auto_transfer_back(
                f"Maximum turns ({self._max_turns}) exceeded. Automatically transferring back."
            )

        try:
            response: TrikResponse = await loaded.agent.process_message(message, ctx)
        except Exception as exc:
            return self._auto_transfer_back(
                f'Trik "{loaded.manifest.name}" encountered an error: {exc}'
            )

        if response.toolCalls:
            self._process_tool_calls(handoff.session_id, loaded.manifest, response.toolCalls)

        if response.transferBack:
            self._session_storage.append_log(
                handoff.session_id,
                HandoffLogEntry(
                    timestamp=_now_ms(),
                    type="handoff_end",
                    summary=f"Transferred back from {loaded.manifest.name}",
                ),
            )
            summary = self._build_session_summary(handoff.session_id, loaded.manifest)
            result = RouteTransferBack(
                trik_id=handoff.trik_id,
                message=response.message,
                summary=summary,
                session_id=handoff.session_id,
            )
            self._active_handoff = None
            return result

        return RouteToTrik(
            trik_id=handoff.trik_id,
            response=response,
            session_id=handoff.session_id,
        )

    def _force_transfer_back(self) -> RouteForceBack:
        handoff = self._active_handoff
        assert handoff is not None
        loaded = self._triks[handoff.trik_id]

        self._session_storage.append_log(
            handoff.session_id,
            HandoffLogEntry(
                timestamp=_now_ms(),
                type="handoff_end",
                summary="Force transfer-back via /back",
            ),
        )
        summary = self._build_session_summary(handoff.session_id, loaded.manifest)
        result = RouteForceBack(
            trik_id=handoff.trik_id,
            message="",
            summary=summary,
            session_id=handoff.session_id,
        )
        self._active_handoff = None
        return result

    def _auto_transfer_back(self, reason: str) -> RouteTransferBack:
        handoff = self._active_handoff
        assert handoff is not None
        loaded = self._triks[handoff.trik_id]

        self._session_storage.append_log(
            handoff.session_id,
            HandoffLogEntry(
                timestamp=_now_ms(),
                type="handoff_end",
                summary=reason,
            ),
        )
        summary = self._build_session_summary(handoff.session_id, loaded.manifest)
        result = RouteTransferBack(
            trik_id=handoff.trik_id,
            message=reason,
            summary=summary,
            session_id=handoff.session_id,
        )
        self._active_handoff = None
        return result

    # -- Conversation Log -----------------------------------------------------

    def _process_tool_calls(
        self,
        session_id: str,
        manifest: TrikManifest,
        tool_calls: list[ToolCallRecord],
    ) -> None:
        for call in tool_calls:
            decl = (manifest.tools or {}).get(call.tool)
            summary = self._build_tool_log_summary(call, decl)
            self._session_storage.append_log(
                session_id,
                HandoffLogEntry(timestamp=_now_ms(), type="tool_execution", summary=summary),
            )

    @staticmethod
    def _build_tool_log_summary(
        call: ToolCallRecord, decl: ToolDeclaration | None
    ) -> str:
        if not decl or not decl.logTemplate:
            return f"Called {call.tool}"
        import re

        def _replace(m: re.Match[str]) -> str:
            field = m.group(1)
            val = call.output.get(field)
            if val is None:
                return m.group(0)
            return str(val)

        return re.sub(r"\{\{(\w+)\}\}", _replace, decl.logTemplate)

    def _build_session_summary(self, session_id: str, manifest: TrikManifest) -> str:
        session = self._session_storage.get_session(session_id)
        if session is None or len(session.log) == 0:
            return f"Handoff to {manifest.name} (no activity logged)"

        tool_entries = [e for e in session.log if e.type == "tool_execution"]
        if not tool_entries:
            return f"Handoff to {manifest.name} (conversation only, no tools used)"

        return "\n".join(f"- {e.summary}" for e in tool_entries)

    # -- Context Building -----------------------------------------------------

    def _build_trik_context(self, session_id: str, loaded: _LoadedTrik) -> TrikContext:
        config_ctx = self._config_store.get_for_trik(loaded.manifest.id)
        storage_ctx = self._storage_provider.for_trik(
            loaded.manifest.id,
            loaded.manifest.capabilities.storage if loaded.manifest.capabilities else None,
        )
        return TrikContext(sessionId=session_id, config=config_ctx, storage=storage_ctx)

    # -- Trik Loading ---------------------------------------------------------

    async def load_trik(self, trik_path: str) -> TrikManifest:
        manifest_path = os.path.join(trik_path, "manifest.json")
        with open(manifest_path) as f:
            manifest_data = json.load(f)

        validation = validate_manifest(manifest_data)
        if not validation.valid:
            raise ValueError(
                f"Invalid manifest at {manifest_path}: {', '.join(validation.errors or [])}"
            )

        manifest = TrikManifest(**manifest_data)

        if self._config.allowed_triks and manifest.id not in self._config.allowed_triks:
            raise ValueError(f'Trik "{manifest.id}" is not in the allowlist')

        runtime = manifest.entry.runtime or TrikRuntime.NODE
        is_tool_mode = manifest.agent.mode == "tool"

        if runtime == TrikRuntime.PYTHON or runtime == "python":
            # Load Python triks in-process
            agent = self._trik_loader.load(trik_path)
            self._triks[manifest.id] = _LoadedTrik(
                manifest=manifest, agent=agent, path=trik_path, runtime=TrikRuntime.PYTHON
            )
        else:
            # JS triks via NodeWorker proxy
            await self._ensure_node_worker()
            agent = self._create_node_agent_proxy(manifest, trik_path)

            if is_tool_mode:
                if not callable(getattr(agent, "execute_tool", None)):
                    raise ValueError(
                        f'Trik "{manifest.id}" module does not export a valid tool-mode TrikAgent'
                    )
                # Check duplicate tool names
                if manifest.tools:
                    for tn in manifest.tools:
                        for eid, et in self._triks.items():
                            if et.manifest.agent.mode != "tool":
                                continue
                            if et.manifest.tools and tn in et.manifest.tools:
                                raise ValueError(
                                    f'Duplicate tool name "{tn}": declared in both "{eid}" and "{manifest.id}"'
                                )
            else:
                if not callable(getattr(agent, "process_message", None)):
                    raise ValueError(
                        f'Trik "{manifest.id}" module does not export a valid TrikAgent'
                    )

            self._triks[manifest.id] = _LoadedTrik(
                manifest=manifest, agent=agent, path=trik_path, runtime=TrikRuntime.NODE
            )

        return manifest

    def _create_node_agent_proxy(
        self, manifest: TrikManifest, trik_path: str
    ) -> Any:
        """Create a proxy TrikAgent for JS triks that delegates to NodeWorker."""
        gateway = self

        class _NodeAgentProxy:
            pass

        proxy = _NodeAgentProxy()

        if manifest.agent.mode == "conversational":

            async def _process_message(message: str, context: TrikContext) -> TrikResponse:
                worker = await gateway._ensure_node_worker()
                worker.set_storage_context(context.storage)
                try:
                    result = await worker.process_message(
                        trik_path=trik_path,
                        message=message,
                        session_id=context.sessionId,
                        config=_config_to_record(context.config),
                        storage_namespace=manifest.id,
                    )
                    return TrikResponse(
                        message=result.message,
                        transferBack=result.transfer_back,
                        toolCalls=(
                            [ToolCallRecord(**tc) for tc in result.tool_calls]
                            if result.tool_calls
                            else None
                        ),
                    )
                finally:
                    worker.set_storage_context(None)

            proxy.process_message = _process_message  # type: ignore[attr-defined]

        if manifest.agent.mode == "tool":

            async def _execute_tool(
                tool_name: str, input: dict[str, Any], context: TrikContext
            ) -> ToolExecutionResult:
                worker = await gateway._ensure_node_worker()
                worker.set_storage_context(context.storage)
                try:
                    result = await worker.execute_tool(
                        trik_path=trik_path,
                        tool_name=tool_name,
                        input=input,
                        session_id=context.sessionId,
                        config=_config_to_record(context.config),
                        storage_namespace=manifest.id,
                    )
                    return ToolExecutionResult(output=result.output)
                finally:
                    worker.set_storage_context(None)

            proxy.execute_tool = _execute_tool  # type: ignore[attr-defined]

        return proxy

    async def _ensure_node_worker(self) -> NodeWorker:
        if self._node_worker is None:
            self._node_worker = NodeWorker(self._config.node_worker_config)
        if not self._node_worker.ready:
            await self._node_worker.start()
        return self._node_worker

    async def shutdown(self) -> None:
        if self._node_worker:
            await self._node_worker.shutdown()
            self._node_worker = None

    # -- Directory Loading ----------------------------------------------------

    async def load_triks_from_directory(self, directory: str) -> list[TrikManifest]:
        resolved = (
            os.path.join(os.path.expanduser("~"), directory[1:])
            if directory.startswith("~")
            else os.path.abspath(directory)
        )

        manifests: list[TrikManifest] = []
        errors: list[tuple[str, str]] = []

        if not os.path.isdir(resolved):
            return manifests

        for entry in os.listdir(resolved):
            entry_path = os.path.join(resolved, entry)
            if not os.path.isdir(entry_path):
                continue

            if entry.startswith("@"):
                # Scoped directory
                for scoped in os.listdir(entry_path):
                    scoped_path = os.path.join(entry_path, scoped)
                    if not os.path.isdir(scoped_path):
                        continue
                    mp = os.path.join(scoped_path, "manifest.json")
                    if os.path.isfile(mp):
                        try:
                            m = await self.load_trik(scoped_path)
                            manifests.append(m)
                        except Exception as e:
                            errors.append((scoped_path, str(e)))
            else:
                mp = os.path.join(entry_path, "manifest.json")
                if os.path.isfile(mp):
                    try:
                        m = await self.load_trik(entry_path)
                        manifests.append(m)
                    except Exception as e:
                        errors.append((entry_path, str(e)))

        if errors:
            import sys
            for path, err in errors:
                print(f"[TrikGateway] Failed to load {path}: {err}", file=sys.stderr)

        return manifests

    # -- Config Loading -------------------------------------------------------

    async def load_triks_from_config(
        self, options: LoadFromConfigOptions | None = None
    ) -> list[TrikManifest]:
        """Load triks from a config file (.trikhub/config.json)."""
        options = options or LoadFromConfigOptions()
        config_path = options.config_path or str(
            Path.cwd() / ".trikhub" / "config.json"
        )
        base_dir = options.base_dir or os.path.dirname(config_path)

        if not os.path.exists(config_path):
            return []

        try:
            with open(config_path) as f:
                config_data = json.load(f)
        except Exception as e:
            raise ValueError(f'Failed to read config file "{config_path}": {e}')

        if "triks" not in config_data or not isinstance(config_data["triks"], list):
            return []

        manifests: list[TrikManifest] = []
        errors: list[tuple[str, str]] = []

        for trik_name in config_data["triks"]:
            try:
                # 1. Check if it's a direct path
                if os.path.isdir(trik_name):
                    manifests.append(await self.load_trik(trik_name))
                    continue

                # 2. Check in .trikhub/triks/ directory
                triks_dir = os.path.join(base_dir, "triks", trik_name)
                if os.path.isdir(triks_dir):
                    manifests.append(await self.load_trik(triks_dir))
                    continue

                # 3. Try to import as Python package
                package_names_to_try = []
                if trik_name.startswith("@"):
                    parts = trik_name[1:].split("/", 1)
                    if len(parts) == 2:
                        scope, name = parts
                        package_names_to_try.append(name.replace("-", "_"))
                        package_names_to_try.append(f"{scope}_{name}".replace("-", "_"))
                else:
                    package_names_to_try.append(trik_name.replace("-", "_"))

                found = False
                for package_name in package_names_to_try:
                    try:
                        spec = importlib.util.find_spec(package_name)
                        if spec and spec.origin:
                            trik_path = os.path.dirname(spec.origin)
                            manifests.append(await self.load_trik(trik_path))
                            found = True
                            break
                    except (ImportError, ModuleNotFoundError):
                        continue

                if not found:
                    errors.append((trik_name, f"Could not find trik {trik_name}"))

            except Exception as e:
                errors.append((trik_name, str(e)))

        if errors:
            import sys
            for trik_name, err in errors:
                print(f"[TrikGateway] Failed to load {trik_name}: {err}", file=sys.stderr)

        return manifests

    # -- Trik Queries ---------------------------------------------------------

    def get_manifest(self, trik_id: str) -> TrikManifest | None:
        loaded = self._triks.get(trik_id)
        return loaded.manifest if loaded else None

    def get_loaded_triks(self) -> list[str]:
        return list(self._triks.keys())

    def is_loaded(self, trik_id: str) -> bool:
        return trik_id in self._triks

    def unload_trik(self, trik_id: str) -> bool:
        return self._triks.pop(trik_id, None) is not None


# ============================================================================
# Helpers
# ============================================================================


def _now_ms() -> int:
    return int(time.time() * 1000)


def _config_to_record(config: TrikConfigContext) -> dict[str, str]:
    record: dict[str, str] = {}
    for key in config.keys():
        value = config.get(key)
        if value is not None:
            record[key] = value
    return record
