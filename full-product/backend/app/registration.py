"""Self-registration creates a private workspace, never joins an existing one."""

import copy
import os
import re
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import field_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from . import models as m
from .schemas import Setup
from .db import get_db
from .security import audit, enforce_rate_limit, hash_password, new_session
from .config import settings
from .domain import DEFAULT_RULES
from .seed import seed_workspace

router = APIRouter(prefix="/api/auth", tags=["Account registration"])


def registration_enabled():
    return os.getenv("ALLOW_SELF_REGISTRATION", "true").lower() == "true"


class RegisterAccount(Setup):
    @field_validator("email")
    @classmethod
    def normalized_email(cls, value):
        value = value.strip().lower()
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", value):
            raise ValueError("Enter a valid email address.")
        return value

    @field_validator("name", "workspace_name", "scope")
    @classmethod
    def meaningful_text(cls, value, info):
        value = value.strip()
        minimum = 10 if info.field_name == "scope" else 2
        if len(value) < minimum:
            raise ValueError(f"Enter at least {minimum} non-blank characters.")
        return value


@router.get("/registration-status")
def status(db: Session = Depends(get_db)):
    needs_setup = not bool(db.scalar(select(m.User.id).limit(1)))
    enabled = registration_enabled() and not needs_setup
    return {
        "enabled": enabled,
        "setup_required": needs_setup,
        "creates_private_workspace": True,
        "reason": "Secure first-owner setup is required before self-registration."
        if needs_setup
        else "New accounts create their own private workspace. Existing workspace access requires an administrator."
        if enabled
        else "Self-registration is disabled by this installation. Ask an Owner/Admin to create or link your account.",
    }


@router.post("/register", status_code=201)
def register(
    body: RegisterAccount, request: Request, response: Response, db: Session = Depends(get_db)
):
    origin = request.headers.get("origin")
    if origin and origin.rstrip("/") != settings.frontend_origin.rstrip("/"):
        raise HTTPException(403, "Origin is not allowed.")
    if not registration_enabled():
        raise HTTPException(403, "Self-registration is disabled. Ask an Owner/Admin for access.")
    if not db.scalar(select(m.User.id).limit(1)):
        raise HTTPException(409, "Initialize the first owner using the secure setup flow first.")
    enforce_rate_limit(request, "account-registration", 5, 900)
    if db.scalar(select(m.User.id).where(m.User.email == body.email)):
        raise HTTPException(409, "This email is already registered. Sign in instead.")
    user = m.User(email=body.email, name=body.name, password_hash=hash_password(body.password))
    workspace = m.Workspace(
        name=body.workspace_name,
        scope=body.scope,
        settings={
            "retention_days": 90,
            "compact_mode": False,
            "reduced_motion": False,
            "risk_rules": copy.deepcopy(DEFAULT_RULES),
        },
    )
    try:
        db.add_all([user, workspace])
        db.flush()
        db.add(m.Membership(workspace_id=workspace.id, user_id=user.id, role="Owner"))
        db.flush()
        seed_workspace(db, workspace, user.id)
        session = new_session(db, user, response)
        audit(
            db,
            workspace.id,
            user.id,
            "Account registered",
            "Created a new private local workspace. No existing workspace membership was granted.",
            "user",
            user.id,
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            409, "The account could not be created because its identifier is already in use."
        ) from None
    return {
        "user": {"id": user.id, "email": user.email, "name": user.name},
        "csrf_token": session.csrf_token,
        "workspaces": [{**m.serialize(workspace), "role": "Owner"}],
    }
