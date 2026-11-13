# Optional assistant and threat context

## Assistant

The application starts without an API key or local model when `AI_PROVIDER=none`. Provider status distinguishes configured credentials/model names from a verified connection and lists missing configuration fields without exposing secrets. Choosing an unsupported provider or an invalid local base URL gives a configuration error rather than a misleading ready state.

The interface offers two explicit modes:

- **Workspace guide (no LLM):** fixed-template explanations of current, authorized workspace records. It works without a model, has record citations, and labels every answer as deterministic. It can summarize inventory, explain rule-based finding risk, show modeled simulations, compare ranked recommendations, and list each dataset's training blockers. It cannot run jobs, approve permissions, create defenses, or activate models.
- **AI provider:** open-ended text generation through an intentionally configured local model or the optional OpenAI adapter. An unavailable provider returns an error. AEGIS never silently replaces that request with the workspace guide or claims the guide is a live AI answer.

Both modes retain private user/workspace conversation history. A guide conversation is marked `[Workspace guide]` and cannot be reused for provider messages, or vice versa. History responses include the mode and read-only references; guide messages explicitly declare `llm_used=false`. Mode metadata is derived from the reserved conversation marker because the existing database schema has no separate provider column. Historical provider messages do not claim a saved exact model/provider version.

### Local workspace guide API

Send `POST /api/workspaces/{workspace_id}/assistant/guide` with `content`, an optional existing guide `conversation_id`, and optional paired `context_type`/`context_id`. The response returns the persisted conversation, answer message, actual record references, `provider=workspace_guide`, `mode=deterministic`, and `llm_used=false`. A first question creates a guide conversation only after its context has been validated. Invalid or foreign context creates no orphan conversation or question.

Training-readiness explanations report the selected task, original-source and citation gaps, permission review, file ingestion status, and explicit feature/label mapping. They do not infer permission from a filename, execute training, or invent metrics. The chat provider and offline intrusion/phishing classifiers remain separate components.

The OpenAI adapter uses the current Responses API shape and read-only function calls described in the [official OpenAI documentation](https://developers.openai.com/api/docs/guides/function-calling). Supply `OPENAI_API_KEY` and an explicitly chosen `OPENAI_MODEL` on the backend only when you deliberately enable it. The application does not silently choose a model or create/reuse a key. Requests set `store=false`; that request setting is not a broader guarantee about an account's provider retention policies.

The optional local adapter expects an intentionally configured OpenAI-compatible `/chat/completions` endpoint and model. It sends bounded, backend-selected context. General summary questions receive at most three active finding examples, ordered by stored base score, and two asset records when their words do not match a record name. Contextual entry points instead retrieve the selected scoped record.

CPU inference is bounded by `LOCAL_AI_TIMEOUT_SECONDS` (default 90, clamped to 10–180 seconds) and `LOCAL_AI_MAX_TOKENS` (default 450, clamped to 32–1400 output tokens). Connect timeout is 10 seconds. These settings apply only to the local adapter. The optional local-model Compose service/model installation must complete before the configured local provider can answer; environment configuration alone does not prove model availability. Check the main setup guide for the currently installed local model and verification status.

### Data and tool permissions

The backend checks the current session, workspace membership, role, CSRF token, and request rate before a configured chat request. Conversations belong to a user **and** workspace. A user cannot read another member's conversation merely because both have workspace access.

The OpenAI tool surface contains only `lookup_workspace_records`. It supports bounded, read-only asset, event, finding, vulnerability, relationship, simulation, recommendation, and report retrieval. Every query has an enforced workspace filter. Unsupported tool names are rejected by application code. No scan, command, external action, model activation, or approval function is exposed.

Imported notes, logs, and descriptions are quoted as untrusted context. The system instructions ask the provider to ignore embedded commands and cite actual record identifiers, but instructions alone are not the permission boundary: the backend tool allowlist and scoped queries enforce it. No claim is made that arbitrary model text is guaranteed correct or immune to all prompt injection. Treat an answer as analyst assistance and verify its record references.

Provider failures return a concise error and never fabricate an assistant answer. A question remains in history after a failed provider call, with an audit record of failure and no generated assistant message. Invalid context is rejected before the question is saved or a provider request is made. The separately selected workspace guide and non-chat workflows remain available while a provider is unavailable.

## NVD

The adapter is limited to explicit CVE identifiers against the configured NVD API endpoint. It never contacts an asset address. `INTEGRATION_NETWORK_ENABLED=false` blocks outbound enrichment by default. The optional `NVD_API_KEY` stays on the server. Redis coordinates a conservative client-side request interval, and upstream HTTP 429 responses become persisted, readable retry errors.

Reference: [NVD developer documentation](https://nvd.nist.gov/developers/vulnerabilities). This delivery does not claim a successful live NVD connection, current feed completeness, current KEV membership, or verified applicability to an asset. Retrieved records preserve source and retrieval metadata.

## MITRE ATT&CK

Supply a local STIX JSON bundle through a configured read-only dataset root/private upload directory, plus its source and version. AEGIS imports active technique records and skips revoked/deprecated entries. This is a local import, not a live feed. It does not automatically download a dataset.

Use the [official ATT&CK STIX repository](https://github.com/mitre-attack/attack-stix-data) and [usage documentation](https://github.com/mitre-attack/attack-stix-data/blob/master/USAGE.md) to identify the original source and version. Preserve the original usage terms and attribution. AEGIS's imported subset is not a complete implementation of every STIX object type or relationship.

## Unavailable connectors

Real telemetry/discovery connectors and infrastructure change execution are not implemented. Editing authorized scope does not enable a connector. Guardian Gate decisions never execute a real defensive change.
