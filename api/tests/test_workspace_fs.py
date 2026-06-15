"""Tests for studio_api.workspace_fs — WorkspaceFS."""

from __future__ import annotations

from pathlib import Path

import pytest

from studio_api.workspace_fs import WorkspaceFS


@pytest.fixture
def ws(tmp_path: Path) -> WorkspaceFS:
    return WorkspaceFS(tmp_path)


@pytest.fixture
def ws_with_files(tmp_path: Path) -> WorkspaceFS:
    (tmp_path / "hello.txt").write_text("Hello World", encoding="utf-8")
    (tmp_path / "sub").mkdir()
    (tmp_path / "sub" / "nested.py").write_text("x = 1", encoding="utf-8")
    (tmp_path / "sub" / "data.json").write_text("{}", encoding="utf-8")
    return WorkspaceFS(tmp_path)


# ── read ──────────────────────────────────────────────────────────────────────


def test_read_existing_file(ws: WorkspaceFS, tmp_path: Path):
    (tmp_path / "hello.txt").write_text("Hello World", encoding="utf-8")
    assert ws.read("hello.txt") == "Hello World"


def test_read_nested_file(ws: WorkspaceFS, tmp_path: Path):
    (tmp_path / "sub").mkdir()
    (tmp_path / "sub" / "f.txt").write_text("nested", encoding="utf-8")
    assert ws.read("sub/f.txt") == "nested"


def test_read_unicode_content(ws: WorkspaceFS, tmp_path: Path):
    content = "Hello 🌍 日本語"
    (tmp_path / "unicode.txt").write_text(content, encoding="utf-8")
    assert ws.read("unicode.txt") == content


def test_read_nonexistent_raises(ws: WorkspaceFS):
    with pytest.raises(FileNotFoundError):
        ws.read("does_not_exist.txt")


def test_read_path_traversal_raises(ws: WorkspaceFS):
    with pytest.raises(PermissionError):
        ws.read("../../etc/passwd")


def test_read_double_dot_in_subdir_raises(ws: WorkspaceFS, tmp_path: Path):
    (tmp_path / "sub").mkdir()
    with pytest.raises(PermissionError):
        ws.read("sub/../../etc/passwd")


# ── write ─────────────────────────────────────────────────────────────────────


def test_write_creates_file(ws: WorkspaceFS, tmp_path: Path):
    ws.write("output.txt", "data")
    assert (tmp_path / "output.txt").read_text() == "data"


def test_write_creates_parent_dirs(ws: WorkspaceFS, tmp_path: Path):
    ws.write("a/b/c/file.txt", "deep")
    assert (tmp_path / "a" / "b" / "c" / "file.txt").read_text() == "deep"


def test_write_overwrites_existing(ws: WorkspaceFS, tmp_path: Path):
    (tmp_path / "f.txt").write_text("old", encoding="utf-8")
    ws.write("f.txt", "new")
    assert (tmp_path / "f.txt").read_text() == "new"


def test_write_unicode_content(ws: WorkspaceFS, tmp_path: Path):
    content = "こんにちは 🎵"
    ws.write("unicode.txt", content)
    assert (tmp_path / "unicode.txt").read_text(encoding="utf-8") == content


def test_write_path_traversal_raises(ws: WorkspaceFS):
    with pytest.raises(PermissionError):
        ws.write("../../tmp/evil.txt", "bad")


# ── list ──────────────────────────────────────────────────────────────────────


def test_list_root(ws_with_files: WorkspaceFS):
    entries = ws_with_files.list()
    assert "hello.txt" in entries
    assert "sub" in entries


def test_list_subdirectory(ws_with_files: WorkspaceFS):
    entries = ws_with_files.list("sub")
    assert "sub/nested.py" in entries
    assert "sub/data.json" in entries


def test_list_empty_directory(ws: WorkspaceFS, tmp_path: Path):
    (tmp_path / "empty").mkdir()
    assert ws.list("empty") == []


def test_list_nonexistent_returns_empty(ws: WorkspaceFS):
    assert ws.list("does_not_exist") == []


def test_list_path_traversal_raises(ws: WorkspaceFS):
    with pytest.raises(PermissionError):
        ws.list("../../")


# ── search ────────────────────────────────────────────────────────────────────


def test_search_by_extension(ws_with_files: WorkspaceFS):
    results = ws_with_files.search("*.py")
    assert any("nested.py" in r for r in results)
    assert not any("hello.txt" in r for r in results)


def test_search_all_files(ws_with_files: WorkspaceFS):
    results = ws_with_files.search("*")
    assert len(results) == 3  # hello.txt, nested.py, data.json


def test_search_no_match(ws_with_files: WorkspaceFS):
    assert ws_with_files.search("*.rb") == []


def test_search_by_name_pattern(ws_with_files: WorkspaceFS):
    results = ws_with_files.search("*.json")
    assert any("data.json" in r for r in results)


def test_search_empty_workspace(ws: WorkspaceFS):
    assert ws.search("*") == []
