import { seedWorkspace } from './seed';
import type { Workspace } from './types';

export const STORAGE_KEY = 'aegis.workspace.v1';
type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => typeof value === 'object' && value !== null && !Array.isArray(value);
const string = (value: unknown, max = 1000): value is string => typeof value === 'string' && value.length <= max;
const text = (value: unknown, max = 1000): value is string => string(value, max) && value.trim().length > 0;
const number = (value: unknown, min = 0, max = 100): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const oneOf = (value: unknown, values: string[]) => typeof value === 'string' && values.includes(value);
const strings = (value: unknown) => Array.isArray(value) && value.length <= 100 && value.every(v => string(v));
const date = (value: unknown) => text(value, 100) && Number.isFinite(Date.parse(value));
const severity = (value: unknown) => oneOf(value, ['Critical', 'High', 'Medium', 'Low']);
const optionalText = (value: unknown) => value === undefined || text(value);

function list(value: unknown, check: (row: RecordValue) => boolean): value is RecordValue[] {
  if (!Array.isArray(value) || value.length > 10000) return false;
  const ids = new Set<string>();
  return value.every(row => { if (!record(row) || !text(row.id, 200) || ids.has(row.id) || !check(row)) return false; ids.add(row.id); return true; });
}

/** Validate persisted data at the service boundary, including references used by UI logic. */
export function isWorkspace(value: unknown): value is Workspace {
  if (!record(value) || value.version !== 1 || !text(value.id) || !text(value.name, 200) || !text(value.scope, 4000) || !date(value.lastDiscovery)) return false;
  if (!record(value.settings) || !text(value.settings.analystName, 100) || typeof value.settings.compactMode !== 'boolean' || typeof value.settings.reducedMotion !== 'boolean') return false;
  if (!list(value.assets, a => text(a.name, 120) && text(a.address, 250) && oneOf(a.type, ['Gateway', 'Server', 'Database', 'Endpoint', 'Cloud']) && oneOf(a.environment, ['Production', 'Staging', 'Corporate']) && severity(a.criticality) && oneOf(a.exposure, ['Internet', 'Internal', 'Isolated']) && text(a.owner, 120) && oneOf(a.status, ['Monitored', 'Review', 'Protected']) && strings(a.services) && date(a.lastSeen) && string(a.notes, 4000) && number(a.x) && number(a.y))) return false;
  const assetIds = new Set(value.assets.map(a => a.id));
  const assetRef = (id: unknown) => typeof id === 'string' && assetIds.has(id);
  if (!list(value.relationships, r => assetRef(r.source) && assetRef(r.target) && r.source !== r.target && text(r.label) && oneOf(r.kind, ['observed', 'inferred', 'hypothetical']))) return false;
  const relationshipIds = new Set(value.relationships.map(r => r.id));
  const relationshipRefs = (ids: unknown) => strings(ids) && (ids as string[]).every(id => relationshipIds.has(id));
  if (!list(value.findings, f => text(f.title) && assetRef(f.assetId) && severity(f.severity) && oneOf(f.status, ['Open', 'Investigating', 'Resolved']) && number(f.baseScore, 0, 10) && text(f.evidence, 4000) && strings(f.factors) && text(f.description, 4000) && optionalText(f.cve) && optionalText(f.technique))) return false;
  const findingIds = new Set(value.findings.map(f => f.id));
  if (!list(value.events, e => text(e.title) && text(e.detail, 4000) && oneOf(e.type, ['finding', 'asset', 'workflow']) && date(e.timestamp) && (e.assetId === undefined || assetRef(e.assetId)))) return false;
  if (!list(value.scenarios, s => text(s.name) && text(s.description, 4000) && assetRef(s.startAssetId) && assetRef(s.targetAssetId) && s.startAssetId !== s.targetAssetId && strings(s.assumptions))) return false;
  const scenarioIds = new Set(value.scenarios.map(s => s.id));
  if (!list(value.simulations, s => {
    if (!(typeof s.scenarioId === 'string' && scenarioIds.has(s.scenarioId) && date(s.startedAt) && strings(s.pathAssetIds) && (s.pathAssetIds as string[]).every(assetRef) && relationshipRefs(s.relationshipIds) && oneOf(s.outcome, ['Potential exposure', 'No modeled path']) && strings(s.steps) && number(s.riskScore) && strings(s.assumptions))) return false;
    const scenario = (value.scenarios as RecordValue[]).find(c => c.id === s.scenarioId)!;
    const path = s.pathAssetIds as string[];
    const edges = s.relationshipIds as string[];
    if (!path.length || path[0] !== scenario.startAssetId || new Set(path).size !== path.length) return false;
    if (s.outcome === 'No modeled path') return path.length === 1 && edges.length === 0 && s.riskScore === 0;
    if (path.length < 2 || path.length > 7 || edges.length !== path.length - 1 || path.at(-1) !== scenario.targetAssetId) return false;
    return edges.every((id, index) => (value.relationships as RecordValue[]).some(r => r.id === id && r.source === path[index] && r.target === path[index + 1]));
  })) return false;
  const simulationIds = new Set(value.simulations.map(s => s.id));
  if (!list(value.recommendations, r => text(r.title) && text(r.description, 4000) && assetRef(r.assetId) && (r.findingId === undefined || (typeof r.findingId === 'string' && findingIds.has(r.findingId) && (value.findings as RecordValue[]).some(f => f.id === r.findingId && f.assetId === r.assetId))) && number(r.riskReduction) && number(r.disruption, 1, 5) && number(r.effort, 1, 5) && text(r.rationale, 4000) && text(r.control) && relationshipRefs(r.blockedRelationshipIds))) return false;
  const recommendationIds = new Set(value.recommendations.map(r => r.id));
  if (!list(value.approvals, a => typeof a.recommendationId === 'string' && recommendationIds.has(a.recommendationId) && oneOf(a.decision, ['Approved', 'Rejected']) && string(a.notes, 4000) && date(a.timestamp) && text(a.reviewer, 100) && (a.simulationId === undefined || (typeof a.simulationId === 'string' && simulationIds.has(a.simulationId))))) return false;
  if (!list(value.audit, a => text(a.action) && text(a.detail, 6000) && date(a.timestamp) && oneOf(a.category, ['Workspace', 'Asset', 'Simulation', 'Decision', 'Report', 'Discovery', 'Settings']) && optionalText(a.relatedId))) return false;
  if (!list(value.reports, r => date(r.generatedAt) && text(r.name) && text(r.content, 2_000_000))) return false;
  return true;
}

export function loadWorkspace(): { workspace: Workspace; warning?: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { workspace: seedWorkspace() };
    const data: unknown = JSON.parse(raw);
    if (record(data) && data.version !== 1) return { workspace: seedWorkspace(), warning: 'This saved workspace uses an unsupported data version. A fresh demo has been loaded; the saved value has not been deleted.' };
    if (!isWorkspace(data)) return { workspace: seedWorkspace(), warning: 'The saved workspace could not be validated. A fresh demo has been loaded; the saved value has not been deleted.' };
    return { workspace: data };
  } catch {
    return { workspace: seedWorkspace(), warning: 'Local storage is unavailable or the saved data could not be read. The workspace is available in memory; changes may not persist.' };
  }
}

export function saveWorkspace(workspace: Workspace): { ok: boolean; error?: string } {
  try {
    if (!isWorkspace(workspace)) return { ok: false, error: 'The workspace contains invalid data. Changes remain in memory and have not been saved.' };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
    return { ok: true };
  } catch {
    return { ok: false, error: 'Local storage is unavailable or full. Changes remain in this tab but will not survive a reload. Download a report to keep a readable snapshot.' };
  }
}

export function clearWorkspace(): void { localStorage.removeItem(STORAGE_KEY); }
