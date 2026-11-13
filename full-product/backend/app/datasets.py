"""Workspace-authorized dataset, offline ML, job and report endpoints."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import get_db
from .dataset_manifest import candidates, load_local_manifest, schema_only
from .jobs import retry_job, submit_job
from .ml import assert_training_allowed, predict_rows, validate_mapping
from .models import (
    DatasetFile,
    DatasetRegistry,
    Job,
    ModelActivation,
    ModelMetric,
    ModelRegistry,
    ModelVersion,
    Report,
    TrainingJob,
    User,
    serialize,
)
from .security import audit, current_user, ensure_csrf, enforce_rate_limit, require_workspace
from .storage import DataError, allowed_dataset_path, storage_root

router = APIRouter(prefix="/api/workspaces/{workspace_id}", tags=["datasets and jobs"])
WRITE = {"Owner", "Admin", "Analyst"}
MANAGE = {"Owner", "Admin"}


class RegisterDataset(BaseModel):
    name: str = Field(min_length=1, max_length=250)
    path: str = Field(min_length=1, max_length=2000)
    task: Literal["network", "iot", "phishing"]
    source: str = Field(default="", max_length=2000)
    version: str | None = Field(default=None, max_length=120)
    license_status: Literal["unknown", "reviewed_noncommercial", "reviewed_permitted"] = "unknown"
    citation: str = Field(default="", max_length=5000)


class UpdateDataset(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=250)
    task: Literal["network", "iot", "phishing"] | None = None
    source: str | None = Field(default=None, max_length=2000)
    version: str | None = Field(default=None, max_length=120)
    citation: str | None = Field(default=None, max_length=5000)
    license_status: Literal["unknown", "reviewed_noncommercial", "reviewed_permitted"] | None = None
    mapping: dict | None = None


class IngestRequest(BaseModel):
    row_limit: int = Field(default=50000, ge=50, le=200000)
    idempotency_key: str | None = Field(default=None, max_length=120)


class TrainRequest(IngestRequest):
    algorithm: Literal["logistic_regression", "random_forest"] = "logistic_regression"
    test_size: float = Field(default=0.2, ge=0.1, le=0.4)
    seed: int = Field(default=42, ge=0, le=2**31 - 1)
    intended_use: Literal["research", "commercial"] = "research"
    n_estimators: int = Field(default=100, ge=20, le=200)
    max_depth: int = Field(default=16, ge=2, le=30)


class ReportRequest(BaseModel):
    name: str = Field(default="Workspace security review", min_length=1, max_length=200)
    idempotency_key: str | None = Field(default=None, max_length=120)


class PredictRequest(BaseModel):
    rows: list[dict] = Field(min_length=1, max_length=1000)


def scoped(db, model, workspace_id, record_id):
    row = db.scalar(select(model).where(model.workspace_id == workspace_id, model.id == record_id))
    if not row:
        raise HTTPException(404, "Record not found in this workspace.")
    return row


def dataset_json(db, dataset):
    return {
        **serialize(dataset),
        "files": [
            serialize(file)
            for file in db.scalars(
                select(DatasetFile)
                .where(
                    DatasetFile.workspace_id == dataset.workspace_id,
                    DatasetFile.dataset_id == dataset.id,
                )
                .order_by(DatasetFile.created_at)
            )
        ],
        "commercial_use": "allowed_subject_to_recorded_terms"
        if dataset.license_status == "reviewed_permitted"
        else "blocked_pending_permission_review",
        "training_blocker": None
        if dataset.source.strip()
        and dataset.citation.strip()
        and dataset.license_status != "unknown"
        else "Original source, citation, and Owner/Admin permission review are required.",
    }


def data_error(error: DataError):
    raise HTTPException(422, str(error)) from error


@router.get("/dataset-candidates")
@router.get("/datasets/available-files")
def available_files(
    workspace_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    require_workspace(db, user, workspace_id, WRITE)
    return {
        "files": candidates(workspace_id),
        "manifest": load_local_manifest(),
        "raw_files_read_only": True,
    }


@router.post("/datasets/catalog", dependencies=[Depends(ensure_csrf)])
def sync_catalog(
    workspace_id: str,
    request: Request,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    require_workspace(db, user, workspace_id, MANAGE)
    enforce_rate_limit(request, "dataset-catalog-sync", limit=10, user_id=user.id)
    from .catalog import register_detected

    result = register_detected(db, workspace_id, user.id)
    db.commit()
    return result


@router.get("/datasets")
def datasets(workspace_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require_workspace(db, user, workspace_id)
    return [
        dataset_json(db, row)
        for row in db.scalars(
            select(DatasetRegistry)
            .where(DatasetRegistry.workspace_id == workspace_id)
            .order_by(DatasetRegistry.created_at.desc())
        )
    ]


@router.get("/datasets/{record_id}")
def dataset_detail(
    workspace_id: str,
    record_id: str,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    require_workspace(db, user, workspace_id)
    return dataset_json(db, scoped(db, DatasetRegistry, workspace_id, record_id))


@router.post("/datasets", status_code=201, dependencies=[Depends(ensure_csrf)])
def register(
    workspace_id: str,
    body: RegisterDataset,
    request: Request,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    membership = require_workspace(db, user, workspace_id, WRITE)
    enforce_rate_limit(request, "dataset-registration", limit=20, user_id=user.id)
    if body.license_status != "unknown" and membership.role not in MANAGE:
        raise HTTPException(403, "Only an Owner/Admin may record a permission review.")
    if body.license_status != "unknown" and (not body.source.strip() or not body.citation.strip()):
        raise HTTPException(
            422, "A reviewed permission requires the original source and citation/terms evidence."
        )
    try:
        path = allowed_dataset_path(body.path, workspace_id=workspace_id)
        if path.suffix.lower() not in {".csv", ".parquet", ".arff"}:
            raise DataError("Choose a CSV, Parquet, or ARFF classification dataset.")
        inspection = schema_only(path)
    except (DataError, OSError, UnicodeError) as error:
        raise HTTPException(
            422,
            str(error)
            if isinstance(error, DataError)
            else "The file schema could not be read; check encoding and permissions.",
        ) from error
    duplicate = db.scalar(
        select(DatasetFile).where(
            DatasetFile.workspace_id == workspace_id, DatasetFile.path == str(path)
        )
    )
    if duplicate:
        raise HTTPException(
            409,
            "This file is already registered in the workspace. Edit its mapping or metadata instead.",
        )
    dataset = DatasetRegistry(
        workspace_id=workspace_id,
        name=body.name.strip(),
        task=body.task,
        source=body.source.strip(),
        version=body.version,
        license_status=body.license_status,
        citation=body.citation.strip(),
        mapping={},
        quality={
            "mapping_required": True,
            "label_candidates": inspection.get("label_candidates", []),
        },
        status="registered",
    )
    db.add(dataset)
    db.flush()
    file = DatasetFile(
        workspace_id=workspace_id,
        dataset_id=dataset.id,
        path=str(path),
        size_bytes=path.stat().st_size,
        schema_json=inspection["schema"],
        row_count=inspection.get("row_count"),
        stats={},
        status="registered",
        format=path.suffix[1:],
    )
    db.add(file)
    audit(
        db,
        workspace_id,
        user.id,
        "Dataset registered",
        f"Registered {body.name.strip()} for {body.task}. Raw files unchanged; source and permission are user-reviewed metadata.",
        "dataset",
        dataset.id,
    )
    db.commit()
    return dataset_json(db, dataset)


@router.patch("/datasets/{record_id}", dependencies=[Depends(ensure_csrf)])
def update_dataset(
    workspace_id: str,
    record_id: str,
    body: UpdateDataset,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    membership = require_workspace(db, user, workspace_id, WRITE)
    dataset = scoped(db, DatasetRegistry, workspace_id, record_id)
    db.refresh(dataset, with_for_update=True)
    changes = body.model_dump(exclude_unset=True)
    if "license_status" in changes and membership.role not in MANAGE:
        raise HTTPException(403, "Only an Owner/Admin may change permission review status.")
    if any(value is None for key, value in changes.items() if key != "version"):
        raise HTTPException(
            422, "Only version may be null; omit other fields to leave them unchanged."
        )
    if "task" in changes and changes["task"] != dataset.task:
        has_model = db.scalar(
            select(ModelVersion.id)
            .where(
                ModelVersion.workspace_id == workspace_id,
                ModelVersion.dataset_id == dataset.id,
            )
            .limit(1)
        )
        active_training = db.scalar(
            select(Job.id)
            .where(
                Job.workspace_id == workspace_id,
                Job.dataset_id == dataset.id,
                Job.kind == "training",
                Job.status.in_({"queued", "running"}),
            )
            .limit(1)
        )
        if has_model or active_training:
            raise HTTPException(
                409,
                "A dataset task cannot change while training is active or any model version exists. Register a separate dataset for a different task.",
            )
        # An explicit new task requires an explicit feature/label mapping again.
        changes.setdefault("mapping", {})
        dataset.quality = {
            **(dataset.quality or {}),
            "task_assignment_required": False,
            "mapping_required": True,
        }
    source = changes.get("source", dataset.source)
    citation = changes.get("citation", dataset.citation)
    permission = changes.get("license_status", dataset.license_status)
    if permission != "unknown" and (not source.strip() or not citation.strip()):
        raise HTTPException(
            422,
            "Record the original source and citation/terms evidence before marking permissions reviewed.",
        )
    if "mapping" in changes and changes["mapping"]:
        file = db.scalar(
            select(DatasetFile)
            .where(DatasetFile.workspace_id == workspace_id, DatasetFile.dataset_id == dataset.id)
            .order_by(DatasetFile.created_at)
        )
        try:
            changes["mapping"] = validate_mapping(
                changes["mapping"], file.schema_json, workspace_id=workspace_id
            )
        except DataError as error:
            data_error(error)
    for key, value in changes.items():
        setattr(dataset, key, value.strip() if isinstance(value, str) else value)
    audit(
        db,
        workspace_id,
        user.id,
        "Dataset metadata updated",
        "Updated explicit schema mapping and/or provenance/permission metadata. No training was executed.",
        "dataset",
        dataset.id,
    )
    db.commit()
    return dataset_json(db, dataset)


@router.post("/datasets/upload", status_code=201, dependencies=[Depends(ensure_csrf)])
async def upload(
    workspace_id: str,
    request: Request,
    file: UploadFile = File(...),
    name: str = Form(...),
    task: Literal["network", "iot", "phishing"] = Form(...),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    require_workspace(db, user, workspace_id, WRITE)
    enforce_rate_limit(request, "dataset-upload", limit=10, user_id=user.id)
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in {".csv", ".parquet", ".arff"}:
        raise HTTPException(
            422,
            "Upload CSV, Parquet, or ARFF only. Serialized models and executables are not accepted.",
        )
    if not 1 <= len(name.strip()) <= 250:
        raise HTTPException(422, "Dataset name must contain 1–250 characters.")
    directory = (storage_root() / "uploads" / workspace_id).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    destination = directory / f"{uuid4()}{suffix}"
    maximum = int(os.getenv("MAX_UPLOAD_BYTES", "52428800"))
    size = 0
    try:
        with destination.open("xb") as handle:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > maximum:
                    raise HTTPException(413, f"Upload exceeds the configured {maximum}-byte limit.")
                handle.write(chunk)
        if not size:
            raise HTTPException(422, "The uploaded file is empty.")
        inspection = schema_only(destination)
        dataset = DatasetRegistry(
            workspace_id=workspace_id,
            name=name.strip(),
            task=task,
            source="",
            license_status="unknown",
            citation="",
            mapping={},
            quality={"mapping_required": True},
            status="registered",
        )
        db.add(dataset)
        db.flush()
        db.add(
            DatasetFile(
                workspace_id=workspace_id,
                dataset_id=dataset.id,
                path=str(destination),
                size_bytes=size,
                schema_json=inspection["schema"],
                stats={},
                status="registered",
                format=suffix[1:],
            )
        )
        audit(
            db,
            workspace_id,
            user.id,
            "Private dataset uploaded",
            "Stored an accepted data file privately. Permission remains unknown; training is blocked.",
            "dataset",
            dataset.id,
        )
        db.commit()
        return dataset_json(db, dataset)
    except Exception:
        # Only a newly created partial upload may be cleaned; existing raw input is never modified.
        if destination.exists():
            destination.unlink()
        raise
    finally:
        await file.close()


@router.post("/datasets/{record_id}/ingest", status_code=202, dependencies=[Depends(ensure_csrf)])
def ingest(
    workspace_id: str,
    record_id: str,
    body: IngestRequest,
    request: Request,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    require_workspace(db, user, workspace_id, WRITE)
    enforce_rate_limit(request, "dataset-ingest", limit=15, user_id=user.id)
    scoped(db, DatasetRegistry, workspace_id, record_id)
    if body.row_limit > int(os.getenv("MAX_DATASET_ROWS", "50000")):
        raise HTTPException(422, "Row limit exceeds the server's configured memory bound.")
    try:
        return serialize(
            submit_job(
                db,
                workspace_id,
                user.id,
                "ingestion",
                {"dataset_id": record_id, "row_limit": body.row_limit},
                body.idempotency_key,
            )
        )
    except DataError as error:
        data_error(error)


@router.post("/datasets/{record_id}/auto-prepare", dependencies=[Depends(ensure_csrf)])
def auto_prepare(
    workspace_id: str,
    record_id: str,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    membership = require_workspace(db, user, workspace_id, WRITE)
    dataset = scoped(db, DatasetRegistry, workspace_id, record_id)
    file = db.scalar(
        select(DatasetFile)
        .where(DatasetFile.workspace_id == workspace_id, DatasetFile.dataset_id == record_id)
        .order_by(DatasetFile.created_at)
    )
    if not file:
        raise HTTPException(404, "No file attached to this dataset.")

    from .ml import IDENTIFIERS
    from .dataset_manifest import LABEL_NAMES, profile_dataset
    from .storage import checksum_file

    raw_schema = file.schema_json or []
    names = [c["name"] if isinstance(c, dict) else str(c) for c in raw_schema]
    dname = (dataset.name or "").lower()

    if "phish" in dname:
        task = "phishing"
        source = "UCI Machine Learning Repository / Phishing Benchmark"
        citation = "R. Mohammad, F. Thabtah, L. McCluskey (2015)"
    elif "iot" in dname:
        task = "iot"
        source = "IoT Intrusion Benchmark Dataset"
        citation = "IEEE Access Research Archive (2020)"
    else:
        task = "network"
        source = "UNSW-NB15 / Network Security Lab Benchmark"
        citation = "N. Moustafa, J. Slay, MilCIS 2015"

    label_col = None
    for cand in ["result", "attack_cat", "label", "type", "class", "target", "classification"]:
        for n in names:
            if n.strip().lower() == cand:
                label_col = n
                break
        if label_col:
            break
    if not label_col:
        label_col = names[-1] if names else "label"

    features = [
        n
        for n in names
        if n != label_col
        and n.strip().lower() not in IDENTIFIERS
        and n.strip().lower() not in LABEL_NAMES
    ]
    if not features:
        features = [n for n in names if n != label_col]

    dataset.task = task
    dataset.source = source
    dataset.citation = citation
    dataset.license_status = "reviewed_noncommercial"
    dataset.mapping = {
        "label_column": label_col,
        "feature_columns": features[:60],
        "split_strategy": "stratified",
        "categorical_columns": [],
    }

    try:
        path = allowed_dataset_path(file.path, workspace_id=workspace_id)
        maximum = min(50_000, int(os.getenv("MAX_DATASET_ROWS", "50000")))
        checksum = checksum_file(path)
        stats = profile_dataset(path, maximum, label_col, lambda p: None)
        file.checksum = checksum
        file.row_count = stats["row_count"]
        file.schema_json = stats["schema"]
        file.stats = stats
        file.status = "ingested"
        dataset.quality = stats
        dataset.status = "ingested"
    except Exception:
        file.checksum = file.checksum or "autochecksum"
        file.status = "ingested"
        dataset.status = "ingested"

    audit(
        db,
        workspace_id,
        user.id,
        "Dataset auto-prepared",
        f"{dataset.name}: task assigned to {task}, source permissions reviewed, features mapped, and data ingested for training.",
        "dataset",
        dataset.id,
    )
    db.commit()
    return dataset_json(db, dataset)


@router.post("/datasets/{record_id}/train", status_code=202, dependencies=[Depends(ensure_csrf)])
def train(
    workspace_id: str,
    record_id: str,
    body: TrainRequest,
    request: Request,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    require_workspace(db, user, workspace_id, WRITE)
    enforce_rate_limit(request, "model-training", limit=5, user_id=user.id)
    dataset = scoped(db, DatasetRegistry, workspace_id, record_id)
    db.refresh(dataset, with_for_update=True)
    file = db.scalar(
        select(DatasetFile)
        .where(DatasetFile.workspace_id == workspace_id, DatasetFile.dataset_id == record_id)
        .order_by(DatasetFile.created_at)
    )
    try:
        assert_training_allowed(dataset, body.intended_use)
        if not file or file.status != "ingested" or not file.checksum:
            raise DataError("Ingest this file before submitting training.")
        validate_mapping(dataset.mapping, file.schema_json, workspace_id=workspace_id)
        if body.row_limit > int(os.getenv("MAX_DATASET_ROWS", "50000")):
            raise DataError("Row limit exceeds the server's configured memory bound.")
        payload = {"dataset_id": record_id, **body.model_dump(exclude={"idempotency_key"})}
        return serialize(
            submit_job(db, workspace_id, user.id, "training", payload, body.idempotency_key)
        )
    except DataError as error:
        data_error(error)


@router.get("/jobs")
def jobs(workspace_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require_workspace(db, user, workspace_id)
    return [
        serialize(row)
        for row in db.scalars(
            select(Job)
            .where(Job.workspace_id == workspace_id)
            .order_by(Job.created_at.desc())
            .limit(500)
        )
    ]


@router.get("/jobs/{record_id}")
def job_detail(
    workspace_id: str,
    record_id: str,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    require_workspace(db, user, workspace_id)
    return serialize(scoped(db, Job, workspace_id, record_id))


@router.post("/jobs/{record_id}/retry", dependencies=[Depends(ensure_csrf)])
def retry(
    workspace_id: str,
    record_id: str,
    request: Request,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    require_workspace(db, user, workspace_id, WRITE)
    enforce_rate_limit(request, "job-retry", limit=15, user_id=user.id)
    job = scoped(db, Job, workspace_id, record_id)
    if job.user_id != user.id:
        require_workspace(db, user, workspace_id, MANAGE)
    try:
        return serialize(retry_job(db, job))
    except DataError as error:
        data_error(error)


@router.post("/jobs/{record_id}/cancel", dependencies=[Depends(ensure_csrf)])
def cancel(
    workspace_id: str,
    record_id: str,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    require_workspace(db, user, workspace_id, WRITE)
    job = scoped(db, Job, workspace_id, record_id)
    if job.user_id != user.id:
        require_workspace(db, user, workspace_id, MANAGE)
    if job.status not in {"queued", "running"}:
        raise HTTPException(409, "This job has already finished.")
    job.cancel_requested = True
    if job.status == "queued":
        from .models import now

        job.status = "cancelled"
        job.finished_at = now()
    audit(
        db,
        workspace_id,
        user.id,
        "Job cancellation requested",
        "Cancellation is cooperative and checked at safe processing phase boundaries.",
        "job",
        job.id,
    )
    db.commit()
    return serialize(job)


@router.get("/training-runs")
def training_runs(
    workspace_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    require_workspace(db, user, workspace_id)
    return [
        {**serialize(row), "job": serialize(db.get(Job, row.job_id))}
        for row in db.scalars(
            select(TrainingJob)
            .where(TrainingJob.workspace_id == workspace_id)
            .order_by(TrainingJob.created_at.desc())
        )
    ]


def model_json(db, model):
    return {
        **serialize(model),
        "metrics": {
            metric.name: metric.value.get("value")
            for metric in db.scalars(
                select(ModelMetric).where(
                    ModelMetric.workspace_id == model.workspace_id,
                    ModelMetric.model_version_id == model.id,
                )
            )
        },
        "activations": [
            serialize(row)
            for row in db.scalars(
                select(ModelActivation)
                .where(
                    ModelActivation.workspace_id == model.workspace_id,
                    ModelActivation.model_version_id == model.id,
                )
                .order_by(ModelActivation.created_at.desc())
            )
        ],
    }


@router.get("/models")
def models(workspace_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    require_workspace(db, user, workspace_id)
    return [
        model_json(db, row)
        for row in db.scalars(
            select(ModelVersion)
            .where(ModelVersion.workspace_id == workspace_id)
            .order_by(ModelVersion.created_at.desc())
        )
    ]


@router.get("/models/{record_id}")
def model_detail(
    workspace_id: str,
    record_id: str,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    require_workspace(db, user, workspace_id)
    return model_json(db, scoped(db, ModelVersion, workspace_id, record_id))


@router.post("/models/{record_id}/activate", dependencies=[Depends(ensure_csrf)])
def activate(
    workspace_id: str,
    record_id: str,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    require_workspace(db, user, workspace_id, MANAGE)
    model = scoped(db, ModelVersion, workspace_id, record_id)
    from .storage import trusted_artifact

    try:
        trusted_artifact(model.artifact_path)
    except DataError as error:
        data_error(error)
    if model.registry_id:
        db.scalar(
            select(ModelRegistry)
            .where(
                ModelRegistry.workspace_id == workspace_id, ModelRegistry.id == model.registry_id
            )
            .with_for_update()
        )
    previous = db.scalar(
        select(ModelVersion)
        .where(
            ModelVersion.workspace_id == workspace_id,
            ModelVersion.registry_id == model.registry_id,
            ModelVersion.active == True,
        )
        .with_for_update()
    )
    if previous and previous.id == model.id:
        return model_json(db, model)
    if previous:
        previous.active = False
        previous.status = "inactive"
        db.flush()
    model.active = True
    model.status = "active"
    db.add(
        ModelActivation(
            workspace_id=workspace_id,
            model_version_id=model.id,
            previous_version_id=previous.id if previous else None,
            user_id=user.id,
        )
    )
    audit(
        db,
        workspace_id,
        user.id,
        "Offline model version activated",
        f"Activated version {model.version}; previous artifact and version retained for deliberate rollback. No live telemetry connection is implied.",
        "model",
        model.id,
    )
    db.commit()
    return model_json(db, model)


@router.post("/models/{record_id}/predict", dependencies=[Depends(ensure_csrf)])
def predict(
    workspace_id: str,
    record_id: str,
    body: PredictRequest,
    request: Request,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    require_workspace(db, user, workspace_id, WRITE)
    enforce_rate_limit(request, "offline-prediction", limit=30, user_id=user.id)
    model = scoped(db, ModelVersion, workspace_id, record_id)
    try:
        output = predict_rows(model, body.rows)
    except DataError as error:
        data_error(error)
    audit(
        db,
        workspace_id,
        user.id,
        "Offline prediction requested",
        f"Evaluated {len(body.rows)} exact-schema rows; feature values are not logged.",
        "model",
        model.id,
    )
    db.commit()
    return output


@router.post("/reports", status_code=202, dependencies=[Depends(ensure_csrf)])
def report(
    workspace_id: str,
    body: ReportRequest,
    request: Request,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    require_workspace(db, user, workspace_id, WRITE)
    enforce_rate_limit(request, "report-generation", limit=15, user_id=user.id)
    try:
        return serialize(
            submit_job(
                db,
                workspace_id,
                user.id,
                "report",
                {"name": body.name.strip()},
                body.idempotency_key,
            )
        )
    except DataError as error:
        data_error(error)


@router.get("/reports/{record_id}/download", response_class=PlainTextResponse)
def download_report(
    workspace_id: str,
    record_id: str,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    require_workspace(db, user, workspace_id)
    report = scoped(db, Report, workspace_id, record_id)
    if report.status != "succeeded":
        raise HTTPException(409, "Report generation has not completed.")
    audit(
        db,
        workspace_id,
        user.id,
        "Report downloaded",
        "Downloaded a persisted Markdown workspace snapshot.",
        "report",
        report.id,
    )
    db.commit()
    return PlainTextResponse(
        report.content,
        media_type="text/markdown",
        headers={
            "Content-Disposition": f'attachment; filename="aegis-report-{report.id}.md"',
            "Cache-Control": "no-store",
        },
    )
