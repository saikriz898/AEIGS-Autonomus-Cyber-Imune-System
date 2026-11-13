"""Private local storage boundary. Raw input files are opened read-only."""

from __future__ import annotations

import hashlib
import os
from pathlib import Path


class DataError(ValueError):
    """An actionable error whose message contains no raw dataset rows."""


def storage_root() -> Path:
    root = Path(os.getenv("STORAGE_ROOT", "/storage")).resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def dataset_roots() -> list[Path]:
    configured = os.getenv(
        "DATASET_ROOTS", "/datasets/unsw,/datasets/iot,/datasets/ton,/datasets/phishing"
    )
    roots = [Path(item.strip()).resolve() for item in configured.split(",") if item.strip()]
    roots.append((storage_root() / "uploads").resolve())
    return roots


def allowed_dataset_path(
    value: str, *, must_exist: bool = True, workspace_id: str | None = None
) -> Path:
    path = Path(value).resolve()
    uploads = (storage_root() / "uploads").resolve()
    if path.is_relative_to(uploads):
        if (
            not workspace_id
            or Path(workspace_id).name != workspace_id
            or not path.is_relative_to(uploads / workspace_id)
        ):
            raise DataError("Private uploaded files belong to their owning workspace only.")
    if not any(path.is_relative_to(root) for root in dataset_roots()):
        raise DataError(
            "File must be inside a configured read-only dataset root or private upload storage."
        )
    if path.suffix.lower() not in {".csv", ".parquet", ".arff", ".json"}:
        raise DataError(
            "Only CSV, Parquet, ARFF, and explicitly imported STIX JSON files are supported."
        )
    if must_exist and (not path.is_file() or path.is_symlink()):
        raise DataError("Dataset file is missing or inaccessible.")
    return path


def checksum_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def source_fingerprint() -> str:
    """Identify the actual application code even when no Git checkout is available."""
    digest = hashlib.sha256()
    for module in sorted(Path(__file__).resolve().parent.glob("*.py")):
        digest.update(module.name.encode("utf-8"))
        digest.update(module.read_bytes())
    return digest.hexdigest()


def artifact_path(workspace_id: str, job_id: str, name: str = "pipeline.joblib") -> Path:
    if any(
        not part
        or any(
            c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_ ."
            for c in part
        )
        for part in (workspace_id, job_id, name)
    ):
        raise DataError("Invalid storage identifier.")
    root = storage_root() / "models"
    result = (root / workspace_id / job_id / name).resolve()
    if not result.is_relative_to(root.resolve()):
        raise DataError("Artifact must remain in private model storage.")
    result.parent.mkdir(parents=True, exist_ok=True)
    return result


def trusted_artifact(value: str) -> Path:
    path = Path(value).resolve()
    root = (storage_root() / "models").resolve()
    if not path.is_relative_to(root) or path.suffix != ".joblib" or not path.is_file():
        raise DataError("Model artifact is unavailable in the trusted artifact store.")
    return path
