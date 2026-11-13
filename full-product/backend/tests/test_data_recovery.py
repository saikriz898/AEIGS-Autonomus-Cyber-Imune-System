from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.db import Base
from app import jobs, models as m
from app.dataset_manifest import schema_only, profile_dataset
from app.storage import checksum_file, source_fingerprint


def test_public_arff_reader_preserves_file_and_decodes_nominal_labels(tmp_path, monkeypatch):
    monkeypatch.setenv("DATASET_ROOTS", str(tmp_path))
    monkeypatch.setenv("STORAGE_ROOT", str(tmp_path / "private"))
    path = tmp_path / "synthetic-test-only.arff"
    path.write_text(
        "@relation fixture\n@attribute duration numeric\n@attribute label {normal,anomaly}\n@data\n1,normal\n2,anomaly\n",
        encoding="utf-8",
    )
    before = checksum_file(path)
    schema = schema_only(path)
    assert [column["name"] for column in schema["schema"]] == ["duration", "label"]
    assert schema["row_count"] == 2
    profile = profile_dataset(path, 50, "label")
    assert profile["row_count"] == 2
    assert checksum_file(path) == before


def test_redelivered_running_job_is_failed_without_reexecuting_results(tmp_path, monkeypatch):
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine, expire_on_commit=False)
    with factory() as db:
        user = m.User(
            email="worker-test@example.invalid", name="Synthetic test", password_hash="unused"
        )
        workspace = m.Workspace(name="Synthetic recovery test", scope="Test fixture only.")
        db.add_all([user, workspace])
        db.flush()
        job = m.Job(
            workspace_id=workspace.id,
            user_id=user.id,
            kind="report",
            status="running",
            progress=50,
            payload={},
            result={},
            idempotency_key="synthetic-recovery",
        )
        db.add(job)
        db.commit()
        job_id = job.id
    monkeypatch.setattr(jobs, "SessionLocal", factory)
    result = jobs.execute_job(job_id, redelivered=True)
    assert result["status"] == "failed"
    with factory() as db:
        stored = db.get(m.Job, job_id)
        assert stored.status == "failed" and stored.finished_at is not None
        assert stored.result == {}
        assert not list(db.query(m.Report))
    engine.dispose()


def test_source_version_fingerprint_is_deterministic():
    assert len(source_fingerprint()) == 64
    assert source_fingerprint() == source_fingerprint()
