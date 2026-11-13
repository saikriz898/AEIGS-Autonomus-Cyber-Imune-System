from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select, func, or_
from sqlalchemy.orm import Session

from .db import get_db
from . import models as m
from .security import current_user, require_workspace, ensure_csrf, audit, enforce_rate_limit
from .ai_providers import get_provider, provider_status, ProviderUnavailable, ProviderFailure

router = APIRouter(prefix="/api/workspaces/{workspace_id}/assistant", tags=["AI assistant"])
ROLES = ["Owner", "Admin", "Analyst"]
RECORDS = {
    "assets": (
        m.Asset,
        [
            "id",
            "name",
            "asset_type",
            "criticality",
            "exposure",
            "status",
            "owner",
            "notes",
            "provenance",
        ],
    ),
    "events": (
        m.SecurityEvent,
        ["id", "asset_id", "title", "severity", "category", "status", "evidence", "provenance"],
    ),
    "findings": (
        m.Finding,
        [
            "id",
            "asset_id",
            "vulnerability_id",
            "title",
            "description",
            "severity",
            "base_score",
            "evidence",
            "factors",
            "status",
            "technique",
        ],
    ),
    "vulnerabilities": (
        m.Vulnerability,
        ["id", "cve", "title", "description", "cvss", "source", "retrieved_at"],
    ),
    "relationships": (m.AssetRelationship, ["id", "source_id", "target_id", "label", "kind"]),
    "simulations": (
        m.Simulation,
        [
            "id",
            "scenario_id",
            "outcome",
            "risk_score",
            "assumptions",
            "path_asset_ids",
            "started_at",
        ],
    ),
    "recommendations": (
        m.Recommendation,
        [
            "id",
            "asset_id",
            "finding_id",
            "title",
            "risk_reduction",
            "disruption",
            "effort",
            "evidence_confidence",
            "rationale",
            "control",
        ],
    ),
    "reports": (m.Report, ["id", "name", "status", "content", "created_at"]),
}
ALIASES = {
    "asset": "assets",
    "event": "events",
    "finding": "findings",
    "vulnerability": "vulnerabilities",
    "graph": "relationships",
    "simulation": "simulations",
    "recommendation": "recommendations",
    "report": "reports",
}


class NewConversation(BaseModel):
    title: str = Field(default="Workspace analysis", min_length=1, max_length=200)
    mode: Literal["provider", "workspace_guide"] = "provider"


class SendMessage(BaseModel):
    content: str = Field(min_length=1, max_length=6000)
    context_type: str | None = Field(default=None, max_length=30)
    context_id: str | None = Field(default=None, max_length=64)


class GuideMessage(SendMessage):
    conversation_id: str | None = Field(default=None, max_length=64)


GUIDE_PREFIX = "[Workspace guide] "
GUIDE_LABEL = "Workspace guide · deterministic · no LLM"


def conversation_payload(conversation):
    guide = conversation.title.startswith(GUIDE_PREFIX)
    return {
        **m.serialize(conversation),
        "mode": "workspace_guide" if guide else "provider",
        "provider": "workspace_guide" if guide else "configured_provider",
        "llm_used": False if guide else None,
    }


def message_payload(message, conversation):
    return {
        **m.serialize(message),
        "mode": conversation_payload(conversation)["mode"],
        "provider": conversation_payload(conversation)["provider"],
        "llm_used": False if conversation.title.startswith(GUIDE_PREFIX) else None,
    }


def lookup_records(
    db: Session,
    workspace_id: str,
    record_type: str,
    query: str = "",
    record_id: str | None = None,
    limit: int = 5,
) -> list[dict]:
    kind = ALIASES.get(record_type, record_type)
    if kind not in RECORDS:
        return []
    model, fields = RECORDS[kind]
    stmt = select(model).where(model.workspace_id == workspace_id)
    if record_id:
        stmt = stmt.where(model.id == record_id)
    elif query.strip():
        terms = [term[:50] for term in query.split() if len(term) >= 2][:5]
        searchable = [
            getattr(model, key) for key in ["name", "title", "cve", "label"] if hasattr(model, key)
        ]
        if not terms or not searchable:
            return []
        stmt = stmt.where(
            or_(
                *[
                    func.lower(col).contains(term.lower(), autoescape=True)
                    for col in searchable
                    for term in terms
                ]
            )
        )
    results = []
    for row in db.scalars(stmt.order_by(model.created_at.desc()).limit(min(10, max(1, limit)))):
        record = {"record_type": kind}
        for field in fields:
            value = getattr(row, field)
            if hasattr(value, "isoformat"):
                value = value.isoformat()
            if isinstance(value, str):
                value = value[: 2000 if field == "content" else 1000]
            record[field] = value
        results.append(record)
    return results


def owned_conversation(db, user, wid, cid):
    require_workspace(db, user, wid)
    conversation = db.scalar(
        select(m.Conversation).where(
            m.Conversation.id == cid,
            m.Conversation.workspace_id == wid,
            m.Conversation.user_id == user.id,
        )
    )
    if not conversation:
        raise HTTPException(404, "Conversation not found.")
    return conversation


@router.get("/status")
def status(workspace_id: str, db: Session = Depends(get_db), user=Depends(current_user)):
    membership = require_workspace(db, user, workspace_id)
    return {**provider_status(), "can_send_messages": membership.role in ROLES}


@router.get("/conversations")
def conversations(workspace_id: str, db: Session = Depends(get_db), user=Depends(current_user)):
    require_workspace(db, user, workspace_id)
    return [
        conversation_payload(c)
        for c in db.scalars(
            select(m.Conversation)
            .where(m.Conversation.workspace_id == workspace_id, m.Conversation.user_id == user.id)
            .order_by(m.Conversation.updated_at.desc())
            .limit(100)
        )
    ]


@router.post("/conversations", dependencies=[Depends(ensure_csrf)])
def create_conversation(
    workspace_id: str,
    body: NewConversation,
    db: Session = Depends(get_db),
    user=Depends(current_user),
):
    require_workspace(db, user, workspace_id, ROLES)
    title = body.title.strip()
    if not title:
        raise HTTPException(422, "Enter a conversation title.")
    if body.mode == "workspace_guide":
        title = GUIDE_PREFIX + title.removeprefix(GUIDE_PREFIX)[:180]
    elif title.startswith(GUIDE_PREFIX):
        raise HTTPException(422, "Use workspace_guide mode for a workspace guide conversation.")
    conversation = m.Conversation(workspace_id=workspace_id, user_id=user.id, title=title)
    db.add(conversation)
    db.flush()
    audit(
        db,
        workspace_id,
        user.id,
        "Workspace guide conversation created"
        if body.mode == "workspace_guide"
        else "AI conversation created",
        "Created a private conversation; no provider request was made.",
        "conversation",
        conversation.id,
    )
    db.commit()
    return conversation_payload(conversation)


@router.get("/conversations/{conversation_id}")
def read_conversation(
    workspace_id: str,
    conversation_id: str,
    db: Session = Depends(get_db),
    user=Depends(current_user),
):
    conversation = owned_conversation(db, user, workspace_id, conversation_id)
    messages = db.scalars(
        select(m.Message)
        .where(m.Message.workspace_id == workspace_id, m.Message.conversation_id == conversation_id)
        .order_by(m.Message.created_at)
        .limit(300)
    )
    return {
        "conversation": conversation_payload(conversation),
        "messages": [message_payload(message, conversation) for message in messages],
    }


@router.post("/conversations/{conversation_id}/messages", dependencies=[Depends(ensure_csrf)])
def send(
    workspace_id: str,
    conversation_id: str,
    body: SendMessage,
    request: Request,
    db: Session = Depends(get_db),
    user=Depends(current_user),
):
    require_workspace(db, user, workspace_id, ROLES)
    conversation = owned_conversation(db, user, workspace_id, conversation_id)
    if conversation.title.startswith(GUIDE_PREFIX):
        raise HTTPException(
            409,
            "This conversation uses the deterministic workspace guide. Send to /assistant/guide or start a separate AI provider conversation.",
        )
    content = body.content.strip()
    if not content:
        raise HTTPException(422, "Enter a question.")
    try:
        provider = get_provider()
    except ProviderUnavailable as error:
        raise HTTPException(503, str(error)) from None
    enforce_rate_limit(request, "chat", 6, 60, user.id)
    kind = ALIASES.get(body.context_type or "", body.context_type or "")
    context = []
    if body.context_type or body.context_id:
        if not kind or not body.context_id:
            raise HTTPException(422, "A context requires both its record type and identifier.")
        context = lookup_records(db, workspace_id, kind, record_id=body.context_id, limit=1)
        if not context:
            raise HTTPException(
                404,
                "The requested context record is unavailable in this workspace. No question was saved or provider request made.",
            )
    else:
        context = lookup_records(db, workspace_id, "findings", content, limit=3) + lookup_records(
            db, workspace_id, "assets", content, limit=3
        )
        if not context:
            # A general summary question need not contain an asset/finding name.
            # Send a small, authorized evidence sample instead of an empty prompt.
            examples = list(
                db.scalars(
                    select(m.Finding.id)
                    .where(
                        m.Finding.workspace_id == workspace_id,
                        m.Finding.status != "Resolved",
                    )
                    .order_by(m.Finding.base_score.desc(), m.Finding.id)
                    .limit(3)
                )
            )
            context = [
                record
                for record_id in examples
                for record in lookup_records(
                    db, workspace_id, "findings", record_id=record_id, limit=1
                )
            ] + lookup_records(db, workspace_id, "assets", limit=2)
    query = (
        select(m.Message)
        .where(m.Message.workspace_id == workspace_id, m.Message.conversation_id == conversation_id)
        .order_by(m.Message.created_at.desc())
        .limit(12)
    )
    history = [
        {"role": message.role, "content": message.content[:6000]}
        for message in reversed(list(db.scalars(query)))
    ]
    user_message = m.Message(
        workspace_id=workspace_id,
        conversation_id=conversation_id,
        role="user",
        content=content,
        references=[],
    )
    db.add(user_message)
    conversation.updated_at = m.now()
    db.commit()
    try:
        answer, evidence = provider.answer(
            history + [{"role": "user", "content": content}],
            context,
            lambda record_type, query, record_id, limit: lookup_records(
                db, workspace_id, record_type, query, record_id, limit
            ),
        )
    except ProviderFailure as error:
        audit(
            db,
            workspace_id,
            user.id,
            "AI provider request failed",
            "The configured provider did not return a usable answer. No assistant response was fabricated.",
            "conversation",
            conversation_id,
        )
        db.commit()
        raise HTTPException(502, str(error)) from None
    references = []
    seen = set()
    for record in evidence:
        marker = (record.get("record_type"), record.get("id"))
        if marker not in seen and marker[1]:
            seen.add(marker)
            references.append({"record_type": marker[0], "id": marker[1]})
    assistant_message = m.Message(
        workspace_id=workspace_id,
        conversation_id=conversation_id,
        role="assistant",
        content=answer[:16000],
        references=references,
    )
    db.add(assistant_message)
    conversation.updated_at = m.now()
    audit(
        db,
        workspace_id,
        user.id,
        "AI answer recorded",
        f"Read-only provider response with {len(references)} authorized record references.",
        "conversation",
        conversation_id,
    )
    db.commit()
    return {
        "message": message_payload(assistant_message, conversation),
        "references": references,
        "provider": provider_status()["provider"],
        "mode": "provider",
    }


def workspace_guide_answer(db, workspace_id: str, body: SendMessage) -> tuple[str, list[dict]]:
    """Generate fixed-template evidence summaries, without an LLM or side effects."""
    from .domain import risk_for_finding, rank_recommendations

    workspace = db.get(m.Workspace, workspace_id)
    if not workspace:
        raise HTTPException(404, "Workspace not found.")
    content = body.content.strip().lower()
    lines = [
        GUIDE_LABEL,
        "This is a fixed-template explanation of stored records, not an AI model response. No action was executed.",
        "",
    ]
    references = []

    def cite(record_type: str, record_id: str):
        marker = {"record_type": record_type, "id": record_id}
        if marker not in references:
            references.append(marker)

    def count(model, *conditions):
        return (
            db.scalar(
                select(func.count())
                .select_from(model)
                .where(model.workspace_id == workspace_id, *conditions)
            )
            or 0
        )

    kind = ALIASES.get(body.context_type or "", body.context_type or "")
    if body.context_type or body.context_id:
        if not kind or not body.context_id:
            raise HTTPException(422, "A context requires both its record type and identifier.")
        records = lookup_records(db, workspace_id, kind, record_id=body.context_id, limit=1)
        if not records:
            raise HTTPException(
                404,
                "Context record is unavailable in this workspace. No guide conversation was changed.",
            )
        record = records[0]
        cite(kind, record["id"])
        lines += [
            f"Selected {kind.rstrip('s')} [{record['id']}]: {record.get('name') or record.get('title') or record.get('outcome') or record.get('label') or 'stored record'}."
        ]
        if kind == "assets":
            asset = db.scalar(
                select(m.Asset).where(
                    m.Asset.id == record["id"], m.Asset.workspace_id == workspace_id
                )
            )
            lines += [
                f"Type: {asset.asset_type}; criticality: {asset.criticality}; exposure: {asset.exposure}; status: {asset.status}; provenance: {asset.provenance}."
            ]
            findings = list(
                db.scalars(
                    select(m.Finding)
                    .where(m.Finding.workspace_id == workspace_id, m.Finding.asset_id == asset.id)
                    .order_by(m.Finding.base_score.desc())
                    .limit(5)
                )
            )
            for finding in findings:
                risk = risk_for_finding(finding, asset, workspace.settings)
                lines.append(
                    f"- Finding [{finding.id}] {finding.title}: {finding.status}; modeled risk {risk['score']}/100. {risk['explanation']}"
                )
                cite("findings", finding.id)
            if not findings:
                lines.append(
                    "No finding records are attached to this asset. This does not establish that it is secure."
                )
        elif kind == "findings":
            finding = db.scalar(
                select(m.Finding).where(
                    m.Finding.id == record["id"], m.Finding.workspace_id == workspace_id
                )
            )
            asset = db.scalar(
                select(m.Asset).where(
                    m.Asset.id == finding.asset_id, m.Asset.workspace_id == workspace_id
                )
            )
            if asset:
                risk = risk_for_finding(finding, asset, workspace.settings)
                lines += [
                    f"Affected asset [{asset.id}] {asset.name}. Modeled risk {risk['score']}/100. {risk['explanation']}",
                    f"Stored evidence: {finding.evidence[:1200]}",
                ]
                cite("assets", asset.id)
        lines.append("")

    if any(
        word in content for word in ("train", "model", "dataset", "license", "permission", "ingest")
    ):
        dataset_count = count(m.DatasetRegistry)
        lines += [
            f"Training readiness: {dataset_count} registered dataset records; {count(m.ModelVersion)} model versions actually stored.",
            "The guide does not ingest files, train models, approve permissions, or activate versions.",
        ]
        rows = list(
            db.scalars(
                select(m.DatasetRegistry)
                .where(m.DatasetRegistry.workspace_id == workspace_id)
                .order_by(m.DatasetRegistry.created_at.desc())
                .limit(20)
            )
        )
        for dataset in rows:
            blockers = []
            if dataset.task not in {"network", "iot", "phishing"}:
                blockers.append("assign an explicit network, IoT, or phishing task")
            if not dataset.source.strip():
                blockers.append("record the original source")
            if not dataset.citation.strip():
                blockers.append("record citation and permission evidence")
            if dataset.license_status not in {"reviewed_noncommercial", "reviewed_permitted"}:
                blockers.append("Owner/Admin must review usage permission")
            file = db.scalar(
                select(m.DatasetFile)
                .where(
                    m.DatasetFile.workspace_id == workspace_id,
                    m.DatasetFile.dataset_id == dataset.id,
                )
                .order_by(m.DatasetFile.created_at)
            )
            if not file or file.status != "ingested" or not file.checksum:
                blockers.append("complete ingestion of the selected file")
            if not dataset.mapping.get("label_column") or not dataset.mapping.get(
                "feature_columns"
            ):
                blockers.append("save explicit label and feature mapping")
            if dataset.license_status == "reviewed_noncommercial":
                blockers.append("commercial use remains blocked by noncommercial permission")
            readiness = (
                "; ".join(blockers)
                if blockers
                else "recorded prerequisites are present; submit a separate training job for worker-side schema/integrity checks"
            )
            lines.append(
                f"- Dataset [{dataset.id}] {dataset.name}: task={dataset.task}; permission={dataset.license_status}; status={dataset.status}. Next: {readiness}."
            )
            cite("datasets", dataset.id)
        if not rows:
            lines.append(
                "No dataset registrations exist in this workspace. An Owner/Admin can synchronize the mounted-file catalog; then select task, source, permission review, mapping, and ingestion explicitly."
            )
        if dataset_count > len(rows):
            lines.append(
                f"Showing readiness for {len(rows)} of {dataset_count} datasets; open Dataset Management for the remaining records."
            )
        lines.append(
            "The foundation chat provider is separate from these offline classifiers. No successful training or metrics are inferred from file presence."
        )
    elif any(word in content for word in ("risk", "finding", "vulnerab", "critical")):
        active = count(m.Finding, m.Finding.status != "Resolved")
        lines.append(
            f"There are {active} active finding records in this workspace. Rule scores are deterministic; they are not ML predictions or proof of compromise."
        )
        examples = list(
            db.execute(
                select(m.Finding, m.Asset)
                .join(m.Asset, m.Asset.id == m.Finding.asset_id)
                .where(
                    m.Finding.workspace_id == workspace_id,
                    m.Asset.workspace_id == workspace_id,
                    m.Finding.status != "Resolved",
                )
                .order_by(m.Finding.base_score.desc())
                .limit(5)
            )
        )
        for finding, asset in examples:
            risk = risk_for_finding(finding, asset, workspace.settings)
            lines.append(
                f"- Finding [{finding.id}] {finding.title}, asset [{asset.id}] {asset.name}: {risk['score']}/100. {risk['explanation']}"
            )
            cite("findings", finding.id)
            cite("assets", asset.id)
        if not examples:
            lines.append(
                "No active findings are recorded. Missing findings do not validate security."
            )
        lines.append(
            "Examples are ordered by stored base score. Review the Risk Intelligence page for full record context and current rules."
        )
    elif any(word in content for word in ("recommend", "defen", "guardian", "approv")):
        ranked = rank_recommendations(db, workspace_id)
        lines.append(
            "Recommendation priority = reduction × 2 + confidence × 10 − disruption × 5 − effort × 3. These are planning estimates, not measured efficacy."
        )
        for recommendation in ranked[:5]:
            decision = recommendation.get("latest_decision")
            lines.append(
                f"- Recommendation [{recommendation['id']}] #{recommendation['rank']} {recommendation['title']}: priority {recommendation['score']}; review={decision['decision'] if decision else 'pending'}. {recommendation['rationale']}"
            )
            cite("recommendations", recommendation["id"])
        if not ranked:
            lines.append("No defensive recommendations are recorded.")
        lines.append(
            "Guardian Gate records a human decision only; it never changes infrastructure."
        )
    elif any(word in content for word in ("simulat", "path", "twin", "graph")):
        lines.append(
            f"The stored Digital Twin contains {count(m.Asset)} assets and {count(m.AssetRelationship)} directed relationships. There are {count(m.Simulation)} recorded simulations."
        )
        for simulation in db.scalars(
            select(m.Simulation)
            .where(m.Simulation.workspace_id == workspace_id)
            .order_by(m.Simulation.created_at.desc())
            .limit(5)
        ):
            lines.append(
                f"- Simulation [{simulation.id}]: {simulation.outcome}; modeled risk {simulation.risk_score}/100; {len(simulation.path_asset_ids)} path assets."
            )
            cite("simulations", simulation.id)
        lines.append(
            "Paths and outcomes operate on stored relationships and assumptions only. The guide did not run a simulation or verify exploitability."
        )
    else:
        lines.append(
            f"Workspace: {workspace.name}. Stored records: {count(m.Asset)} assets, {count(m.SecurityEvent)} events, {count(m.Finding)} findings, {count(m.DatasetRegistry)} datasets, and {count(m.Report)} reports."
        )
        assets = lookup_records(db, workspace_id, "assets", limit=5)
        for asset in assets:
            lines.append(
                f"- Asset [{asset['id']}] {asset['name']}: {asset['asset_type']}, {asset['criticality']} criticality, {asset['exposure']} exposure, provenance={asset['provenance']}."
            )
            cite("assets", asset["id"])
        lines.append(
            "Supported guide topics: assets, finding/risk explanation, Digital Twin/simulations, defensive recommendations, and dataset training readiness. For open-ended language-model analysis, configure and explicitly select an AI provider."
        )
    lines += [
        "",
        "References identify stored AEGIS records. Seeded data stays illustrative; missing evidence is not replaced with a generated claim.",
    ]
    return "\n".join(lines)[:24000], references


@router.post("/guide", dependencies=[Depends(ensure_csrf)])
def guide(
    workspace_id: str,
    body: GuideMessage,
    request: Request,
    db: Session = Depends(get_db),
    user=Depends(current_user),
):
    require_workspace(db, user, workspace_id, ROLES)
    content = body.content.strip()
    if not content:
        raise HTTPException(422, "Enter a guide question.")
    enforce_rate_limit(request, "workspace-guide", 20, 60, user.id)
    conversation = None
    if body.conversation_id:
        conversation = owned_conversation(db, user, workspace_id, body.conversation_id)
        if not conversation.title.startswith(GUIDE_PREFIX):
            raise HTTPException(
                409,
                "This conversation uses the AI provider mode. Start a separate workspace guide conversation.",
            )
    # Resolve all evidence first. Bad context creates no conversation or messages.
    answer, references = workspace_guide_answer(db, workspace_id, body)
    if conversation is None:
        conversation = m.Conversation(
            workspace_id=workspace_id, user_id=user.id, title=GUIDE_PREFIX + content[:150]
        )
        db.add(conversation)
        db.flush()
    question = m.Message(
        workspace_id=workspace_id,
        conversation_id=conversation.id,
        role="user",
        content=content,
        references=[],
    )
    response = m.Message(
        workspace_id=workspace_id,
        conversation_id=conversation.id,
        role="assistant",
        content=answer,
        references=references,
    )
    db.add_all([question, response])
    conversation.updated_at = m.now()
    audit(
        db,
        workspace_id,
        user.id,
        "Workspace guide answer recorded",
        f"Deterministic, read-only explanation with {len(references)} authorized references. No LLM/provider call or action executed.",
        "conversation",
        conversation.id,
    )
    db.commit()
    return {
        "conversation": conversation_payload(conversation),
        "message": message_payload(response, conversation),
        "references": references,
        "provider": "workspace_guide",
        "mode": "deterministic",
        "llm_used": False,
    }
