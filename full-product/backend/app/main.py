import logging
import json
import secrets
import time
from datetime import datetime, timezone
from fastapi import FastAPI, Depends, HTTPException, Request, Response, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from sqlalchemy import select, func, text, or_, cast, String
from sqlalchemy.orm import Session as DBSession
from . import models as m, schemas as s, domain
from .config import settings
from .db import get_db
from .security import (
    current_user,
    require_workspace,
    ensure_csrf,
    audit,
    new_session,
    verify_password,
    hash_password,
    session_for,
    DUMMY_HASH,
    enforce_rate_limit,
)
from .seed import seed_workspace
from .body_limit import BodyLimitMiddleware

app = FastAPI(
    title="AEGIS defensive workspace",
    version="1.0.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)
app.add_middleware(BodyLimitMiddleware, max_upload_bytes=settings.max_upload_bytes)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH"],
    allow_headers=["Content-Type", "X-CSRF-Token", "X-Setup-Token", "Idempotency-Key"],
)
logger = logging.getLogger("aegis.api")
logger.setLevel(logging.INFO)
if not logger.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(logging.Formatter("%(message)s"))
    logger.addHandler(_handler)
logger.propagate = False
WRITE = {"Owner", "Admin", "Analyst"}
MANAGE = {"Owner", "Admin"}


@app.exception_handler(RequestValidationError)
async def validation_errors(request, exc):
    # Pydantic's default includes supplied field values, including passwords.
    return JSONResponse(
        status_code=422,
        content={
            "detail": [
                {"loc": error["loc"], "msg": error["msg"], "type": error["type"]}
                for error in exc.errors()
            ]
        },
    )


@app.middleware("http")
async def request_log(request, call_next):
    started = time.monotonic()
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Content-Security-Policy"] = (
        "default-src 'none'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: https://fastapi.tiangolo.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"
        if request.url.path == "/api/docs"
        else "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
    )
    logger.info(
        json.dumps(
            {
                "event": "request",
                "method": request.method,
                "path": request.url.path,
                "status": response.status_code,
                "duration_ms": round((time.monotonic() - started) * 1000),
            }
        )
    )
    return response


def auth_origin(request):
    origin = request.headers.get("origin")
    if origin and origin.rstrip("/") != settings.frontend_origin.rstrip("/"):
        raise HTTPException(403, "Origin is not allowed.")


def user_json(user):
    return {"id": user.id, "email": user.email, "name": user.name}


def workspace_users(db, workspace_id):
    """Expose identities only through this workspace's memberships."""
    return {
        account.id: user_json(account)
        for account in db.scalars(
            select(m.User)
            .join(m.Membership, m.Membership.user_id == m.User.id)
            .where(m.Membership.workspace_id == workspace_id)
        )
    }


def record_json(db, workspace_id, record, users=None):
    value = m.serialize(record)
    if not hasattr(record, "user_id"):
        return value
    users = users if users is not None else workspace_users(db, workspace_id)
    account = users.get(record.user_id)
    if isinstance(record, m.Membership):
        # Preserve the nested shape while supplying the table's direct fields.
        return {
            **value,
            "name": account["name"] if account else None,
            "email": account["email"] if account else None,
            "user": account,
        }
    value.update({"actor": account, "actor_name": account["name"] if account else None})
    if isinstance(record, m.ApprovalRequest):
        value["reviewer_name"] = account["name"] if account else None
    return value


def user_workspaces(db, user):
    return [
        {**m.serialize(workspace), "role": membership.role}
        for workspace, membership in db.execute(
            select(m.Workspace, m.Membership)
            .join(m.Membership, m.Membership.workspace_id == m.Workspace.id)
            .where(m.Membership.user_id == user.id)
        )
    ]


def auth_payload(db, user, session):
    return {
        "user": user_json(user),
        "csrf_token": session.csrf_token,
        "workspaces": user_workspaces(db, user),
    }


def scoped(db, model, wid, record_id):
    row = db.scalar(select(model).where(model.workspace_id == wid, model.id == record_id))
    if not row:
        raise HTTPException(404, "Record not found in this workspace.")
    return row


def list_rows(db, model, wid):
    return list(
        db.scalars(
            select(model)
            .where(model.workspace_id == wid)
            .order_by(model.created_at.desc())
            .limit(1000)
        )
    )


@app.get("/api/health")
def health():
    return {"status": "healthy", "service": "api"}


@app.get("/api/ready")
def ready(db: DBSession = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
        import redis

        redis.Redis.from_url(settings.redis_url, socket_connect_timeout=2, socket_timeout=2).ping()
        return {"status": "ready", "database": "connected", "queue": "connected"}
    except Exception:
        raise HTTPException(503, "Database or queue unavailable.")


@app.get("/api/auth/status")
def auth_status(request: Request, db: DBSession = Depends(get_db)):
    result = {
        "setup_required": not bool(db.scalar(select(m.User.id).limit(1))),
        "authenticated": False,
    }
    try:
        session = session_for(request, db)
        user = db.get(m.User, session.user_id)
        if user and user.is_active:
            result.update(auth_payload(db, user, session))
            result["authenticated"] = True
    except HTTPException:
        pass
    return result


@app.post("/api/auth/setup", status_code=201)
def setup(body: s.Setup, request: Request, response: Response, db: DBSession = Depends(get_db)):
    auth_origin(request)
    supplied = request.headers.get("X-Setup-Token", "")
    if (
        not settings.setup_token
        or settings.setup_token.startswith("CHANGE_ME")
        or len(settings.setup_token) < 24
        or not supplied
        or not secrets.compare_digest(supplied, settings.setup_token)
    ):
        raise HTTPException(403, "A valid local setup token is required.")
    # Serialize first-owner bootstrap across API processes in PostgreSQL.
    if db.bind.dialect.name == "postgresql":
        db.execute(text("SELECT pg_advisory_xact_lock(18490127)"))
    if db.scalar(select(m.User.id).limit(1)):
        raise HTTPException(409, "The first owner already exists. Sign in instead.")
    email = body.email.strip().lower()
    if "@" not in email:
        raise HTTPException(422, "Enter a valid email address.")
    for role in ["Owner", "Admin", "Analyst", "Viewer"]:
        if not db.scalar(select(m.Role).where(m.Role.name == role)):
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
    user = m.User(email=email, name=body.name.strip(), password_hash=hash_password(body.password))
    workspace = m.Workspace(
        name=body.workspace_name.strip(),
        scope=body.scope.strip(),
        settings={
            "retention_days": 90,
            "compact_mode": False,
            "reduced_motion": False,
            "risk_rules": domain.DEFAULT_RULES,
        },
    )
    db.add_all([user, workspace])
    db.flush()
    db.add(m.Membership(user_id=user.id, workspace_id=workspace.id, role="Owner"))
    db.flush()
    seed_workspace(db, workspace, user.id)
    session = new_session(db, user, response)
    audit(
        db,
        workspace.id,
        user.id,
        "First owner created",
        "Explicit local setup completed. No default shared password.",
    )
    db.commit()
    return auth_payload(db, user, session)


@app.post("/api/auth/login")
def login(body: s.Login, request: Request, response: Response, db: DBSession = Depends(get_db)):
    auth_origin(request)
    enforce_rate_limit(request, "login", 20, 900)
    user = db.scalar(select(m.User).where(m.User.email == body.email.strip().lower()))
    # Equal-cost verification avoids a trivial account enumeration timing signal.
    valid = verify_password(user.password_hash if user else DUMMY_HASH, body.password)
    if not user or not user.is_active or not valid:
        raise HTTPException(401, "Invalid email or password.")
    session = new_session(db, user, response)
    for workspace in user_workspaces(db, user):
        audit(db, workspace["id"], user.id, "User signed in", "A new local session was issued.")
    db.commit()
    return auth_payload(db, user, session)


@app.get("/api/auth/me")
def me(request: Request, user: m.User = Depends(current_user), db: DBSession = Depends(get_db)):
    return auth_payload(db, user, request.state.session)


@app.post("/api/auth/logout", dependencies=[Depends(ensure_csrf)])
def logout(
    request: Request,
    response: Response,
    user: m.User = Depends(current_user),
    db: DBSession = Depends(get_db),
):
    db.delete(session_for(request, db))
    db.commit()
    response.delete_cookie("aegis_session", path="/")
    return {"ok": True}


@app.get("/api/workspaces")
def workspaces(user: m.User = Depends(current_user), db: DBSession = Depends(get_db)):
    return user_workspaces(db, user)


@app.post("/api/workspaces", status_code=201, dependencies=[Depends(ensure_csrf)])
def create_workspace(
    body: s.WorkspaceCreate, user: m.User = Depends(current_user), db: DBSession = Depends(get_db)
):
    if not db.scalar(
        select(m.Membership).where(m.Membership.user_id == user.id, m.Membership.role == "Owner")
    ):
        raise HTTPException(403, "Only an Owner can create a workspace.")
    workspace = m.Workspace(
        name=body.name.strip(),
        scope=body.scope.strip(),
        settings={"retention_days": 90, "risk_rules": domain.DEFAULT_RULES},
    )
    db.add(workspace)
    db.flush()
    db.add(m.Membership(workspace_id=workspace.id, user_id=user.id, role="Owner"))
    db.flush()
    if body.seed_demo:
        seed_workspace(db, workspace, user.id)
    audit(db, workspace.id, user.id, "Workspace created", f"Demo seeding: {body.seed_demo}.")
    db.commit()
    return {**m.serialize(workspace), "role": "Owner"}


@app.patch("/api/workspaces/{workspace_id}", dependencies=[Depends(ensure_csrf)])
def update_workspace(
    workspace_id: str,
    body: s.WorkspacePatch,
    user: m.User = Depends(current_user),
    db: DBSession = Depends(get_db),
):
    membership = require_workspace(db, user, workspace_id, MANAGE)
    workspace = db.get(m.Workspace, workspace_id)
    if body.name is not None:
        workspace.name = body.name.strip()
    if body.scope is not None:
        workspace.scope = body.scope.strip()
    if body.settings is not None:
        if membership.role != "Owner":
            raise HTTPException(403, "Only an Owner can change system settings.")
        allowed = {"retention_days", "compact_mode", "reduced_motion", "risk_rules"}
        if set(body.settings) - allowed:
            raise HTTPException(422, "Unknown preference field.")
        if "retention_days" in body.settings and (
            not isinstance(body.settings["retention_days"], int)
            or not 7 <= body.settings["retention_days"] <= 3650
        ):
            raise HTTPException(422, "Retention must be 7–3650 days.")
        for key in ["compact_mode", "reduced_motion"]:
            if key in body.settings and not isinstance(body.settings[key], bool):
                raise HTTPException(422, "Layout preferences must be boolean.")
        if "risk_rules" in body.settings:
            rules = body.settings["risk_rules"]
            if not isinstance(rules, dict) or set(rules) != {
                "base_multiplier",
                "exposure",
                "criticality",
            }:
                raise HTTPException(422, "Supply complete risk rules.")
            if (
                not isinstance(rules["base_multiplier"], (int, float))
                or not 1 <= rules["base_multiplier"] <= 10
            ):
                raise HTTPException(422, "Base multiplier must be 1–10.")
            for key, values in [
                ("exposure", {"Internet", "Internal", "Isolated"}),
                ("criticality", {"Critical", "High", "Medium", "Low"}),
            ]:
                if (
                    not isinstance(rules[key], dict)
                    or set(rules[key]) != values
                    or any(
                        not isinstance(v, (int, float)) or not 0 <= v <= 30
                        for v in rules[key].values()
                    )
                ):
                    raise HTTPException(422, "Risk weights must contain valid 0–30 point values.")
        workspace.settings = {**workspace.settings, **body.settings}
    audit(
        db,
        workspace_id,
        user.id,
        "Workspace configuration updated",
        "Saved workspace scope or local product settings. Retention is a policy configuration; no data was deleted.",
    )
    db.commit()
    return m.serialize(workspace)


BOOTSTRAP_MODELS = {
    "assets": m.Asset,
    "relationships": m.AssetRelationship,
    "events": m.SecurityEvent,
    "findings": m.Finding,
    "vulnerabilities": m.Vulnerability,
    "threats": m.ThreatIntelligenceRecord,
    "scenarios": m.Scenario,
    "simulations": m.Simulation,
    "simulation_steps": m.SimulationStep,
    "approvals": m.ApprovalRequest,
    "snapshots": m.DigitalTwinSnapshot,
    "paths": m.AttackPath,
    "reports": m.Report,
    "audit": m.AuditLog,
    "notifications": m.Notification,
    "discovery_runs": m.DiscoveryRun,
    "agent_workflows": m.AgentWorkflow,
    "agent_executions": m.AgentExecution,
    "datasets": m.DatasetRegistry,
    "dataset_files": m.DatasetFile,
    "jobs": m.Job,
    "models": m.ModelVersion,
    "model_metrics": m.ModelMetric,
    "training_jobs": m.TrainingJob,
    "model_activations": m.ModelActivation,
}


@app.get("/api/workspaces/{workspace_id}/bootstrap")
def workspace_bootstrap(
    workspace_id: str, user: m.User = Depends(current_user), db: DBSession = Depends(get_db)
):
    membership = require_workspace(db, user, workspace_id)
    workspace = db.get(m.Workspace, workspace_id)
    users = workspace_users(db, workspace_id)
    output = {
        key: [record_json(db, workspace_id, row, users) for row in list_rows(db, model, workspace_id)]
        for key, model in BOOTSTRAP_MODELS.items()
    }
    scores = domain.asset_scores(db, workspace_id)
    assets = {a.id: a for a in list_rows(db, m.Asset, workspace_id)}
    for row in output["assets"]:
        row["risk_score"] = scores[row["id"]]
    for row in output["findings"]:
        row["risk"] = domain.risk_for_finding(
            scoped(db, m.Finding, workspace_id, row["id"]),
            assets[row["asset_id"]],
            workspace.settings,
        )
    output["recommendations"] = domain.rank_recommendations(db, workspace_id)
    for recommendation in output["recommendations"]:
        decision = recommendation.get("latest_decision")
        if decision:
            account = users.get(decision["user_id"])
            decision.update({"actor": account, "reviewer_name": account["name"] if account else None})
    output["workspace"] = {**m.serialize(workspace), "role": membership.role}
    output["settings"] = workspace.settings
    output["members"] = [
        record_json(db, workspace_id, member, users)
        for member in list_rows(db, m.Membership, workspace_id)
    ]
    output["roles"] = [m.serialize(role) for role in db.scalars(select(m.Role))]
    output["overview"] = {
        "assets": len(output["assets"]),
        "open_findings": sum(f["status"] != "Resolved" for f in output["findings"]),
        "risk_score": round(sum(scores.values()) / max(len(scores), 1)),
        "pending_approvals": sum(r["latest_decision"] is None for r in output["recommendations"]),
    }
    output["limits"] = {
        "records_per_collection": 1000,
        "paths": 20,
        "path_hops": 6,
        "provenance": "Seeded infrastructure. Dataset and training records reflect actual local jobs.",
    }
    return output


@app.get("/api/workspaces/{workspace_id}/records/{kind}")
def paginated_records(
    workspace_id: str,
    kind: str,
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0, le=1000000),
    q: str = Query(default="", max_length=200),
    sort: str = Query(default="created_at", max_length=40),
    order: str = Query(default="desc", pattern="^(asc|desc)$"),
    status: str | None = Query(default=None, max_length=40),
    severity: str | None = Query(default=None, max_length=20),
    asset_type: str | None = Query(default=None, max_length=30),
    exposure: str | None = Query(default=None, max_length=30),
    user: m.User = Depends(current_user),
    db: DBSession = Depends(get_db),
):
    require_workspace(db, user, workspace_id)
    model = {**BOOTSTRAP_MODELS, "recommendations": m.Recommendation, "members": m.Membership}.get(kind)
    if model is None:
        raise HTTPException(404, "Unknown record collection.")
    allowed_sort = {
        "created_at",
        "updated_at",
        "name",
        "title",
        "status",
        "severity",
        "criticality",
        "base_score",
        "progress",
    }
    if sort not in allowed_sort or not hasattr(model, sort):
        raise HTTPException(422, "Unsupported sort column for this collection.")
    stmt = select(model).where(model.workspace_id == workspace_id)
    if q.strip():
        escaped = q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        fields = [
            getattr(model, key)
            for key in ["name", "title", "address", "owner", "services", "detail", "action"]
            if hasattr(model, key)
        ]
        if not fields:
            raise HTTPException(422, "Text search is unavailable for this collection.")
        stmt = stmt.where(
            or_(*[cast(field, String).ilike(f"%{escaped}%", escape="\\") for field in fields])
        )
    for key, value in [
        ("status", status),
        ("severity", severity),
        ("asset_type", asset_type),
        ("exposure", exposure),
    ]:
        if value:
            if not hasattr(model, key):
                raise HTTPException(422, f"{key} filtering is unavailable for this collection.")
            stmt = stmt.where(getattr(model, key) == value)
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    sort_column = getattr(model, sort)
    stmt = (
        stmt.order_by(sort_column.asc() if order == "asc" else sort_column.desc(), model.id.asc())
        .offset(offset)
        .limit(limit)
    )
    records = list(db.scalars(stmt))
    users = workspace_users(db, workspace_id) if hasattr(model, "user_id") else None
    items = [record_json(db, workspace_id, row, users) for row in records]
    if kind == "assets" and records:
        assets_by_id = {row.id: row for row in records}
        scores = {asset_id: 0 for asset_id in assets_by_id}
        configuration = db.get(m.Workspace, workspace_id).settings
        factors = db.execute(
            select(m.Finding.asset_id, m.Finding.base_score, m.Finding.status).where(
                m.Finding.workspace_id == workspace_id, m.Finding.asset_id.in_(assets_by_id)
            )
        )
        for finding in factors:
            scores[finding.asset_id] = max(
                scores[finding.asset_id],
                domain.risk_for_finding(finding, assets_by_id[finding.asset_id], configuration)[
                    "score"
                ],
            )
        for row in items:
            row["risk_score"] = scores[row["id"]]
    return {
        "items": items,
        "total": total,
        "offset": offset,
        "limit": limit,
        "sort": sort,
        "order": order,
    }


@app.post("/api/workspaces/{workspace_id}/assets", status_code=201, dependencies=[Depends(ensure_csrf)])
def create_asset(
    workspace_id: str,
    body: s.AssetCreate,
    user: m.User = Depends(current_user),
    db: DBSession = Depends(get_db),
):
    require_workspace(db, user, workspace_id, WRITE)
    count = db.scalar(
        select(func.count()).select_from(m.Asset).where(m.Asset.workspace_id == workspace_id)
    )
    asset = m.Asset(
        workspace_id=workspace_id,
        **{**body.model_dump(), "address": body.address or ""},
        status="Monitored",
        provenance="manual",
        x=12 + ((count * 23) % 73),
        y=14 + ((count * 29) % 72),
    )
    db.add(asset)
    db.flush()
    audit(
        db,
        workspace_id,
        user.id,
        "Manual asset created",
        f"{asset.name}: analyst-entered inventory metadata. No scan, probe, DNS lookup, or validation was performed; no findings or relationships were inferred.",
        "asset",
        asset.id,
    )
    db.commit()
    return {**m.serialize(asset), "risk_score": 0}


@app.patch("/api/workspaces/{workspace_id}/assets/{record_id}", dependencies=[Depends(ensure_csrf)])
def update_asset(
    workspace_id: str,
    record_id: str,
    body: s.AssetPatch,
    user: m.User = Depends(current_user),
    db: DBSession = Depends(get_db),
):
    require_workspace(db, user, workspace_id, MANAGE)
    asset = scoped(db, m.Asset, workspace_id, record_id)
    for key, value in body.model_dump(exclude_unset=True).items():
        if value is None:
            raise HTTPException(422, "Asset fields cannot be null.")
        if isinstance(value, str) and key != "notes" and not value.strip():
            raise HTTPException(422, "Asset fields cannot be blank.")
        setattr(asset, key, value.strip() if isinstance(value, str) else value)
    audit(
        db,
        workspace_id,
        user.id,
        "Asset updated",
        f"{asset.name}: metadata updated only.",
        "asset",
        asset.id,
    )
    db.commit()
    return {**m.serialize(asset), "risk_score": domain.asset_scores(db, workspace_id)[asset.id]}


@app.patch(
    "/api/workspaces/{workspace_id}/findings/{record_id}", dependencies=[Depends(ensure_csrf)]
)
def update_finding(
    workspace_id: str,
    record_id: str,
    body: s.FindingPatch,
    user: m.User = Depends(current_user),
    db: DBSession = Depends(get_db),
):
    require_workspace(db, user, workspace_id, WRITE)
    finding = scoped(db, m.Finding, workspace_id, record_id)
    finding.status = body.status
    audit(
        db,
        workspace_id,
        user.id,
        "Finding status updated",
        f"{finding.title}: {body.status}. Record update; no infrastructure remediation.",
        "finding",
        finding.id,
    )
    db.commit()
    return m.serialize(finding)


@app.patch("/api/workspaces/{workspace_id}/events/{record_id}", dependencies=[Depends(ensure_csrf)])
def update_event(
    workspace_id: str,
    record_id: str,
    body: s.EventPatch,
    user: m.User = Depends(current_user),
    db: DBSession = Depends(get_db),
):
    require_workspace(db, user, workspace_id, WRITE)
    event = scoped(db, m.SecurityEvent, workspace_id, record_id)
    event.status = body.status
    audit(
        db,
        workspace_id,
        user.id,
        "Event review updated",
        f"{event.title}: {body.status}.",
        "event",
        event.id,
    )
    db.commit()
    return m.serialize(event)


@app.post(
    "/api/workspaces/{workspace_id}/discovery", status_code=201, dependencies=[Depends(ensure_csrf)]
)
def discovery(
    workspace_id: str, user: m.User = Depends(current_user), db: DBSession = Depends(get_db)
):
    require_workspace(db, user, workspace_id, MANAGE)
    workspace = db.get(m.Workspace, workspace_id)
    seed_workspace(db, workspace, user.id)
    assets = list_rows(db, m.Asset, workspace_id)
    for asset in assets:
        asset.last_seen = m.now()
    run = m.DiscoveryRun(workspace_id=workspace_id, user_id=user.id, asset_count=len(assets))
    db.add(run)
    db.flush()
    audit(
        db,
        workspace_id,
        user.id,
        "Seeded inventory refreshed",
        "Only sample record timestamps updated. No scan, DNS lookup, or network traffic.",
        "discovery_run",
        run.id,
    )
    db.commit()
    return m.serialize(run)


@app.post("/api/workspaces/{workspace_id}/paths", dependencies=[Depends(ensure_csrf)])
def paths(
    workspace_id: str,
    body: s.PathRequest,
    user: m.User = Depends(current_user),
    db: DBSession = Depends(get_db),
):
    require_workspace(db, user, workspace_id, WRITE)
    if body.start_asset_id == body.target_asset_id:
        raise HTTPException(422, "Choose two different assets.")
    scoped(db, m.Asset, workspace_id, body.start_asset_id)
    scoped(db, m.Asset, workspace_id, body.target_asset_id)
    rows = []
    for result in domain.calculate_paths(
        db, workspace_id, body.start_asset_id, body.target_asset_id
    ):
        path = m.AttackPath(
            workspace_id=workspace_id,
            start_asset_id=body.start_asset_id,
            target_asset_id=body.target_asset_id,
            **result,
        )
        db.add(path)
        db.flush()
        rows.append(path)
    audit(
        db,
        workspace_id,
        user.id,
        "Attack paths modeled",
        f"{len(rows)} potential routes within the stored graph. No attack was executed.",
    )
    db.commit()
    return [m.serialize(row) for row in rows]


@app.post(
    "/api/workspaces/{workspace_id}/scenarios", status_code=201, dependencies=[Depends(ensure_csrf)]
)
def create_scenario(
    workspace_id: str,
    body: s.ScenarioCreate,
    user: m.User = Depends(current_user),
    db: DBSession = Depends(get_db),
):
    require_workspace(db, user, workspace_id, WRITE)
    scoped(db, m.Asset, workspace_id, body.start_asset_id)
    scoped(db, m.Asset, workspace_id, body.target_asset_id)
    if body.start_asset_id == body.target_asset_id:
        raise HTTPException(422, "Choose two different assets.")
    scenario = m.Scenario(workspace_id=workspace_id, **body.model_dump())
    db.add(scenario)
    db.flush()
    audit(
        db,
        workspace_id,
        user.id,
        "Scenario created",
        "Stored a user-authored Digital Twin scenario.",
        "scenario",
        scenario.id,
    )
    db.commit()
    return m.serialize(scenario)


@app.post(
    "/api/workspaces/{workspace_id}/simulations",
    status_code=201,
    dependencies=[Depends(ensure_csrf)],
)
def simulation(
    workspace_id: str,
    body: s.SimulationCreate,
    user: m.User = Depends(current_user),
    db: DBSession = Depends(get_db),
):
    require_workspace(db, user, workspace_id, WRITE)
    scenario = scoped(db, m.Scenario, workspace_id, body.scenario_id)
    result = domain.simulate(db, workspace_id, scenario)
    audit(
        db,
        workspace_id,
        user.id,
        "Simulation completed",
        f"{scenario.name}: {result.outcome}. Digital Twin only.",
        "simulation",
        result.id,
    )
    db.commit()
    return {
        **m.serialize(result),
        "steps": [
            m.serialize(step)
            for step in db.scalars(
                select(m.SimulationStep)
                .where(m.SimulationStep.simulation_id == result.id)
                .order_by(m.SimulationStep.ordinal)
            )
        ],
    }


@app.post(
    "/api/workspaces/{workspace_id}/recommendations/{record_id}/decisions",
    status_code=201,
    dependencies=[Depends(ensure_csrf)],
)
def decision(
    workspace_id: str,
    record_id: str,
    body: s.DecisionCreate,
    user: m.User = Depends(current_user),
    db: DBSession = Depends(get_db),
):
    require_workspace(db, user, workspace_id, WRITE)
    recommendation = scoped(db, m.Recommendation, workspace_id, record_id)
    linked = next(
        (
            run
            for run in list_rows(db, m.Simulation, workspace_id)
            if recommendation.asset_id in run.path_asset_ids
        ),
        None,
    )
    approval = m.ApprovalRequest(
        workspace_id=workspace_id,
        user_id=user.id,
        recommendation_id=record_id,
        decision=body.decision,
        notes=body.notes,
        simulation_id=linked.id if linked else None,
    )
    db.add(approval)
    db.flush()
    audit(
        db,
        workspace_id,
        user.id,
        f"Recommendation {body.decision.lower()}",
        f"{recommendation.title}. Notes: {body.notes}. Record only; no infrastructure action.",
        "approval",
        approval.id,
    )
    db.add(
        m.Notification(
            workspace_id=workspace_id,
            title=f"Recommendation {body.decision.lower()}",
            detail=recommendation.title,
            record_type="approval",
            record_id=approval.id,
        )
    )
    db.commit()
    return record_json(db, workspace_id, approval)


@app.post(
    "/api/workspaces/{workspace_id}/snapshots", status_code=201, dependencies=[Depends(ensure_csrf)]
)
def snapshot(
    workspace_id: str,
    body: s.NamedRequest,
    user: m.User = Depends(current_user),
    db: DBSession = Depends(get_db),
):
    require_workspace(db, user, workspace_id, WRITE)
    row = m.DigitalTwinSnapshot(
        workspace_id=workspace_id,
        name=body.name,
        graph={
            "assets": [m.serialize(a) for a in list_rows(db, m.Asset, workspace_id)],
            "relationships": [
                m.serialize(r) for r in list_rows(db, m.AssetRelationship, workspace_id)
            ],
        },
    )
    db.add(row)
    db.flush()
    audit(db, workspace_id, user.id, "Digital Twin snapshot created", body.name, "snapshot", row.id)
    db.commit()
    return m.serialize(row)


@app.patch(
    "/api/workspaces/{workspace_id}/notifications/{record_id}", dependencies=[Depends(ensure_csrf)]
)
def notification_read(
    workspace_id: str,
    record_id: str,
    user: m.User = Depends(current_user),
    db: DBSession = Depends(get_db),
):
    require_workspace(db, user, workspace_id)
    row = scoped(db, m.Notification, workspace_id, record_id)
    row.read = True
    db.commit()
    return m.serialize(row)


@app.post(
    "/api/workspaces/{workspace_id}/members", status_code=201, dependencies=[Depends(ensure_csrf)]
)
def add_member(
    workspace_id: str,
    body: s.MemberCreate,
    user: m.User = Depends(current_user),
    db: DBSession = Depends(get_db),
):
    actor = require_workspace(db, user, workspace_id, MANAGE)
    if body.role == "Owner" and actor.role != "Owner":
        raise HTTPException(403, "Only an Owner can grant Owner access.")
    email = body.email.strip().lower()
    if "@" not in email:
        raise HTTPException(422, "Enter a valid email address.")
    member_user = db.scalar(select(m.User).where(m.User.email == email))
    if member_user:
        raise HTTPException(
            409,
            "This email already belongs to a local account. Use an explicit membership flow; credentials cannot be overwritten.",
        )
    member_user = m.User(email=email, name=body.name, password_hash=hash_password(body.password))
    db.add(member_user)
    db.flush()
    membership = m.Membership(workspace_id=workspace_id, user_id=member_user.id, role=body.role)
    db.add(membership)
    db.flush()
    audit(
        db,
        workspace_id,
        user.id,
        "Local member created",
        f"{email}: {body.role}. No email invitation was sent.",
        "membership",
        membership.id,
    )
    db.commit()
    return record_json(db, workspace_id, membership)


@app.patch(
    "/api/workspaces/{workspace_id}/members/{record_id}", dependencies=[Depends(ensure_csrf)]
)
def update_member(
    workspace_id: str,
    record_id: str,
    body: s.RolePatch,
    user: m.User = Depends(current_user),
    db: DBSession = Depends(get_db),
):
    actor = require_workspace(db, user, workspace_id, MANAGE)
    member = scoped(db, m.Membership, workspace_id, record_id)
    if actor.role != "Owner" and (member.role == "Owner" or body.role == "Owner"):
        raise HTTPException(403, "Only an Owner can manage Owner roles.")
    if (
        member.role == "Owner"
        and body.role != "Owner"
        and db.scalar(
            select(func.count())
            .select_from(m.Membership)
            .where(m.Membership.workspace_id == workspace_id, m.Membership.role == "Owner")
        )
        <= 1
    ):
        raise HTTPException(409, "The workspace must retain an Owner.")
    member.role = body.role
    audit(
        db,
        workspace_id,
        user.id,
        "Member role updated",
        f"Role changed to {body.role}.",
        "membership",
        member.id,
    )
    db.commit()
    return record_json(db, workspace_id, member)


@app.post(
    "/api/workspaces/{workspace_id}/members/existing",
    status_code=201,
    dependencies=[Depends(ensure_csrf)],
)
def link_existing_member(
    workspace_id: str,
    body: s.ExistingMember,
    user: m.User = Depends(current_user),
    db: DBSession = Depends(get_db),
):
    actor = require_workspace(db, user, workspace_id, MANAGE)
    if body.role == "Owner" and actor.role != "Owner":
        raise HTTPException(403, "Only an Owner can grant Owner access.")
    account = db.scalar(
        select(m.User).where(m.User.email == body.email.strip().lower(), m.User.is_active.is_(True))
    )
    if not account:
        raise HTTPException(404, "Active local account not found. Create a local account first.")
    if db.scalar(
        select(m.Membership).where(
            m.Membership.workspace_id == workspace_id, m.Membership.user_id == account.id
        )
    ):
        raise HTTPException(409, "This account is already a member of the workspace.")
    member = m.Membership(workspace_id=workspace_id, user_id=account.id, role=body.role)
    db.add(member)
    db.flush()
    audit(
        db,
        workspace_id,
        user.id,
        "Existing local account linked",
        f"{account.email}: {body.role}. Existing credentials were not changed. No invitation was sent.",
        "membership",
        member.id,
    )
    db.commit()
    return record_json(db, workspace_id, member)


@app.post(
    "/api/workspaces/{workspace_id}/agents/{record_id}/run",
    status_code=201,
    dependencies=[Depends(ensure_csrf)],
)
def run_workflow(
    workspace_id: str,
    record_id: str,
    user: m.User = Depends(current_user),
    db: DBSession = Depends(get_db),
):
    require_workspace(db, user, workspace_id, WRITE)
    workflow = scoped(db, m.AgentWorkflow, workspace_id, record_id)
    if workflow.kind != "deterministic" or workflow.status != "available":
        raise HTTPException(409, "This agent is planned or unavailable; no execution occurred.")
    scores = domain.asset_scores(db, workspace_id)
    execution = m.AgentExecution(
        workspace_id=workspace_id,
        user_id=user.id,
        workflow_id=record_id,
        status="succeeded",
        steps=[
            {"step": "Read authorized workspace records", "status": "completed"},
            {
                "step": f"Calculated rule scores for {len(scores)} stored assets",
                "status": "completed",
            },
            {
                "step": "Recorded deterministic workflow; no LLM or external action",
                "status": "completed",
            },
        ],
        finished_at=m.now(),
    )
    db.add(execution)
    db.flush()
    audit(
        db,
        workspace_id,
        user.id,
        "Deterministic workflow completed",
        workflow.name,
        "agent_execution",
        execution.id,
    )
    db.commit()
    return m.serialize(execution)


# Explicit module routes precede generic record detail routes (for example,
# datasets/available-files must not be interpreted as a dataset identifier).
from . import datasets, assistant, integrations

app.include_router(datasets.router)
app.include_router(assistant.router)
app.include_router(integrations.router)


# Uniform read-only list/detail routes share the exact same scoped records as bootstrap.
def register_read_routes(kind, model):
    def collection(
        workspace_id: str, user: m.User = Depends(current_user), db: DBSession = Depends(get_db)
    ):
        require_workspace(db, user, workspace_id)
        users = workspace_users(db, workspace_id) if hasattr(model, "user_id") else None
        return [record_json(db, workspace_id, row, users) for row in list_rows(db, model, workspace_id)]

    def detail(
        workspace_id: str,
        record_id: str,
        user: m.User = Depends(current_user),
        db: DBSession = Depends(get_db),
    ):
        require_workspace(db, user, workspace_id)
        return record_json(db, workspace_id, scoped(db, model, workspace_id, record_id))

    app.add_api_route(
        f"/api/workspaces/{{workspace_id}}/{kind}", collection, methods=["GET"], name=f"list_{kind}"
    )
    app.add_api_route(
        f"/api/workspaces/{{workspace_id}}/{kind}/{{record_id}}",
        detail,
        methods=["GET"],
        name=f"detail_{kind}",
    )


for kind, model in {**BOOTSTRAP_MODELS, "recommendations": m.Recommendation, "members": m.Membership}.items():
    register_read_routes(kind, model)

from .registration import router as registration_router

app.include_router(registration_router)
