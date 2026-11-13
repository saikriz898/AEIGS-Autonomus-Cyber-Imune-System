"""Indexes for workspace-scoped record timelines and filters.

Revision ID: 0002
Revises: 0001
"""

from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

INDEXES = [
    ("ix_events_workspace_created", "security_events", ["workspace_id", "created_at"]),
    ("ix_events_workspace_status", "security_events", ["workspace_id", "status", "created_at"]),
    ("ix_findings_workspace_status", "findings", ["workspace_id", "status", "created_at"]),
    ("ix_jobs_workspace_status", "ingestion_jobs", ["workspace_id", "status", "created_at"]),
    ("ix_audit_workspace_created", "audit_logs", ["workspace_id", "created_at"]),
    ("ix_assets_workspace_name", "assets", ["workspace_id", "name"]),
    ("ix_assets_workspace_created", "assets", ["workspace_id", "created_at"]),
    ("ix_messages_workspace_created", "ai_messages", ["workspace_id", "created_at"]),
    ("ix_messages_conversation_created", "ai_messages", ["conversation_id", "created_at"]),
]


def upgrade():
    for name, table, columns in INDEXES:
        op.create_index(name, table, columns, unique=False, if_not_exists=True)
    op.create_index(
        "uq_active_model_per_registry",
        "model_versions",
        ["registry_id"],
        unique=True,
        postgresql_where=sa.text("active = true"),
        sqlite_where=sa.text("active = 1"),
        if_not_exists=True,
    )
    foreign_keys = sa.inspect(op.get_bind()).get_foreign_keys("training_jobs")
    if not any(
        fk.get("constrained_columns") == ["model_version_id"]
        and fk.get("referred_table") == "model_versions"
        for fk in foreign_keys
    ):
        if op.get_bind().dialect.name == "sqlite":
            with op.batch_alter_table("training_jobs") as batch:
                batch.create_foreign_key(
                    "fk_training_job_model_version", "model_versions", ["model_version_id"], ["id"]
                )
        else:
            op.create_foreign_key(
                "fk_training_job_model_version",
                "training_jobs",
                "model_versions",
                ["model_version_id"],
                ["id"],
            )


def downgrade():
    foreign_keys = sa.inspect(op.get_bind()).get_foreign_keys("training_jobs")
    if any(fk.get("name") == "fk_training_job_model_version" for fk in foreign_keys):
        if op.get_bind().dialect.name == "sqlite":
            with op.batch_alter_table("training_jobs") as batch:
                batch.drop_constraint("fk_training_job_model_version", type_="foreignkey")
        else:
            op.drop_constraint("fk_training_job_model_version", "training_jobs", type_="foreignkey")
    op.drop_index("uq_active_model_per_registry", table_name="model_versions", if_exists=True)
    for name, table, columns in reversed(INDEXES):
        op.drop_index(name, table_name=table, if_exists=True)
