# Dataset inventory and offline model workflow

AEGIS reads existing datasets from configured local directories. It never downloads datasets, moves the extracted files, rewrites their contents, or submits their rows to the chat provider. Dataset source, citation, version, permission review, mapping, inspection results, and job state are persistent workspace records in PostgreSQL.

## Files found in this repository

The read-only metadata inspection recorded the following CSV files. Full-file checksums, column schemas, missing-value counts, duplicate counts, candidate labels, and class distributions are in [`data/dataset-manifest.json`](../data/dataset-manifest.json). Filenames suggest dataset families; they do not establish official provenance or usage rights.

| Repository file | Docker path | Rows | Columns | Candidate labels | Exact duplicate rows |
| --- | --- | ---: | ---: | --- | ---: |
| `archive/UNSW-NB15_Dataset2.csv` | `/datasets/unsw/UNSW-NB15_Dataset2.csv` | 340,693 | 40 | `attack` | 198,253 |
| `archive (1)/IoT_Intrusion.csv` | `/datasets/iot/IoT_Intrusion.csv` | 1,048,575 | 47 | `label` | 65,556 |
| `archive (2)/train_test_network.csv` | `/datasets/ton/train_test_network.csv` | 211,043 | 44 | `label`, `type` | 20,569 |
| `archive (3)/phishing_features.csv` | `/datasets/phishing/phishing_features.csv` | 160,064 | 13 | `label` | 0 |

The UNSW-named file contains five attack-category labels and no benign class. It cannot, by itself, establish benign-versus-intrusion classification. The network file containing both `label` and `type` requires an explicit task/target choice. The phishing file contains 159,244 rows labeled `1` and 820 labeled `0`; label meaning still needs confirmation from the original source. Its raw `url` column must be excluded from predictors. These observations are metadata, not evidence of live detection capability.

Matching copies of these files also exist under `full-product/data/raw/archive*`. All eight file locations were checked by SHA-256; they contain **four unique datasets**. The manifest's `file_aliases` preserves the copy paths and their canonical locations. Catalog synchronization links known identical locations to the same dataset without moving or deleting files. Untouched, automatically created duplicate metadata records can be consolidated; records with user edits, jobs, or models are preserved and labeled as duplicates. Ingestion independently verifies the file checksum before processing.

All four files currently have **unknown original source, dataset version, citation, and permission status**. Product training is blocked until an Owner or Admin records the missing source and a reviewed permission decision. No actual product model or benchmark metrics are supplied merely because the files exist. Synthetic test fixtures validate the training implementation; they are never registered as real product benchmarks.

## Locations and read-only access

Existing `archive*` directories are mounted read-only by Compose. Do not relocate them. `DATASET_ROOTS` is a comma-separated allowlist of container directories; dataset registration rejects paths outside it. Additional local datasets can use the configured `LOCAL_DATA_PATH` mount. The recommended layout for newly obtained files is:

```text
full-product/data/raw/
  dataset-name/
    original-file.csv
    source-and-permission-notes.txt
```

Keep original terms and citations alongside the files. Raw data, private uploads, model artifacts, and local configuration are ignored by Git. Uploaded CSV/Parquet/ARFF files are stored privately with generated names and a configured byte limit; they are not publicly served. The application does not accept uploaded serialized model files.

To reproduce the metadata inventory from `full-product/` with a local Python installation:

```powershell
py scripts/inspect_datasets.py --repository .. --output data/dataset-manifest.json
```

This command writes only the metadata manifest inside `full-product/`; it opens the input files read-only and prints no row contents. Review the manifest before committing it if your schemas or class labels are sensitive.

The inspector searches conventional archive, global, data, datasets, uploads, and full-product data directories. It hashes every discovered file and profiles each distinct CSV. Files outside the supplied Compose mount layout need an explicit read-only mount and `DATASET_ROOTS` entry before runtime access; their filenames do not imply a container path.

## Register, inspect, and map

Mounted raw files are registered as **metadata only** when a new workspace is created. Their task remains **unassigned**, their permission status remains **unknown**, and their file status remains **registered**. This makes the files visible in the dataset selector without claiming that ingestion or training has occurred. Owners/Admins can synchronize missing catalog entries from Dataset Management; repeating synchronization preserves existing edits and does not create duplicate registrations. Private uploads never enter the shared mounted-file catalog.

Verified byte-identical copies recorded in the manifest's `file_aliases` share one dataset registration with multiple file locations. Eight mounted file locations can therefore represent four distinct datasets. Synchronization can consolidate an older, untouched automatic duplicate registration; it preserves both file records and all raw files. Registrations with manual edits, jobs, or model versions remain separate and are labeled as duplicates rather than removed. Runtime ingestion rechecks file integrity; catalog display does not rehash every large file.

For an existing installation created before automatic catalog registration, an administrator can run this metadata-only repair from `full-product/`:

```powershell
docker compose exec api python -m app.catalog --sync-existing
```

This keeps existing users, workspaces, assets, dataset edits, and trained artifacts. It records a system audit action and prints only aggregate counts. It does not ingest data, start training, choose labels, assign tasks, or approve permissions.

1. Sign in and choose the authorized workspace. Open **Dataset Management** and select an automatically cataloged file, explicitly register another discovered file, or upload an accepted data file.
2. Register its explicit task: **network**, **IoT/IIoT**, or **phishing**. Unrelated task types are never combined into one model. Record the original source, version when known, and citation/terms evidence.
3. An Owner/Admin may change permission status to `reviewed_noncommercial` or `reviewed_permitted` after reviewing the original terms. A mirror's license label is not evidence that the original dataset permits commercial use. `unknown` blocks training; noncommercial status blocks training requested for commercial use. These fields record a human decision rather than an automated legal determination.
4. Run ingestion with a bounded row limit. The API returns a persisted job ID; Redis/Celery executes the inspection and PostgreSQL records progress, completion, or a concise error. Inspect the schema, missing values, duplicate indicators, class balance, and potential leakage columns.
5. Save an explicit label column and feature list. Label/target-like columns, raw URLs, addresses, and direct identifiers are rejected as predictors. Map categorical columns and choose a stratified, group-aware, or time-aware split. Group/time splitting requires the corresponding explicit column. An optional separate evaluation file must match the selected feature and label schema.

Assigning a task is an explicit analyst decision. Changing a task clears its previous mapping unless a new mapping is provided in the same change. A task cannot change while training is queued/running or after any model version exists; register a separate dataset for a different modeling task.

The authored manifest describes a full-file inspection. Runtime ingestion quality statistics describe a **bounded prefix** and label that scope explicitly. A 2,000-row or 50,000-row profile is not the full-file row count or a representative sample guarantee. Configurable limits keep processing bounded; larger limits require an intentional server configuration change.

## Train, evaluate, and activate

After ingestion, source/permission review, and valid explicit mapping, select `logistic_regression` or `random_forest` and submit a background training job. CPU mode remains available. No foundation chat model is trained or fine-tuned.

Each task trains separately. Duplicate feature records are removed before splitting; contradictory feature/label records are excluded and counted. An explicitly supplied separate evaluation file is checked for overlapping feature records. Without one, the selected split is recorded. Imputers, scalers, encoders, and estimator are fitted on training rows only. Bounded-prefix sampling, class imbalance, and correlated records remain evaluation limitations that require review.

A successful worker saves the preprocessing pipeline and estimator together in the private artifact store. The registry records the dataset checksum/version, exact feature schema, algorithm and parameters, split configuration, timestamp, code version, and actual evaluation results. Metrics include accuracy, per-class precision/recall/F1, macro-F1, confusion matrix, and ROC-AUC/PR-AUC only where mathematically appropriate. Missing or failed jobs have no invented metrics.

New model versions are **inactive**. An Owner/Admin must deliberately activate a version. Earlier versions and activation history are retained; selecting an earlier version again provides an explicit rollback. Prediction requires the requested active version and exact registered feature names/types, with no extra or missing fields. Numeric values must be finite or null. Predictions are labeled as an offline benchmark model's output, not confirmed compromise or validated live-network detection.

## Jobs and failures

Job IDs, idempotency keys, payloads, statuses, progress, timestamps, errors, and outcomes belong to PostgreSQL. Redis provides execution and advisory progress messaging. Duplicate idempotency keys reuse the same compatible job; conflicting parameters are rejected. If Redis is unavailable, submission records an explicit failed state that can be retried after the services recover.

Cancellation is cooperative at safe phase boundaries. A running scikit-learn fit does not stop immediately. Retry controls apply to failed or cancelled jobs and re-check dataset, mapping, permission, and file integrity before training. Never infer successful ingestion, training, or activation from a button click alone; inspect the persisted job and model records.

CSV is the format found and inspected here. Parquet requires optional `pyarrow`; without it the application returns a clear dependency error. ARFF support is bounded to small files because SciPy loading is not streamed. Optional-format availability and worker interruption recovery should be verified in the target environment before relying on those paths.
