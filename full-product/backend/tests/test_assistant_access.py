import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from app.db import Base
from app import models as m
from app.assistant import lookup_records, owned_conversation
from fastapi import HTTPException


@pytest.fixture
def data():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        first = m.Workspace(name="Authorized workspace", scope="Synthetic scope")
        second = m.Workspace(name="Another workspace", scope="Synthetic scope")
        user = m.User(
            name="Test analyst", email="test@example.invalid", password_hash="not-used-by-this-test"
        )
        other = m.User(
            name="Other analyst",
            email="other@example.invalid",
            password_hash="not-used-by-this-test",
        )
        db.add_all([first, second, user, other])
        db.flush()
        db.add_all(
            [
                m.Membership(workspace_id=first.id, user_id=user.id, role="Analyst"),
                m.Membership(workspace_id=first.id, user_id=other.id, role="Analyst"),
            ]
        )
        for wid, name in [(first.id, "Visible server"), (second.id, "Other tenant server")]:
            db.add(
                m.Asset(
                    workspace_id=wid,
                    name=name,
                    address="192.0.2.1",
                    asset_type="Server",
                    owner="Synthetic",
                    criticality="Low",
                    exposure="Internal",
                    notes="Test data only.",
                )
            )
        conversation = m.Conversation(
            workspace_id=first.id, user_id=other.id, title="Other user private chat"
        )
        db.add(conversation)
        db.commit()
        yield db, first, second, user, conversation


def test_lookup_never_returns_records_from_other_workspaces(data):
    db, first, second, user, conversation = data
    results = lookup_records(db, first.id, "assets", limit=10)
    assert [r["name"] for r in results] == ["Visible server"]
    foreign = db.query(m.Asset).filter(m.Asset.workspace_id == second.id).first()
    assert lookup_records(db, first.id, "assets", record_id=foreign.id) == []


def test_private_conversation_stays_user_scoped_inside_same_workspace(data):
    db, first, second, user, conversation = data
    with pytest.raises(HTTPException) as error:
        owned_conversation(db, user, first.id, conversation.id)
    assert error.value.status_code == 404


def test_unsupported_tool_kind_has_no_write_capability(data):
    db, first, *_ = data
    assert lookup_records(db, first.id, "execute") == []
    assert lookup_records(db, first.id, "assets", query="%") == []
