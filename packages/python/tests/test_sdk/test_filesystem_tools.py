"""Tests for filesystem tool handlers."""

from __future__ import annotations

import os
import tempfile

import pytest

from trikhub.sdk.filesystem_tools import FilesystemHandlers, create_filesystem_handlers


@pytest.fixture()
def workspace(tmp_path):
    """Create a temporary workspace directory."""
    return str(tmp_path)


@pytest.fixture()
def handlers(workspace):
    """Create filesystem handlers bound to the workspace."""
    return create_filesystem_handlers(workspace)


# ============================================================================
# read_file
# ============================================================================


class TestReadFile:
    def test_reads_existing_file(self, workspace, handlers):
        path = os.path.join(workspace, "hello.txt")
        with open(path, "w") as f:
            f.write("Hello, world!")
        assert handlers.read_file(path="hello.txt") == "Hello, world!"

    def test_raises_for_missing_file(self, handlers):
        with pytest.raises(FileNotFoundError, match="File not found"):
            handlers.read_file(path="missing.txt")

    def test_raises_for_directory(self, workspace, handlers):
        os.makedirs(os.path.join(workspace, "somedir"))
        with pytest.raises(IsADirectoryError):
            handlers.read_file(path="somedir")


# ============================================================================
# write_file
# ============================================================================


class TestWriteFile:
    def test_creates_new_file(self, workspace, handlers):
        result = handlers.write_file(path="new.txt", content="content")
        assert "File written" in result
        with open(os.path.join(workspace, "new.txt")) as f:
            assert f.read() == "content"

    def test_overwrites_existing_file(self, workspace, handlers):
        with open(os.path.join(workspace, "existing.txt"), "w") as f:
            f.write("old")
        handlers.write_file(path="existing.txt", content="new")
        with open(os.path.join(workspace, "existing.txt")) as f:
            assert f.read() == "new"

    def test_creates_parent_directories(self, workspace, handlers):
        handlers.write_file(path="deep/nested/file.txt", content="deep")
        with open(os.path.join(workspace, "deep", "nested", "file.txt")) as f:
            assert f.read() == "deep"


# ============================================================================
# edit_file
# ============================================================================


class TestEditFile:
    def test_replaces_string(self, workspace, handlers):
        with open(os.path.join(workspace, "edit.txt"), "w") as f:
            f.write("Hello, world!")
        handlers.edit_file(path="edit.txt", old_string="world", new_string="cosmos")
        with open(os.path.join(workspace, "edit.txt")) as f:
            assert f.read() == "Hello, cosmos!"

    def test_raises_when_string_not_found(self, workspace, handlers):
        with open(os.path.join(workspace, "edit.txt"), "w") as f:
            f.write("Hello, world!")
        with pytest.raises(ValueError, match="String not found"):
            handlers.edit_file(path="edit.txt", old_string="xyz", new_string="abc")

    def test_raises_for_missing_file(self, handlers):
        with pytest.raises(FileNotFoundError, match="File not found"):
            handlers.edit_file(path="missing.txt", old_string="a", new_string="b")


# ============================================================================
# list_directory
# ============================================================================


class TestListDirectory:
    def test_lists_contents(self, workspace, handlers):
        with open(os.path.join(workspace, "file.txt"), "w") as f:
            f.write("")
        os.makedirs(os.path.join(workspace, "subdir"))
        result = handlers.list_directory(path=".")
        assert "file.txt" in result
        assert "subdir/" in result

    def test_lists_empty_directory(self, workspace, handlers):
        os.makedirs(os.path.join(workspace, "empty"))
        assert handlers.list_directory(path="empty") == ""

    def test_defaults_to_workspace_root(self, workspace, handlers):
        with open(os.path.join(workspace, "root.txt"), "w") as f:
            f.write("")
        result = handlers.list_directory()
        assert "root.txt" in result


# ============================================================================
# glob_files
# ============================================================================


class TestGlobFiles:
    def test_matches_by_pattern(self, workspace, handlers):
        for name in ("a.ts", "b.ts", "c.js"):
            with open(os.path.join(workspace, name), "w") as f:
                f.write("")
        result = handlers.glob_files(pattern="*.ts")
        assert "a.ts" in result
        assert "b.ts" in result
        assert "c.js" not in result

    def test_matches_nested_with_recursive(self, workspace, handlers):
        os.makedirs(os.path.join(workspace, "src"))
        with open(os.path.join(workspace, "src", "index.ts"), "w") as f:
            f.write("")
        result = handlers.glob_files(pattern="**/*.ts")
        assert "src/index.ts" in result or "src\\index.ts" in result


# ============================================================================
# grep_files
# ============================================================================


class TestGrepFiles:
    def test_finds_matching_lines(self, workspace, handlers):
        with open(os.path.join(workspace, "code.py"), "w") as f:
            f.write("x = 1\ny = 2\nx = 3\n")
        result = handlers.grep_files(pattern="x =")
        assert "code.py:1:" in result
        assert "code.py:3:" in result

    def test_returns_empty_for_no_matches(self, workspace, handlers):
        with open(os.path.join(workspace, "code.py"), "w") as f:
            f.write("hello\n")
        assert handlers.grep_files(pattern="xyz") == ""

    def test_filters_by_glob(self, workspace, handlers):
        with open(os.path.join(workspace, "a.ts"), "w") as f:
            f.write("match\n")
        with open(os.path.join(workspace, "b.js"), "w") as f:
            f.write("match\n")
        result = handlers.grep_files(pattern="match", glob="*.ts")
        assert "a.ts" in result
        assert "b.js" not in result


# ============================================================================
# delete_file
# ============================================================================


class TestDeleteFile:
    def test_deletes_file(self, workspace, handlers):
        path = os.path.join(workspace, "doomed.txt")
        with open(path, "w") as f:
            f.write("")
        handlers.delete_file(path="doomed.txt")
        assert not os.path.exists(path)

    def test_raises_for_missing_file(self, handlers):
        with pytest.raises(FileNotFoundError, match="File not found"):
            handlers.delete_file(path="missing.txt")


# ============================================================================
# create_directory
# ============================================================================


class TestCreateDirectory:
    def test_creates_directory(self, workspace, handlers):
        handlers.create_directory(path="newdir")
        assert os.path.isdir(os.path.join(workspace, "newdir"))

    def test_creates_nested_directories(self, workspace, handlers):
        handlers.create_directory(path="a/b/c")
        assert os.path.isdir(os.path.join(workspace, "a", "b", "c"))


# ============================================================================
# Path traversal protection
# ============================================================================


class TestPathTraversal:
    def test_rejects_parent_traversal(self, handlers):
        with pytest.raises(ValueError, match="traversal"):
            handlers.read_file(path="../../../etc/passwd")

    def test_rejects_absolute_path_outside(self, handlers):
        with pytest.raises(ValueError, match="traversal"):
            handlers.read_file(path="/etc/passwd")

    def test_allows_safe_relative_paths(self, workspace, handlers):
        with open(os.path.join(workspace, "safe.txt"), "w") as f:
            f.write("ok")
        assert handlers.read_file(path="./safe.txt") == "ok"


# ============================================================================
# handle() dispatch
# ============================================================================


class TestHandle:
    def test_dispatches_to_read_file(self, workspace, handlers):
        with open(os.path.join(workspace, "test.txt"), "w") as f:
            f.write("content")
        result = handlers.handle("read_file", {"path": "test.txt"})
        assert result == "content"

    def test_raises_for_unknown_tool(self, handlers):
        with pytest.raises(ValueError, match="Unknown filesystem tool"):
            handlers.handle("unknown_tool", {})
