from datetime import datetime, timezone
from uuid import uuid4
from sqlalchemy import (
    String,
    Text,
    Integer,
    Float,
    Boolean,
    DateTime,
    ForeignKey,
    JSON,
    UniqueConstraint,
    Index,
)
from sqlalchemy.orm import Mapped, mapped_column
from .db import Base


def now():
    return datetime.now(timezone.utc)


def uid():
    return str(uuid4())


class Identity:
    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=uid)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)


class Scoped(Identity):
    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )


class User(Identity, Base):
    __tablename__ = "users"
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(80))
    password_hash: Mapped[str] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Workspace(Identity, Base):
    __tablename__ = "workspaces"
    name: Mapped[str] = mapped_column(String(80))
    scope: Mapped[str] = mapped_column(Text)
    settings: Mapped[dict] = mapped_column(JSON, default=dict)


class Role(Identity, Base):
    __tablename__ = "roles"
    name: Mapped[str] = mapped_column(String(20), unique=True)
    permissions: Mapped[list] = mapped_column(JSON, default=list)


class Membership(Scoped, Base):
    __tablename__ = "memberships"
    __table_args__ = (UniqueConstraint("workspace_id", "user_id"),)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    role: Mapped[str] = mapped_column(ForeignKey("roles.name"), default="Viewer")


class Session(Identity, Base):
    __tablename__ = "sessions"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    csrf_token: Mapped[str] = mapped_column(String(100))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Asset(Scoped, Base):
    __tablename__ = "assets"
    name: Mapped[str] = mapped_column(String(120), index=True)
    address: Mapped[str] = mapped_column(String(250))
    asset_type: Mapped[str] = mapped_column(String(30))
    environment: Mapped[str] = mapped_column(String(30), default="Production")
    owner: Mapped[str] = mapped_column(String(100))
    criticality: Mapped[str] = mapped_column(String(20))
    exposure: Mapped[str] = mapped_column(String(20))
    status: Mapped[str] = mapped_column(String(30), default="Monitored")
    services: Mapped[list] = mapped_column(JSON, default=list)
    notes: Mapped[str] = mapped_column(Text, default="")
    x: Mapped[float] = mapped_column(Float, default=50)
    y: Mapped[float] = mapped_column(Float, default=50)
    provenance: Mapped[str] = mapped_column(String(30), default="seeded")
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class AssetRelationship(Scoped, Base):
    __tablename__ = "asset_relationships"
    source_id: Mapped[str] = mapped_column(ForeignKey("assets.id"), index=True)
    target_id: Mapped[str] = mapped_column(ForeignKey("assets.id"), index=True)
    label: Mapped[str] = mapped_column(String(250))
    kind: Mapped[str] = mapped_column(String(30))


class DiscoveryRun(Scoped, Base):
    __tablename__ = "discovery_runs"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    mode: Mapped[str] = mapped_column(String(30), default="seed_refresh")
    status: Mapped[str] = mapped_column(String(30), default="succeeded")
    asset_count: Mapped[int] = mapped_column(Integer, default=0)
    details: Mapped[str] = mapped_column(
        Text, default="Seeded record refresh only. No network operations."
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    finished_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class SecurityEvent(Scoped, Base):
    __tablename__ = "security_events"
    asset_id: Mapped[str | None] = mapped_column(ForeignKey("assets.id"), nullable=True)
    title: Mapped[str] = mapped_column(String(250))
    severity: Mapped[str] = mapped_column(String(20))
    category: Mapped[str] = mapped_column(String(40))
    evidence: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(30), default="New")
    provenance: Mapped[str] = mapped_column(String(30), default="seeded")
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class Vulnerability(Scoped, Base):
    __tablename__ = "vulnerabilities"
    cve: Mapped[str] = mapped_column(String(30), index=True)
    title: Mapped[str] = mapped_column(String(250))
    description: Mapped[str] = mapped_column(Text)
    cvss: Mapped[float | None] = mapped_column(Float, nullable=True)
    source: Mapped[str] = mapped_column(String(250))
    retrieved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)


class Finding(Scoped, Base):
    __tablename__ = "findings"
    asset_id: Mapped[str] = mapped_column(ForeignKey("assets.id"), index=True)
    vulnerability_id: Mapped[str | None] = mapped_column(
        ForeignKey("vulnerabilities.id"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(250))
    description: Mapped[str] = mapped_column(Text)
    severity: Mapped[str] = mapped_column(String(20))
    base_score: Mapped[float] = mapped_column(Float)
    evidence: Mapped[str] = mapped_column(Text)
    factors: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(30), default="Open")
    technique: Mapped[str | None] = mapped_column(String(40), nullable=True)


class ThreatIntelligenceRecord(Scoped, Base):
    __tablename__ = "threat_intelligence_records"
    name: Mapped[str] = mapped_column(String(250))
    source: Mapped[str] = mapped_column(String(250))
    version: Mapped[str | None] = mapped_column(String(100), nullable=True)
    technique: Mapped[str | None] = mapped_column(String(40), nullable=True)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)


class RiskAssessment(Scoped, Base):
    __tablename__ = "risk_assessments"
    asset_id: Mapped[str] = mapped_column(ForeignKey("assets.id"))
    finding_id: Mapped[str | None] = mapped_column(ForeignKey("findings.id"), nullable=True)
    score: Mapped[float] = mapped_column(Float)
    factors: Mapped[dict] = mapped_column(JSON)
    rules_version: Mapped[str] = mapped_column(String(40), default="rules-v1")


class DigitalTwinSnapshot(Scoped, Base):
    __tablename__ = "digital_twin_snapshots"
    name: Mapped[str] = mapped_column(String(120))
    graph: Mapped[dict] = mapped_column(JSON)


class AttackPath(Scoped, Base):
    __tablename__ = "attack_paths"
    start_asset_id: Mapped[str] = mapped_column(ForeignKey("assets.id"))
    target_asset_id: Mapped[str] = mapped_column(ForeignKey("assets.id"))
    asset_ids: Mapped[list] = mapped_column(JSON)
    relationship_ids: Mapped[list] = mapped_column(JSON)
    assumptions: Mapped[list] = mapped_column(JSON)
    impact: Mapped[str] = mapped_column(Text)


class Scenario(Scoped, Base):
    __tablename__ = "scenarios"
    name: Mapped[str] = mapped_column(String(150))
    description: Mapped[str] = mapped_column(Text)
    start_asset_id: Mapped[str] = mapped_column(ForeignKey("assets.id"))
    target_asset_id: Mapped[str] = mapped_column(ForeignKey("assets.id"))
    assumptions: Mapped[list] = mapped_column(JSON)


class Simulation(Scoped, Base):
    __tablename__ = "simulations"
    scenario_id: Mapped[str] = mapped_column(ForeignKey("scenarios.id"), index=True)
    status: Mapped[str] = mapped_column(String(30), default="succeeded")
    outcome: Mapped[str] = mapped_column(String(60))
    risk_score: Mapped[float] = mapped_column(Float)
    assumptions: Mapped[list] = mapped_column(JSON)
    path_asset_ids: Mapped[list] = mapped_column(JSON)
    relationship_ids: Mapped[list] = mapped_column(JSON)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    finished_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)


class SimulationStep(Scoped, Base):
    __tablename__ = "simulation_steps"
    simulation_id: Mapped[str] = mapped_column(ForeignKey("simulations.id"), index=True)
    ordinal: Mapped[int] = mapped_column(Integer)
    asset_id: Mapped[str | None] = mapped_column(ForeignKey("assets.id"), nullable=True)
    description: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(30), default="modeled")


class Recommendation(Scoped, Base):
    __tablename__ = "recommendations"
    asset_id: Mapped[str] = mapped_column(ForeignKey("assets.id"))
    finding_id: Mapped[str | None] = mapped_column(ForeignKey("findings.id"), nullable=True)
    title: Mapped[str] = mapped_column(String(250))
    description: Mapped[str] = mapped_column(Text)
    risk_reduction: Mapped[float] = mapped_column(Float)
    disruption: Mapped[float] = mapped_column(Float)
    effort: Mapped[float] = mapped_column(Float)
    evidence_confidence: Mapped[float] = mapped_column(Float, default=0.7)
    rationale: Mapped[str] = mapped_column(Text)
    control: Mapped[str] = mapped_column(Text)
    blocked_relationship_ids: Mapped[list] = mapped_column(JSON, default=list)


class ApprovalRequest(Scoped, Base):
    __tablename__ = "approval_requests"
    recommendation_id: Mapped[str] = mapped_column(ForeignKey("recommendations.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    decision: Mapped[str] = mapped_column(String(20))
    notes: Mapped[str] = mapped_column(Text)
    simulation_id: Mapped[str | None] = mapped_column(ForeignKey("simulations.id"), nullable=True)


class DatasetRegistry(Scoped, Base):
    __tablename__ = "dataset_registry"
    name: Mapped[str] = mapped_column(String(250))
    task: Mapped[str] = mapped_column(String(50))
    source: Mapped[str] = mapped_column(Text, default="")
    version: Mapped[str | None] = mapped_column(String(120), nullable=True)
    license_status: Mapped[str] = mapped_column(String(30), default="unknown")
    citation: Mapped[str] = mapped_column(Text, default="")
    mapping: Mapped[dict] = mapped_column(JSON, default=dict)
    quality: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(30), default="registered")


class DatasetFile(Scoped, Base):
    __tablename__ = "dataset_files"
    dataset_id: Mapped[str] = mapped_column(ForeignKey("dataset_registry.id"), index=True)
    path: Mapped[str] = mapped_column(Text)
    checksum: Mapped[str | None] = mapped_column(String(64), nullable=True)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    schema_json: Mapped[list] = mapped_column(JSON, default=list)
    row_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    stats: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(30), default="registered")
    format: Mapped[str] = mapped_column(String(20), default="csv")


class Job(Scoped, Base):
    __tablename__ = "ingestion_jobs"
    __table_args__ = (UniqueConstraint("workspace_id", "idempotency_key"),)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    dataset_id: Mapped[str | None] = mapped_column(ForeignKey("dataset_registry.id"), nullable=True)
    kind: Mapped[str] = mapped_column(String(50))
    status: Mapped[str] = mapped_column(String(30), default="queued", index=True)
    progress: Mapped[int] = mapped_column(Integer, default=0)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    result: Mapped[dict] = mapped_column(JSON, default=dict)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    idempotency_key: Mapped[str] = mapped_column(String(150))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False)


class TrainingJob(Scoped, Base):
    __tablename__ = "training_jobs"
    dataset_id: Mapped[str] = mapped_column(ForeignKey("dataset_registry.id"))
    job_id: Mapped[str] = mapped_column(ForeignKey("ingestion_jobs.id"))
    algorithm: Mapped[str] = mapped_column(String(80))
    parameters: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(30), default="queued")
    model_version_id: Mapped[str | None] = mapped_column(
        ForeignKey("model_versions.id"), nullable=True
    )


class ModelRegistry(Scoped, Base):
    __tablename__ = "model_registry"
    name: Mapped[str] = mapped_column(String(150))
    task: Mapped[str] = mapped_column(String(50))


class ModelVersion(Scoped, Base):
    __tablename__ = "model_versions"
    registry_id: Mapped[str | None] = mapped_column(ForeignKey("model_registry.id"), nullable=True)
    dataset_id: Mapped[str] = mapped_column(ForeignKey("dataset_registry.id"))
    training_job_id: Mapped[str | None] = mapped_column(
        ForeignKey("ingestion_jobs.id"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(200))
    task: Mapped[str] = mapped_column(String(50))
    algorithm: Mapped[str] = mapped_column(String(80))
    feature_schema: Mapped[dict] = mapped_column(JSON, default=dict)
    artifact_path: Mapped[str] = mapped_column(Text)
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)
    active: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(30), default="inactive")
    version: Mapped[int] = mapped_column(Integer, default=1)


class ModelMetric(Scoped, Base):
    __tablename__ = "model_metrics"
    model_version_id: Mapped[str] = mapped_column(ForeignKey("model_versions.id"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    value: Mapped[dict] = mapped_column(JSON)


class ModelActivation(Scoped, Base):
    __tablename__ = "model_activations"
    model_version_id: Mapped[str] = mapped_column(ForeignKey("model_versions.id"))
    previous_version_id: Mapped[str | None] = mapped_column(
        ForeignKey("model_versions.id"), nullable=True
    )
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))


class AgentWorkflow(Scoped, Base):
    __tablename__ = "agent_workflows"
    name: Mapped[str] = mapped_column(String(150))
    description: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(String(40), default="deterministic")
    status: Mapped[str] = mapped_column(String(30), default="available")


class AgentExecution(Scoped, Base):
    __tablename__ = "agent_executions"
    workflow_id: Mapped[str] = mapped_column(ForeignKey("agent_workflows.id"))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(String(30), default="succeeded")
    steps: Mapped[list] = mapped_column(JSON, default=list)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Report(Scoped, Base):
    __tablename__ = "reports"
    name: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(30), default="queued")
    content: Mapped[str] = mapped_column(Text, default="")
    job_id: Mapped[str | None] = mapped_column(ForeignKey("ingestion_jobs.id"), nullable=True)


class Notification(Scoped, Base):
    __tablename__ = "notifications"
    title: Mapped[str] = mapped_column(String(250))
    detail: Mapped[str] = mapped_column(Text)
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    record_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    record_id: Mapped[str | None] = mapped_column(String(64), nullable=True)


class AuditLog(Scoped, Base):
    __tablename__ = "audit_logs"
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    action: Mapped[str] = mapped_column(String(200))
    detail: Mapped[str] = mapped_column(Text)
    record_type: Mapped[str | None] = mapped_column(String(60), nullable=True)
    record_id: Mapped[str | None] = mapped_column(String(64), nullable=True)


class Conversation(Scoped, Base):
    __tablename__ = "ai_conversations"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(200))


class Message(Scoped, Base):
    __tablename__ = "ai_messages"
    conversation_id: Mapped[str] = mapped_column(ForeignKey("ai_conversations.id"), index=True)
    role: Mapped[str] = mapped_column(String(20))
    content: Mapped[str] = mapped_column(Text)
    references: Mapped[list] = mapped_column(JSON, default=list)


def serialize(obj):
    return {
        column.key: (value.isoformat() if isinstance(value, datetime) else value)
        for column in obj.__table__.columns
        for value in [getattr(obj, column.key)]
    }


# Keep ORM-created test schemas consistent with the versioned 0002 migration.
for _name, _table, _columns in [
    ("ix_events_workspace_created", SecurityEvent, ["workspace_id", "created_at"]),
    ("ix_events_workspace_status", SecurityEvent, ["workspace_id", "status", "created_at"]),
    ("ix_findings_workspace_status", Finding, ["workspace_id", "status", "created_at"]),
    ("ix_jobs_workspace_status", Job, ["workspace_id", "status", "created_at"]),
    ("ix_audit_workspace_created", AuditLog, ["workspace_id", "created_at"]),
    ("ix_assets_workspace_name", Asset, ["workspace_id", "name"]),
    ("ix_assets_workspace_created", Asset, ["workspace_id", "created_at"]),
    ("ix_messages_workspace_created", Message, ["workspace_id", "created_at"]),
    ("ix_messages_conversation_created", Message, ["conversation_id", "created_at"]),
]:
    Index(_name, *[getattr(_table, column) for column in _columns])
Index(
    "uq_active_model_per_registry",
    ModelVersion.registry_id,
    unique=True,
    postgresql_where=ModelVersion.active.is_(True),
    sqlite_where=ModelVersion.active.is_(True),
)
