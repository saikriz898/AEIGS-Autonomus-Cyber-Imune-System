"""Schema-only and bounded quality inspection, without logging row contents."""

from __future__ import annotations

import csv
import json
import math
from collections import Counter
from pathlib import Path

from .storage import DataError, allowed_dataset_path, checksum_file, dataset_roots

LABEL_NAMES = {
    "label",
    "class",
    "attack",
    "attack_cat",
    "type",
    "result",
    "classification",
    "target",
}


def load_local_manifest() -> dict:
    locations = [
        Path(__file__).resolve().parents[2] / "data" / "dataset-manifest.json",
        Path("/app/data/dataset-manifest.json"),
    ]
    for location in locations:
        if location.is_file():
            try:
                return json.loads(location.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                pass
    return {"datasets": [], "raw_files_modified": False}


def candidates(workspace_id: str | None = None) -> list[dict]:
    manifest = load_local_manifest()
    authored = {entry.get("container_path"): entry for entry in manifest.get("datasets", [])}
    for alias in manifest.get("file_aliases", []):
        canonical = authored.get(alias.get("canonical_container_path"))
        if canonical and alias.get("sha256") == canonical.get("sha256"):
            authored[alias["container_path"]] = {
                **canonical,
                "container_path": alias["container_path"],
                "local_path": alias.get("local_path"),
                "size_bytes": alias["size_bytes"],
                "duplicate_of": alias["canonical_container_path"],
            }
    output = []
    for root in dataset_roots():
        if not root.exists():
            continue
        for path in sorted(root.rglob("*")):
            if not path.is_file() or path.suffix.lower() not in {".csv", ".parquet", ".arff"}:
                continue
            # The allowlist is checked again after resolving, including symlink destinations.
            try:
                safe = allowed_dataset_path(str(path), workspace_id=workspace_id)
                entry = {
                    "path": str(safe),
                    "name": safe.name,
                    "format": safe.suffix[1:],
                    "size_bytes": safe.stat().st_size,
                    "license_status": "unknown",
                }
                profile = authored.get(str(safe))
                if profile and profile.get("size_bytes") == entry["size_bytes"]:
                    entry.update(
                        {
                            key: value
                            for key, value in profile.items()
                            if key not in {"local_path", "container_path", "path"}
                        }
                    )
                    entry["name"] = safe.name
                else:
                    entry.update(schema_only(safe))
                    if profile:
                        entry["manifest_metadata_stale"] = True
                output.append(entry)
            except (OSError, DataError):
                continue
            if len(output) >= 200:
                return output
    return output


def schema_only(path: Path) -> dict:
    if path.suffix.lower() == ".csv":
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            columns = next(csv.reader(handle), [])
        if not columns or len(columns) != len(set(columns)):
            raise DataError("Dataset header is empty or contains duplicate column names.")
        return {
            "schema": [{"name": col, "dtype": "uninspected"} for col in columns],
            "label_candidates": [col for col in columns if col.lower().strip() in LABEL_NAMES],
            "mapping_required": True,
        }
    if path.suffix.lower() == ".parquet":
        try:
            import pyarrow.parquet as pq
        except ImportError as exc:
            raise DataError(
                "Parquet requires optional pyarrow; install it before registering this format."
            ) from exc
        metadata = pq.ParquetFile(path)
        return {
            "schema": [
                {"name": item.name, "dtype": str(item.type)} for item in metadata.schema_arrow
            ],
            "row_count": metadata.metadata.num_rows,
            "mapping_required": True,
        }
    from scipy.io import arff

    if path.stat().st_size > 20 * 1024 * 1024:
        raise DataError(
            "ARFF files larger than 20 MiB require conversion to chunked CSV/Parquet outside AEGIS."
        )
    try:
        records, metadata = arff.loadarff(path)
    except (ValueError, NotImplementedError):
        raise DataError(
            "This ARFF schema is unsupported. Use a numeric/nominal classification file or convert it outside AEGIS."
        ) from None
    return {
        "schema": [
            {"name": name, "dtype": str(kind)}
            for name, kind in zip(metadata.names(), metadata.types())
        ],
        "row_count": len(records),
        "mapping_required": True,
    }


def frame_chunks(path: Path, row_limit: int, chunk_size: int = 5000):
    import pandas as pd

    if path.suffix.lower() == ".csv":
        yield from pd.read_csv(
            path,
            chunksize=min(chunk_size, row_limit),
            nrows=row_limit,
            low_memory=False,
            encoding="utf-8-sig",
        )
    elif path.suffix.lower() == ".parquet":
        try:
            import pyarrow.parquet as pq
        except ImportError as exc:
            raise DataError("Parquet ingestion requires optional pyarrow.") from exc
        total = 0
        for batch in pq.ParquetFile(path).iter_batches(batch_size=chunk_size):
            if total >= row_limit:
                break
            frame = batch.to_pandas().iloc[: row_limit - total]
            total += len(frame)
            yield frame
    elif path.suffix.lower() == ".arff":
        # scipy ARFF loader is not streamed; enforce size first to bound memory.
        if path.stat().st_size > 20 * 1024 * 1024:
            raise DataError(
                "ARFF files larger than 20 MiB require conversion to chunked CSV/Parquet outside AEGIS."
            )
        from scipy.io import arff

        records, _ = arff.loadarff(path)
        frame = pd.DataFrame(records).iloc[:row_limit]
        for col in frame.select_dtypes(include="object"):
            frame[col] = frame[col].map(
                lambda value: value.decode("utf-8") if isinstance(value, bytes) else value
            )
        yield frame
    else:
        raise DataError("This file type is not a supported classification dataset.")


def profile_dataset(
    path: Path, row_limit: int, label_column: str | None = None, progress=lambda value: None
) -> dict:
    import pandas as pd

    hashes: set[int] = set()
    duplicates = 0
    missing = Counter()
    numeric = Counter()
    observed = Counter()
    classes = Counter()
    columns = []
    rows = 0
    for frame in frame_chunks(path, row_limit):
        columns = list(frame.columns)
        for col in columns:
            series = frame[col].replace([float("inf"), -float("inf")], float("nan"))
            missing[col] += int(series.isna().sum())
            observed[col] += int(series.notna().sum())
            numeric[col] += int(pd.to_numeric(series, errors="coerce").notna().sum())
        for value in pd.util.hash_pandas_object(frame, index=False).values:
            value = int(value)
            duplicates += value in hashes
            hashes.add(value)
        if label_column and label_column in frame:
            classes.update(frame[label_column].dropna().astype(str).value_counts().to_dict())
        rows += len(frame)
        progress(min(90, 10 + int(rows / max(1, row_limit) * 70)))
    if not rows:
        raise DataError("The dataset contains no readable rows.")
    schema = [
        {
            "name": col,
            "dtype": "numeric"
            if observed[col] and numeric[col] == observed[col]
            else "categorical",
            "missing_count": missing[col],
        }
        for col in columns
    ]
    label_candidates = [col for col in columns if col.strip().lower() in LABEL_NAMES]
    leakage = [
        col
        for col in columns
        if col.lower()
        in {"url", "id", "src_ip", "dst_ip", "srcip", "dstip", "flow_id", "timestamp", "time"}
        or col.strip().lower() in LABEL_NAMES
    ]
    return {
        "schema": schema,
        "row_count": rows,
        "profile_scope": "bounded_prefix",
        "row_limit": row_limit,
        "limit_reached": rows >= row_limit,
        "missing_values": dict(missing),
        "duplicate_rows": duplicates,
        "class_distribution": dict(classes),
        "label_candidates": label_candidates,
        "potential_leakage_columns": leakage,
        "mapping_required": True,
        "warnings": [
            "Quality statistics describe only the profiled prefix, not necessarily the full file.",
            "Explicit feature and label mapping is required before training.",
            "Identifier, target-like and time columns require leakage review.",
        ],
    }
