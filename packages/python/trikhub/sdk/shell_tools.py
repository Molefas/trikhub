"""
Shell tool schema and handler for containerized triks.

Auto-injected by wrap_agent when a trik declares
capabilities.shell.enabled = True. Commands execute inside
the container, scoped by container isolation.

Mirrors packages/js/sdk/src/shell-tools.ts
"""

from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass


# ============================================================================
# Types
# ============================================================================


@dataclass
class ShellDefaults:
    """Default settings for shell execution."""

    timeout_ms: int = 30_000
    max_concurrent: int = 3


@dataclass
class ExecuteCommandOutput:
    """Output from a shell command execution."""

    stdout: str
    stderr: str
    exit_code: int


# ============================================================================
# Tool Schema
# ============================================================================

SHELL_TOOL_SCHEMAS: list[dict] = [
    {
        "name": "execute_command",
        "description": "Run a shell command in the workspace. Returns stdout, stderr, and exit code.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "command": {"type": "string", "description": "Shell command to execute"},
                "cwd": {
                    "type": "string",
                    "description": "Working directory relative to /workspace (default: /workspace)",
                },
                "timeoutMs": {
                    "type": "number",
                    "description": "Timeout in milliseconds (default: 30000)",
                },
                "env": {
                    "type": "object",
                    "description": "Additional environment variables",
                    "additionalProperties": {"type": "string"},
                },
            },
            "required": ["command"],
        },
    },
]


# ============================================================================
# Tool Handler
# ============================================================================


class ShellHandlers:
    """Shell tool handlers bound to a specific workspace root."""

    def __init__(self, workspace_root: str, defaults: ShellDefaults | None = None) -> None:
        self._root = os.path.realpath(workspace_root)
        self._defaults = defaults or ShellDefaults()

    def execute_command(
        self,
        *,
        command: str,
        cwd: str | None = None,
        timeoutMs: int | None = None,
        env: dict[str, str] | None = None,
    ) -> ExecuteCommandOutput:
        """Execute a shell command within the workspace."""
        # Resolve cwd within workspace
        exec_cwd = self._root
        if cwd:
            exec_cwd = os.path.realpath(os.path.join(self._root, cwd))
            if not exec_cwd.startswith(self._root + os.sep) and exec_cwd != self._root:
                raise ValueError(f'cwd traversal denied: "{cwd}" resolves outside workspace')
            if not os.path.exists(exec_cwd):
                raise FileNotFoundError(f"Working directory not found: {cwd}")

        timeout_ms = timeoutMs or self._defaults.timeout_ms
        timeout_sec = timeout_ms / 1000.0

        # Build environment
        exec_env = {**os.environ, **(env or {})}

        try:
            result = subprocess.run(
                command,
                shell=True,
                cwd=exec_cwd,
                timeout=timeout_sec,
                env=exec_env,
                capture_output=True,
                text=True,
            )
            return ExecuteCommandOutput(
                stdout=result.stdout,
                stderr=result.stderr,
                exit_code=result.returncode,
            )
        except subprocess.TimeoutExpired as e:
            return ExecuteCommandOutput(
                stdout=e.stdout or "" if isinstance(e.stdout, str) else (e.stdout.decode("utf-8", errors="replace") if e.stdout else ""),
                stderr=f"Command timed out after {timeout_ms}ms",
                exit_code=124,
            )

    def handle(self, tool_name: str, input_data: dict) -> ExecuteCommandOutput:
        """Route a tool call to the appropriate handler."""
        if tool_name != "execute_command":
            raise ValueError(f"Unknown shell tool: {tool_name}")
        return self.execute_command(**input_data)


def create_shell_handlers(
    workspace_root: str, defaults: ShellDefaults | None = None
) -> ShellHandlers:
    """Create shell tool handlers bound to a specific workspace root."""
    return ShellHandlers(workspace_root, defaults)
