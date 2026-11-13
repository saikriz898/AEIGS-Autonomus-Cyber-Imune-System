# Verification record

Reviewed 2026-11-14. This document repairs an existing missing link and separates configured checks from executed results. No historical timings or passing results are inferred.

## Commands

- `prototype/`: `npm ci`, `npm test`, `npm run build`; then `npx playwright install chrome` and `npm run test:e2e`.
- `full-product/frontend/`: `npm ci`, `npm run typecheck`, `npm run build`.
- `full-product/backend/`, in a Python 3.12 virtual environment: `python -m pip install -c requirements.lock -r requirements.txt -r requirements-dev.txt`, `python -m ruff check .`, `python -m pytest -q`.
- Product browser checks: follow [isolated setup](OPERATIONS.md#isolated-browser-checks), including the local datasets and isolation flag. Never use a personal application database.

Backend synthetic tests do not establish real dataset/model performance. Hosted CI also checks container readiness and migration state, without the dataset-dependent product browser suite.

## Results in this workspace

| Check | Result |
| --- | --- |
| Full-product frontend typecheck | Passed |
| Full-product frontend production build | Passed; Next.js generated the application routes |
| Prototype domain tests | Passed: 20 tests, using `node node_modules/vitest/vitest.mjs run` |
| Prototype TypeScript and build | Passed: `node node_modules/typescript/bin/tsc -b` and `node node_modules/vite/bin/vite.js build` |
| Workflow/Dependabot YAML | Parsed and formatted successfully with the installed Prettier YAML parser; not an Actions execution |
| Compose configuration | Passed: `docker compose --env-file .env.example -f compose.yaml config --quiet` from `full-product/` |
| New documentation links | All local file links resolve |
| Docker daemon | Unavailable; container startup and migration checks not executed |
| Python launcher | Windows app alias could not execute; backend tests/lint not executed |
| GitHub Actions and GHCR | Local checks do not establish hosted success; inspect the selected repository's Actions page after publication |
| Product browser suite | Not executed; isolated container stack unavailable |

Frontend checks used already installed dependencies; a clean install remains for hosted CI. Existing `test-results/` files predate this review and are not current results.

The first prototype npm invocation encountered a local Node/npm path permission error. Direct invocation of the installed tools succeeded as recorded above. Prototype browser tests were not run during this review. Compose validation emitted a Docker user-config access warning but completed successfully; no private environment values were printed.
