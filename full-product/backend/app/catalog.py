"""Idempotent metadata registration for mounted raw files; never ingests or trains."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from sqlalchemy import select

from .dataset_manifest import candidates
from .db import SessionLocal
from .models import (
    AuditLog,
    DatasetFile,
    DatasetRegistry,
    Job,
    ModelVersion,
    TrainingJob,
    Workspace,
)
from .security import audit
from .storage import allowed_dataset_path, storage_root


def _metadata(entry: dict) -> dict:
    result = {
        key: entry[key]
        for key in (
            "label_candidates",
            "class_distribution",
            "duplicate_rows",
            "quality_issues",
            "potential_leakage_columns",
            "malformed_rows",
            "suspected_headerless",
            "row_count",
            "column_count",
            "duplicate_of",
        )
        if key in entry
    }
    result.update(
        {
            "catalog_source": "mounted_raw_file_metadata",
            "mapping_required": True,
            "task_assignment_required": True,
            "ingestion_completed": False,
            "checksum_source": "local_manifest_not_reverified"
            if entry.get("sha256")
            else "not_computed",
            "message": "Metadata only. Assign a task, review permissions, map columns, and explicitly ingest before training.",
        }
    )
    return result


def _untouched_catalog_dataset(db, dataset, workspace_id: str, group_paths: set[str]) -> bool:
    if not (
        dataset.workspace_id == workspace_id
        and dataset.task == "unassigned"
        and not dataset.source.strip()
        and not dataset.citation.strip()
        and dataset.license_status == "unknown"
        and not dataset.mapping
        and dataset.version is None
        and dataset.status == "registered"
        and (dataset.quality or {}).get("catalog_source") == "mounted_raw_file_metadata"
    ):
        return False
    for model in (Job, ModelVersion, TrainingJob):
        if db.scalar(select(model.id).where(model.dataset_id == dataset.id).limit(1)):
            return False
    if db.scalar(
        select(AuditLog.id)
        .where(
            AuditLog.workspace_id == workspace_id,
            AuditLog.record_type == "dataset",
            AuditLog.record_id == dataset.id,
            AuditLog.action == "Dataset metadata updated",
        )
        .limit(1)
    ):
        return False
    files = list(
        db.scalars(
            select(DatasetFile).where(
                DatasetFile.workspace_id == workspace_id, DatasetFile.dataset_id == dataset.id
            )
        )
    )
    return (
        bool(files)
        and dataset.name in {Path(file.path).stem[:250] for file in files}
        and all(file.path in group_paths and file.status == "registered" for file in files)
    )


def register_detected(db, workspace_id: str, user_id: str | None) -> dict:
    """Copy metadata only; verified checksum aliases share a registry record."""
    workspace = db.scalar(select(Workspace).where(Workspace.id == workspace_id).with_for_update())
    if not workspace:
        raise ValueError("Workspace does not exist.")
    private_uploads = (storage_root() / "uploads").resolve()
    groups: dict[tuple[str, str], list[dict]] = {}
    for entry in candidates():
        path = allowed_dataset_path(entry["path"])
        if path.is_relative_to(private_uploads) or not entry.get("schema"):
            continue
        entry = {**entry, "path": str(path)}
        key = ("sha256", entry["sha256"]) if entry.get("sha256") else ("path", str(path))
        groups.setdefault(key, []).append(entry)
    existing_files = {
        file.path: file
        for file in db.scalars(select(DatasetFile).where(DatasetFile.workspace_id == workspace_id))
    }
    registered, merged = [], []
    skipped = aliases_registered = 0
    for key, entries in groups.items():
        entries.sort(key=lambda entry: (bool(entry.get("duplicate_of")), entry["path"]))
        canonical_entry = entries[0]
        canonical_path = canonical_entry["path"]
        group_paths = {entry["path"] for entry in entries}
        canonical_file = existing_files.get(canonical_path) or next(
            (existing_files[entry["path"]] for entry in entries if entry["path"] in existing_files),
            None,
        )
        dataset = db.get(DatasetRegistry, canonical_file.dataset_id) if canonical_file else None
        if dataset is None:
            dataset = DatasetRegistry(
                workspace_id=workspace_id,
                name=Path(canonical_entry.get("name", canonical_path)).stem[:250],
                task="unassigned",
                source="",
                version=None,
                license_status="unknown",
                citation="",
                mapping={},
                quality=_metadata(canonical_entry),
                status="registered",
            )
            db.add(dataset)
            db.flush()
            registered.append(dataset.id)
        dataset.quality = {
            **(dataset.quality or {}),
            "canonical_path": canonical_path,
            "file_locations": sorted(group_paths),
        }
        if key[0] == "sha256":
            dataset.quality = {**dataset.quality, "content_sha256": key[1]}
        for entry in entries:
            path = entry["path"]
            file = existing_files.get(path)
            metadata = _metadata(entry)
            if path != canonical_path:
                metadata.update(
                    {"duplicate_of": canonical_path, "canonical_dataset_id": dataset.id}
                )
            if file:
                skipped += 1
                if file.dataset_id != dataset.id:
                    duplicate = db.get(DatasetRegistry, file.dataset_id)
                    if duplicate and _untouched_catalog_dataset(
                        db, duplicate, workspace_id, group_paths
                    ):
                        duplicate_id = duplicate.id
                        for duplicate_file in db.scalars(
                            select(DatasetFile).where(
                                DatasetFile.workspace_id == workspace_id,
                                DatasetFile.dataset_id == duplicate_id,
                            )
                        ):
                            duplicate_file.dataset_id = dataset.id
                            duplicate_file.stats = {
                                **(duplicate_file.stats or {}),
                                "duplicate_of": canonical_path,
                                "canonical_dataset_id": dataset.id,
                            }
                        db.flush()
                        db.delete(duplicate)
                        db.flush()
                        merged.append(duplicate_id)
                    elif duplicate:
                        # A human edit, job or model makes this a distinct user record.
                        duplicate.quality = {
                            **(duplicate.quality or {}),
                            "duplicate_of_dataset_id": dataset.id,
                            "duplicate_of": canonical_path,
                        }
                file.stats = {
                    **(file.stats or {}),
                    **{
                        name: value
                        for name, value in metadata.items()
                        if name in {"duplicate_of", "canonical_dataset_id"}
                    },
                }
                continue
            file = DatasetFile(
                workspace_id=workspace_id,
                dataset_id=dataset.id,
                path=path,
                checksum=entry.get("sha256"),
                size_bytes=entry["size_bytes"],
                schema_json=entry["schema"],
                row_count=entry.get("row_count"),
                stats=metadata,
                status="registered",
                format=entry.get("format", Path(path).suffix[1:]),
            )
            db.add(file)
            existing_files[path] = file
            aliases_registered += int(path != canonical_path)
        db.flush()
    if registered or merged or aliases_registered:
        audit(
            db,
            workspace_id,
            user_id,
            "Dataset catalog synchronized",
            f"Registered {len(registered)} distinct dataset metadata records; linked {aliases_registered} alternate file locations; consolidated {len(merged)} untouched duplicate catalog records. Raw files unchanged; no ingestion or training ran.",
            "dataset_catalog",
        )
    db.flush()
    return {
        "registered": len(registered),
        "existing": skipped,
        "dataset_ids": registered,
        "aliases_registered": aliases_registered,
        "duplicate_records_merged": len(merged),
        "metadata_only": True,
        "ingestion_started": False,
        "training_started": False,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Synchronize mounted dataset metadata into existing workspaces."
    )
    parser.add_argument("--sync-existing", action="store_true", required=True)
    args = parser.parse_args()
    if not args.sync_existing:
        return
    totals = {
        "workspaces": 0,
        "registered": 0,
        "existing": 0,
        "duplicate_records_merged": 0,
        "metadata_only": True,
    }
    with SessionLocal() as db:
        workspace_ids = list(db.scalars(select(Workspace.id).order_by(Workspace.id)))
        for workspace_id in workspace_ids:
            # This explicit administrator-run repair is a system action, not an
            # action attributed to an arbitrary logged-in workspace member.
            result = register_detected(db, workspace_id, None)
            db.commit()
            totals["workspaces"] += 1
            totals["registered"] += result["registered"]
            totals["existing"] += result["existing"]
            totals["duplicate_records_merged"] += result["duplicate_records_merged"]
    print(json.dumps(totals))


if __name__ == "__main__":
    main()
