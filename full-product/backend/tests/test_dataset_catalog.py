"""Mounted-file catalog metadata is visible without ingestion or training."""

from pathlib import Path

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import sessionmaker

from app import catalog, dataset_manifest, datasets, models as m
from app.dataset_manifest import candidates
from app.db import Base
from app.ml import assert_training_allowed, validate_mapping
from app.seed import seed_workspace
from app.storage import DataError, allowed_dataset_path, checksum_file


@pytest.fixture
def catalog_environment(tmp_path, monkeypatch):
    raw = tmp_path / "mounted-raw"
    raw.mkdir()
    for name in ("first.csv", "second.csv"):
        (raw / name).write_text("duration,label\n1,normal\n2,anomaly\n", encoding="utf-8")
    storage = tmp_path / "private"
    monkeypatch.setenv("DATASET_ROOTS", str(raw))
    monkeypatch.setenv("STORAGE_ROOT", str(storage))
    engine = create_engine("sqlite://")

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    factory = sessionmaker(engine, expire_on_commit=False)
    with factory() as db:
        user = m.User(
            name="Catalog test", email="catalog@example.invalid", password_hash="test-fixture-only"
        )
        first = m.Workspace(name="First test workspace", scope="Synthetic fixture only.")
        second = m.Workspace(name="Second test workspace", scope="Synthetic fixture only.")
        db.add_all([user, first, second, m.Role(name="Owner", permissions=[])])
        db.flush()
        db.add(m.Membership(workspace_id=first.id, user_id=user.id, role="Owner"))
        db.commit()
        yield db, user, first, second, raw, storage
    engine.dispose()


def test_catalog_registers_metadata_once_without_ingestion_or_training(catalog_environment):
    db, user, workspace, _, raw, _ = catalog_environment
    checksums = {path.name: checksum_file(path) for path in raw.iterdir()}
    result = catalog.register_detected(db, workspace.id, user.id)
    db.commit()
    assert result["registered"] == 2
    assert result["metadata_only"] is True
    assert result["ingestion_started"] is False and result["training_started"] is False
    rows = list(
        db.scalars(select(m.DatasetRegistry).where(m.DatasetRegistry.workspace_id == workspace.id))
    )
    assert len(rows) == 2
    assert all(
        row.task == "unassigned"
        and row.license_status == "unknown"
        and not row.mapping
        and not row.source
        for row in rows
    )
    files = list(
        db.scalars(select(m.DatasetFile).where(m.DatasetFile.workspace_id == workspace.id))
    )
    assert all(file.status == "registered" and len(file.schema_json) == 2 for file in files)
    assert not list(db.scalars(select(m.Job)))
    assert not list(db.scalars(select(m.ModelVersion)))
    with pytest.raises(DataError):
        assert_training_allowed(rows[0])
    rows[0].source = "Preserve this user-entered source note."
    db.commit()
    again = catalog.register_detected(db, workspace.id, user.id)
    db.commit()
    assert again["registered"] == 0 and again["existing"] == 2
    assert rows[0].source == "Preserve this user-entered source note."
    assert (
        len(
            list(
                db.scalars(
                    select(m.AuditLog).where(m.AuditLog.action == "Dataset catalog synchronized")
                )
            )
        )
        == 1
    )
    assert {path.name: checksum_file(path) for path in raw.iterdir()} == checksums


def test_private_upload_paths_and_discovery_stay_workspace_scoped(catalog_environment):
    db, user, workspace, other, _, storage = catalog_environment
    own = storage / "uploads" / workspace.id / "own.csv"
    foreign = storage / "uploads" / other.id / "foreign.csv"
    for path in (own, foreign):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("duration,label\n1,normal\n", encoding="utf-8")
    assert allowed_dataset_path(str(own), workspace_id=workspace.id) == own
    with pytest.raises(DataError, match="owning workspace"):
        allowed_dataset_path(str(foreign), workspace_id=workspace.id)
    with pytest.raises(DataError, match="owning workspace"):
        allowed_dataset_path(str(own))
    assert not any("uploads" in entry["path"] for entry in candidates())
    visible = {entry["path"] for entry in candidates(workspace.id)}
    assert str(own) in visible and str(foreign) not in visible
    result = catalog.register_detected(db, workspace.id, user.id)
    assert result["registered"] == 2  # Shared mounted files only; private files are excluded.
    with pytest.raises(DataError, match="owning workspace"):
        validate_mapping(
            {"label_column": "label", "feature_columns": ["duration"], "test_path": str(foreign)},
            [{"name": "duration"}, {"name": "label"}],
            workspace_id=workspace.id,
        )


def test_new_workspace_seed_registers_metadata_without_resetting_existing_records(
    catalog_environment,
):
    db, user, workspace, _, _, _ = catalog_environment
    seed_workspace(db, workspace, user.id)
    db.commit()
    assert (
        len(
            list(
                db.scalars(
                    select(m.DatasetRegistry).where(m.DatasetRegistry.workspace_id == workspace.id)
                )
            )
        )
        == 2
    )
    asset = db.scalar(select(m.Asset).where(m.Asset.workspace_id == workspace.id))
    asset.owner = "Keep the analyst edit"
    db.commit()
    seed_workspace(db, workspace, user.id)
    db.commit()
    assert asset.owner == "Keep the analyst edit"
    assert len(list(db.scalars(select(m.Asset).where(m.Asset.workspace_id == workspace.id)))) == 12
    assert (
        len(
            list(
                db.scalars(
                    select(m.DatasetRegistry).where(m.DatasetRegistry.workspace_id == workspace.id)
                )
            )
        )
        == 2
    )


def test_task_assignment_is_explicit_and_cannot_reclassify_active_training_or_models(
    catalog_environment,
):
    db, user, workspace, _, _, _ = catalog_environment
    catalog.register_detected(db, workspace.id, user.id)
    db.commit()
    dataset = db.scalar(
        select(m.DatasetRegistry).where(m.DatasetRegistry.workspace_id == workspace.id)
    )
    result = datasets.update_dataset(
        workspace.id, dataset.id, datasets.UpdateDataset(task="network"), user, db
    )
    assert result["task"] == "network" and result["mapping"] == {}
    job = m.Job(
        workspace_id=workspace.id,
        user_id=user.id,
        dataset_id=dataset.id,
        kind="training",
        status="running",
        payload={},
        result={},
        idempotency_key="catalog-test-training",
    )
    db.add(job)
    db.commit()
    with pytest.raises(HTTPException) as error:
        datasets.update_dataset(
            workspace.id, dataset.id, datasets.UpdateDataset(task="iot"), user, db
        )
    assert error.value.status_code == 409
    job.status = "failed"
    db.commit()
    result = datasets.update_dataset(
        workspace.id, dataset.id, datasets.UpdateDataset(task="iot"), user, db
    )
    assert result["task"] == "iot"
    model = m.ModelVersion(
        workspace_id=workspace.id,
        dataset_id=dataset.id,
        name="Synthetic registry row",
        task="iot",
        algorithm="test-only",
        feature_schema={},
        artifact_path="/not-a-real-model.joblib",
        metadata_json={},
        status="inactive",
        active=False,
    )
    db.add(model)
    db.commit()
    with pytest.raises(HTTPException) as error:
        datasets.update_dataset(
            workspace.id, dataset.id, datasets.UpdateDataset(task="phishing"), user, db
        )
    assert error.value.status_code == 409


def alias_manifest(raw):
    first, second = raw / "first.csv", raw / "second.csv"
    checksum = checksum_file(first)
    return {
        "datasets": [
            {
                "container_path": str(first),
                "sha256": checksum,
                "size_bytes": first.stat().st_size,
                "row_count": 2,
                "schema": [
                    {"name": "duration", "dtype": "numeric"},
                    {"name": "label", "dtype": "string"},
                ],
                "label_candidates": ["label"],
            }
        ],
        "file_aliases": [
            {
                "container_path": str(second),
                "canonical_container_path": str(first),
                "sha256": checksum,
                "size_bytes": second.stat().st_size,
                "local_path": "synthetic-alias-fixture/second.csv",
            }
        ],
    }


def test_verified_alias_locations_share_one_dataset_without_touching_raw_files(
    catalog_environment, monkeypatch
):
    db, user, workspace, _, raw, _ = catalog_environment
    before = {path.name: checksum_file(path) for path in raw.iterdir()}
    monkeypatch.setattr(dataset_manifest, "load_local_manifest", lambda: alias_manifest(raw))
    entries = candidates()
    alias = next(entry for entry in entries if entry["path"].endswith("second.csv"))
    assert alias["duplicate_of"] == str(raw / "first.csv")
    assert alias["row_count"] == 2
    result = catalog.register_detected(db, workspace.id, user.id)
    db.commit()
    assert result["registered"] == 1 and result["aliases_registered"] == 1
    records = list(
        db.scalars(select(m.DatasetRegistry).where(m.DatasetRegistry.workspace_id == workspace.id))
    )
    files = list(
        db.scalars(select(m.DatasetFile).where(m.DatasetFile.workspace_id == workspace.id))
    )
    assert len(records) == 1 and len(files) == 2
    assert len({file.dataset_id for file in files}) == 1
    assert all(file.status == "registered" for file in files)
    assert records[0].task == "unassigned" and not records[0].mapping
    assert {path.name: checksum_file(path) for path in raw.iterdir()} == before


@pytest.mark.parametrize("manual_edit", [False, "source", "name", "version", "job"])
def test_existing_alias_cleanup_preserves_user_edited_records(
    catalog_environment, monkeypatch, manual_edit
):
    db, user, workspace, _, raw, _ = catalog_environment
    catalog.register_detected(db, workspace.id, user.id)
    db.commit()
    second_file = db.scalar(
        select(m.DatasetFile).where(m.DatasetFile.path == str(raw / "second.csv"))
    )
    duplicate_id = second_file.dataset_id
    duplicate = db.get(m.DatasetRegistry, duplicate_id)
    if manual_edit == "source":
        duplicate.source = "Keep this analyst-entered provenance note."
    elif manual_edit == "name":
        duplicate.name = "Preserve a manually renamed dataset"
    elif manual_edit == "version":
        duplicate.version = "User-entered-version"
    elif manual_edit == "job":
        db.add(
            m.Job(
                workspace_id=workspace.id,
                user_id=user.id,
                dataset_id=duplicate_id,
                kind="ingestion",
                status="failed",
                payload={},
                result={},
                idempotency_key="preserve-existing-job",
            )
        )
    db.commit()
    monkeypatch.setattr(dataset_manifest, "load_local_manifest", lambda: alias_manifest(raw))
    result = catalog.register_detected(db, workspace.id, None)
    db.commit()
    rows = list(
        db.scalars(select(m.DatasetRegistry).where(m.DatasetRegistry.workspace_id == workspace.id))
    )
    assert len(rows) == (2 if manual_edit else 1)
    assert result["duplicate_records_merged"] == (0 if manual_edit else 1)
    if manual_edit:
        preserved = db.get(m.DatasetRegistry, duplicate_id)
        assert preserved is not None
        if manual_edit == "source":
            assert preserved.source == "Keep this analyst-entered provenance note."
        assert preserved.quality["duplicate_of_dataset_id"]
    else:
        assert db.get(m.DatasetRegistry, duplicate_id) is None
        assert len({file.dataset_id for file in db.scalars(select(m.DatasetFile))}) == 1
    assert len(list(db.scalars(select(m.DatasetFile)))) == 2


def test_changed_size_does_not_reuse_verified_alias_metadata(catalog_environment, monkeypatch):
    _, _, _, _, raw, _ = catalog_environment
    manifest = alias_manifest(raw)
    monkeypatch.setattr(dataset_manifest, "load_local_manifest", lambda: manifest)
    alias = raw / "second.csv"
    alias.write_text("duration,label\n1,normal\n2,anomaly\n3,normal\n", encoding="utf-8")
    entry = next(item for item in candidates() if item["path"] == str(alias))
    assert entry["manifest_metadata_stale"] is True
    assert "sha256" not in entry and "duplicate_of" not in entry
