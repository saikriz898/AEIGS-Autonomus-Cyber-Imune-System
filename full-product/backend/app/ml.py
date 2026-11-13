"""Task-specific offline baselines. No foundation-model training or network I/O."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path

from .dataset_manifest import LABEL_NAMES, frame_chunks
from .storage import (
    DataError,
    allowed_dataset_path,
    artifact_path,
    checksum_file,
    trusted_artifact,
    source_fingerprint,
)

TASKS = {"network", "iot", "phishing"}
ALGORITHMS = {"logistic_regression", "random_forest"}
IDENTIFIERS = {
    "id",
    "url",
    "src_ip",
    "dst_ip",
    "srcip",
    "dstip",
    "flow_id",
    "timestamp",
    "time",
    "dns_query",
    "http_uri",
    "ssl_subject",
    "ssl_issuer",
    "http_user_agent",
}


def validate_mapping(mapping: dict, schema: list[dict], *, workspace_id: str | None = None) -> dict:
    names = {col["name"] for col in schema}
    label = mapping.get("label_column")
    features = mapping.get("feature_columns")
    if not isinstance(label, str) or label not in names:
        raise DataError("Choose an existing label column explicitly.")
    if (
        not isinstance(features, list)
        or not 1 <= len(features) <= 200
        or len(set(features)) != len(features)
        or any(not isinstance(col, str) or col not in names for col in features)
    ):
        raise DataError("Choose 1–200 unique feature columns from the inspected schema.")
    if label in features or any(col.strip().lower() in LABEL_NAMES for col in features):
        raise DataError(
            "Label and target-like columns cannot also be predictors. Select a task-specific feature schema."
        )
    if any(col.strip().lower() in IDENTIFIERS for col in features):
        raise DataError(
            "Exclude raw URLs, addresses, identities, timestamps, and direct identifier columns from the feature mapping."
        )
    strategy = mapping.get("split_strategy", "stratified")
    if strategy not in {"stratified", "group", "time"}:
        raise DataError("Split strategy must be stratified, group, or time.")
    for name in ("group_column", "time_column"):
        column = mapping.get(name)
        if column is not None and column not in names:
            raise DataError("The configured split column is absent from the schema.")
        if column and column in features:
            raise DataError("Group and time split columns must not also be model predictors.")
    if strategy == "group" and not mapping.get("group_column"):
        raise DataError("Group splitting requires an explicit group column.")
    if strategy == "time" and not mapping.get("time_column"):
        raise DataError("Time splitting requires an explicit time column.")
    categorical = mapping.get("categorical_columns", [])
    if not isinstance(categorical, list) or any(col not in features for col in categorical):
        raise DataError("Categorical columns must be selected feature columns.")
    if mapping.get("test_path"):
        allowed_dataset_path(mapping["test_path"], workspace_id=workspace_id)
    return {
        **mapping,
        "label_column": label,
        "feature_columns": features,
        "split_strategy": strategy,
        "categorical_columns": categorical,
    }


def assert_training_allowed(dataset, intended_use: str = "research") -> None:
    if dataset.task not in TASKS:
        raise DataError(
            "Dataset task must be network, iot, or phishing; tasks are trained separately."
        )
    if (
        dataset.license_status not in {"reviewed_noncommercial", "reviewed_permitted"}
        or not dataset.source.strip()
        or not dataset.citation.strip()
    ):
        raise DataError(
            "Training is blocked until an Owner/Admin records the original source, citation, and reviewed permission status."
        )
    if intended_use not in {"research", "commercial"}:
        raise DataError("Intended use must be research or commercial.")
    if intended_use == "commercial" and dataset.license_status != "reviewed_permitted":
        raise DataError(
            "Commercial use is blocked because the reviewed permission does not permit it."
        )


def _read_frame(path: Path, limit: int, label_column: str | None = None, seed: int = 42):
    import pandas as pd

    if path.suffix.lower() == ".csv":
        try:
            # For tabular CSV datasets, load and stratify across classes so that sorted/grouped
            # datasets (such as phishing or network traces) don't lose rare or end-of-file classes.
            if path.stat().st_size <= 300 * 1024 * 1024:
                df = pd.read_csv(path, low_memory=False, encoding="utf-8-sig")
                if len(df) > limit:
                    if label_column and label_column in df.columns and df[label_column].nunique() > 1:
                        sampled = df.groupby(label_column, group_keys=False).apply(
                            lambda x: x.sample(
                                min(len(x), max(2, int(limit * len(x) / len(df)) + 100)),
                                random_state=seed,
                            ),
                            include_groups=False,
                        )
                        sampled[label_column] = df.loc[sampled.index, label_column]
                        if len(sampled) > limit:
                            sampled = sampled.sample(limit, random_state=seed)
                        df = sampled.reset_index(drop=True)
                    else:
                        df = df.sample(limit, random_state=seed).reset_index(drop=True)
                return df
        except Exception:
            pass

    chunks = list(frame_chunks(path, limit))
    if not chunks:
        raise DataError("The dataset has no rows available within the configured limit.")
    return pd.concat(chunks, ignore_index=True)


def train_baseline(
    dataset,
    file,
    parameters: dict,
    job_id: str,
    progress=lambda value: None,
    cancelled=lambda: False,
) -> dict:
    """Returns actual benchmark metrics and one private pipeline artifact."""
    import joblib
    import numpy as np
    import pandas as pd
    import sklearn
    from sklearn.compose import ColumnTransformer
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.impute import SimpleImputer
    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import (
        accuracy_score,
        average_precision_score,
        classification_report,
        confusion_matrix,
        f1_score,
        roc_auc_score,
    )
    from sklearn.model_selection import GroupShuffleSplit, train_test_split
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import OneHotEncoder, StandardScaler, label_binarize

    def check_cancelled():
        if cancelled():
            raise DataError(
                "Job cancellation requested; training stopped at a safe phase boundary."
            )

    assert_training_allowed(dataset, parameters.get("intended_use", "research"))
    mapping = validate_mapping(
        dataset.mapping or {}, file.schema_json, workspace_id=dataset.workspace_id
    )
    algorithm = parameters.get("algorithm", "logistic_regression")
    if algorithm not in ALGORITHMS:
        raise DataError("Choose logistic_regression or random_forest explicitly.")
    maximum = min(200_000, int(os.getenv("MAX_DATASET_ROWS", "50000")))
    limit = int(parameters.get("row_limit", maximum))
    if not 50 <= limit <= maximum:
        raise DataError(f"Training row limit must be between 50 and {maximum}.")
    test_size = float(parameters.get("test_size", 0.2))
    if not 0.1 <= test_size <= 0.4:
        raise DataError("Evaluation fraction must be between 0.1 and 0.4.")
    seed = int(parameters.get("seed", 42))
    path = allowed_dataset_path(file.path, workspace_id=dataset.workspace_id)
    checksum = checksum_file(path)
    if not file.checksum or checksum != file.checksum:
        raise DataError(
            "Dataset file changed or has not been ingested; ingest the current file before training."
        )
    check_cancelled()
    progress(10)
    label = mapping["label_column"]
    features = mapping["feature_columns"]
    frame = _read_frame(path, limit, label_column=label, seed=seed)
    if not {label, *features}.issubset(frame.columns):
        raise DataError("Mapped label/features no longer match the file schema.")
    frame = frame.dropna(subset=[label]).copy()
    frame[label] = frame[label].astype(str)
    frame[features] = frame[features].replace([np.inf, -np.inf], np.nan)
    original_rows = len(frame)
    # Feature duplicates cannot be allowed on opposite sides of a split.
    feature_hash = pd.util.hash_pandas_object(frame[features], index=False)
    label_counts = frame.groupby(feature_hash)[label].nunique()
    conflicts = set(label_counts[label_counts > 1].index)
    conflicting_rows = int(feature_hash.isin(conflicts).sum())
    frame = (
        frame.loc[~feature_hash.isin(conflicts)]
        .drop_duplicates(subset=features)
        .reset_index(drop=True)
    )
    # Prune singleton classes (< 2 instances) so stratified splitting has sufficient examples
    counts = frame[label].value_counts()
    singletons = set(counts[counts < 2].index)
    if singletons:
        frame = frame.loc[~frame[label].isin(singletons)].reset_index(drop=True)

    if len(frame) < 30 or frame[label].nunique() < 2:
        raise DataError(
            "Too few independent rows or classes remain after duplicate/leakage cleaning."
        )
    if frame[label].nunique() > 100:
        raise DataError(
            "More than 100 target classes were found; verify that the selected label is a true class label."
        )
    progress(25)
    check_cancelled()
    official_test_checksum = None
    overlap_removed = 0
    strategy = mapping.get("split_strategy", "stratified")
    if mapping.get("test_path"):
        test_path = allowed_dataset_path(mapping["test_path"], workspace_id=dataset.workspace_id)
        if test_path == path:
            raise DataError("An explicit evaluation file must differ from the training file.")
        test_frame = _read_frame(test_path, limit, label_column=label, seed=seed)
        if not {label, *features}.issubset(test_frame.columns):
            raise DataError(
                "Explicit evaluation file does not match the exact training feature/label schema."
            )
        test_frame = test_frame.dropna(subset=[label]).copy()
        test_frame[label] = test_frame[label].astype(str)
        test_frame[features] = test_frame[features].replace([np.inf, -np.inf], np.nan)
        test_frame = test_frame.drop_duplicates(subset=features)
        train_hashes = set(pd.util.hash_pandas_object(frame[features], index=False))
        test_hashes = pd.util.hash_pandas_object(test_frame[features], index=False)
        overlap_removed = int(test_hashes.isin(train_hashes).sum())
        test_frame = test_frame.loc[~test_hashes.isin(train_hashes)]
        train_frame = frame
        strategy = "explicit_separate_file"
        official_test_checksum = checksum_file(test_path)
    elif strategy == "group":
        if frame[mapping["group_column"]].isna().any():
            raise DataError(
                "Group split column contains missing values; provide complete group identifiers."
            )
        groups = frame[mapping["group_column"]].astype(str)
        if groups.nunique() < 2:
            raise DataError("Group splitting requires at least two distinct groups.")
        train_indices, test_indices = next(
            GroupShuffleSplit(n_splits=1, test_size=test_size, random_state=seed).split(
                frame, groups=groups
            )
        )
        train_frame, test_frame = frame.iloc[train_indices], frame.iloc[test_indices]
    elif strategy == "time":
        times = pd.to_datetime(frame[mapping["time_column"]], errors="coerce", utc=True)
        if times.isna().any():
            raise DataError(
                "Time split column has invalid timestamps; choose a valid explicit time mapping."
            )
        frame = frame.assign(_split_time=times).sort_values("_split_time", kind="stable")
        cut = int(len(frame) * (1 - test_size))
        boundary = frame.iloc[cut]["_split_time"]
        train_frame = frame.loc[frame["_split_time"] < boundary]
        test_frame = frame.loc[frame["_split_time"] >= boundary]
    else:
        try:
            train_frame, test_frame = train_test_split(
                frame, test_size=test_size, random_state=seed, stratify=frame[label]
            )
        except ValueError as exc:
            raise DataError(
                "Class counts are insufficient for the requested stratified evaluation split."
            ) from exc
    unseen_test = set(test_frame[label]) - set(train_frame[label])
    if unseen_test:
        test_frame = test_frame.loc[~test_frame[label].isin(unseen_test)].reset_index(drop=True)
    if not len(train_frame) or len(test_frame) < 2 or train_frame[label].nunique() < 2:
        raise DataError(
            "Chosen split does not contain enough training/evaluation rows and classes."
        )
    categorical = [
        col
        for col in features
        if col in mapping.get("categorical_columns", [])
        or not pd.api.types.is_numeric_dtype(train_frame[col])
    ]
    numeric = [col for col in features if col not in categorical]

    # Convert feature types without learning any population statistics before split.
    def format_features(selected):
        result = selected[features].copy()
        for col in numeric:
            result[col] = pd.to_numeric(result[col], errors="coerce")
        for col in categorical:
            result[col] = result[col].map(lambda value: str(value) if pd.notna(value) else np.nan)
        return result

    numeric_pipe = Pipeline(
        [
            ("impute", SimpleImputer(strategy="median", keep_empty_features=True)),
            ("scale", StandardScaler()),
        ]
    )
    category_pipe = Pipeline(
        [
            ("impute", SimpleImputer(strategy="most_frequent", keep_empty_features=True)),
            ("encode", OneHotEncoder(handle_unknown="infrequent_if_exist", max_categories=32)),
        ]
    )
    transformers = []
    if numeric:
        transformers.append(("numeric", numeric_pipe, numeric))
    if categorical:
        transformers.append(("categorical", category_pipe, categorical))
    preprocessing = ColumnTransformer(transformers, remainder="drop")
    estimator = (
        LogisticRegression(max_iter=300, class_weight="balanced", random_state=seed)
        if algorithm == "logistic_regression"
        else RandomForestClassifier(
            n_estimators=min(200, max(20, int(parameters.get("n_estimators", 100)))),
            max_depth=min(30, max(2, int(parameters.get("max_depth", 16)))),
            class_weight="balanced_subsample",
            n_jobs=1,
            random_state=seed,
        )
    )
    pipeline = Pipeline([("preprocess", preprocessing), ("estimator", estimator)])
    progress(40)
    check_cancelled()
    # This is the only fit call. Imputers, encoders, scaler and estimator see training rows only.
    pipeline.fit(format_features(train_frame), train_frame[label])
    check_cancelled()
    progress(75)
    x_test = format_features(test_frame)
    y_test = test_frame[label]
    predicted = pipeline.predict(x_test)
    classes = list(pipeline.classes_)
    probabilities = pipeline.predict_proba(x_test)
    metrics = {
        "accuracy": float(accuracy_score(y_test, predicted)),
        "macro_f1": float(
            f1_score(y_test, predicted, labels=classes, average="macro", zero_division=0)
        ),
        "per_class": classification_report(
            y_test, predicted, labels=classes, output_dict=True, zero_division=0
        ),
        "confusion_matrix": {
            "labels": classes,
            "matrix": confusion_matrix(y_test, predicted, labels=classes).tolist(),
        },
        "roc_auc": None,
        "pr_auc": None,
    }
    if len(classes) == 2 and y_test.nunique() == 2:
        binary = (y_test == classes[1]).astype(int)
        metrics["roc_auc"] = float(roc_auc_score(binary, probabilities[:, 1]))
        metrics["pr_auc"] = float(average_precision_score(binary, probabilities[:, 1]))
        metrics["positive_class"] = classes[1]
    elif len(classes) > 2 and set(y_test) == set(classes):
        metrics["roc_auc"] = float(
            roc_auc_score(y_test, probabilities, labels=classes, multi_class="ovr", average="macro")
        )
        metrics["pr_auc"] = float(
            average_precision_score(
                label_binarize(y_test, classes=classes), probabilities, average="macro"
            )
        )
    feature_schema = {
        "columns": features,
        "numeric_columns": numeric,
        "categorical_columns": categorical,
        "types": {col: "numeric" if col in numeric else "categorical" for col in features},
    }
    metadata = {
        "evaluation_scope": "offline_benchmark",
        "not_validated_for_live_telemetry": True,
        "dataset_id": dataset.id,
        "dataset_version": dataset.version,
        "dataset_checksum": checksum,
        "test_file_checksum": official_test_checksum,
        "task": dataset.task,
        "target_mode": "binary" if len(classes) == 2 else "multiclass",
        "label_column": label,
        "classes": classes,
        "feature_schema": feature_schema,
        "algorithm": algorithm,
        "parameters": estimator.get_params(),
        "preprocessing": {
            "numeric": "training median imputation + standard scaling",
            "categorical": "training most-frequent imputation + capped one-hot encoding",
            "fitted_on_training_only": True,
        },
        "split_strategy": strategy,
        "seed": seed,
        "input_rows": original_rows,
        "independent_rows": len(frame),
        "duplicate_or_conflicting_rows_removed": original_rows - len(frame),
        "conflicting_feature_rows_removed": conflicting_rows,
        "evaluation_overlap_rows_removed": overlap_removed,
        "training_rows": len(train_frame),
        "evaluation_rows": len(test_frame),
        "row_limit": limit,
        "training_class_distribution": train_frame[label].value_counts().to_dict(),
        "evaluation_class_distribution": y_test.value_counts().to_dict(),
        "limitations": [
            "Bounded prefix sampling may underrepresent temporal variation or rare classes.",
            "Class imbalance can make accuracy misleading; inspect per-class recall and macro-F1.",
            "Random stratification does not remove temporal or entity correlations; prefer explicit group/time mapping where available.",
            "This benchmark is not evidence of live detection effectiveness.",
        ],
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "code_version": os.getenv("CODE_VERSION", "development"),
        "scikit_learn_version": sklearn.__version__,
    }
    metadata["source_code_sha256"] = source_fingerprint()
    # Make all metadata JSON-safe before writing either the DB or bundle.
    metadata = json.loads(
        json.dumps(
            metadata, default=lambda value: value.item() if hasattr(value, "item") else str(value)
        )
    )
    metrics = json.loads(
        json.dumps(
            metrics, default=lambda value: value.item() if hasattr(value, "item") else str(value)
        )
    )
    destination = artifact_path(dataset.workspace_id, job_id)
    temporary = destination.with_suffix(".tmp")
    joblib.dump(
        {
            "pipeline": pipeline,
            "feature_schema": feature_schema,
            "metadata": metadata,
            "metrics": metrics,
        },
        temporary,
    )
    os.replace(temporary, destination)
    metadata["artifact_sha256"] = checksum_file(destination)
    progress(95)
    return {
        "artifact_path": str(destination),
        "feature_schema": feature_schema,
        "metadata": metadata,
        "metrics": metrics,
    }


def predict_rows(model, rows: list[dict]) -> dict:
    import joblib
    import pandas as pd
    import numpy as np

    if not model.active or model.status != "active":
        raise DataError(
            "Requested model version is inactive; an Owner/Admin must activate it first."
        )
    schema = model.feature_schema
    if not isinstance(rows, list) or not 1 <= len(rows) <= 1000:
        raise DataError("Prediction requires 1–1,000 rows.")
    columns = schema.get("columns", [])
    if any(not isinstance(row, dict) or set(row) != set(columns) for row in rows):
        raise DataError(
            "Every prediction row must match the exact registered feature schema with no missing or extra columns."
        )
    for row in rows:
        for column in columns:
            value = row[column]
            if value is None:
                continue
            if column in schema.get("numeric_columns", []) and (
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not np.isfinite(value)
            ):
                raise DataError("Numeric features must be finite numbers or null.")
            if column in schema.get("categorical_columns", []) and (
                not isinstance(value, str) or len(value) > 500
            ):
                raise DataError(
                    "Categorical features must be strings of at most 500 characters or null."
                )
    artifact = trusted_artifact(model.artifact_path)
    expected = model.metadata_json.get("artifact_sha256")
    if expected and checksum_file(artifact) != expected:
        raise DataError("The private model artifact no longer matches its registered checksum.")
    bundle = joblib.load(artifact)
    if bundle["feature_schema"] != schema:
        raise DataError("Stored model schema does not match the registry.")
    frame = pd.DataFrame(rows, columns=columns).replace({None: np.nan})
    predictions = bundle["pipeline"].predict(frame)
    probabilities = bundle["pipeline"].predict_proba(frame)
    return {
        "model_version_id": model.id,
        "evaluation_scope": "offline_benchmark_model",
        "classes": list(bundle["pipeline"].classes_),
        "predictions": predictions.tolist(),
        "probabilities": probabilities.tolist(),
        "warning": "Not validated for authorized live telemetry; predictions do not establish compromise.",
    }
