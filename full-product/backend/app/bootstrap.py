"""Explicit first-owner command. Passwords are accepted only by secure prompt."""

import argparse
from getpass import getpass
from sqlalchemy import select, text
from .db import SessionLocal
from . import models as m
from .security import hash_password, audit
from .seed import seed_workspace
from .domain import DEFAULT_RULES


def main():
    parser = argparse.ArgumentParser(
        description="Create the first AEGIS owner after running migrations."
    )
    parser.add_argument("--email", required=True)
    parser.add_argument("--name", default="Workspace owner")
    parser.add_argument("--workspace", default="AEGIS security workspace")
    args = parser.parse_args()
    email = args.email.strip().lower()
    if "@" not in email:
        raise SystemExit("Enter a valid email address.")
    password = getpass("New owner password (12+ characters): ")
    if len(password) < 12 or len(password) > 256:
        raise SystemExit("Password must be 12–256 characters.")
    if password != getpass("Confirm password: "):
        raise SystemExit("Passwords do not match.")
    with SessionLocal() as db:
        if db.bind.dialect.name == "postgresql":
            db.execute(text("SELECT pg_advisory_xact_lock(18490127)"))
        if db.scalar(select(m.User.id).limit(1)):
            raise SystemExit("An owner already exists. This command never resets credentials.")
        for role in ["Owner", "Admin", "Analyst", "Viewer"]:
            db.add(
                m.Role(
                    name=role,
                    permissions=["read"]
                    if role == "Viewer"
                    else ["read", "analyze"]
                    if role == "Analyst"
                    else ["read", "analyze", "manage"]
                    if role == "Admin"
                    else ["read", "analyze", "manage", "configure"],
                )
            )
        db.flush()
        user = m.User(email=email, name=args.name, password_hash=hash_password(password))
        workspace = m.Workspace(
            name=args.workspace,
            scope="Authorized synthetic documentation IP addresses and example domains. No discovery or network operations are enabled.",
            settings={
                "retention_days": 90,
                "compact_mode": False,
                "reduced_motion": False,
                "risk_rules": DEFAULT_RULES,
            },
        )
        db.add_all([user, workspace])
        db.flush()
        db.add(m.Membership(workspace_id=workspace.id, user_id=user.id, role="Owner"))
        db.flush()
        seed_workspace(db, workspace, user.id)
        audit(
            db,
            workspace.id,
            user.id,
            "First owner created",
            "Explicit local setup command completed.",
        )
        db.commit()
    print("Owner created. Sign in through the frontend. No password was written to logs.")


if __name__ == "__main__":
    main()
