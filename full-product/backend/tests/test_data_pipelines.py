"""Synthetic fixtures validate mechanics only; they are not product benchmark data."""

import csv
import json
from pathlib import Path
from types import SimpleNamespace

import joblib
import numpy as np
import pandas as pd
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app import jobs
from app.dataset_manifest import profile_dataset, schema_only
from app.ml import assert_training_allowed, predict_rows, train_baseline, validate_mapping
from app.models import DatasetRegistry, DatasetFile, Job, Membership, User, Workspace
from app.storage import DataError, allowed_dataset_path, checksum_file


@pytest.fixture
def raw_file(tmp_path, monkeypatch):
    root = tmp_path / "raw"
    root.mkdir()
    monkeypatch.setenv("DATASET_ROOTS", str(root))
    monkeypatch.setenv("STORAGE_ROOT", str(tmp_path / "storage"))
    path = root / "synthetic-unit-test.csv"
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.writer(stream)
        writer.writerow(["duration", "bytes", "protocol", "label", "group", "timestamp"])
        for index in range(160):
            writer.writerow(
                [
                    index + 1,
                    index % 13 * 1.25,
                    "tcp" if index % 2 else "udp",
                    "normal" if index % 3 else "anomaly",
                    f"group-{index // 10}",
                    f"2025-01-{index // 8 + 1:02d}T{index % 8:02d}:00:00Z",
                ]
            )
    return path


def records_for(path, workspace_id="workspace-fixture"):
    mapping = {
        "label_column": "label",
        "feature_columns": ["duration", "bytes", "protocol"],
        "categorical_columns": ["protocol"],
        "split_strategy": "stratified",
    }
    dataset = SimpleNamespace(
        id="dataset-fixture",
        workspace_id=workspace_id,
        task="network",
        source="Synthetic unit-test fixture only",
        citation="Generated solely by this test; never used as a product benchmark.",
        version="test-only",
        license_status="reviewed_permitted",
        mapping=mapping,
    )
    file = SimpleNamespace(
        path=str(path), checksum=checksum_file(path), schema_json=schema_only(path)["schema"]
    )
    return dataset, file


def test_raw_allowlist_and_checksum_do_not_modify_data(raw_file, tmp_path):
    original = raw_file.read_bytes()
    assert allowed_dataset_path(str(raw_file)) == raw_file.resolve()
    assert len(checksum_file(raw_file)) == 64
    with pytest.raises(DataError, match="configured"):
        allowed_dataset_path(str(tmp_path / "elsewhere.csv"))
    assert raw_file.read_bytes() == original


def test_bounded_profile_explicit_label_and_no_mutation(raw_file):
    before = checksum_file(raw_file)
    profile = profile_dataset(raw_file, 50, "label")
    assert profile["row_count"] == 50
    assert profile["profile_scope"] == "bounded_prefix"
    assert sum(profile["class_distribution"].values()) == 50
    assert profile["mapping_required"] is True
    assert profile["label_candidates"] == ["label"]
    assert checksum_file(raw_file) == before


def test_mapping_rejects_label_and_identifier_leakage(raw_file):
    schema = schema_only(raw_file)["schema"]
    with pytest.raises(DataError, match="Label"):
        validate_mapping({"label_column": "label", "feature_columns": ["label"]}, schema)
    with pytest.raises(DataError, match="identifier"):
        validate_mapping({"label_column": "label", "feature_columns": ["timestamp"]}, schema)
    with pytest.raises(DataError, match="group column"):
        validate_mapping(
            {"label_column": "label", "feature_columns": ["duration"], "split_strategy": "group"},
            schema,
        )
    valid = validate_mapping(
        {
            "label_column": "label",
            "feature_columns": ["duration"],
            "split_strategy": "group",
            "group_column": "group",
        },
        schema,
    )
    assert valid["group_column"] == "group"


def test_permission_and_intended_use_blockers(raw_file):
    dataset, _ = records_for(raw_file)
    dataset.license_status = "unknown"
    with pytest.raises(DataError, match="blocked"):
        assert_training_allowed(dataset)
    dataset.license_status = "reviewed_noncommercial"
    assert_training_allowed(dataset, "research")
    with pytest.raises(DataError, match="Commercial"):
        assert_training_allowed(dataset, "commercial")
    dataset.citation = ""
    with pytest.raises(DataError, match="citation"):
        assert_training_allowed(dataset)


def test_actual_fixture_training_persists_pipeline_and_real_metrics(raw_file):
    dataset, file = records_for(raw_file)
    result = train_baseline(
        dataset,
        file,
        {"algorithm": "logistic_regression", "row_limit": 160, "seed": 42},
        "job-test-only",
    )
    assert Path(result["artifact_path"]).is_file()
    assert result["metadata"]["evaluation_scope"] == "offline_benchmark"
    assert result["metadata"]["training_rows"] + result["metadata"]["evaluation_rows"] == 160
    assert 0 <= result["metrics"]["accuracy"] <= 1
    assert (
        sum(map(sum, result["metrics"]["confusion_matrix"]["matrix"]))
        == result["metadata"]["evaluation_rows"]
    )
    assert "precision" in result["metrics"]["per_class"]["normal"]
    bundle = joblib.load(result["artifact_path"])
    assert bundle["pipeline"].named_steps["preprocess"].named_transformers_["numeric"].named_steps[
        "impute"
    ].statistics_.shape == (2,)
    model = SimpleNamespace(
        id="test-model",
        active=True,
        status="active",
        feature_schema=result["feature_schema"],
        artifact_path=result["artifact_path"],
        metadata_json=result["metadata"],
    )
    predictions = predict_rows(model, [{"duration": 11, "bytes": 2.5, "protocol": "tcp"}])
    assert len(predictions["predictions"]) == 1
    assert len(result["metadata"]["source_code_sha256"]) == 64
    assert result["metadata"]["artifact_sha256"] == checksum_file(Path(result["artifact_path"]))
    with pytest.raises(DataError, match="exact"):
        predict_rows(model, [{"duration": 11}])
    with pytest.raises(DataError, match="finite"):
        predict_rows(model, [{"duration": "11", "bytes": 2.5, "protocol": "tcp"}])
    model.active = False
    with pytest.raises(DataError, match="inactive"):
        predict_rows(model, [{"duration": 11, "bytes": 2.5, "protocol": "tcp"}])
    model.active = True
    with Path(result["artifact_path"]).open("ab") as artifact:
        artifact.write(b"test-only-integrity-change")
    with pytest.raises(DataError, match="checksum"):
        predict_rows(model, [{"duration": 11, "bytes": 2.5, "protocol": "tcp"}])


@pytest.mark.parametrize("strategy,column", [("group", "group_column"), ("time", "time_column")])
def test_group_and_time_split_are_explicit_and_evaluated(raw_file, strategy, column):
    dataset, file = records_for(raw_file)
    dataset.mapping.update(
        {"split_strategy": strategy, column: "group" if strategy == "group" else "timestamp"}
    )
    result = train_baseline(
        dataset,
        file,
        {"algorithm": "random_forest", "n_estimators": 20, "row_limit": 160},
        f"job-{strategy}-test-only",
    )
    assert result["metadata"]["split_strategy"] == strategy
    assert result["metadata"]["preprocessing"]["fitted_on_training_only"] is True


def test_changed_raw_file_is_rejected_before_training(raw_file):
    dataset, file = records_for(raw_file)
    file.checksum = "0" * 64
    with pytest.raises(DataError, match="changed"):
        train_baseline(dataset, file, {"row_limit": 160}, "job-changed-test")


@pytest.fixture
def database(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}")
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine, expire_on_commit=False)
    with factory() as db:
        user = User(
            id="user-fixture",
            email="fixture@example.invalid",
            name="Test fixture",
            password_hash="not-a-real-account",
        )
        workspace = Workspace(
            id="workspace-fixture",
            name="Test-only workspace",
            scope="Synthetic unit test records only",
            settings={},
        )
        db.add_all([user, workspace])
        db.flush()
        db.add(Membership(workspace_id=workspace.id, user_id=user.id, role="Owner"))
        db.commit()
    yield factory
    engine.dispose()


def test_jobs_are_persisted_idempotent_and_queue_failure_is_truthful(database, monkeypatch):
    calls = []
    monkeypatch.setattr(
        jobs.celery_app, "send_task", lambda *args, **kwargs: calls.append((args, kwargs))
    )
    with database() as db:
        first = jobs.submit_job(
            db,
            "workspace-fixture",
            "user-fixture",
            "report",
            {"name": "Test snapshot"},
            "same-request",
        )
        second = jobs.submit_job(
            db,
            "workspace-fixture",
            "user-fixture",
            "report",
            {"name": "Test snapshot"},
            "same-request",
        )
        assert first.id == second.id
        assert len(calls) == 1
        assert first.status == "queued"
        with pytest.raises(DataError, match="different"):
            jobs.submit_job(
                db,
                "workspace-fixture",
                "user-fixture",
                "report",
                {"name": "Changed snapshot"},
                "same-request",
            )
        monkeypatch.setattr(
            jobs.celery_app,
            "send_task",
            lambda *args, **kwargs: (_ for _ in ()).throw(ConnectionError("No actual broker")),
        )
        failed = jobs.submit_job(
            db,
            "workspace-fixture",
            "user-fixture",
            "report",
            {"name": "Queue unavailable"},
            "queue-failure",
        )
        assert failed.status == "failed"
        assert "Redis queue is unavailable" in failed.error
        assert db.get(Job, failed.id).status == "failed"


def test_real_worker_function_generates_persisted_report(database, monkeypatch):
    monkeypatch.setattr(jobs.celery_app, "send_task", lambda *args, **kwargs: None)
    monkeypatch.setattr(jobs, "SessionLocal", database)
    with database() as db:
        job = jobs.submit_job(
            db,
            "workspace-fixture",
            "user-fixture",
            "report",
            {"name": "Synthetic fixture report"},
            "worker-report",
        )
        job_id = job.id
    result = jobs.execute_job(job_id)
    assert result["report_id"]
    with database() as db:
        from app.models import Report

        assert db.get(Job, job_id).status == "succeeded"
        assert "Test-only workspace" in db.get(Report, result["report_id"]).content
    assert jobs.execute_job(job_id) == {"skipped": True}


def test_cancelled_queued_job_does_not_execute(database, monkeypatch):
    monkeypatch.setattr(jobs.celery_app, "send_task", lambda *args, **kwargs: None)
    monkeypatch.setattr(jobs, "SessionLocal", database)
    with database() as db:
        job = jobs.submit_job(
            db,
            "workspace-fixture",
            "user-fixture",
            "report",
            {"name": "Cancelled fixture"},
            "cancel-report",
        )
        job.cancel_requested = True
        db.commit()
        job_id = job.id
    assert jobs.execute_job(job_id) == {"cancelled": True}
    with database() as db:
        assert db.get(Job, job_id).status == "cancelled"
