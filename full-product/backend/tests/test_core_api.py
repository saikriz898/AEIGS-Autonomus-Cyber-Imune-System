import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from app.db import Base, get_db
from app import models as m
from app.main import app
from app.config import settings
from app.security import hash_password

PASSWORD = "Local-Only-Test-Password-2026"
SETUP = "test-setup-token-long-enough-for-bootstrap-only"


@pytest.fixture
def environment(monkeypatch):
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )

    @event.listens_for(engine, "connect")
    def foreign_keys(connection, record):
        connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    factory = sessionmaker(engine, expire_on_commit=False)

    def db_override():
        with factory() as db:
            yield db

    app.dependency_overrides[get_db] = db_override
    monkeypatch.setattr(settings, "setup_token", SETUP)
    monkeypatch.setattr(settings, "frontend_origin", "http://localhost:3000")
    monkeypatch.setattr("app.main.enforce_rate_limit", lambda *a, **kw: None)
    with TestClient(app) as client:
        yield client, factory
    app.dependency_overrides.clear()
    engine.dispose()


def setup(client):
    response = client.post(
        "/api/auth/setup",
        headers={"X-Setup-Token": SETUP},
        json={
            "email": "owner@example.invalid",
            "password": PASSWORD,
            "name": "Local owner",
            "workspace_name": "Authorized demo",
            "scope": "Synthetic documentation assets only; no scanning or external operations.",
        },
    )
    assert response.status_code == 201, response.text
    auth = response.json()
    return auth, {"X-CSRF-Token": auth["csrf_token"]}


def test_paginated_asset_filters_and_risk_follow_persisted_edits(environment):
    client, _ = environment
    account, csrf = setup(client)
    wid = account["workspaces"][0]["id"]
    result = client.get(
        f"/api/workspaces/{wid}/records/assets",
        params={
            "asset_type": "Server",
            "exposure": "Internet",
            "limit": 1,
            "sort": "name",
            "order": "asc",
        },
    )
    assert result.status_code == 200, result.text
    page = result.json()
    assert len(page["items"]) == 1 and page["total"] >= 1
    asset = page["items"][0]
    assert asset["asset_type"] == "Server" and asset["exposure"] == "Internet"
    assert isinstance(asset["risk_score"], (int, float))
    saved = client.patch(
        f"/api/workspaces/{wid}/assets/{asset['id']}",
        headers=csrf,
        json={"owner": "Paged review team", "exposure": "Isolated"},
    )
    assert saved.status_code == 200
    searched = client.get(
        f"/api/workspaces/{wid}/records/assets",
        params={"q": "Paged review team", "exposure": "Isolated", "sort": "name"},
    ).json()
    assert searched["total"] == 1 and searched["items"][0]["id"] == asset["id"]
    assert searched["items"][0]["risk_score"] == saved.json()["risk_score"]


def test_first_owner_requires_explicit_token_and_never_ships_shared_password(environment):
    client, factory = environment
    assert client.get("/api/auth/status").json()["setup_required"] is True
    body = {
        "email": "owner@example.invalid",
        "password": PASSWORD,
        "name": "Local owner",
        "workspace_name": "Authorized demo",
        "scope": "Synthetic documentation assets only.",
    }
    assert client.post("/api/auth/setup", json=body).status_code == 403
    auth, headers = setup(client)
    assert client.get("/api/auth/status").json()["authenticated"] is True
    cookie = client.cookies.get("aegis_session")
    assert cookie
    with factory() as db:
        user = db.get(m.User, auth["user"]["id"])
        assert user.password_hash.startswith("$argon2id$")
        assert PASSWORD not in user.password_hash
        session = db.scalar(select(m.Session))
        assert session.token_hash != cookie
        assert len(session.token_hash) == 64
    assert (
        client.post("/api/auth/setup", headers={"X-Setup-Token": SETUP}, json=body).status_code
        == 409
    )


def test_login_origin_csrf_and_session_revocation(environment):
    client, _ = environment
    auth, headers = setup(client)
    wid = auth["workspaces"][0]["id"]
    assert (
        client.post(
            "/api/auth/login",
            headers={"Origin": "https://untrusted.invalid"},
            json={"email": "owner@example.invalid", "password": PASSWORD},
        ).status_code
        == 403
    )
    assert client.post(f"/api/workspaces/{wid}/discovery").status_code == 403
    assert (
        client.post(
            f"/api/workspaces/{wid}/discovery",
            headers={**headers, "Origin": "https://untrusted.invalid"},
        ).status_code
        == 403
    )
    assert client.post("/api/auth/logout", headers=headers).status_code == 200
    assert client.get(f"/api/workspaces/{wid}/bootstrap").status_code == 401
    assert (
        client.post(
            "/api/auth/login", json={"email": "owner@example.invalid", "password": "wrong password"}
        ).status_code
        == 401
    )
    response = client.post(
        "/api/auth/login", json={"email": "owner@example.invalid", "password": PASSWORD}
    )
    assert response.status_code == 200
    assert response.json()["csrf_token"] != auth["csrf_token"]


def test_validation_never_echoes_secrets(environment):
    client, _ = environment
    secret = "this-must-not-appear-in-errors"
    response = client.post(
        "/api/auth/login",
        json={
            "email": "valid@example.invalid",
            "password": secret,
            "unexpected": "do-not-echo-this",
        },
    )
    assert response.status_code == 422
    assert secret not in response.text and "do-not-echo-this" not in response.text
    response = client.post(
        "/api/auth/setup",
        headers={"X-Setup-Token": SETUP},
        json={
            "email": "owner@example.invalid",
            "password": "short",
            "name": "  ",
            "workspace_name": "Demo",
            "scope": "Synthetic scope.",
        },
    )
    assert response.status_code == 422
    assert all("input" not in row and "ctx" not in row for row in response.json()["detail"])


def test_connected_workflow_and_transparent_edit_propagation(environment):
    client, _ = environment
    auth, headers = setup(client)
    wid = auth["workspaces"][0]["id"]
    prefix = f"/api/workspaces/{wid}"
    initial = client.get(prefix + "/bootstrap").json()
    assert len(initial["assets"]) == 12 and len(initial["relationships"]) == 12
    web = next(asset for asset in initial["assets"] if asset["name"] == "web-prod-01")
    assert web["risk_score"] == 94
    changed = client.patch(
        prefix + "/assets/" + web["id"],
        headers=headers,
        json={"owner": "Local review team", "criticality": "Low", "exposure": "Isolated"},
    )
    assert changed.status_code == 200
    assert changed.json()["risk_score"] == 69
    state = client.get(prefix + "/bootstrap").json()
    finding = next(f for f in state["findings"] if f["asset_id"] == web["id"])
    assert finding["risk"]["score"] == 69
    assert (
        client.patch(
            prefix + "/findings/" + finding["id"], headers=headers, json={"status": "Resolved"}
        ).status_code
        == 200
    )
    assert (
        next(a for a in client.get(prefix + "/bootstrap").json()["assets"] if a["id"] == web["id"])[
            "risk_score"
        ]
        == 0
    )
    scenario = next(s for s in state["scenarios"] if s["name"] == "Perimeter to customer data")
    paths = client.post(
        prefix + "/paths",
        headers=headers,
        json={
            "start_asset_id": scenario["start_asset_id"],
            "target_asset_id": scenario["target_asset_id"],
        },
    ).json()
    assert len(paths) == 1 and len(paths[0]["asset_ids"]) == 5
    run = client.post(
        prefix + "/simulations", headers=headers, json={"scenario_id": scenario["id"]}
    )
    assert run.status_code == 201
    simulation = run.json()
    assert simulation["outcome"] == "Potential exposure"
    assert len(simulation["steps"]) == 5
    recommendation = next(
        r for r in state["recommendations"] if r["asset_id"] in simulation["path_asset_ids"]
    )
    decision = client.post(
        prefix + f"/recommendations/{recommendation['id']}/decisions",
        headers=headers,
        json={
            "decision": "Approved",
            "notes": "Reviewed model assumptions and operational tradeoffs.",
        },
    )
    assert decision.status_code == 201
    assert decision.json()["simulation_id"] == simulation["id"]
    after = client.get(prefix + "/bootstrap").json()
    assert after["relationships"] == state["relationships"]
    assert after["overview"]["pending_approvals"] == 4
    assert any(row["action"] == "Recommendation approved" for row in after["audit"])
    assert any(
        row["latest_decision"] and row["latest_decision"]["decision"] == "Approved"
        for row in after["recommendations"]
    )


def test_workspace_scope_and_viewer_role_are_enforced_on_backend(environment):
    client, factory = environment
    auth, headers = setup(client)
    first = auth["workspaces"][0]["id"]
    prefix = f"/api/workspaces/{first}"
    second = client.post(
        "/api/workspaces",
        headers=headers,
        json={
            "name": "Other authorized workspace",
            "scope": "Synthetic separate tenant for isolation tests.",
            "seed_demo": True,
        },
    )
    assert second.status_code == 201
    second_id = second.json()["id"]
    foreign = client.get(f"/api/workspaces/{second_id}/bootstrap").json()["assets"][0]
    assert (
        client.patch(
            prefix + "/assets/" + foreign["id"], headers=headers, json={"owner": "Forbidden"}
        ).status_code
        == 404
    )
    member = client.post(
        prefix + "/members",
        headers=headers,
        json={
            "email": "viewer@example.invalid",
            "name": "Read only analyst",
            "password": PASSWORD + "-viewer",
            "role": "Viewer",
        },
    )
    assert member.status_code == 201
    client.post("/api/auth/logout", headers=headers)
    viewer = client.post(
        "/api/auth/login",
        json={"email": "viewer@example.invalid", "password": PASSWORD + "-viewer"},
    ).json()
    viewer_headers = {"X-CSRF-Token": viewer["csrf_token"]}
    assert client.get(prefix + "/bootstrap").status_code == 200
    assert client.get(f"/api/workspaces/{second_id}/bootstrap").status_code == 404
    asset = client.get(prefix + "/bootstrap").json()["assets"][0]
    assert (
        client.patch(
            prefix + "/assets/" + asset["id"], headers=viewer_headers, json={"owner": "Forbidden"}
        ).status_code
        == 403
    )
    assert client.post(prefix + "/discovery", headers=viewer_headers).status_code == 403
    assert (
        client.post(
            prefix + "/paths",
            headers=viewer_headers,
            json={"start_asset_id": asset["id"], "target_asset_id": foreign["id"]},
        ).status_code
        == 403
    )


def test_analyst_can_review_but_cannot_manage_assets_or_members(environment):
    client, _ = environment
    auth, headers = setup(client)
    wid = auth["workspaces"][0]["id"]
    prefix = f"/api/workspaces/{wid}"
    assert (
        client.post(
            prefix + "/members",
            headers=headers,
            json={
                "email": "analyst@example.invalid",
                "name": "Local analyst",
                "password": PASSWORD + "-analyst",
                "role": "Analyst",
            },
        ).status_code
        == 201
    )
    client.post("/api/auth/logout", headers=headers)
    analyst = client.post(
        "/api/auth/login",
        json={"email": "analyst@example.invalid", "password": PASSWORD + "-analyst"},
    ).json()
    headers = {"X-CSRF-Token": analyst["csrf_token"]}
    state = client.get(prefix + "/bootstrap").json()
    finding = state["findings"][0]
    asset = state["assets"][0]
    assert (
        client.patch(
            prefix + "/findings/" + finding["id"], headers=headers, json={"status": "Investigating"}
        ).status_code
        == 200
    )
    assert (
        client.patch(
            prefix + "/assets/" + asset["id"], headers=headers, json={"owner": "Forbidden"}
        ).status_code
        == 403
    )
    assert (
        client.post(
            prefix + "/members",
            headers=headers,
            json={
                "email": "another@example.invalid",
                "name": "Another viewer",
                "password": PASSWORD,
                "role": "Viewer",
            },
        ).status_code
        == 403
    )


def test_last_owner_and_settings_constraints(environment):
    client, _ = environment
    auth, headers = setup(client)
    wid = auth["workspaces"][0]["id"]
    prefix = f"/api/workspaces/{wid}"
    state = client.get(prefix + "/bootstrap").json()
    assert (
        client.patch(
            prefix + "/members/" + state["members"][0]["id"],
            headers=headers,
            json={"role": "Viewer"},
        ).status_code
        == 409
    )
    assert (
        client.patch(prefix, headers=headers, json={"settings": {"retention_days": 0}}).status_code
        == 422
    )
    rules = {
        "base_multiplier": 5,
        "exposure": {"Internet": 10, "Internal": 3, "Isolated": 0},
        "criticality": {"Critical": 10, "High": 5, "Medium": 3, "Low": 0},
    }
    assert (
        client.patch(prefix, headers=headers, json={"settings": {"risk_rules": rules}}).status_code
        == 200
    )
    after = client.get(prefix + "/bootstrap").json()
    assert after["overview"]["risk_score"] < state["overview"]["risk_score"]
    assert after["settings"]["risk_rules"] == rules


def test_pagination_search_filters_and_sort_are_scoped_and_bounded(environment):
    client, _ = environment
    auth, headers = setup(client)
    wid = auth["workspaces"][0]["id"]
    prefix = f"/api/workspaces/{wid}/records"
    response = client.get(
        prefix + "/assets", params={"limit": 3, "offset": 0, "sort": "name", "order": "asc"}
    )
    assert response.status_code == 200
    page = response.json()
    assert page["total"] == 12 and len(page["items"]) == 3
    assert [row["name"] for row in page["items"]] == sorted(row["name"] for row in page["items"])
    second = client.get(
        prefix + "/assets", params={"limit": 3, "offset": 3, "sort": "name", "order": "asc"}
    ).json()
    assert not {a["id"] for a in page["items"]} & {a["id"] for a in second["items"]}
    assert client.get(prefix + "/assets", params={"q": "web-prod"}).json()["total"] == 1
    assert client.get(prefix + "/assets", params={"q": "%"}).json()["total"] == 0
    assert client.get(prefix + "/assets", params={"limit": 1000}).status_code == 422
    assert client.get(prefix + "/assets", params={"sort": "password_hash"}).status_code == 422
    assert client.get(prefix + "/findings", params={"severity": "Critical"}).json()["total"] == 1


def test_graph_model_deterministic_snapshot_and_workflow_unavailability(environment):
    client, _ = environment
    auth, headers = setup(client)
    wid = auth["workspaces"][0]["id"]
    prefix = f"/api/workspaces/{wid}"
    state = client.get(prefix + "/bootstrap").json()
    scenario = state["scenarios"][0]
    runs = [
        client.post(
            prefix + "/simulations", headers=headers, json={"scenario_id": scenario["id"]}
        ).json()
        for _ in range(2)
    ]
    assert runs[0]["id"] != runs[1]["id"]
    assert runs[0]["path_asset_ids"] == runs[1]["path_asset_ids"]
    assert runs[0]["assumptions"] == runs[1]["assumptions"]
    assert runs[0]["risk_score"] == runs[1]["risk_score"]
    snap = client.post(
        prefix + "/snapshots", headers=headers, json={"name": "Before defensive review"}
    )
    assert snap.status_code == 201
    assert len(snap.json()["graph"]["assets"]) == 12
    planned = next(a for a in state["agent_workflows"] if a["kind"] == "planned")
    assert (
        client.post(prefix + "/agents/" + planned["id"] + "/run", headers=headers).status_code
        == 409
    )
    available = next(a for a in state["agent_workflows"] if a["kind"] == "deterministic")
    result = client.post(prefix + "/agents/" + available["id"] + "/run", headers=headers)
    assert result.status_code == 201
    assert result.json()["status"] == "succeeded"


def test_security_response_headers(environment):
    client, _ = environment
    response = client.get("/api/health")
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert "frame-ancestors 'none'" in response.headers["content-security-policy"]


def test_existing_account_membership_links_without_changing_credentials(environment):
    client, factory = environment
    auth, headers = setup(client)
    wid = auth["workspaces"][0]["id"]
    prefix = f"/api/workspaces/{wid}"
    with factory() as db:
        account = m.User(
            name="Existing local user",
            email="existing@example.invalid",
            password_hash="existing-credential-hash-must-not-change",
        )
        db.add(account)
        db.commit()
        account_id = account.id
    response = client.post(
        prefix + "/members/existing",
        headers=headers,
        json={"email": "existing@example.invalid", "role": "Viewer"},
    )
    assert response.status_code == 201 and response.json()["user_id"] == account_id
    with factory() as db:
        assert (
            db.get(m.User, account_id).password_hash == "existing-credential-hash-must-not-change"
        )
    assert (
        client.post(
            prefix + "/members/existing",
            headers=headers,
            json={"email": "existing@example.invalid", "role": "Viewer"},
        ).status_code
        == 409
    )
    assert (
        client.post(
            prefix + "/members/existing",
            headers=headers,
            json={"email": "missing@example.invalid", "role": "Viewer"},
        ).status_code
        == 404
    )


def test_placeholder_setup_token_is_never_accepted(environment, monkeypatch):
    client, _ = environment
    monkeypatch.setattr(settings, "setup_token", "CHANGE_ME_GENERATE_RANDOM_SETUP_TOKEN")
    response = client.post(
        "/api/auth/setup",
        headers={"X-Setup-Token": settings.setup_token},
        json={
            "email": "owner@example.invalid",
            "password": PASSWORD,
            "name": "Local owner",
            "workspace_name": "Authorized demo",
            "scope": "Synthetic scope for local demonstration.",
        },
    )
    assert response.status_code == 403


def test_member_identity_fields_are_consistent_and_workspace_scoped(environment):
    client, factory = environment
    auth, headers = setup(client)
    wid = auth["workspaces"][0]["id"]
    prefix = f"/api/workspaces/{wid}"
    created = client.post(
        prefix + "/members",
        headers=headers,
        json={"email": "visible@example.invalid", "name": "Visible member", "password": PASSWORD, "role": "Viewer"},
    )
    assert created.status_code == 201
    member = created.json()
    assert member["name"] == "Visible member" and member["email"] == "visible@example.invalid"
    assert member["user"]["name"] == member["name"]
    with factory() as db:
        outsider = m.User(name="Unrelated private person", email="private@example.invalid", password_hash="not-exposed")
        db.add(outsider)
        db.flush()
        db.add(m.AuditLog(workspace_id=wid, user_id=outsider.id, action="Historical actor test", detail="Identity must not be fetched outside workspace membership."))
        db.commit()
    state = client.get(prefix + "/bootstrap").json()
    assert {row["name"] for row in state["members"]} == {"Local owner", "Visible member"}
    assert all(row["email"] and row["name"] for row in state["members"])
    history = next(row for row in state["audit"] if row["action"] == "Historical actor test")
    assert history["actor"] is None and history["actor_name"] is None
    assert "Unrelated private person" not in str(state) and "private@example.invalid" not in str(state)
    assert "password_hash" not in str(state)
    listed = client.get(prefix + "/members").json()
    detailed = client.get(prefix + "/members/" + member["id"]).json()
    paged = client.get(prefix + "/records/members").json()
    assert any(row["email"] == member["email"] for row in listed)
    assert detailed["name"] == member["name"]
    assert any(row["name"] == member["name"] for row in paged["items"])


def test_approval_history_contains_authorized_reviewer_identity(environment):
    client, _ = environment
    auth, headers = setup(client)
    prefix = f'/api/workspaces/{auth["workspaces"][0]["id"]}'
    recommendation = client.get(prefix + "/bootstrap").json()["recommendations"][0]
    response = client.post(
        prefix + f'/recommendations/{recommendation["id"]}/decisions',
        headers=headers,
        json={"decision": "Approved", "notes": "Reviewed the illustrative planning assumptions."},
    )
    assert response.status_code == 201 and response.json()["reviewer_name"] == "Local owner"
    state = client.get(prefix + "/bootstrap").json()
    assert state["approvals"][0]["actor"]["email"] == "owner@example.invalid"
    assert state["approvals"][0]["reviewer_name"] == "Local owner"
    latest = next(row for row in state["recommendations"] if row["id"] == recommendation["id"])["latest_decision"]
    assert latest["reviewer_name"] == "Local owner"


def manual_asset_payload(**overrides):
    return {"name": "Locally entered server", "asset_type": "Server", "owner": "Infrastructure team", "criticality": "High", "exposure": "Internal", **overrides}


def test_manual_asset_persists_into_inventory_graph_snapshot_and_audit_without_scanning(environment):
    client, factory = environment
    auth, headers = setup(client)
    wid = auth["workspaces"][0]["id"]
    prefix = f"/api/workspaces/{wid}"
    before = client.get(prefix + "/bootstrap").json()
    response = client.post(prefix + "/assets", headers=headers, json=manual_asset_payload(notes="", services=["HTTPS 443", "HTTPS 443"]))
    assert response.status_code == 201, response.text
    asset = response.json()
    assert asset["provenance"] == "manual" and asset["risk_score"] == 0
    assert asset["address"] == "" and asset["services"] == ["HTTPS 443"]
    assert 0 <= asset["x"] <= 100 and 0 <= asset["y"] <= 100
    with factory() as db:
        assert db.get(m.Asset, asset["id"]).workspace_id == wid
    state = client.get(prefix + "/bootstrap").json()
    assert state["overview"]["assets"] == before["overview"]["assets"] + 1
    assert any(row["id"] == asset["id"] and row["provenance"] == "manual" for row in state["assets"])
    assert state["relationships"] == before["relationships"]
    assert len(state["findings"]) == len(before["findings"])
    audit = next(row for row in state["audit"] if row["action"] == "Manual asset created")
    assert audit["record_id"] == asset["id"] and "No scan" in audit["detail"]
    assert audit["actor_name"] == "Local owner"
    listed = client.get(prefix + "/records/assets", params={"q": asset["name"]}).json()
    assert listed["total"] == 1 and listed["items"][0]["risk_score"] == 0
    snapshot = client.post(prefix + "/snapshots", headers=headers, json={"name": "Manual inventory snapshot"}).json()
    assert any(row["id"] == asset["id"] for row in snapshot["graph"]["assets"])


@pytest.mark.parametrize("role,expected", [("Owner", 201), ("Admin", 201), ("Analyst", 201), ("Viewer", 403)])
def test_manual_asset_creation_role_authorization_and_workspace_isolation(environment, role, expected):
    client, _ = environment
    auth, headers = setup(client)
    wid = auth["workspaces"][0]["id"]
    prefix = f"/api/workspaces/{wid}"
    second = client.post("/api/workspaces", headers=headers, json={"name": "Separate space", "scope": "Another isolated inventory workspace.", "seed_demo": False}).json()
    if role != "Owner":
        account = {"email": f"asset-{role.lower()}@example.invalid", "password": PASSWORD + "-member"}
        assert client.post(prefix + "/members", headers=headers, json={**account, "name": "Inventory reviewer", "role": role}).status_code == 201
        client.post("/api/auth/logout", headers=headers)
        signed_in = client.post("/api/auth/login", json=account).json()
        headers = {"X-CSRF-Token": signed_in["csrf_token"]}
    response = client.post(prefix + "/assets", headers=headers, json=manual_asset_payload(address="unresolved.example.invalid"))
    assert response.status_code == expected
    if expected == 201:
        assert response.json()["workspace_id"] == wid and response.json()["address"] == "unresolved.example.invalid"
    if role != "Owner":
        assert client.post(f'/api/workspaces/{second["id"]}/assets', headers=headers, json=manual_asset_payload()).status_code == 404


@pytest.mark.parametrize("patch", [{"name": "   "}, {"owner": "   "}, {"asset_type": "Arbitrary"}, {"exposure": "External"}, {"criticality": "Invalid"}, {"address": "host\nsecond"}, {"notes": "x" * 1501}, {"services": [""]}, {"workspace_id": "outside"}, {"provenance": "observed"}])
def test_manual_asset_input_validation_does_not_create_records(environment, patch):
    client, factory = environment
    auth, headers = setup(client)
    wid = auth["workspaces"][0]["id"]
    response = client.post(f"/api/workspaces/{wid}/assets", headers=headers, json=manual_asset_payload(**patch))
    assert response.status_code == 422
    with factory() as db:
        assert len(list(db.scalars(select(m.Asset).where(m.Asset.workspace_id == wid)))) == 12


def test_manual_asset_creation_requires_session_and_csrf(environment):
    client, _ = environment
    auth, headers = setup(client)
    prefix = f'/api/workspaces/{auth["workspaces"][0]["id"]}'
    assert client.post(prefix + "/assets", json=manual_asset_payload()).status_code == 403
    client.post("/api/auth/logout", headers=headers)
    assert client.post(prefix + "/assets", headers=headers, json=manual_asset_payload()).status_code == 401
