"""Tests for shell tool handlers."""

from __future__ import annotations

import os
import sys

import pytest

from trikhub.sdk.shell_tools import ShellDefaults, ShellHandlers, create_shell_handlers


@pytest.fixture()
def workspace(tmp_path):
    """Create a temporary workspace directory."""
    return str(tmp_path)


@pytest.fixture()
def handlers(workspace):
    """Create shell handlers bound to the workspace."""
    return create_shell_handlers(workspace)


# ============================================================================
# execute_command
# ============================================================================


class TestExecuteCommand:
    def test_runs_command_and_captures_stdout(self, handlers):
        result = handlers.execute_command(command="echo hello")
        assert result.stdout.strip() == "hello"
        assert result.exit_code == 0

    def test_captures_stderr(self, handlers):
        result = handlers.execute_command(command="echo error >&2")
        assert result.stderr.strip() == "error"
        assert result.exit_code == 0

    def test_returns_nonzero_exit_code(self, handlers):
        result = handlers.execute_command(command="exit 42")
        assert result.exit_code == 42

    def test_respects_cwd(self, workspace, handlers):
        subdir = os.path.join(workspace, "subdir")
        os.makedirs(subdir)
        with open(os.path.join(subdir, "test.txt"), "w") as f:
            f.write("content")
        result = handlers.execute_command(command="ls", cwd="subdir")
        assert result.stdout.strip() == "test.txt"

    def test_respects_env(self, handlers):
        result = handlers.execute_command(
            command="echo $MY_VAR", env={"MY_VAR": "custom_value"}
        )
        assert result.stdout.strip() == "custom_value"

    def test_enforces_timeout(self, handlers):
        result = handlers.execute_command(command="sleep 10", timeoutMs=100)
        assert result.exit_code == 124
        assert "timed out" in result.stderr

    def test_rejects_cwd_traversal(self, handlers):
        with pytest.raises(ValueError, match="traversal"):
            handlers.execute_command(command="echo hi", cwd="../../..")

    def test_raises_for_nonexistent_cwd(self, handlers):
        with pytest.raises(FileNotFoundError, match="not found"):
            handlers.execute_command(command="echo hi", cwd="nonexistent")


# ============================================================================
# Defaults
# ============================================================================


class TestShellDefaults:
    def test_custom_default_timeout(self, workspace):
        custom_handlers = create_shell_handlers(
            workspace, ShellDefaults(timeout_ms=100)
        )
        result = custom_handlers.execute_command(command="sleep 10")
        assert result.exit_code == 124


# ============================================================================
# handle() dispatch
# ============================================================================


class TestHandle:
    def test_dispatches_execute_command(self, handlers):
        result = handlers.handle("execute_command", {"command": "echo test"})
        assert result.stdout.strip() == "test"

    def test_raises_for_unknown_tool(self, handlers):
        with pytest.raises(ValueError, match="Unknown shell tool"):
            handlers.handle("unknown_tool", {})
