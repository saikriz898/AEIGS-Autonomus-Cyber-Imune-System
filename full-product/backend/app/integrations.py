from datetime import datetime
import os
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session
from .db import get_db
from . import models as m
from .security import current_user, require_workspace, ensure_csrf, audit
from .threat_adapters import (
    NVDAdapter,
    read_attack_bundle,
    IntegrationUnavailable,
    IntegrationRateLimited,
)
from .storage import DataError, allowed_dataset_path

router = APIRouter(prefix="/api/workspaces/{workspace_id}/integrations", tags=["Integrations"])


class EnrichCVE(BaseModel):
    cve_id: str = Field(pattern=r"^CVE-\d{4}-\d{4,9}$")
    idempotency_key: str | None = Field(default=None, max_length=120)


class ImportSTIX(BaseModel):
    path: str = Field(min_length=1, max_length=1000)
    source: str = Field(min_length=3, max_length=250)
    version: str = Field(min_length=1, max_length=100)
    idempotency_key: str | None = Field(default=None, max_length=120)


@router.get("")
def statuses(workspace_id: str, db: Session = Depends(get_db), user=Depends(current_user)):
    require_workspace(db, user, workspace_id)
    enabled = os.getenv("INTEGRATION_NETWORK_ENABLED", "false").lower() == "true"
    return {
        "network_enabled": enabled,
        "integrations": [
            {
                "id": "nvd",
                "name": "NVD vulnerability enrichment",
                "status": "configured" if enabled else "disabled",
                "reason": "Explicit CVE-only enrichment available; asset applicability is never inferred."
                if enabled
                else "External enrichment is disabled. Enable it intentionally in the backend environment.",
                "api_key_configured": bool(os.getenv("NVD_API_KEY")),
                "rate_limit": "1 request/second with API key; 1 request/6 seconds without key, coordinated through Redis.",
                "live_verified": False,
            },
            {
                "id": "attack",
                "name": "MITRE ATT&CK STIX",
                "status": "local_import_available",
                "reason": "Import an explicitly selected local STIX JSON bundle with source and version. No bundled or automatically downloaded live feed.",
            },
            {
                "id": "discovery",
                "name": "Authorized telemetry / discovery",
                "status": "unavailable",
                "reason": "No real discovery connector is implemented. Scope text never initiates a scan.",
            },
            {
                "id": "executor",
                "name": "Infrastructure change executor",
                "status": "unavailable",
                "reason": "Guardian Gate records decisions only. No infrastructure action adapter exists.",
            },
        ],
    }


@router.post("/nvd", dependencies=[Depends(ensure_csrf)], status_code=202)
def enrich(
    workspace_id: str, body: EnrichCVE, db: Session = Depends(get_db), user=Depends(current_user)
):
    require_workspace(db, user, workspace_id, ["Owner", "Admin"])
    if os.getenv("INTEGRATION_NETWORK_ENABLED", "false").lower() != "true":
        raise HTTPException(
            409, "NVD enrichment is disabled by backend configuration. No request was made."
        )
    from .jobs import submit_job

    job = submit_job(
        db, workspace_id, user.id, "nvd_import", {"cve_id": body.cve_id}, body.idempotency_key
    )
    return m.serialize(job)


@router.post("/attack", dependencies=[Depends(ensure_csrf)], status_code=202)
def import_stix(
    workspace_id: str, body: ImportSTIX, db: Session = Depends(get_db), user=Depends(current_user)
):
    require_workspace(db, user, workspace_id, ["Owner", "Admin"])
    from .jobs import submit_job

    job = submit_job(
        db,
        workspace_id,
        user.id,
        "attack_import",
        body.model_dump(exclude={"idempotency_key"}),
        body.idempotency_key,
    )
    return m.serialize(job)


def process_import(db: Session, job, progress):
    parameters = job.payload
    progress(10)
    if job.kind == "nvd_import":
        try:
            data = NVDAdapter().fetch(parameters["cve_id"])
        except (IntegrationUnavailable, IntegrationRateLimited) as error:
            raise DataError(str(error)) from None
        existing = db.scalar(
            select(m.Vulnerability).where(
                m.Vulnerability.workspace_id == job.workspace_id,
                m.Vulnerability.cve == data["external_id"],
            )
        )
        if not existing:
            existing = m.Vulnerability(
                workspace_id=job.workspace_id,
                cve=data["external_id"],
                title=data["name"],
                description=data["description"],
                source=data["source"],
            )
            db.add(existing)
        existing.description = data["description"]
        existing.cvss = data["base_score"]
        existing.source = data["source"]
        existing.metadata_json = data
        existing.retrieved_at = datetime.fromisoformat(data["retrieved_at"])
        db.flush()
        progress(90)
        audit(
            db,
            job.workspace_id,
            job.user_id,
            "NVD context imported",
            "Retrieved CVE context from the configured NVD service. Asset applicability was not verified.",
            "vulnerability",
            existing.id,
        )
        return {
            "vulnerability_id": existing.id,
            "source": data["source"],
            "retrieved_at": data["retrieved_at"],
            "applicability": "unverified",
        }
    if job.kind == "attack_import":
        try:
            allowed_dataset_path(parameters["path"], workspace_id=job.workspace_id)
            records = read_attack_bundle(
                parameters["path"], parameters["source"], parameters["version"]
            )
        except (ValueError, OSError):
            raise DataError(
                "The local ATT&CK import could not be validated. Use a readable STIX JSON bundle inside the configured roots and record its source/version."
            ) from None
        for index, data in enumerate(records):
            existing = db.scalar(
                select(m.ThreatIntelligenceRecord).where(
                    m.ThreatIntelligenceRecord.workspace_id == job.workspace_id,
                    m.ThreatIntelligenceRecord.technique == data["external_id"],
                    m.ThreatIntelligenceRecord.source == data["source"],
                )
            )
            if not existing:
                existing = m.ThreatIntelligenceRecord(
                    workspace_id=job.workspace_id,
                    name=data["name"],
                    source=data["source"],
                    technique=data["external_id"],
                )
                db.add(existing)
            existing.name = data["name"]
            existing.version = data["version"]
            existing.payload = data
            if index % 100 == 0:
                progress(10 + int(75 * index / len(records)))
        db.flush()
        progress(90)
        audit(
            db,
            job.workspace_id,
            job.user_id,
            "ATT&CK bundle imported",
            f"Imported {len(records)} active technique records from a local, explicitly selected STIX file.",
            "job",
            job.id,
        )
        return {
            "records_imported": len(records),
            "source": parameters["source"],
            "version": parameters["version"],
        }
    raise IntegrationUnavailable("Unsupported integration import kind.")
