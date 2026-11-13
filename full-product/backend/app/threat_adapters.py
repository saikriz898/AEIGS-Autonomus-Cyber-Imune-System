"""Explicitly configured enrichment; never probes assets or arbitrary target URLs."""

from __future__ import annotations

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re

import httpx
import redis


class IntegrationUnavailable(RuntimeError):
    pass


class IntegrationRateLimited(RuntimeError):
    def __init__(self, seconds: int):
        self.retry_after = min(3600, max(1, seconds))
        super().__init__(f"Upstream rate limit. Retry after at least {self.retry_after} seconds.")


class NVDAdapter:
    endpoint = "https://services.nvd.nist.gov/rest/json/cves/2.0"

    def fetch(self, cve_id: str) -> dict:
        if not re.fullmatch(r"CVE-\d{4}-\d{4,9}", cve_id):
            raise ValueError("Use an exact CVE identifier, for example CVE-2021-44228.")
        if os.getenv("INTEGRATION_NETWORK_ENABLED", "false").lower() != "true":
            raise IntegrationUnavailable(
                "External enrichment is disabled by INTEGRATION_NETWORK_ENABLED. No network request was made."
            )
        key = os.getenv("NVD_API_KEY")
        try:
            queue = redis.Redis.from_url(
                os.getenv("REDIS_URL", "redis://redis:6379/0"),
                socket_connect_timeout=2,
                socket_timeout=2,
            )
            if not queue.set("aegis:nvd:rate-lock", "1", nx=True, ex=1 if key else 6):
                raise IntegrationRateLimited(1 if key else 6)
        except IntegrationRateLimited:
            raise
        except redis.RedisError:
            raise IntegrationUnavailable(
                "Rate-limit coordination is unavailable. Restore Redis before retrying enrichment."
            ) from None
        try:
            response = httpx.get(
                self.endpoint,
                params={"cveId": cve_id},
                headers={"apiKey": key} if key else {},
                timeout=30,
                follow_redirects=False,
            )
            if response.status_code == 429:
                try:
                    delay = int(response.headers.get("Retry-After", "30"))
                except ValueError:
                    delay = 30
                raise IntegrationRateLimited(delay)
            response.raise_for_status()
            records = response.json().get("vulnerabilities", [])
            if not records:
                raise IntegrationUnavailable(
                    "NVD returned no record for this CVE. No vulnerability applicability was established."
                )
            cve = records[0]["cve"]
            description = next(
                (d.get("value", "") for d in cve.get("descriptions", []) if d.get("lang") == "en"),
                "No English description supplied.",
            )
            score = None
            for version in ["cvssMetricV40", "cvssMetricV31", "cvssMetricV30", "cvssMetricV2"]:
                metrics = cve.get("metrics", {}).get(version, [])
                if metrics:
                    score = metrics[0].get("cvssData", {}).get("baseScore")
                    break
            return {
                "external_id": cve.get("id", cve_id),
                "name": cve_id,
                "description": description[:6000],
                "source": "NVD API 2.0",
                "source_url": f"https://nvd.nist.gov/vuln/detail/{cve_id}",
                "version": cve.get("lastModified"),
                "published": cve.get("published"),
                "retrieved_at": datetime.now(timezone.utc).isoformat(),
                "base_score": score,
                "context_type": "retrieved",
                "applicability": "Not verified against an asset",
                "kev_membership": "Not determined by this adapter",
            }
        except (IntegrationUnavailable, IntegrationRateLimited):
            raise
        except Exception:
            raise IntegrationUnavailable(
                "NVD enrichment failed. Review provider availability and retry the persisted job; no asset was contacted."
            ) from None


def configured_roots() -> list[Path]:
    return [
        Path(p.strip()).resolve()
        for p in os.getenv(
            "DATASET_ROOTS",
            "/datasets/unsw,/datasets/iot,/datasets/ton,/datasets/phishing,/storage/uploads",
        ).split(",")
        if p.strip()
    ]


def read_attack_bundle(path_string: str, source: str, version: str) -> list[dict]:
    path = Path(path_string).resolve(strict=True)
    if not any(path.is_relative_to(root) for root in configured_roots()):
        raise ValueError(
            "The STIX file must be inside a configured read-only dataset root or private upload directory."
        )
    if path.suffix.lower() != ".json" or not path.is_file():
        raise ValueError("ATT&CK imports require a local .json STIX bundle.")
    if path.stat().st_size > int(os.getenv("MAX_UPLOAD_BYTES", "52428800")):
        raise ValueError("The STIX bundle exceeds the configured import size limit.")
    with path.open("r", encoding="utf-8-sig") as handle:
        bundle = json.load(handle)
    if (
        not isinstance(bundle, dict)
        or bundle.get("type") != "bundle"
        or not isinstance(bundle.get("objects"), list)
    ):
        raise ValueError("The JSON file is not a STIX bundle.")
    if len(bundle["objects"]) > 100000:
        raise ValueError("This local import is limited to 100,000 STIX objects.")
    results = []
    retrieved = datetime.now(timezone.utc).isoformat()
    for item in bundle["objects"]:
        if (
            not isinstance(item, dict)
            or item.get("type") != "attack-pattern"
            or item.get("revoked")
            or item.get("x_mitre_deprecated")
        ):
            continue
        refs = item.get("external_references", [])
        ref = next(
            (
                r
                for r in refs
                if isinstance(r, dict)
                and r.get("source_name")
                in ("mitre-attack", "mitre-mobile-attack", "mitre-ics-attack")
            ),
            None,
        )
        if not ref or not re.fullmatch(r"T\d{4}(?:\.\d{3})?", str(ref.get("external_id", ""))):
            continue
        results.append(
            {
                "external_id": ref["external_id"],
                "name": str(item.get("name", "Unnamed technique"))[:300],
                "description": str(item.get("description", ""))[:6000],
                "source": source,
                "source_url": ref.get("url"),
                "version": version,
                "modified": item.get("modified"),
                "stix_id": item.get("id"),
                "retrieved_at": retrieved,
                "context_type": "imported",
            }
        )
    if not results:
        raise ValueError(
            "No supported, active ATT&CK technique records were found in this STIX bundle."
        )
    return results
