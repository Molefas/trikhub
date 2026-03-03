"""
Filesystem tool schemas and handlers for containerized triks.

These tools are auto-injected by wrap_agent when a trik declares
capabilities.filesystem.enabled = True. All paths are resolved
relative to the workspace root (container mount point).

Mirrors packages/js/sdk/src/filesystem-tools.ts
"""

from __future__ import annotations

import glob as glob_module
import os
import re
from pathlib import Path


# ============================================================================
# Path Safety
# ============================================================================


def _safe_path(workspace_root: str, user_path: str) -> str:
    """Resolve a user-provided path safely within the workspace root.

    Defense-in-depth — the container is the primary boundary.

    Raises:
        ValueError: If the resolved path escapes the workspace root.
    """
    root = os.path.realpath(workspace_root)
    resolved = os.path.realpath(os.path.join(root, user_path))
    if not resolved.startswith(root + os.sep) and resolved != root:
        raise ValueError(f'Path traversal denied: "{user_path}" resolves outside workspace')
    return resolved


# ============================================================================
# Tool Schemas
# ============================================================================

FILESYSTEM_TOOL_SCHEMAS: list[dict] = [
    {
        "name": "read_file",
        "description": "Read the contents of a file. Returns the file content as a string.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "File path relative to /workspace"},
            },
            "required": ["path"],
        },
    },
    {
        "name": "write_file",
        "description": "Create or overwrite a file with the given content. Creates parent directories if needed.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "File path relative to /workspace"},
                "content": {"type": "string", "description": "Content to write"},
            },
            "required": ["path", "content"],
        },
    },
    {
        "name": "edit_file",
        "description": "Replace a specific string in a file with a new string. Fails if the old string is not found.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "File path relative to /workspace"},
                "old_string": {"type": "string", "description": "The exact string to find and replace"},
                "new_string": {"type": "string", "description": "The string to replace it with"},
            },
            "required": ["path", "old_string", "new_string"],
        },
    },
    {
        "name": "list_directory",
        "description": "List the contents of a directory. Returns file and directory names.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Directory path relative to /workspace (default: \".\")"},
            },
        },
    },
    {
        "name": "glob_files",
        "description": "Find files matching a glob pattern within the workspace.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "pattern": {"type": "string", "description": 'Glob pattern (e.g., "**/*.py", "src/*.js")'},
            },
            "required": ["pattern"],
        },
    },
    {
        "name": "grep_files",
        "description": "Search file contents for lines matching a regex pattern. Returns matching lines with file paths and line numbers.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "pattern": {"type": "string", "description": "Regular expression pattern to search for"},
                "glob": {"type": "string", "description": 'Optional glob pattern to filter files (default: "**/*")'},
            },
            "required": ["pattern"],
        },
    },
    {
        "name": "delete_file",
        "description": "Delete a file from the workspace.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "File path relative to /workspace"},
            },
            "required": ["path"],
        },
    },
    {
        "name": "create_directory",
        "description": "Create a directory (and any parent directories) in the workspace.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Directory path relative to /workspace"},
            },
            "required": ["path"],
        },
    },
]


# ============================================================================
# Tool Handlers
# ============================================================================


class FilesystemHandlers:
    """Filesystem tool handlers bound to a specific workspace root."""

    def __init__(self, workspace_root: str) -> None:
        self._root = os.path.realpath(workspace_root)
        os.makedirs(self._root, exist_ok=True)

    def read_file(self, *, path: str) -> str:
        full_path = _safe_path(self._root, path)
        if not os.path.exists(full_path):
            raise FileNotFoundError(f"File not found: {path}")
        if os.path.isdir(full_path):
            raise IsADirectoryError(f"Path is a directory, not a file: {path}")
        with open(full_path, encoding="utf-8") as f:
            return f.read()

    def write_file(self, *, path: str, content: str) -> str:
        full_path = _safe_path(self._root, path)
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        with open(full_path, "w", encoding="utf-8") as f:
            f.write(content)
        return f"File written: {path}"

    def edit_file(self, *, path: str, old_string: str, new_string: str) -> str:
        full_path = _safe_path(self._root, path)
        if not os.path.exists(full_path):
            raise FileNotFoundError(f"File not found: {path}")
        with open(full_path, encoding="utf-8") as f:
            file_content = f.read()
        if old_string not in file_content:
            raise ValueError(f'String not found in {path}: "{old_string}"')
        updated = file_content.replace(old_string, new_string, 1)
        with open(full_path, "w", encoding="utf-8") as f:
            f.write(updated)
        return f"File edited: {path}"

    def list_directory(self, *, path: str | None = None) -> str:
        target = _safe_path(self._root, path or ".")
        if not os.path.exists(target):
            raise FileNotFoundError(f"Directory not found: {path or '.'}")
        if not os.path.isdir(target):
            raise NotADirectoryError(f"Path is not a directory: {path}")
        entries = []
        for name in sorted(os.listdir(target)):
            full = os.path.join(target, name)
            entries.append(f"{name}/" if os.path.isdir(full) else name)
        return "\n".join(entries)

    def glob_files(self, *, pattern: str) -> str:
        matches = glob_module.glob(pattern, root_dir=self._root, recursive=True)
        return "\n".join(sorted(matches))

    def grep_files(self, *, pattern: str, glob: str | None = None) -> str:
        regex = re.compile(pattern)
        file_pattern = glob or "**/*"
        files = glob_module.glob(file_pattern, root_dir=self._root, recursive=True)

        results: list[str] = []
        for file_path in sorted(files):
            full_path = os.path.join(self._root, file_path)
            if not os.path.isfile(full_path):
                continue
            try:
                with open(full_path, encoding="utf-8") as f:
                    for i, line in enumerate(f, 1):
                        if regex.search(line):
                            results.append(f"{file_path}:{i}:{line.rstrip()}")
            except (UnicodeDecodeError, PermissionError):
                # Skip files that can't be read (binary, permissions, etc.)
                continue
        return "\n".join(results)

    def delete_file(self, *, path: str) -> str:
        full_path = _safe_path(self._root, path)
        if not os.path.exists(full_path):
            raise FileNotFoundError(f"File not found: {path}")
        os.remove(full_path)
        return f"File deleted: {path}"

    def create_directory(self, *, path: str) -> str:
        full_path = _safe_path(self._root, path)
        os.makedirs(full_path, exist_ok=True)
        return f"Directory created: {path}"

    def handle(self, tool_name: str, input_data: dict) -> str:
        """Route a tool call to the appropriate handler."""
        handler = getattr(self, tool_name, None)
        if handler is None:
            raise ValueError(f"Unknown filesystem tool: {tool_name}")
        return handler(**input_data)


def create_filesystem_handlers(workspace_root: str) -> FilesystemHandlers:
    """Create filesystem tool handlers bound to a specific workspace root."""
    return FilesystemHandlers(workspace_root)
