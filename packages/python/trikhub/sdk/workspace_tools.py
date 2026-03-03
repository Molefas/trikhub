"""
LangChain tool wrappers for workspace filesystem and shell tools.

When a trik declares filesystem/shell capabilities, these tools are
created and can be added to the LangGraph agent's tool list.
The handlers delegate to the underlying filesystem_tools and shell_tools
implementations which use native fs/os/shell APIs inside the container.

Usage:
    from trikhub.sdk import get_workspace_tools

    def my_factory(context):
        llm = ChatAnthropic(...)
        tools = [*my_tools, transfer_back_tool, *get_workspace_tools(context)]
        return create_react_agent(llm, tools)

    export = wrap_agent(my_factory)

Mirrors packages/js/sdk/src/workspace-tools.ts
"""

from __future__ import annotations

from typing import Any

from langchain_core.tools import tool
from pydantic import BaseModel, Field

from trikhub.manifest import TrikCapabilities, TrikContext

from .filesystem_tools import FilesystemHandlers
from .shell_tools import ShellDefaults, ShellHandlers

# The set of tool names that are workspace-injected (used for output filtering)
WORKSPACE_TOOL_NAMES: set[str] = {
    "read_file",
    "write_file",
    "edit_file",
    "list_directory",
    "glob_files",
    "grep_files",
    "delete_file",
    "create_directory",
    "execute_command",
}

# System prompt appendix for workspace tools
WORKSPACE_SYSTEM_PROMPT = """## Workspace Tools
You have access to a sandboxed workspace at /workspace.
- Use read_file, write_file, edit_file to manipulate files
- Use list_directory, glob_files, grep_files to explore
- Use execute_command to run shell commands
- All file paths are relative to /workspace
- You cannot access files outside /workspace"""


# ============================================================================
# Pydantic input schemas for LangChain tools
# ============================================================================


class ReadFileInput(BaseModel):
    path: str = Field(description="File path relative to /workspace")


class WriteFileInput(BaseModel):
    path: str = Field(description="File path relative to /workspace")
    content: str = Field(description="Content to write")


class EditFileInput(BaseModel):
    path: str = Field(description="File path relative to /workspace")
    old_string: str = Field(description="The exact string to find and replace")
    new_string: str = Field(description="The string to replace it with")


class ListDirectoryInput(BaseModel):
    path: str | None = Field(
        default=None, description='Directory path relative to /workspace (default: ".")'
    )


class GlobFilesInput(BaseModel):
    pattern: str = Field(description='Glob pattern (e.g., "**/*.py", "src/*.js")')


class GrepFilesInput(BaseModel):
    pattern: str = Field(description="Regular expression pattern to search for")
    glob: str | None = Field(
        default=None,
        description='Optional glob pattern to filter files (default: "**/*")',
    )


class DeleteFileInput(BaseModel):
    path: str = Field(description="File path relative to /workspace")


class CreateDirectoryInput(BaseModel):
    path: str = Field(description="Directory path relative to /workspace")


class ExecuteCommandInput(BaseModel):
    command: str = Field(description="Shell command to execute")
    cwd: str | None = Field(
        default=None,
        description="Working directory relative to /workspace (default: /workspace)",
    )
    timeoutMs: int | None = Field(
        default=None, description="Timeout in milliseconds (default: 30000)"
    )
    env: dict[str, str] | None = Field(
        default=None, description="Additional environment variables"
    )


# ============================================================================
# LangChain tool creation
# ============================================================================


def _create_filesystem_langchain_tools(workspace_root: str) -> list[Any]:
    """Create LangChain tools for filesystem operations."""
    handlers = FilesystemHandlers(workspace_root)

    @tool("read_file", args_schema=ReadFileInput)
    def read_file(path: str) -> str:
        """Read the contents of a file. Returns the file content as a string."""
        return handlers.read_file(path=path)

    @tool("write_file", args_schema=WriteFileInput)
    def write_file(path: str, content: str) -> str:
        """Create or overwrite a file with the given content. Creates parent directories if needed."""
        return handlers.write_file(path=path, content=content)

    @tool("edit_file", args_schema=EditFileInput)
    def edit_file(path: str, old_string: str, new_string: str) -> str:
        """Replace a specific string in a file with a new string. Fails if the old string is not found."""
        return handlers.edit_file(path=path, old_string=old_string, new_string=new_string)

    @tool("list_directory", args_schema=ListDirectoryInput)
    def list_directory(path: str | None = None) -> str:
        """List the contents of a directory. Returns file and directory names."""
        return handlers.list_directory(path=path)

    @tool("glob_files", args_schema=GlobFilesInput)
    def glob_files(pattern: str) -> str:
        """Find files matching a glob pattern within the workspace."""
        return handlers.glob_files(pattern=pattern)

    @tool("grep_files", args_schema=GrepFilesInput)
    def grep_files(pattern: str, glob: str | None = None) -> str:
        """Search file contents for lines matching a regex pattern. Returns matching lines with file paths and line numbers."""
        return handlers.grep_files(pattern=pattern, glob=glob)

    @tool("delete_file", args_schema=DeleteFileInput)
    def delete_file(path: str) -> str:
        """Delete a file from the workspace."""
        return handlers.delete_file(path=path)

    @tool("create_directory", args_schema=CreateDirectoryInput)
    def create_directory(path: str) -> str:
        """Create a directory (and any parent directories) in the workspace."""
        return handlers.create_directory(path=path)

    return [
        read_file,
        write_file,
        edit_file,
        list_directory,
        glob_files,
        grep_files,
        delete_file,
        create_directory,
    ]


def _create_shell_langchain_tools(
    workspace_root: str, capabilities: TrikCapabilities
) -> list[Any]:
    """Create LangChain tools for shell command execution."""
    shell_caps = capabilities.shell
    defaults = ShellDefaults(
        timeout_ms=shell_caps.timeoutMs if shell_caps and shell_caps.timeoutMs else 30_000,
        max_concurrent=shell_caps.maxConcurrent if shell_caps and shell_caps.maxConcurrent else 3,
    )
    handlers = ShellHandlers(workspace_root, defaults)

    @tool("execute_command", args_schema=ExecuteCommandInput)
    def execute_command(
        command: str,
        cwd: str | None = None,
        timeoutMs: int | None = None,
        env: dict[str, str] | None = None,
    ) -> str:
        """Run a shell command in the workspace. Returns stdout, stderr, and exit code."""
        result = handlers.execute_command(
            command=command, cwd=cwd, timeoutMs=timeoutMs, env=env
        )
        import json

        return json.dumps(
            {
                "stdout": result.stdout,
                "stderr": result.stderr,
                "exitCode": result.exit_code,
            }
        )

    return [execute_command]


def get_workspace_tools(
    context: TrikContext,
    workspace_root: str = "/workspace",
) -> list[Any]:
    """Get LangChain tools for workspace operations based on the trik's capabilities.

    Returns an empty array if no filesystem/shell capabilities are enabled.
    Include the returned tools in your LangGraph agent's tool list.

    Args:
        context: The TrikContext (must have capabilities populated by the gateway)
        workspace_root: Override the workspace root directory (default: /workspace)

    Returns:
        List of LangChain tool instances
    """
    caps = context.capabilities
    if caps is None:
        return []

    tools: list[Any] = []

    if caps.filesystem and caps.filesystem.enabled:
        tools.extend(_create_filesystem_langchain_tools(workspace_root))

    if caps.shell and caps.shell.enabled:
        tools.extend(_create_shell_langchain_tools(workspace_root, caps))

    return tools


def get_active_workspace_tool_names(
    capabilities: TrikCapabilities | None = None,
) -> set[str]:
    """Get the set of workspace tool names that are active for the given capabilities.

    Used internally by wrap_agent to filter these from ToolCallRecord output.
    """
    if capabilities is None:
        return set()

    names: set[str] = set()

    if capabilities.filesystem and capabilities.filesystem.enabled:
        names.update(
            {
                "read_file",
                "write_file",
                "edit_file",
                "list_directory",
                "glob_files",
                "grep_files",
                "delete_file",
                "create_directory",
            }
        )

    if capabilities.shell and capabilities.shell.enabled:
        names.add("execute_command")

    return names
