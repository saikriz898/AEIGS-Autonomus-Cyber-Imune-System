import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from argon2 import PasswordHasher
from argon2.exceptions import VerificationError, InvalidHashError
from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session as DBSession
from .db import get_db
from .models import User, Session, Membership, AuditLog
from .config import settings

hasher = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=2)
DUMMY_HASH = hasher.hash("unusable-random-" + secrets.token_urlsafe(24))


def hash_password(password):
    return hasher.hash(password)


def verify_password(stored, password):
    try:
        return hasher.verify(stored, password)
    except (VerificationError, InvalidHashError):
        return False


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def enforce_rate_limit(
    request: Request, bucket: str, limit: int = 30, window: int = 60, user_id: str | None = None
):
    """Redis-backed limits shared across API processes; never logs user input."""
    import redis

    subject = user_id or (request.client.host if request.client else "local")
    key = "aegis:limit:" + bucket + ":" + token_hash(subject)
    try:
        client = redis.Redis.from_url(
            settings.redis_url, socket_connect_timeout=2, socket_timeout=2
        )
        count = client.eval(
            "local count=redis.call('INCR',KEYS[1]); if count==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]); end; return count",
            1,
            key,
            window,
        )
    except redis.RedisError:
        raise HTTPException(
            503, "The request limiter is unavailable. Restore Redis before retrying this operation."
        )
    if count > limit:
        raise HTTPException(
            429, "Request limit reached. Try again shortly.", headers={"Retry-After": str(window)}
        )


def session_for(request: Request, db: DBSession):
    token = request.cookies.get("aegis_session")
    session = (
        db.scalar(select(Session).where(Session.token_hash == token_hash(token))) if token else None
    )
    if session:
        expires = session.expires_at
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires <= datetime.now(timezone.utc):
            session = None
    if not session:
        raise HTTPException(401, "Sign in to continue.")
    return session


def current_user(request: Request, db: DBSession = Depends(get_db)):
    session = session_for(request, db)
    user = db.get(User, session.user_id)
    if not user or not user.is_active:
        raise HTTPException(401, "Account unavailable.")
    request.state.session = session
    return user


def ensure_csrf(request: Request, db: DBSession = Depends(get_db)):
    session = session_for(request, db)
    supplied = request.headers.get("X-CSRF-Token", "")
    if not supplied or not secrets.compare_digest(supplied, session.csrf_token):
        raise HTTPException(403, "Missing or invalid CSRF token.")
    origin = request.headers.get("origin")
    if origin and origin.rstrip("/") != settings.frontend_origin.rstrip("/"):
        raise HTTPException(403, "Origin is not allowed.")
    return session


require_csrf = ensure_csrf


def require_workspace(db, user, workspace_id, roles=None):
    membership = db.scalar(
        select(Membership).where(
            Membership.workspace_id == workspace_id, Membership.user_id == user.id
        )
    )
    if not membership:
        raise HTTPException(404, "Workspace not found.")
    if roles and membership.role not in roles:
        raise HTTPException(403, "Your workspace role cannot perform this action.")
    return membership


def audit(db, workspace_id, user_id, action, detail, record_type=None, record_id=None):
    entry = AuditLog(
        workspace_id=workspace_id,
        user_id=user_id,
        action=action,
        detail=detail,
        record_type=record_type,
        record_id=record_id,
    )
    db.add(entry)
    return entry


def new_session(db, user, response):
    token = secrets.token_urlsafe(40)
    session = Session(
        user_id=user.id,
        token_hash=token_hash(token),
        csrf_token=secrets.token_urlsafe(32),
        expires_at=datetime.now(timezone.utc) + timedelta(hours=settings.session_ttl_hours),
    )
    db.add(session)
    response.set_cookie(
        "aegis_session",
        token,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        max_age=settings.session_ttl_hours * 3600,
        path="/",
    )
    return session
