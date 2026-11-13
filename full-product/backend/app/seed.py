from sqlalchemy import select
from . import models as m


def seed_workspace(db, workspace, user_id):
    if db.scalar(select(m.Asset).where(m.Asset.workspace_id == workspace.id).limit(1)):
        return
    wid = workspace.id
    specs = [
        (
            "edge",
            "edge-gw-01",
            "192.0.2.10",
            "Gateway",
            "High",
            "Internet",
            "Network Operations",
            12,
            45,
        ),
        (
            "vpn",
            "vpn-corp-01",
            "192.0.2.20",
            "Gateway",
            "High",
            "Internet",
            "Network Operations",
            12,
            80,
        ),
        (
            "web",
            "web-prod-01",
            "portal.aegis.example",
            "Server",
            "High",
            "Internet",
            "Digital Experience",
            35,
            25,
        ),
        (
            "api",
            "api-prod-01",
            "198.51.100.21",
            "Server",
            "Critical",
            "Internal",
            "Platform Engineering",
            35,
            51,
        ),
        (
            "identity",
            "identity-01",
            "198.51.100.15",
            "Server",
            "Critical",
            "Internal",
            "Identity & Access",
            35,
            80,
        ),
        (
            "app",
            "app-core-01",
            "198.51.100.31",
            "Server",
            "High",
            "Internal",
            "Platform Engineering",
            59,
            45,
        ),
        (
            "db",
            "db-customer-01",
            "203.0.113.40",
            "Database",
            "Critical",
            "Internal",
            "Data Engineering",
            83,
            28,
        ),
        (
            "files",
            "files-people-01",
            "203.0.113.50",
            "Server",
            "High",
            "Internal",
            "People Operations",
            83,
            61,
        ),
        (
            "vault",
            "backup-vault-01",
            "vault.aegis.example",
            "Cloud",
            "Critical",
            "Isolated",
            "Infrastructure",
            83,
            86,
        ),
        (
            "build",
            "ci-runner-02",
            "198.51.100.61",
            "Server",
            "Medium",
            "Internal",
            "Developer Experience",
            59,
            14,
        ),
        (
            "observe",
            "observe-01",
            "198.51.100.70",
            "Server",
            "Medium",
            "Internal",
            "Security Operations",
            59,
            79,
        ),
        (
            "laptop",
            "workstation-07",
            "192.0.2.77",
            "Endpoint",
            "Low",
            "Internal",
            "Security Operations",
            12,
            14,
        ),
    ]
    assets = {}
    for key, name, address, kind, criticality, exposure, owner, x, y in specs:
        asset = m.Asset(
            workspace_id=wid,
            name=name,
            address=address,
            asset_type=kind,
            owner=owner,
            criticality=criticality,
            exposure=exposure,
            status="Review" if key in {"edge", "web", "api", "identity", "db"} else "Monitored",
            services=["HTTPS · 443"] if kind != "Database" else ["PostgreSQL · 5432"],
            notes="Authored demonstration record. No discovery, traffic, or telemetry collection occurred.",
            x=x,
            y=y,
        )
        db.add(asset)
        db.flush()
        assets[key] = asset
    edges = {}
    for key, source, target, label, kind in [
        ("ingress", "edge", "web", "HTTPS ingress", "observed"),
        ("api", "web", "api", "API service trust", "observed"),
        ("app", "api", "app", "Application access", "observed"),
        ("db", "app", "db", "Database service identity", "inferred"),
        ("vpn", "vpn", "identity", "Directory authentication", "observed"),
        ("idapp", "identity", "app", "Shared service identity", "inferred"),
        ("files", "identity", "files", "Broad group membership", "inferred"),
        ("build", "build", "app", "Deployment identity", "hypothetical"),
        ("vault", "build", "vault", "Assumed backup permission", "hypothetical"),
        ("observe", "app", "observe", "Telemetry export", "observed"),
        ("backup", "db", "vault", "Scheduled backup", "observed"),
        ("browser", "laptop", "web", "Browser access", "observed"),
    ]:
        edge = m.AssetRelationship(
            workspace_id=wid,
            source_id=assets[source].id,
            target_id=assets[target].id,
            label=label,
            kind=kind,
        )
        db.add(edge)
        db.flush()
        edges[key] = edge
    vulnerability = m.Vulnerability(
        workspace_id=wid,
        cve="CVE-2021-44228",
        title="Historical Log4j example",
        description="Illustrative historical context. Applicability has not been verified.",
        cvss=9.8,
        source="seeded historical reference",
        metadata_json={"live": False, "verified": False},
    )
    db.add(vulnerability)
    db.flush()
    findings = {}
    for key, title, severity, base, technique in [
        ("web", "Illustrative vulnerable logging component", "Critical", 9.8, "T1190"),
        ("api", "Overly broad API service trust", "High", 8.1, "T1078"),
        ("db", "Database access lacks a narrow allowlist", "High", 7.7, "T1213"),
        ("edge", "Legacy perimeter management policy", "High", 7.2, None),
        ("identity", "Privileged group membership needs review", "High", 7.5, "T1098"),
        ("files", "Broad employee file share permissions", "Medium", 6.4, "T1039"),
        ("build", "Long-lived deployment credential example", "Medium", 6.2, "T1552"),
        ("vpn", "Remote access session policy review", "Medium", 5.5, None),
        ("observe", "Telemetry retention not documented", "Low", 2.8, None),
        ("app", "Application management access review", "Medium", 5.8, None),
    ]:
        finding = m.Finding(
            workspace_id=wid,
            asset_id=assets[key].id,
            vulnerability_id=vulnerability.id if key == "web" else None,
            title=title,
            severity=severity,
            base_score=base,
            technique=technique,
            description="Synthetic security finding for a safe defensive review workflow.",
            evidence="Seeded configuration evidence only. No package inventory, traffic, or credentials were collected.",
            factors=[
                "Authored demonstration data",
                f"{assets[key].exposure} exposure",
                f"{assets[key].criticality} asset criticality",
            ],
            status="Investigating" if key == "api" else "Open",
        )
        db.add(finding)
        db.flush()
        findings[key] = finding
    for name, start, target in [
        ("Perimeter to customer data", "edge", "db"),
        ("Identity to employee files", "identity", "files"),
        ("Build trust to backup vault", "build", "vault"),
    ]:
        db.add(
            m.Scenario(
                workspace_id=wid,
                name=name,
                description="Model directed trust through the stored Digital Twin only.",
                start_asset_id=assets[start].id,
                target_asset_id=assets[target].id,
                assumptions=[
                    "A starting foothold is assumed; no attack is performed.",
                    "Relationships are seeded and exploitability has not been verified.",
                ],
            )
        )
    for key, title, reduction, disruption, effort, edge in [
        ("api", "Narrow the API service trust boundary", 35, 2, 3, "app"),
        ("web", "Review and update the illustrative logging component", 38, 3, 4, "api"),
        ("db", "Restrict database service access", 30, 2, 2, "db"),
        ("identity", "Review privileged group membership", 27, 2, 2, "files"),
        ("build", "Rotate and scope deployment identities", 22, 1, 3, "build"),
    ]:
        db.add(
            m.Recommendation(
                workspace_id=wid,
                asset_id=assets[key].id,
                finding_id=findings[key].id,
                title=title,
                description="Human-reviewed planning recommendation based on seeded evidence.",
                risk_reduction=reduction,
                disruption=disruption,
                effort=effort,
                evidence_confidence=0.7,
                rationale="Estimated risk reduction is weighed against operational disruption and implementation effort; all inputs are illustrative.",
                control=title,
                blocked_relationship_ids=[edges[edge].id],
            )
        )
    for name, description in [
        ("Risk review", "Calculate explainable risk using stored records."),
        (
            "Digital Twin evaluation",
            "Model paths and scenarios with deterministic graph traversal.",
        ),
        ("Guardian review", "Human decisions recorded without applying external controls."),
    ]:
        db.add(
            m.AgentWorkflow(
                workspace_id=wid,
                name=name,
                description=description,
                kind="deterministic",
                status="available",
            )
        )
    db.add(
        m.AgentWorkflow(
            workspace_id=wid,
            name="Autonomous telemetry analyst",
            description="Planned; no telemetry connector or autonomous agent is configured.",
            kind="planned",
            status="unavailable",
        )
    )
    for key, title, severity in [
        ("web", "Seeded portal finding requires review", "Critical"),
        ("api", "Seeded service trust policy review", "High"),
        ("db", "Synthetic database permission observation", "High"),
    ]:
        db.add(
            m.SecurityEvent(
                workspace_id=wid,
                asset_id=assets[key].id,
                title=title,
                severity=severity,
                category="seeded finding",
                evidence="Authored example event; not a live detection.",
            )
        )
    db.add(
        m.ThreatIntelligenceRecord(
            workspace_id=wid,
            name="Illustrative historical ATT&CK mapping",
            source="seeded",
            version="unverified illustrative reference",
            technique="T1190",
            payload={
                "description": "Potential exposure through public-facing application context; no current intelligence feed is configured.",
                "live": False,
            },
        )
    )
    db.add(
        m.Notification(
            workspace_id=wid,
            title="Your demonstration workspace is ready",
            detail="Seeded assets and findings are available. No scanning or external integrations are running.",
        )
    )
    db.add(
        m.AuditLog(
            workspace_id=wid,
            user_id=user_id,
            action="Demo workspace seeded",
            detail="Authored sample records added. No discovery, telemetry collection, or infrastructure change.",
        )
    )
    from .catalog import register_detected

    register_detected(db, wid, user_id)
