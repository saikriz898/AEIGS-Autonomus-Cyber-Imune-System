import type { Approval, Asset, Finding, ModelPath, RiskResult, Severity, Simulation, Workspace } from './types';

const criticalityPoints: Record<Severity, number> = { Critical: 15, High: 10, Medium: 5, Low: 0 };
const exposurePoints: Record<Asset['exposure'], number> = { Internet: 15, Internal: 5, Isolated: 0 };
function level(score: number): Severity { return score >= 75 ? 'Critical' : score >= 50 ? 'High' : score >= 25 ? 'Medium' : 'Low'; }

export function findingRisk(finding: Finding, asset: Asset): RiskResult {
  if (finding.status === 'Resolved') return { score: 0, level: 'Low', base: 0, exposure: 0, criticality: 0, explanation: 'Resolved findings contribute 0 points.' };
  const base = Math.round(finding.baseScore * 7 * 10) / 10;
  const exposure = exposurePoints[asset.exposure];
  const criticality = criticalityPoints[asset.criticality];
  const score = Math.min(100, Math.round(base + exposure + criticality));
  return { score, level: level(score), base, exposure, criticality, explanation: `Base ${finding.baseScore} × 7 = ${base}; ${asset.exposure.toLowerCase()} exposure +${exposure}; ${asset.criticality.toLowerCase()} criticality +${criticality}. Rounded and capped at 100. Thresholds: Critical ≥75, High ≥50, Medium ≥25, Low <25.` };
}

export function assetRisk(workspace: Workspace, assetId: string): RiskResult {
  const asset = workspace.assets.find(a => a.id === assetId);
  if (!asset) return { score: 0, level: 'Low', base: 0, exposure: 0, criticality: 0, explanation: 'Asset unavailable in this workspace.' };
  const risks = workspace.findings.filter(f => f.assetId === assetId).map(f => findingRisk(f, asset));
  const highest = risks.sort((a, b) => b.score - a.score)[0];
  return highest ? { ...highest, explanation: `Asset risk is the highest active finding score. ${highest.explanation}` } : { score: 0, level: 'Low', base: 0, exposure: 0, criticality: 0, explanation: 'No active seeded findings. A score of 0 does not validate security.' };
}

export function workspaceRisk(workspace: Workspace): number {
  if (!workspace.assets.length) return 0;
  return Math.round(workspace.assets.reduce((sum, asset) => sum + assetRisk(workspace, asset.id).score, 0) / workspace.assets.length);
}

export function calculatePaths(workspace: Workspace, startId: string, targetId: string): ModelPath[] {
  const ids = new Set(workspace.assets.map(a => a.id));
  if (!ids.has(startId) || !ids.has(targetId) || startId === targetId) return [];
  const paths: ModelPath[] = [];
  const target = workspace.assets.find(a => a.id === targetId)!;
  function walk(current: string, assetIds: string[], relationshipIds: string[]) {
    if (paths.length >= 20 || assetIds.length > Math.min(workspace.assets.length, 7)) return;
    if (current === targetId) {
      const relations = relationshipIds.map(id => workspace.relationships.find(r => r.id === id)!);
      paths.push({ id: `path-${relationshipIds.join('-')}`, assetIds, relationshipIds, assumptions: ['The starting asset is assumed compromised for modeling only.', 'Directed trust edges are treated as traversable; protocol controls and exploitability are not verified.', ...relations.filter(r => r.kind !== 'observed').map(r => `${r.kind === 'inferred' ? 'Inferred' : 'Hypothetical'} relationship: ${r.label}.`)], impact: `Potential access to ${target.name}, a ${target.criticality.toLowerCase()}-criticality ${target.type.toLowerCase()}. This is a modeled possibility, not a confirmed compromise.` });
      return;
    }
    for (const relationship of workspace.relationships.filter(r => r.source === current)) {
      if (ids.has(relationship.target) && !assetIds.includes(relationship.target)) walk(relationship.target, [...assetIds, relationship.target], [...relationshipIds, relationship.id]);
    }
  }
  walk(startId, [startId], []);
  return paths.sort((a, b) => a.assetIds.length - b.assetIds.length || a.id.localeCompare(b.id));
}

export function rankRecommendations(workspace: Workspace) {
  return workspace.recommendations.map(recommendation => ({ ...recommendation, score: recommendation.riskReduction * 2 - recommendation.disruption * 5 - recommendation.effort * 3, decision: workspace.approvals.filter(a => a.recommendationId === recommendation.id).sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0] as Approval | undefined })).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).map((r, index) => ({ ...r, rank: index + 1 }));
}

export function runSimulation(workspace: Workspace, scenarioId: string): Simulation {
  const scenario = workspace.scenarios.find(s => s.id === scenarioId);
  if (!scenario) throw new Error('Choose an available demo scenario.');
  const path = calculatePaths(workspace, scenario.startAssetId, scenario.targetAssetId)[0];
  const timestamp = new Date().toISOString();
  return { id: `SIM-${crypto.randomUUID()}`, scenarioId, startedAt: timestamp, pathAssetIds: path?.assetIds ?? [scenario.startAssetId], relationshipIds: path?.relationshipIds ?? [], outcome: path ? 'Potential exposure' : 'No modeled path', steps: path ? path.assetIds.map((id, index) => { const asset = workspace.assets.find(a => a.id === id)!; if (index === 0) return `Assume a starting foothold on ${asset.name}; no attack is performed.`; const relation = workspace.relationships.find(r => r.id === path.relationshipIds[index - 1])!; return `Model ${relation.label.toLowerCase()} to ${asset.name} (${relation.kind} demo relationship).`; }) : ['Evaluate the directed sample graph.', 'No traversable modeled route connects the selected start and destination. This does not prove security.'], riskScore: path ? Math.max(...path.assetIds.map(id => assetRisk(workspace, id).score)) : 0, assumptions: [...scenario.assumptions, ...(path?.assumptions ?? [])] };
}

export function generateReport(workspace: Workspace): string {
  const byId = (id: string) => workspace.assets.find(a => a.id === id)?.name ?? id;
  const clean = (value: string) => value.replaceAll('|', '\\|').replace(/[\r\n]+/g, ' ');
  const lines = [
    `# AEGIS workspace report — ${workspace.name}`, `Generated: ${new Date().toISOString()}`, '', '## Scope and limitations', workspace.scope, '', 'All asset records and threat context are seeded or illustrative. Paths and simulations are deterministic models, not evidence of compromise. Approval records never modify infrastructure. No real agents or trained models run in this demo.', '', '## Current overview', `Assets: ${workspace.assets.length} · Active findings: ${workspace.findings.filter(f => f.status !== 'Resolved').length} · Modeled relationships: ${workspace.relationships.length} · Simulations: ${workspace.simulations.length} · Decisions: ${workspace.approvals.length}`, `Workspace risk: ${workspaceRisk(workspace)}/100. This is the arithmetic mean of asset risk scores; asset risk is its highest active finding score.`, '', '## Risk calculation', 'Finding score = round(min(100, base score × 7 + exposure points + criticality points)). Resolved findings = 0. Exposure: Internet 15, Internal 5, Isolated 0. Criticality: Critical 15, High 10, Medium 5, Low 0. Critical ≥75, High ≥50, Medium ≥25, Low <25.', '', '## Asset inventory', '| Asset | Type | Owner | Exposure | Criticality | Risk | Status | Notes |', '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...workspace.assets.map(a => `| ${clean(a.name)} | ${a.type} | ${clean(a.owner)} | ${a.exposure} | ${a.criticality} | ${assetRisk(workspace, a.id).score} | ${a.status} | ${clean(a.notes)} |`), '', '## Findings',
    ...workspace.findings.flatMap(f => { const asset = workspace.assets.find(a => a.id === f.assetId)!; return [`### ${f.id} · ${f.title}`, `${byId(f.assetId)} · ${f.status} · Assigned severity ${f.severity} · Calculated risk ${findingRisk(f, asset).score}/100 (${findingRisk(f, asset).level})`, f.description, `Evidence: ${f.evidence}`, `Contributors: ${f.factors.join('; ')}`, findingRisk(f, asset).explanation, f.cve ? `Illustrative historical context: ${f.cve}. Not live vulnerability intelligence.` : '', '']; }),
    '## Modeled relationships', ...workspace.relationships.map(r => `- ${byId(r.source)} → ${byId(r.target)}: ${r.label} [${r.kind} demo data]`), '', '## Modeled scenario paths', ...workspace.scenarios.flatMap(scenario => { const paths = calculatePaths(workspace, scenario.startAssetId, scenario.targetAssetId); return [`### ${scenario.name}`, `Start: ${byId(scenario.startAssetId)}. Destination: ${byId(scenario.targetAssetId)}. ${paths.length} modeled route(s) within six relationships and twenty paths.`, ...paths.flatMap((path, index) => [`${index + 1}. ${path.assetIds.map(byId).join(' → ')}`, path.impact, ...path.assumptions.map(assumption => `   - ${assumption}`)]), ...(paths.length ? [] : ['No modeled path found within the search bounds. This does not prove security.']), '']; }), '', '## Simulation records', ...(workspace.simulations.length ? workspace.simulations.flatMap(s => [`### ${workspace.scenarios.find(c => c.id === s.scenarioId)?.name ?? s.scenarioId}`, `${s.startedAt} · ${s.outcome} · Modeled risk ${s.riskScore}/100`, `Path: ${s.pathAssetIds.map(byId).join(' → ')}`, ...s.steps.map((step, i) => `${i + 1}. ${step}`), 'Assumptions:', ...s.assumptions.map(a => `- ${a}`), '']) : ['No simulations recorded.']), '', '## Ranked recommendations', 'Ranking score = estimated risk reduction × 2 − disruption × 5 − effort × 3. Disruption and effort use an illustrative 1–5 scale; risk reduction is an unvalidated estimate in points.', ...rankRecommendations(workspace).flatMap(r => [`${r.rank}. ${r.title} — score ${r.score}; estimated reduction ${r.riskReduction}; disruption ${r.disruption}/5; effort ${r.effort}/5.`, r.rationale, `Decision: ${r.decision?.decision ?? 'Pending human review'}`, '']), '', '## Guardian Gate decisions', ...(workspace.approvals.length ? workspace.approvals.map(a => `- ${a.timestamp} · ${a.reviewer} · ${a.decision} · ${workspace.recommendations.find(r => r.id === a.recommendationId)?.title ?? a.recommendationId}. Notes: ${a.notes}. Simulation record: ${a.simulationId ?? 'Not linked'}. No infrastructure action.`) : ['No decisions recorded.']), '', '## Audit history', ...workspace.audit.map(a => `- ${a.timestamp} · ${a.category} · ${a.action}: ${a.detail}`), '', '## Availability', 'Threat feeds: not configured. AI agents: planned, workflow activity is deterministic. ML models: untrained/planned; no validated detection metrics. Persistence: browser local storage only. Authentication and tenant isolation: not implemented.', '',
  ];
  return lines.join('\n');
}
