"""Read-only local dataset inventory. Emits metadata only; never prints rows."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


def file_checksum(path: Path) -> str:
    checksum = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            checksum.update(chunk)
    return checksum.hexdigest()


def container_path(path: Path, repo: Path) -> str | None:
    relative = path.relative_to(repo).as_posix()
    if relative.startswith("full-product/data/raw/"):
        return "/datasets/local/" + relative.removeprefix("full-product/data/raw/")
    mounts = {
        "archive": "unsw",
        "archive (1)": "iot",
        "archive (2)": "ton",
        "archive (3)": "phishing",
    }
    for directory, mount in mounts.items():
        if relative.startswith(directory + "/"):
            return "/datasets/" + mount + "/" + relative.removeprefix(directory + "/")
    return None


def inspect_csv(path: Path, repo: Path, checksum: str | None = None) -> dict:
    checksum = checksum or file_checksum(path)
    with path.open("r", encoding="utf-8-sig", errors="strict", newline="") as stream:
        reader = csv.reader(stream)
        headers = next(reader)
        candidates = [
            h
            for h in headers
            if h.strip().lower()
            in {"label", "class", "attack_cat", "attack", "type", "result", "classification"}
        ]
        indexes = {headers.index(h): h for h in candidates}
        missing = Counter()
        numeric = Counter()
        observed = Counter()
        classes = {h: Counter() for h in candidates}
        seen: set[bytes] = set()
        duplicates = 0
        malformed = 0
        rows = 0
        for row in reader:
            rows += 1
            if len(row) != len(headers):
                malformed += 1
                continue
            digest = hashlib.sha256(json.dumps(row, separators=(",", ":")).encode()).digest()
            duplicates += digest in seen
            seen.add(digest)
            for i, (name, value) in enumerate(zip(headers, row)):
                value = value.strip()
                if value.lower() in {"", "nan", "na", "null", "none", "?"}:
                    missing[name] += 1
                    continue
                observed[name] += 1
                try:
                    float(value)
                    numeric[name] += 1
                except ValueError:
                    pass
                if i in indexes:
                    classes[indexes[i]][value] += 1
        numeric_headers = sum(bool(observed[h]) and numeric[h] == observed[h] for h in headers)
        suspected_headerless = numeric_headers > len(headers) * 0.9 and all(
            _is_number(h) for h in headers[:5]
        )
        issues = []
        if duplicates:
            issues.append(f"{duplicates} exact duplicate rows; remove before splitting.")
        if malformed:
            issues.append(f"{malformed} rows have inconsistent field counts.")
        if any(missing.values()):
            issues.append("Missing values require training-only preprocessing.")
        if suspected_headerless:
            issues.append("Possible headerless file: explicit column names and mapping required.")
        leakage = [
            h
            for h in headers
            if any(
                word in h.lower()
                for word in (
                    "attack",
                    "label",
                    "class",
                    "target",
                    "src_ip",
                    "dst_ip",
                    "srcip",
                    "dstip",
                    "flow_id",
                    "timestamp",
                )
            )
        ]
        rel = path.relative_to(repo).as_posix()
        return {
            "name": path.stem,
            "local_path": rel,
            "container_path": container_path(path, repo),
            "format": "csv",
            "size_bytes": path.stat().st_size,
            "sha256": checksum,
            "source": None,
            "version": None,
            "citation": None,
            "license_status": "unknown",
            "permission_status": "unknown",
            "commercial_use": "blocked_pending_review",
            "ingestion_status": "discovered_not_registered",
            "row_count": rows,
            "column_count": len(headers),
            "schema": [
                {
                    "name": h,
                    "dtype": "numeric" if observed[h] and numeric[h] == observed[h] else "string",
                    "missing_count": missing[h],
                }
                for h in headers
            ],
            "label_candidates": candidates,
            "class_distribution": {h: dict(c) for h, c in classes.items()},
            "duplicate_rows": duplicates,
            "malformed_rows": malformed,
            "suspected_headerless": suspected_headerless,
            "potential_leakage_columns": leakage,
            "quality_issues": issues,
            "mapping_required": True,
            "training_status": "blocked: original source, citation, permission review, and explicit feature/label mapping required",
        }


def _is_number(value: str) -> bool:
    try:
        float(value)
        return True
    except ValueError:
        return False


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repository", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "data" / "dataset-manifest.json",
    )
    args = parser.parse_args()
    roots = [
        args.repository / name
        for name in (
            "archive",
            "archive (1)",
            "archive (2)",
            "archive (3)",
            "global",
            "Global",
            "data",
            "datasets",
            "uploads",
            "full-product/data",
        )
    ]
    files = sorted(
        {
            path
            for root in roots
            if root.exists()
            for path in root.rglob("*")
            if path.is_file() and path.suffix.lower() in {".csv", ".parquet", ".arff"}
        }
    )
    entries = []
    aliases = []
    by_checksum = {}
    for path in files:
        try:
            checksum = file_checksum(path)
            canonical = by_checksum.get(checksum)
            mounted_path = container_path(path, args.repository)
            if canonical and canonical.get("container_path") and mounted_path:
                aliases.append(
                    {
                        "local_path": path.relative_to(args.repository).as_posix(),
                        "container_path": mounted_path,
                        "canonical_container_path": canonical["container_path"],
                        "sha256": checksum,
                        "size_bytes": path.stat().st_size,
                        "verified_at": datetime.now(timezone.utc).isoformat(),
                    }
                )
                continue
            entry = (
                inspect_csv(path, args.repository, checksum)
                if path.suffix.lower() == ".csv"
                else {
                    "local_path": path.relative_to(args.repository).as_posix(),
                    "container_path": mounted_path,
                    "format": path.suffix[1:],
                    "sha256": checksum,
                    "size_bytes": path.stat().st_size,
                    "ingestion_status": "requires_runtime_inspection",
                    "license_status": "unknown",
                }
            )
            entries.append(entry)
            by_checksum[checksum] = entry
        except (OSError, UnicodeError, csv.Error) as error:
            entries.append(
                {
                    "local_path": path.relative_to(args.repository).as_posix(),
                    "ingestion_status": "inspection_failed",
                    "error": type(error).__name__,
                    "license_status": "unknown",
                }
            )
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "raw_files_modified": False,
        "datasets": entries,
        "file_aliases": aliases,
        "unique_dataset_count": len(entries),
        "discovered_file_locations": len(files),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(
        json.dumps(
            {
                "manifest": str(args.output),
                "unique_datasets": len(entries),
                "file_locations": len(files),
                "metadata_only": True,
            }
        )
    )


if __name__ == "__main__":
    main()
