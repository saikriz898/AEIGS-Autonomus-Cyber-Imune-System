# AEGIS full product

A connected local defensive security workspace built with Next.js, FastAPI, PostgreSQL, Redis, and Celery. All code and configuration for this version live inside `full-product/`; the existing prototype and raw dataset folders remain separate.

Start with the [global repository guide](../README.md) for a code map and comparison of both applications. See [GitHub and CI/CD](docs/GITHUB.md) for automation and [remaining gaps](docs/GAPS.md) for outstanding work.

## Configure and start

Prerequisites: Docker Desktop running Linux containers, Docker Compose, and Python for the small configuration helper (`py` on this Windows machine). The application itself runs in containers; host Node.js and Python packages are not required.

```powershell
cd D:\AEIGS\full-product
py scripts/configure.py
docker compose up --build -d
docker compose ps
```

The configure helper generates private random database and setup secrets in `.env`; it preserves an existing file and never prints its secrets. There are no shared login credentials and no default account.

Fresh-clone dataset mounts default to `data/raw/archive*`; the helper creates empty directories, so CSV files are optional for startup. If an existing `.env` points to absent `../archive*` folders, intentionally update only those dataset path overrides to actual locations. Preserve secrets and the Compose project name.

Open **http://localhost:3000**. API readiness is **http://localhost:8000/api/ready**; API documentation is **http://localhost:8000/api/docs**. Use `localhost` consistently with the default configured origin.

## Create the first owner

After the API is healthy, run this command and enter a unique password at its hidden prompt:

```powershell
docker compose exec api python -m app.bootstrap --email you@example.com --name "Your name" --workspace "Your security workspace"
```

Then sign in in the browser. Alternatively, use the first-owner web setup page with the private `SETUP_TOKEN` from `.env`. Setup is disabled once the first account exists. The bootstrap command never resets an existing account.

## Register / sign up

Open **http://localhost:3000/register**, or select **Create account** on the sign-in page.

- On a new installation, the page guides the first owner through token-protected setup. Use the private `SETUP_TOKEN` from `.env`; no default password exists.
- Once an owner exists, registration creates a local account and a **new private workspace**. It never grants access to an existing workspace.
- Existing workspace access is managed by an Owner/Admin through Members & Roles.
- Set `ALLOW_SELF_REGISTRATION=false` to require administrator-created accounts instead.

Passwords must contain at least 12 characters, and the form requires password confirmation. Successful registration signs the new account into its own workspace.

## Connected workflows

The shared persistent workspace connects:

```text
Authorized scope → assets and events → findings and rule explanations
→ Digital Twin → modeled paths → safe simulations → defensive recommendations
→ Guardian Gate review → audit history → background-generated reports
```

Workspace records live in PostgreSQL. Browser state is limited to interface preferences and workspace selection. Seeded assets, events, findings, and relationships are labeled demonstration data. Discovery refreshes those sample records only. It never probes, resolves, scans, or contacts the displayed assets.

The application includes account/workspace setup, role-aware navigation, inventory and details, events, findings, threat context, snapshots, graph/path analysis, scenario simulation, recommendations and decision history, conversations, provider status, deterministic workflow activity, dataset/model operations, job history, reports, notifications, settings, membership roles, and audit records. A visible unavailable state explains capabilities that require configuration or are not implemented.

Use **Asset Inventory → Add manual asset** to record authorized inventory metadata. Name, type, owner, criticality, exposure, notes, and optional address/services are saved in PostgreSQL with manual provenance and audit history. Recording an address never probes it. An asset with no recorded findings has a rule score of zero; that does not establish that it is secure or monitored.

## Datasets and models

Four unique CSV datasets were inspected read-only. Identical copies also exist under `full-product/data/raw/`; their verified checksums are recorded as alternate file locations, rather than separate training datasets:

| Repository path | Rows | Columns | Important observed issue |
| --- | ---: | ---: | --- |
| `archive/UNSW-NB15_Dataset2.csv` | 340,693 | 40 | Five attack-category classes; this extract has no benign class; many duplicate rows |
| `archive (1)/IoT_Intrusion.csv` | 1,048,575 | 47 | Duplicate rows and task-specific schema |
| `archive (2)/train_test_network.csv` | 211,043 | 44 | Ambiguous `label`/`type` targets and duplicate rows |
| `archive (3)/phishing_features.csv` | 160,064 | 13 | Severe class imbalance and a raw URL identifier to exclude from features |

The complete checksums, schemas, counts, class balance, and quality flags are in [data/dataset-manifest.json](data/dataset-manifest.json). Filenames alone do not establish the original source, exact version, citation, license, or permission to use these extracts. All four currently have **unknown permissions**. The user indicated that source/permission details will be provided; no actual terms have been supplied yet.

**No model has been trained on these real datasets. No real metrics or model artifacts exist yet.** Training stays blocked until an Owner/Admin records the original source, citation, reviewed usage permissions, and an explicit task/label/feature mapping. Commercial use remains blocked unless the recorded permission allows it.

Mounted files appear automatically as metadata-only registrations in new workspaces. **Training Runs** shows the selected dataset's file, schema, row count, permissions, and missing readiness requirements. Existing workspaces can use **Dataset Management → Sync detected files**, or run `docker compose exec api python -m app.catalog --sync-existing`. Synchronization preserves edited dataset records and raw files. Verified duplicate locations share a catalog record.

The ingestion and training pipelines are implemented separately. Select the task, review schema/quality information, save a deliberate mapping, and submit ingestion/training as background jobs. Network, IoT, and phishing tasks never share a merged model. Supported baselines are explicit scikit-learn algorithms. Preprocessing and estimator are stored together. Real successful runs register inactive models with actual evaluation records; activation is a separate authorized action with previous-version metadata.

Test fixtures used by automated tests are synthetic test data only. They are not substitutes for training the product on the supplied real datasets.

## Optional AI and threat integrations

The application runs without any AI or threat-service credentials. By default:

- AI assistant: **unconfigured**. No live answer is fabricated.
- OpenAI Responses provider: implemented, but no key/model supplied or live request verified.
- Local model adapter: implemented for a deliberately configured compatible provider; no model is bundled.
- NVD adapter: outbound enrichment disabled; optional API key and Redis-coordinated rate limiting.
- ATT&CK: explicit local STIX JSON import with source/version metadata; no automatic download or bundled live feed.
- Discovery/telemetry connectors and infrastructure action execution: unavailable.

For local assistance without a language model, choose **Workspace guide (no LLM)** in AI Assistant. It answers supported questions from current records with fixed rules and citations, and saves private conversation history. It is explicitly separate from AI text generation.

To explicitly download and connect the optional CPU language model:

```powershell
py scripts/setup_local_ai.py
```

The helper downloads the Ollama runtime and `qwen2.5:1.5b`, preserves existing database/setup secrets and the Compose project name, enables the `local-ai` profile, and points the backend at the private local service. Model weights live in a persistent Docker volume. New installation startup alone never downloads weights. See [assistant setup and limitations](docs/AI_AND_INTEGRATIONS.md) for the model source, license, resource limits, and actual verification results.

Chat credentials remain on the backend. Read-only tools restrict retrieval to the current user's authorized workspace; conversations also belong to the current user. Imported text is untrusted context and cannot grant tool permissions. The assistant is neither a detector nor the source of truth for risk or infrastructure state.

## Build and check

```powershell
docker compose build
docker compose run --rm --no-deps api python -m pytest -q
docker compose exec api alembic current
```

For frontend development, use a supported Node.js version (22 LTS recommended):

```powershell
cd frontend
npm ci
$env:API_INTERNAL_URL="http://127.0.0.1:8000"
npm run dev
npm run typecheck
npm run build
```

Executed checks and their limitations are recorded in [Verification](docs/VERIFICATION.md). A successful build is not an independent security or production-readiness assessment.

## Operations and documentation

```powershell
docker compose logs --tail 100 api worker frontend
docker compose stop
docker compose start
docker compose down
```

Stopping/removing containers without `-v` preserves the data volumes. See:

- [Architecture](docs/ARCHITECTURE.md)
- [Environment variables](docs/ENVIRONMENT.md)
- [Dataset registration, permissions, and training](docs/DATASETS.md)
- [Assistant and integration boundaries](docs/AI_AND_INTEGRATIONS.md)
- [Startup, shutdown, backup, and restore](docs/OPERATIONS.md)
- Dataset manifest: [data/dataset-manifest.json](data/dataset-manifest.json)

## Boundaries

Risk uses deterministic, configurable rules and visible factors. Path analysis and simulations operate on stored graph records only. Recommendation estimates are planning heuristics. Guardian Gate stores human decisions and notes without applying external controls. No scan, exploit, firewall change, endpoint command, cloud change, or other infrastructure action is executed.

This is a local implementation with security controls and automated checks, not a claim of independent security validation, production telemetry effectiveness, compliance, or production readiness. TLS, external deployment, independent assessment, dataset usage review, real provider connectivity, and representative live-telemetry model evaluation require separate configuration and validation.
