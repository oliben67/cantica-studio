"""Client-key registration endpoint — always public (bootstrapping)."""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from studio_api.core.client_auth import register_client

router = APIRouter(tags=["auth"])


class RegisterRequest(BaseModel):
    client_id: str
    public_key_pem: str


class RegisterResponse(BaseModel):
    ok: bool
    client_id: str


@router.post("/auth/register", response_model=RegisterResponse)
def register(body: RegisterRequest) -> RegisterResponse:
    """Register a client public key for RS256 JWT authentication."""
    register_client(body.client_id, body.public_key_pem)
    return RegisterResponse(ok=True, client_id=body.client_id)
