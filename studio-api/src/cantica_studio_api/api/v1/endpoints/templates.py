"""AIActor template discovery endpoints (read-only)."""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from cantica_studio_api.api.deps import SettingsDep

router = APIRouter(prefix="/templates", tags=["templates"])


class TemplateInfo(BaseModel):
    name: str
    path: str
    description: str = ""
    tags: list[str] = []


def _scan_templates(templates_dir: Path) -> list[TemplateInfo]:
    """Walk *templates_dir* and return metadata for every ``*.json`` manifest."""
    results: list[TemplateInfo] = []
    if not templates_dir.exists():
        return results
    for manifest in sorted(templates_dir.rglob("manifest.json")):
        try:
            data = json.loads(manifest.read_text())
            results.append(TemplateInfo(
                name=data.get("name", manifest.parent.name),
                path=str(manifest.parent.relative_to(templates_dir)),
                description=data.get("description", ""),
                tags=data.get("tags", []),
            ))
        except Exception:  # noqa: BLE001
            pass  # skip malformed manifests
    return results


@router.get("", response_model=list[TemplateInfo])
def list_templates(settings: SettingsDep) -> list[TemplateInfo]:
    """List available AIActor templates from CANTICA_HOME/templates."""
    return _scan_templates(settings.templates_path)


@router.get("/{template_path:path}/manifest", response_model=TemplateInfo)
def get_template(template_path: str, settings: SettingsDep) -> TemplateInfo:
    """Return the manifest for a specific template."""
    manifest = settings.templates_path / template_path / "manifest.json"
    if not manifest.exists():
        raise HTTPException(status_code=404, detail="Template not found")
    try:
        data = json.loads(manifest.read_text())
        return TemplateInfo(
            name=data.get("name", template_path),
            path=template_path,
            description=data.get("description", ""),
            tags=data.get("tags", []),
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Malformed template manifest") from exc
