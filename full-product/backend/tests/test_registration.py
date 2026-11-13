import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.db import Base, get_db
from app.main import app
from app.config import settings
from app import models as m

PASSWORD = "Only-A-Synthetic-Test-Password-2026"


@pytest.fixture
def registration_environment(monkeypatch):
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )

    @event.listens_for(engine, "connect")
    def enable_fks(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    factory = sessionmaker(engine, expire_on_commit=False)

    def database():
        with factory() as db:
            yield db

    app.dependency_overrides[get_db] = database
    monkeypatch.setattr(settings, "setup_token", "test-only-private-setup-token-long-enough")
    monkeypatch.setattr("app.main.enforce_rate_limit", lambda *args, **kwargs: None)
    monkeypatch.setattr("app.registration.enforce_rate_limit", lambda *args, **kwargs: None)
    monkeypatch.setenv("ALLOW_SELF_REGISTRATION", "true")
    with TestClient(app) as client:
        yield client, factory
    app.dependency_overrides.clear()
    engine.dispose()


def payload(email="new@example.invalid"):
    return {
        "email": email,
        "password": PASSWORD,
        "name": "New analyst",
        "workspace_name": "New private workspace",
        "scope": "Synthetic documentation infrastructure only; no network operations.",
    }


def initialize(client):
    result = client.post(
        "/api/auth/setup",
        headers={"X-Setup-Token": "test-only-private-setup-token-long-enough"},
        json=payload("owner@example.invalid"),
    )
    assert result.status_code == 201
    return result.json()["workspaces"][0]["id"]


def test_registration_never_bypasses_first_owner_setup(registration_environment):
    client, _ = registration_environment
    assert client.get("/api/auth/registration-status").json()["setup_required"] is True
    assert client.post("/api/auth/register", json=payload()).status_code == 409


def test_registration_creates_only_a_new_private_workspace(registration_environment):
    client, factory = registration_environment
    original = initialize(client)
    result = client.post("/api/auth/register", json=payload("NEW@example.invalid"))
    assert result.status_code == 201, result.text
    account = result.json()
    assert account["user"]["email"] == "new@example.invalid"
    assert len(account["workspaces"]) == 1 and account["workspaces"][0]["id"] != original
    assert account["workspaces"][0]["role"] == "Owner"
    assert client.get(f"/api/workspaces/{original}/bootstrap").status_code == 404
    assert (
        client.get(f"/api/workspaces/{account['workspaces'][0]['id']}/bootstrap").status_code == 200
    )
    with factory() as db:
        user = db.scalar(select(m.User).where(m.User.email == "new@example.invalid"))
        assert user.password_hash.startswith("$argon2") and user.password_hash != PASSWORD
    assert client.post("/api/auth/register", json=payload()).status_code == 409


def test_registration_can_be_disabled_and_rejects_bad_origins(
    registration_environment, monkeypatch
):
    client, _ = registration_environment
    initialize(client)
    assert (
        client.post(
            "/api/auth/register", json=payload(), headers={"Origin": "https://unrelated.example"}
        ).status_code
        == 403
    )
    monkeypatch.setenv("ALLOW_SELF_REGISTRATION", "false")
    assert client.get("/api/auth/registration-status").json()["enabled"] is False
    assert client.post("/api/auth/register", json=payload()).status_code == 403


def test_registration_rejects_blank_names_and_weak_passwords(registration_environment):
    client, _ = registration_environment
    initialize(client)
    bad = payload()
    bad["name"] = "  "
    response = client.post("/api/auth/register", json=bad)
    assert response.status_code == 422 and "input" not in response.text
    bad = payload()
    bad["password"] = "short"
    response = client.post("/api/auth/register", json=bad)
    assert response.status_code == 422 and "short" not in response.text
