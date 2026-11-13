from sqlalchemy import select
from . import models as m

DEFAULT_RULES = {
    "base_multiplier": 7,
    "exposure": {"Internet": 15, "Internal": 5, "Isolated": 0},
    "criticality": {"Critical": 15, "High": 10, "Medium": 5, "Low": 0},
}


def risk_for_finding(finding, asset, settings=None):
    rules = (settings or {}).get("risk_rules", DEFAULT_RULES)
    if finding.status == "Resolved":
        return {
            "score": 0,
            "base": 0,
            "exposure": 0,
            "criticality": 0,
            "level": "Low",
            "explanation": "Resolved local finding contributes zero; this does not verify remediation.",
        }
    base = round(finding.base_score * rules.get("base_multiplier", 7), 1)
    exposure = rules.get("exposure", DEFAULT_RULES["exposure"]).get(asset.exposure, 0)
    criticality = rules.get("criticality", DEFAULT_RULES["criticality"]).get(asset.criticality, 0)
    score = min(100, round(base + exposure + criticality))
    return {
        "score": score,
        "base": base,
        "exposure": exposure,
        "criticality": criticality,
        "level": "Critical"
        if score >= 75
        else "High"
        if score >= 50
        else "Medium"
        if score >= 25
        else "Low",
        "explanation": f"Base {finding.base_score} × multiplier = {base}; exposure +{exposure}; criticality +{criticality}. Rounded and capped at 100. Rules-based model, not an ML prediction.",
    }


def asset_scores(db, wid):
    workspace = db.get(m.Workspace, wid)
    assets = list(db.scalars(select(m.Asset).where(m.Asset.workspace_id == wid)))
    findings = list(db.scalars(select(m.Finding).where(m.Finding.workspace_id == wid)))
    return {
        a.id: max(
            [
                risk_for_finding(f, a, workspace.settings)["score"]
                for f in findings
                if f.asset_id == a.id
            ]
            or [0]
        )
        for a in assets
    }


def calculate_paths(db, wid, start_id, target_id):
    assets = {a.id: a for a in db.scalars(select(m.Asset).where(m.Asset.workspace_id == wid))}
    edges = list(
        db.scalars(select(m.AssetRelationship).where(m.AssetRelationship.workspace_id == wid))
    )
    if start_id not in assets or target_id not in assets or start_id == target_id:
        return []
    paths = []

    def walk(current, ids, edge_ids):
        if len(paths) >= 20 or len(ids) > 7:
            return
        if current == target_id:
            relations = [r for edge in edge_ids for r in edges if r.id == edge]
            paths.append(
                {
                    "asset_ids": ids,
                    "relationship_ids": edge_ids,
                    "assumptions": [
                        "Assume the starting asset is compromised for modeling only.",
                        "Stored directed relationships are treated as traversable; actual exploitability is not verified.",
                    ]
                    + [
                        f"{r.kind} relationship assumed: {r.label}"
                        for r in relations
                        if r.kind != "observed"
                    ],
                    "impact": f"Potential modeled access to {assets[target_id].name}. A modeled possibility, not evidence of compromise.",
                }
            )
            return
        for edge in edges:
            if edge.source_id == current and edge.target_id not in ids:
                walk(edge.target_id, ids + [edge.target_id], edge_ids + [edge.id])

    walk(start_id, [start_id], [])
    return sorted(paths, key=lambda p: (len(p["asset_ids"]), ",".join(p["relationship_ids"])))


def rank_recommendations(db, wid):
    rows = []
    for recommendation in db.scalars(
        select(m.Recommendation).where(m.Recommendation.workspace_id == wid)
    ):
        value = m.serialize(recommendation)
        value["score"] = round(
            recommendation.risk_reduction * 2
            + recommendation.evidence_confidence * 10
            - recommendation.disruption * 5
            - recommendation.effort * 3,
            2,
        )
        last = db.scalar(
            select(m.ApprovalRequest)
            .where(
                m.ApprovalRequest.workspace_id == wid,
                m.ApprovalRequest.recommendation_id == recommendation.id,
            )
            .order_by(m.ApprovalRequest.created_at.desc())
        )
        value["latest_decision"] = m.serialize(last) if last else None
        rows.append(value)
    rows.sort(key=lambda row: (-row["score"], row["id"]))
    for index, row in enumerate(rows):
        row["rank"] = index + 1
    return rows


def simulate(db, wid, scenario):
    paths = calculate_paths(db, wid, scenario.start_asset_id, scenario.target_asset_id)
    path = (
        paths[0]
        if paths
        else {"asset_ids": [scenario.start_asset_id], "relationship_ids": [], "assumptions": []}
    )
    scores = asset_scores(db, wid)
    simulation = m.Simulation(
        workspace_id=wid,
        scenario_id=scenario.id,
        outcome="Potential exposure" if paths else "No modeled path",
        risk_score=max([scores.get(i, 0) for i in path["asset_ids"]]) if paths else 0,
        assumptions=scenario.assumptions + path["assumptions"],
        path_asset_ids=path["asset_ids"],
        relationship_ids=path["relationship_ids"],
    )
    db.add(simulation)
    db.flush()
    for index, asset_id in enumerate(path["asset_ids"]):
        asset = db.get(m.Asset, asset_id)
        if index == 0:
            description = f"Assume a starting foothold on {asset.name}; no attack is performed."
        else:
            edge = db.get(m.AssetRelationship, path["relationship_ids"][index - 1])
            description = (
                f"Model {edge.label} toward {asset.name} using a {edge.kind} demo relationship."
            )
        db.add(
            m.SimulationStep(
                workspace_id=wid,
                simulation_id=simulation.id,
                ordinal=index + 1,
                asset_id=asset_id,
                description=description,
            )
        )
    if not paths:
        db.add(
            m.SimulationStep(
                workspace_id=wid,
                simulation_id=simulation.id,
                ordinal=2,
                description="No route found within six relationships. This does not establish security.",
            )
        )
    return simulation


def generate_report(db, wid):
    workspace = db.get(m.Workspace, wid)
    assets = list(db.scalars(select(m.Asset).where(m.Asset.workspace_id == wid)))
    findings = list(db.scalars(select(m.Finding).where(m.Finding.workspace_id == wid)))
    scores = asset_scores(db, wid)
    lines = [
        f"# AEGIS workspace report — {workspace.name}",
        f"Generated: {m.now().isoformat()}",
        "",
        "## Authorized scope",
        workspace.scope,
        "",
        "## Limits",
        "Seeded infrastructure and threat examples are illustrative. Paths and simulations are modeled possibilities, not confirmed compromise. Human approvals never apply infrastructure changes. Offline ML benchmarks do not establish live detection capability.",
        "",
        "## Inventory",
        f"{len(assets)} assets; {sum(f.status != 'Resolved' for f in findings)} active findings. Workspace risk: {round(sum(scores.values()) / max(len(scores), 1))}/100.",
        "Finding risk = base score × configured multiplier + exposure weight + criticality weight, capped at 100. Resolved findings contribute zero. Asset risk = highest active finding; workspace risk = mean asset risk.",
        "",
        "| Asset | Owner | Exposure | Criticality | Risk |",
        "| --- | --- | --- | --- | --- |",
    ]
    clean = lambda value: str(value).replace("|", "\\|").replace("\n", " ")
    lines += [
        f"| {clean(a.name)} | {clean(a.owner)} | {a.exposure} | {a.criticality} | {scores[a.id]} |"
        for a in assets
    ]
    lines += ["", "## Findings"]
    for f in findings:
        asset = next(a for a in assets if a.id == f.asset_id)
        risk = risk_for_finding(f, asset, workspace.settings)
        lines += [
            f"### {f.title} [{f.id}]",
            f"Asset: {asset.name}. Severity: {f.severity}. Status: {f.status}. Modeled risk: {risk['score']}/100.",
            f.evidence,
            risk["explanation"],
            "",
        ]
    lines += ["## Simulations"]
    for simulation in db.scalars(select(m.Simulation).where(m.Simulation.workspace_id == wid)):
        lines += [
            f"- {simulation.id}: {simulation.outcome}, risk {simulation.risk_score}/100, {simulation.created_at.isoformat()}.",
            "  Assumptions: " + "; ".join(simulation.assumptions),
        ]
    lines += [
        "",
        "## Ranked recommendations",
        "Score = estimated reduction ×2 + confidence ×10 − disruption ×5 − effort ×3. Estimates are illustrative planning values.",
    ]
    for r in rank_recommendations(db, wid):
        lines += [f"{r['rank']}. {r['title']}: score {r['score']}. {r['rationale']}"]
    lines += ["", "## Guardian Gate decisions"]
    for approval in db.scalars(
        select(m.ApprovalRequest)
        .where(m.ApprovalRequest.workspace_id == wid)
        .order_by(m.ApprovalRequest.created_at.desc())
    ):
        lines += [
            f"- {approval.created_at.isoformat()}: {approval.decision} [{approval.recommendation_id}]. Notes: {approval.notes}. No external action."
        ]
    lines += ["", "## Datasets and offline models"]
    for dataset in db.scalars(
        select(m.DatasetRegistry).where(m.DatasetRegistry.workspace_id == wid)
    ):
        lines += [
            f"- {dataset.name}: task={dataset.task}; source={dataset.source or 'unrecorded'}; license/permission={dataset.license_status}; ingestion={dataset.status}."
        ]
    for model in db.scalars(select(m.ModelVersion).where(m.ModelVersion.workspace_id == wid)):
        lines += [
            f"- Model {model.name}: {model.algorithm}; status={model.status}; artifact={model.artifact_path}. Offline benchmark only."
        ]
    lines += ["", "## Audit history"]
    for entry in db.scalars(
        select(m.AuditLog)
        .where(m.AuditLog.workspace_id == wid)
        .order_by(m.AuditLog.created_at.desc())
        .limit(500)
    ):
        lines += [f"- {entry.created_at.isoformat()}: {entry.action}. {entry.detail}"]
    return "\n".join(lines)
