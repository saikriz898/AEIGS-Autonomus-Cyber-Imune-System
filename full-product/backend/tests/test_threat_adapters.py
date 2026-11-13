import json
import pytest
from app.threat_adapters import NVDAdapter, IntegrationUnavailable, read_attack_bundle


def test_nvd_is_disabled_without_explicit_outbound_configuration(monkeypatch):
    monkeypatch.setenv("INTEGRATION_NETWORK_ENABLED", "false")
    with pytest.raises(IntegrationUnavailable, match="No network request"):
        NVDAdapter().fetch("CVE-2021-44228")


def test_nvd_rejects_arbitrary_urls_before_network(monkeypatch):
    with pytest.raises(ValueError):
        NVDAdapter().fetch("https://unrelated.example")


def test_stix_import_checks_path_type_and_ignores_revoked(tmp_path, monkeypatch):
    monkeypatch.setenv("DATASET_ROOTS", str(tmp_path))
    file = tmp_path / "attack.json"
    file.write_text(
        json.dumps(
            {
                "type": "bundle",
                "objects": [
                    {
                        "type": "attack-pattern",
                        "id": "attack-pattern--test",
                        "name": "Test technique",
                        "external_references": [
                            {"source_name": "mitre-attack", "external_id": "T1000"}
                        ],
                    },
                    {
                        "type": "attack-pattern",
                        "revoked": True,
                        "name": "Revoked",
                        "external_references": [
                            {"source_name": "mitre-attack", "external_id": "T1001"}
                        ],
                    },
                ],
            }
        )
    )
    records = read_attack_bundle(str(file), "test fixture, not a live feed", "test-v1")
    assert len(records) == 1 and records[0]["external_id"] == "T1000"
    assert records[0]["context_type"] == "imported"
    monkeypatch.setenv("DATASET_ROOTS", str(tmp_path / "other"))
    with pytest.raises(ValueError, match="configured"):
        read_attack_bundle(str(file), "test", "v1")
