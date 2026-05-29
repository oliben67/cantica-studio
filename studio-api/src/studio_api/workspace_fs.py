"""Workspace-scoped file system operations (path-traversal safe)."""

from __future__ import annotations

import fnmatch
from pathlib import Path


class WorkspaceFS:
    def __init__(self, workspace: Path) -> None:
        self._root = workspace.resolve()

    def _safe(self, rel: str) -> Path:
        resolved = (self._root / rel).resolve()
        if not str(resolved).startswith(str(self._root)):
            raise PermissionError(f"Path {rel!r} escapes the workspace")
        return resolved

    def read(self, path: str) -> str:
        return self._safe(path).read_text(encoding="utf-8")

    def write(self, path: str, content: str) -> None:
        p = self._safe(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")

    def list(self, directory: str = ".") -> list[str]:
        d = self._safe(directory)
        if not d.is_dir():
            return []
        return [
            str(entry.relative_to(self._root))
            for entry in sorted(d.iterdir())
        ]

    def search(self, pattern: str) -> list[str]:
        return [
            str(p.relative_to(self._root))
            for p in self._root.rglob("*")
            if p.is_file() and fnmatch.fnmatch(p.name, pattern)
        ]
