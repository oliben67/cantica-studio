"""Shared fixtures for studio_api tests."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from studio_api.cantica_client import CanticaConnector
from studio_api.config import Settings
from studio_api.main import create_app
from studio_api.runtime import ActorRuntime
from studio_api.workspace_fs import WorkspaceFS


@pytest.fixture
def tmp_workspace(tmp_path: Path) -> Path:
    return tmp_path / "workspace"


@pytest.fixture
def settings(tmp_workspace: Path) -> Settings:
    tmp_workspace.mkdir(parents=True, exist_ok=True)
    return Settings(workspace=tmp_workspace)


@pytest.fixture
def mock_runtime() -> ActorRuntime:
    rt = MagicMock(spec=ActorRuntime)
    rt.list_running.return_value = []
    return rt


@pytest.fixture
def mock_connector() -> CanticaConnector:
    conn = MagicMock(spec=CanticaConnector)
    conn.list_prompts = AsyncMock(return_value=[])
    conn.get_prompt_content = AsyncMock(return_value="")
    return conn


@pytest.fixture
def client(
    tmp_workspace: Path,
    mock_runtime: ActorRuntime,
    mock_connector: CanticaConnector,
    monkeypatch: pytest.MonkeyPatch,
) -> TestClient:
    """FastAPI TestClient with mocked runtime, connector, and test workspace."""
    tmp_workspace.mkdir(parents=True, exist_ok=True)

    # Inject test settings so all endpoints use tmp_workspace
    import studio_api.config as cfg_mod  # noqa: PLC0415

    test_settings = Settings(workspace=tmp_workspace)
    monkeypatch.setattr(cfg_mod, "_settings", test_settings)

    app = create_app()

    from studio_api.api.v1 import prompts as prompts_ep  # noqa: PLC0415
    from studio_api.api.v1 import runtime as runtime_ep  # noqa: PLC0415
    import studio_api.mcp_server as mcp_mod  # noqa: PLC0415

    # Enter the TestClient context (this triggers lifespan and sets real singletons),
    # then immediately replace them with mocks so tests run against controlled fakes.
    with TestClient(app, raise_server_exceptions=True) as c:
        prompts_ep._connector = mock_connector
        runtime_ep._runtime = mock_runtime
        runtime_ep._connector = mock_connector
        mcp_mod.init(WorkspaceFS(tmp_workspace))
        yield c

    # Cleanup module-level singletons
    prompts_ep._connector = None
    runtime_ep._runtime = None
    runtime_ep._connector = None
    mcp_mod._fs = None
