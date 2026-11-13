"""Explicitly install a local CPU chat model; never touches cybersecurity datasets."""

from __future__ import annotations

import argparse
import re
import subprocess
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default="qwen2.5:1.5b")
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:/-]{0,150}", args.model):
        parser.error("Provide a valid Ollama model identifier.")
    product = Path(__file__).resolve().parents[1]
    environment = product / ".env"
    if not environment.is_file():
        parser.error("Run scripts/configure.py first; existing private configuration is required.")
    print("Downloading the Ollama runtime and the selected pretrained model. No dataset training runs.")
    for arguments in (
        ["docker", "compose", "--profile", "local-ai", "up", "-d", "--wait", "local-model"],
        ["docker", "compose", "exec", "-T", "local-model", "ollama", "pull", args.model],
    ):
        subprocess.run(arguments, cwd=product, check=True)
    updates = {
        "AI_PROVIDER": "local",
        "LOCAL_AI_BASE_URL": "http://local-model:11434/v1",
        "LOCAL_AI_MODEL": args.model,
        "LOCAL_AI_TIMEOUT_SECONDS": "90",
        "LOCAL_AI_MAX_TOKENS": "450",
    }
    original = environment.read_text(encoding="utf-8")
    lines = original.splitlines()
    profiles = next((line.split("=", 1)[1] for line in lines if line.startswith("COMPOSE_PROFILES=")), "")
    updates["COMPOSE_PROFILES"] = ",".join(dict.fromkeys([p for p in profiles.split(",") if p] + ["local-ai"]))
    output = []
    for line in lines:
        key = line.split("=", 1)[0]
        output.append(f"{key}={updates.pop(key)}" if key in updates else line)
    output.extend(f"{key}={value}" for key, value in updates.items())
    environment.write_text("\n".join(output) + "\n", encoding="utf-8")
    subprocess.run(["docker", "compose", "up", "-d", "--no-build", "api", "worker"], cwd=product, check=True)
    print("Local model connected. Send a message in AI Assistant to verify inference; output requires review.")


if __name__ == "__main__":
    main()
