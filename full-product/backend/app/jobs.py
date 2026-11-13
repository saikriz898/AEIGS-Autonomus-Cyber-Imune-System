"""Celery executes work; PostgreSQL owns job status, progress and results."""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from uuid import uuid4

from celery import Celery, signals
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from .config import settings
from .db import SessionLocal
from .models import (
    AuditLog,
    DatasetFile,
    DatasetRegistry,
    Job,
    Membership,
    ModelMetric,
    ModelRegistry,
    ModelVersion,
    Notification,
    Report,
    TrainingJob,
    User,
)
from .security import audit
from .storage import DataError

logger = logging.getLogger("aegis.jobs")
celery_app = Celery("aegis", broker=settings.redis_url, backend=settings.redis_url)
celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_track_started=False,
    worker_prefetch_multiplier=1,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    broker_connection_retry_on_startup=True,
    broker_transport_options={
        "visibility_timeout": int(os.getenv("JOB_HARD_TIME_LIMIT", "3600")) + 300
    },
    task_soft_time_limit=int(os.getenv("JOB_SOFT_TIME_LIMIT", "3300")),
    task_time_limit=int(os.getenv("JOB_HARD_TIME_LIMIT", "3600")),
    result_expires=86400,
    task_publish_retry=False,
)
KINDS = {"ingestion", "training", "report", "nvd_import", "attack_import"}
TERMINAL = {"succeeded", "failed", "cancelled"}


def _dispatch(job: Job, db) -> None:
    try:
        celery_app.send_task("aegis.execute_job", args=[job.id], task_id=job.id)
    except Exception:
        job.status = "failed"
        job.error = "The Redis queue is unavailable. Start Redis and the worker, then retry this persisted job."
        job.finished_at = datetime.now(timezone.utc)
        db.commit()
        logger.warning(
            json.dumps({"event": "job_dispatch_failed", "job_id": job.id, "kind": job.kind})
        )


def submit_job(
    db,
    workspace_id: str,
    user_id: str,
    kind: str,
    parameters: dict,
    idempotency_key: str | None = None,
) -> Job:
    if kind not in KINDS:
        raise DataError("Unsupported background job type.")
    key = f"{kind}:{idempotency_key or uuid4()}"
    if len(key) > 150:
        raise DataError("Idempotency key must be at most 120 characters.")
    existing = db.scalar(
        select(Job).where(Job.workspace_id == workspace_id, Job.idempotency_key == key)
    )
    if existing:
        if existing.kind != kind or existing.payload != parameters:
            raise DataError("This idempotency key was already used with different job parameters.")
        return existing
    job = Job(
        workspace_id=workspace_id,
        user_id=user_id,
        dataset_id=parameters.get("dataset_id"),
        kind=kind,
        status="queued",
        progress=0,
        payload=parameters,
        result={},
        idempotency_key=key,
    )
    db.add(job)
    try:
        db.flush()
        if kind == "training":
            db.add(
                TrainingJob(
                    workspace_id=workspace_id,
                    dataset_id=parameters["dataset_id"],
                    job_id=job.id,
                    algorithm=parameters["algorithm"],
                    parameters=parameters,
                    status="queued",
                )
            )
        audit(
            db,
            workspace_id,
            user_id,
            "Background job queued",
            f"Queued {kind}; job state is persisted in PostgreSQL.",
            "job",
            job.id,
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.scalar(
            select(Job).where(Job.workspace_id == workspace_id, Job.idempotency_key == key)
        )
        if existing and existing.kind == kind and existing.payload == parameters:
            return existing
        raise DataError("Duplicate job submission used incompatible parameters.") from None
    _dispatch(job, db)
    return job


def retry_job(db, job: Job) -> Job:
    if job.status not in {"failed", "cancelled"}:
        raise DataError("Only failed or cancelled jobs can be retried.")
    job.status = "queued"
    job.progress = 0
    job.error = None
    job.cancel_requested = False
    job.started_at = None
    job.finished_at = None
    training = db.scalar(select(TrainingJob).where(TrainingJob.job_id == job.id))
    if training:
        training.status = "queued"
    audit(
        db,
        job.workspace_id,
        job.user_id,
        "Background job retried",
        f"Retry requested for {job.kind}.",
        "job",
        job.id,
    )
    db.commit()
    _dispatch(job, db)
    return job


def _report(db, job: Job) -> dict:
    from .domain import generate_report

    existing = db.scalar(
        select(Report).where(Report.workspace_id == job.workspace_id, Report.job_id == job.id)
    )
    if existing and existing.status == "succeeded":
        return {"report_id": existing.id}
    report = existing or Report(
        workspace_id=job.workspace_id,
        job_id=job.id,
        name=job.payload.get("name", "Workspace review"),
        status="succeeded",
        content="",
    )
    report.content = generate_report(db, job.workspace_id)
    report.status = "succeeded"
    db.add(report)
    db.flush()
    return {"report_id": report.id}


def _ingest(db, job: Job, progress) -> dict:
    from .dataset_manifest import profile_dataset
    from .storage import allowed_dataset_path, checksum_file

    dataset = db.scalar(
        select(DatasetRegistry).where(
            DatasetRegistry.id == job.payload["dataset_id"],
            DatasetRegistry.workspace_id == job.workspace_id,
        )
    )
    file = (
        db.scalar(
            select(DatasetFile)
            .where(
                DatasetFile.dataset_id == dataset.id, DatasetFile.workspace_id == job.workspace_id
            )
            .order_by(DatasetFile.created_at)
        )
        if dataset
        else None
    )
    if not dataset or not file:
        raise DataError("Dataset registration or file no longer exists in this workspace.")
    path = allowed_dataset_path(file.path, workspace_id=job.workspace_id)
    maximum = min(200_000, int(os.getenv("MAX_DATASET_ROWS", "50000")))
    limit = int(job.payload.get("row_limit", maximum))
    if not 50 <= limit <= maximum:
        raise DataError(f"Inspection row limit must be between 50 and {maximum}.")
    checksum = checksum_file(path)
    stats = profile_dataset(path, limit, dataset.mapping.get("label_column"), progress)
    file.checksum = checksum
    file.row_count = stats["row_count"]
    file.schema_json = stats["schema"]
    file.stats = stats
    file.status = "ingested"
    dataset.quality = stats
    dataset.status = "ingested"
    db.flush()
    return {
        "dataset_id": dataset.id,
        "file_id": file.id,
        "row_count": stats["row_count"],
        "profile_scope": stats["profile_scope"],
        "sha256": checksum,
        "training_blocked": dataset.license_status == "unknown",
        "message": "Metadata inspected; raw files were not changed and no model was trained.",
    }


def _train(db, job: Job, progress, cancelled) -> dict:
    from .ml import train_baseline

    existing = db.scalar(
        select(ModelVersion).where(
            ModelVersion.workspace_id == job.workspace_id, ModelVersion.training_job_id == job.id
        )
    )
    if existing:
        return {
            "model_version_id": existing.id,
            "metrics": existing.metadata_json.get("metrics", {}),
            "artifact_path": existing.artifact_path,
            "status": existing.status,
        }
    dataset = db.scalar(
        select(DatasetRegistry).where(
            DatasetRegistry.id == job.payload["dataset_id"],
            DatasetRegistry.workspace_id == job.workspace_id,
        )
    )
    file = (
        db.scalar(
            select(DatasetFile)
            .where(
                DatasetFile.dataset_id == dataset.id, DatasetFile.workspace_id == job.workspace_id
            )
            .order_by(DatasetFile.created_at)
        )
        if dataset
        else None
    )
    if not dataset or not file:
        raise DataError("Dataset registration or file no longer exists.")
    result = train_baseline(dataset, file, job.payload, job.id, progress, cancelled)
    registry = db.scalar(
        select(ModelRegistry).where(
            ModelRegistry.workspace_id == job.workspace_id,
            ModelRegistry.task == dataset.task,
            ModelRegistry.name == dataset.name,
        )
    )
    if not registry:
        registry = ModelRegistry(
            workspace_id=job.workspace_id, name=dataset.name, task=dataset.task
        )
        db.add(registry)
        db.flush()
    version_number = (
        len(
            list(db.scalars(select(ModelVersion.id).where(ModelVersion.registry_id == registry.id)))
        )
        + 1
    )
    version = ModelVersion(
        workspace_id=job.workspace_id,
        registry_id=registry.id,
        dataset_id=dataset.id,
        training_job_id=job.id,
        name=f"{dataset.name} Â· v{version_number}",
        task=dataset.task,
        algorithm=job.payload["algorithm"],
        feature_schema=result["feature_schema"],
        artifact_path=result["artifact_path"],
        metadata_json={**result["metadata"], "metrics": result["metrics"]},
        active=False,
        status="inactive",
        version=version_number,
    )
    db.add(version)
    db.flush()
    for name, value in result["metrics"].items():
        db.add(
            ModelMetric(
                workspace_id=job.workspace_id,
                model_version_id=version.id,
                name=name,
                value={"value": value},
            )
        )
    training = db.scalar(select(TrainingJob).where(TrainingJob.job_id == job.id))
    if training:
        training.status = "succeeded"
        training.model_version_id = version.id
    dataset.status = "trained"
    return {
        "model_version_id": version.id,
        "metrics": result["metrics"],
        "artifact_path": version.artifact_path,
        "status": "inactive",
        "evaluation_scope": "offline_benchmark",
    }


def execute_job(job_id: str, redelivered: bool = False) -> dict:
    with SessionLocal() as db:
        job = db.scalar(select(Job).where(Job.id == job_id).with_for_update())
        if job and job.status == "running" and redelivered:
            job.status = "failed"
            job.error = "The previous worker was interrupted. Results were not declared complete; review this job and retry deliberately."
            job.finished_at = datetime.now(timezone.utc)
            training = db.scalar(select(TrainingJob).where(TrainingJob.job_id == job.id))
            if training:
                training.status = "failed"
            audit(
                db,
                job.workspace_id,
                job.user_id,
                "Interrupted job recovered",
                "An interrupted running job was marked failed instead of silently re-executed.",
                "job",
                job.id,
            )
            db.commit()
            return {"status": "failed", "error": job.error}
        if not job or job.status != "queued":
            return {"skipped": True}
        if job.cancel_requested:
            job.status = "cancelled"
            job.finished_at = datetime.now(timezone.utc)
            db.commit()
            return {"cancelled": True}
        user = db.get(User, job.user_id)
        membership = db.scalar(
            select(Membership).where(
                Membership.user_id == job.user_id, Membership.workspace_id == job.workspace_id
            )
        )
        allowed_roles = (
            {"Owner", "Admin"}
            if job.kind in {"nvd_import", "attack_import"}
            else {"Owner", "Admin", "Analyst"}
        )
        if not user or not user.is_active or not membership or membership.role not in allowed_roles:
            job.status = "failed"
            job.error = (
                "The submitting user no longer has permission to execute this workspace job."
            )
            job.finished_at = datetime.now(timezone.utc)
            db.commit()
            return {"failed": True}
        job.status = "running"
        job.started_at = datetime.now(timezone.utc)
        job.progress = 1
        db.commit()

        def cancelled():
            # Refresh only the cancel flag so pending result ORM changes stay intact.
            db.refresh(job, attribute_names=["cancel_requested"])
            return job.cancel_requested

        def progress(value: int):
            if cancelled():
                raise DataError("Job cancellation requested; stopped at a safe phase boundary.")
            job.progress = max(job.progress, min(99, int(value)))
            db.commit()
            try:
                import redis

                redis.Redis.from_url(
                    settings.redis_url, socket_connect_timeout=1, socket_timeout=1
                ).publish(
                    f"aegis:workspace:{job.workspace_id}:jobs",
                    json.dumps({"job_id": job.id, "progress": job.progress, "status": job.status}),
                )
            except Exception:
                pass  # PostgreSQL progress remains authoritative if messaging is unavailable.

        try:
            if job.kind == "ingestion":
                result = _ingest(db, job, progress)
            elif job.kind == "training":
                result = _train(db, job, progress, cancelled)
            elif job.kind == "report":
                result = _report(db, job)
            else:
                from .integrations import process_import

                result = process_import(db, job, progress)
            if cancelled():
                raise DataError("Job cancellation requested before results were committed.")
            job.result = result
            job.status = "succeeded"
            job.progress = 100
            job.finished_at = datetime.now(timezone.utc)
            audit(
                db,
                job.workspace_id,
                job.user_id,
                "Background job completed",
                f"Completed {job.kind}; results are stored in PostgreSQL.",
                "job",
                job.id,
            )
            db.add(
                Notification(
                    workspace_id=job.workspace_id,
                    title=f"{job.kind.replace('_', ' ').title()} completed",
                    detail="Open the persisted job to review its results.",
                    record_type="job",
                    record_id=job.id,
                )
            )
            db.commit()
            logger.info(json.dumps({"event": "job_succeeded", "job_id": job.id, "kind": job.kind}))
            return result
        except Exception as error:
            db.rollback()
            db.refresh(job)
            job.status = "cancelled" if job.cancel_requested else "failed"
            job.error = (
                str(error)[:500]
                if isinstance(error, DataError)
                else f"{job.kind.replace('_', ' ').title()} failed ({type(error).__name__}). Review the mapping, file availability, and service logs; raw row contents are not logged."
            )
            job.finished_at = datetime.now(timezone.utc)
            training = db.scalar(select(TrainingJob).where(TrainingJob.job_id == job.id))
            if training:
                training.status = job.status
            audit(
                db,
                job.workspace_id,
                job.user_id,
                "Background job stopped",
                f"{job.kind}: {job.status}. {job.error}",
                "job",
                job.id,
            )
            db.commit()
            logger.warning(
                json.dumps(
                    {
                        "event": "job_stopped",
                        "job_id": job.id,
                        "kind": job.kind,
                        "status": job.status,
                        "error_type": type(error).__name__,
                    }
                )
            )
            return {"status": job.status, "error": job.error}


@celery_app.task(name="aegis.execute_job", bind=True)
def queued_job(task, job_id):
    return execute_job(
        job_id, redelivered=bool((task.request.delivery_info or {}).get("redelivered"))
    )


@signals.task_failure.connect
def record_worker_failure(task_id=None, sender=None, **kwargs):
    if getattr(sender, "name", None) != "aegis.execute_job" or not task_id:
        return
    try:
        with SessionLocal() as db:
            job = db.get(Job, task_id)
            if job and job.status in {"queued", "running"}:
                job.status = "failed"
                job.finished_at = datetime.now(timezone.utc)
                job.error = "Worker execution was interrupted. Review the persisted job and retry at a safe boundary."
                training = db.scalar(select(TrainingJob).where(TrainingJob.job_id == job.id))
                if training:
                    training.status = "failed"
                audit(
                    db,
                    job.workspace_id,
                    job.user_id,
                    "Worker execution interrupted",
                    "The job was marked failed without fabricating results.",
                    "job",
                    job.id,
                )
                db.commit()
    except Exception:
        logger.warning(
            json.dumps({"event": "worker_failure_status_unavailable", "job_id": task_id})
        )
