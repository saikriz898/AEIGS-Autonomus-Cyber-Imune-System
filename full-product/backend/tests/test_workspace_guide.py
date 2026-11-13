"""The explicit no-LLM guide reads authorized records and never executes actions."""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from starlette.requests import Request

from app import assistant, models as m
from app.ai_providers import ProviderFailure
from app.db import Base


@pytest.fixture
def guide_data(monkeypatch):
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(assistant, "enforce_rate_limit", lambda *args, **kwargs: None)
    with factory() as db:
        user = m.User(
            name="Guide analyst", email="guide@example.invalid", password_hash="unused-test-fixture"
        )
        other = m.User(
            name="Other analyst",
            email="other-guide@example.invalid",
            password_hash="unused-test-fixture",
        )
        workspace = m.Workspace(name="Authorized test scope", scope="Synthetic test only.")
        foreign = m.Workspace(name="Foreign private scope", scope="Must not be revealed.")
        db.add_all([user, other, workspace, foreign])
        db.flush()
        db.add_all(
            [
                m.Membership(workspace_id=workspace.id, user_id=user.id, role="Analyst"),
                m.Membership(workspace_id=workspace.id, user_id=other.id, role="Analyst"),
            ]
        )
        for wid, name in (
            (workspace.id, "Synthetic portal"),
            (foreign.id, "Foreign server secret"),
        ):
            asset = m.Asset(
                workspace_id=wid,
                name=name,
                address="192.0.2.1",
                asset_type="Server",
                owner="Test fixture",
                criticality="High",
                exposure="Internet",
                provenance="seeded",
            )
            db.add(asset)
            db.flush()
            db.add(
                m.Finding(
                    workspace_id=wid,
                    asset_id=asset.id,
                    title="Illustrative package review",
                    description="Test evidence only.",
                    severity="High",
                    base_score=7,
                    evidence="Synthetic package metadata, not live telemetry.",
                    factors=[],
                    status="Open",
                )
            )
        dataset = m.DatasetRegistry(
            workspace_id=workspace.id,
            name="Unknown-permission fixture",
            task="unassigned",
            source="",
            citation="",
            license_status="unknown",
            mapping={},
            quality={},
            status="registered",
        )
        db.add(dataset)
        db.flush()
        db.add(
            m.DatasetFile(
                workspace_id=workspace.id,
                dataset_id=dataset.id,
                path="/not-read-by-guide.csv",
                size_bytes=5,
                schema_json=[{"name": "label"}],
                status="registered",
                stats={},
            )
        )
        db.commit()
        request = Request(
            {
                "type": "http",
                "method": "POST",
                "path": "/",
                "headers": [],
                "client": ("127.0.0.1", 1),
            }
        )
        yield db, workspace, foreign, user, other, dataset, request
    engine.dispose()


def test_no_llm_guide_explains_training_blockers_with_real_record_citations(
    guide_data, monkeypatch
):
    db, workspace, _, user, _, dataset, request = guide_data
    monkeypatch.setenv("AI_PROVIDER", "none")
    monkeypatch.setattr(
        assistant,
        "get_provider",
        lambda: (_ for _ in ()).throw(AssertionError("Guide must never request a model")),
    )
    result = assistant.guide(
        workspace.id, assistant.GuideMessage(content="Why is training blocked?"), request, db, user
    )
    assert result["provider"] == "workspace_guide" and result["llm_used"] is False
    assert result["mode"] == "deterministic"
    text = result["message"]["content"]
    assert assistant.GUIDE_LABEL in text and f"[{dataset.id}]" in text
    assert "assign an explicit" in text and "record the original source" in text
    assert "citation and permission evidence" in text and "review usage permission" in text
    assert "complete ingestion" in text and "label and feature mapping" in text
    assert not list(db.scalars(select(m.Job))) and not list(db.scalars(select(m.ModelVersion)))
    assert result["references"] == [{"record_type": "datasets", "id": dataset.id}]


def test_guide_history_continues_and_cannot_cross_users_or_modes(guide_data):
    db, workspace, _, user, other, _, request = guide_data
    first = assistant.guide(
        workspace.id, assistant.GuideMessage(content="Show assets"), request, db, user
    )
    cid = first["conversation"]["id"]
    second = assistant.guide(
        workspace.id,
        assistant.GuideMessage(content="Explain risk", conversation_id=cid),
        request,
        db,
        user,
    )
    assert second["conversation"]["id"] == cid
    history = assistant.read_conversation(workspace.id, cid, db, user)
    assert history["conversation"]["mode"] == "workspace_guide"
    assert len(history["messages"]) == 4
    assert all(message["llm_used"] is False for message in history["messages"])
    assert assistant.conversations(workspace.id, db, user)[0]["id"] == cid
    with pytest.raises(HTTPException) as denied:
        assistant.read_conversation(workspace.id, cid, db, other)
    assert denied.value.status_code == 404
    with pytest.raises(HTTPException) as wrong_mode:
        assistant.send(
            workspace.id,
            cid,
            assistant.SendMessage(content="Use an AI provider"),
            request,
            db,
            user,
        )
    assert wrong_mode.value.status_code == 409
    provider = assistant.create_conversation(
        workspace.id, assistant.NewConversation(title="Provider test"), db, user
    )
    with pytest.raises(HTTPException) as wrong_guide:
        assistant.guide(
            workspace.id,
            assistant.GuideMessage(content="Read records", conversation_id=provider["id"]),
            request,
            db,
            user,
        )
    assert wrong_guide.value.status_code == 409


def test_guide_context_is_scoped_and_bad_context_has_no_orphan_history(guide_data):
    db, workspace, foreign, user, _, _, request = guide_data
    foreign_asset = db.scalar(select(m.Asset).where(m.Asset.workspace_id == foreign.id))
    with pytest.raises(HTTPException) as denied:
        assistant.guide(
            workspace.id,
            assistant.GuideMessage(
                content="Review", context_type="asset", context_id=foreign_asset.id
            ),
            request,
            db,
            user,
        )
    assert denied.value.status_code == 404
    assert not list(db.scalars(select(m.Conversation))) and not list(db.scalars(select(m.Message)))
    asset = db.scalar(select(m.Asset).where(m.Asset.workspace_id == workspace.id))
    result = assistant.guide(
        workspace.id,
        assistant.GuideMessage(
            content="Explain this asset", context_type="asset", context_id=asset.id
        ),
        request,
        db,
        user,
    )
    assert f"[{asset.id}]" in result["message"]["content"]
    assert "Foreign server secret" not in result["message"]["content"]
    assert all(ref["id"] != foreign_asset.id for ref in result["references"])


def test_viewer_cannot_write_guide_history(guide_data):
    db, workspace, _, user, _, _, request = guide_data
    membership = db.scalar(
        select(m.Membership).where(
            m.Membership.user_id == user.id, m.Membership.workspace_id == workspace.id
        )
    )
    membership.role = "Viewer"
    db.commit()
    with pytest.raises(HTTPException) as denied:
        assistant.guide(
            workspace.id, assistant.GuideMessage(content="Show assets"), request, db, user
        )
    assert denied.value.status_code == 403
    assert not list(db.scalars(select(m.Message)))


def test_provider_summary_gets_minimal_real_context_and_failure_has_no_fake_answer(
    guide_data, monkeypatch
):
    db, workspace, _, user, _, _, request = guide_data
    conversation = assistant.create_conversation(
        workspace.id, assistant.NewConversation(title="Provider context test"), db, user
    )
    captured = []

    def failed_answer(messages, context, lookup):
        captured.extend(context)
        raise ProviderFailure("Deliberate mocked provider failure; no external request.")

    monkeypatch.setattr(assistant, "get_provider", lambda: SimpleNamespace(answer=failed_answer))
    with pytest.raises(HTTPException) as failed:
        assistant.send(
            workspace.id,
            conversation["id"],
            assistant.SendMessage(content="Summarize this workspace"),
            request,
            db,
            user,
        )
    assert failed.value.status_code == 502
    assert captured and len(captured) <= 5
    assert "Foreign server secret" not in str(captured)
    messages = list(
        db.scalars(select(m.Message).where(m.Message.conversation_id == conversation["id"]))
    )
    assert len(messages) == 1 and messages[0].role == "user"
    assert db.scalar(select(m.AuditLog).where(m.AuditLog.action == "AI provider request failed"))


def test_invalid_provider_context_saves_no_question_and_calls_no_model(guide_data, monkeypatch):
    db, workspace, foreign, user, _, _, request = guide_data
    conversation = assistant.create_conversation(
        workspace.id, assistant.NewConversation(title="Invalid context"), db, user
    )
    foreign_asset = db.scalar(select(m.Asset).where(m.Asset.workspace_id == foreign.id))
    calls = []
    monkeypatch.setattr(
        assistant, "get_provider", lambda: SimpleNamespace(answer=lambda *args: calls.append(args))
    )
    with pytest.raises(HTTPException) as denied:
        assistant.send(
            workspace.id,
            conversation["id"],
            assistant.SendMessage(
                content="Review", context_type="assets", context_id=foreign_asset.id
            ),
            request,
            db,
            user,
        )
    assert denied.value.status_code == 404 and not calls
    assert not list(db.scalars(select(m.Message)))
