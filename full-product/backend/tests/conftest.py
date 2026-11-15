from pathlib import Path
import pytest


@pytest.fixture(autouse=True)
def test_storage_root(tmp_path, monkeypatch):
    """Isolate storage root to a temporary directory for each test run."""
    storage = tmp_path / "storage"
    storage.mkdir(parents=True, exist_ok=True)
    monkeypatch.setenv("STORAGE_ROOT", str(storage))
    yield storage
