"""Generate local-only secrets without printing their values."""

from pathlib import Path
import secrets

root = Path(__file__).resolve().parents[1]
(root / "data" / "raw").mkdir(parents=True, exist_ok=True)
for directory in ("archive", "archive (1)", "archive (2)", "archive (3)"):
    (root / "data" / "raw" / directory).mkdir(parents=True, exist_ok=True)
target = root / ".env"
if target.exists():
    raise SystemExit(
        "An .env already exists. It was preserved. Edit it intentionally if configuration changes are needed."
    )
text = (root / ".env.example").read_text(encoding="utf-8")
for placeholder in (
    "CHANGE_ME_GENERATE_RANDOM_LOCAL_PASSWORD",
    "CHANGE_ME_GENERATE_RANDOM_SETUP_TOKEN",
):
    text = text.replace(placeholder, secrets.token_urlsafe(36))
target.write_text(text, encoding="utf-8")
try:
    target.chmod(0o600)
except OSError:
    pass
print(
    "Created full-product/.env with random local secrets. No secret values were printed. No account or API key was created."
)
