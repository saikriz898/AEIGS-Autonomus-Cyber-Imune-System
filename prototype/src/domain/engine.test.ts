import { afterEach, describe, expect, it, vi } from 'vitest';
import { assetRisk, calculatePaths, findingRisk, generateReport, rankRecommendations, runSimulation, workspaceRisk } from './engine';
import { seedWorkspace } from './seed';
import { isWorkspace, loadWorkspace, saveWorkspace, STORAGE_KEY } from './storage';

afterEach(() => vi.unstubAllGlobals());

describe('risk calculation', () => {
  it('uses the declared components, rounding, thresholds, and resolved status', () => {
    const w = seedWorkspace();
    const finding = w.findings[0];
    const asset = w.assets.find(a => a.id === finding.assetId)!;
    const risk = findingRisk(finding, asset);
    expect(risk).toMatchObject({ score: 94, level: 'Critical', base: 68.6, exposure: 15, criticality: 10 });
    expect(findingRisk({ ...finding, status: 'Resolved' }, asset).score).toBe(0);
    expect(findingRisk({ ...finding, baseScore: 10 }, { ...asset, criticality: 'Critical', exposure: 'Internet' }).score).toBe(100);
  });
  it('uses the same 75/50/25 risk bands documented in the UI and reports', () => {
    const w = seedWorkspace();
    const asset = { ...w.assets[0], exposure: 'Isolated' as const, criticality: 'Medium' as const };
    for (const [baseScore, expected] of [[10, 'Critical'], [6.4, 'High'], [2.9, 'Medium'], [2.7, 'Low']] as const) {
      expect(findingRisk({ ...w.findings[0], baseScore }, asset).level).toBe(expected);
    }
    expect(generateReport(w)).toContain('Critical ≥75, High ≥50, Medium ≥25, Low <25');
  });
  it('reflects asset edits in asset and workspace risk', () => {
    const w = seedWorkspace();
    const before = workspaceRisk(w);
    const asset = w.assets.find(a => a.id === 'web-portal')!;
    asset.exposure = 'Isolated';
    asset.criticality = 'Low';
    expect(assetRisk(w, asset.id).score).toBe(69);
    expect(workspaceRisk(w)).toBeLessThan(before);
    expect(assetRisk(w, 'unavailable').score).toBe(0);
  });
});

describe('modeled graph and simulation', () => {
  it('finds directed paths, carries assumptions, and never repeats assets', () => {
    const w = seedWorkspace();
    w.relationships.push({ id: 'cycle', source: 'app-server', target: 'web-portal', label: 'Cycle for test', kind: 'hypothetical' });
    const paths = calculatePaths(w, 'edge-gateway', 'customer-db');
    expect(paths[0].assetIds).toEqual(['edge-gateway', 'web-portal', 'api-service', 'app-server', 'customer-db']);
    expect(paths[0].assumptions.join(' ')).toContain('Inferred');
    expect(paths.every(p => new Set(p.assetIds).size === p.assetIds.length)).toBe(true);
    expect(calculatePaths(w, 'customer-db', 'edge-gateway')).toEqual([]);
    expect(calculatePaths(w, 'missing', 'customer-db')).toEqual([]);
  });
  it('produces identical modeled outcomes without mutating data or applying approvals', () => {
    const w = seedWorkspace();
    const original = structuredClone(w);
    const first = runSimulation(w, 'perimeter-to-data');
    const second = runSimulation(w, 'perimeter-to-data');
    expect(first.steps).toEqual(second.steps);
    expect(first.riskScore).toBe(second.riskScore);
    expect(first.pathAssetIds).toEqual(second.pathAssetIds);
    expect(w).toEqual(original);
    w.approvals.push({ id: 'approval', recommendationId: 'REC-001', decision: 'Approved', notes: 'Record only', timestamp: new Date().toISOString(), reviewer: 'Test analyst' });
    expect(runSimulation(w, 'perimeter-to-data').outcome).toBe('Potential exposure');
  });
  it('handles disconnected graphs truthfully and rejects absent scenarios', () => {
    const w = seedWorkspace();
    w.relationships = [];
    expect(runSimulation(w, 'perimeter-to-data')).toMatchObject({ outcome: 'No modeled path', relationshipIds: [], riskScore: 0 });
    expect(() => runSimulation(w, 'absent')).toThrow('Choose an available');
  });
  it('retains hypothetical assumptions in paths, simulation steps, and reports', () => {
    const w = seedWorkspace();
    const path = calculatePaths(w, 'build-runner', 'backup-vault')[0];
    expect(path.assetIds).toEqual(['build-runner', 'backup-vault']);
    expect(path.assumptions).toContain('Hypothetical relationship: Assumed backup permission.');
    const simulation = runSimulation(w, 'build-to-vault');
    expect(simulation.assumptions).toContain('Hypothetical relationship: Assumed backup permission.');
    expect(simulation.steps.join(' ')).toContain('(hypothetical demo relationship)');
    expect(generateReport(w)).toContain('Hypothetical relationship: Assumed backup permission.');
  });
});

describe('recommendations and reports', () => {
  it('ranks by the explicit score with stable tie-breaking and latest decision', () => {
    const w = seedWorkspace();
    w.approvals.push({ id: 'two', recommendationId: 'REC-001', decision: 'Rejected', notes: 'Revised', timestamp: '2026-11-13T10:00:00Z', reviewer: 'Analyst' }, { id: 'one', recommendationId: 'REC-001', decision: 'Approved', notes: 'First', timestamp: '2026-11-13T14:30:00+05:30', reviewer: 'Analyst' });
    const ranked = rankRecommendations(w);
    expect(ranked[0].id).toBe('REC-002');
    expect(ranked[0].score).toBe(52);
    expect(ranked.find(r => r.id === 'REC-001')?.score).toBe(48);
    expect(ranked.find(r => r.id === 'REC-001')?.decision?.decision).toBe('Rejected');
    expect(ranked.map(r => r.rank)).toEqual([1, 2, 3, 4, 5]);
  });
  it('reports current edits, simulations, review notes, and honest limitations', () => {
    const w = seedWorkspace();
    w.assets[0].owner = 'Updated owner';
    w.simulations.push(runSimulation(w, 'perimeter-to-data'));
    w.approvals.push({ id: 'one', recommendationId: 'REC-001', decision: 'Approved', notes: 'Local human review complete', timestamp: '2026-11-13T09:00:00Z', reviewer: 'Analyst' });
    const report = generateReport(w);
    expect(report).toContain('Updated owner');
    expect(report).toContain('Potential exposure');
    expect(report).toContain('Local human review complete');
    expect(report).toContain('No real agents or trained models');
    expect(report).toContain('## Modeled scenario paths');
    expect(report).toContain('Inferred relationship: Database service account');
  });
  it('reports the latest prepended decision while retaining prior review notes', () => {
    const w = seedWorkspace();
    w.approvals = [
      { id: 'latest', recommendationId: 'REC-002', decision: 'Rejected', notes: 'Defer until the owner verifies applicability', timestamp: '2026-11-13T11:00:00Z', reviewer: 'Second reviewer' },
      { id: 'earlier', recommendationId: 'REC-002', decision: 'Approved', notes: 'Initial conditional support', timestamp: '2026-11-13T10:00:00Z', reviewer: 'First reviewer' },
    ];
    const report = generateReport(w);
    const recommendationSection = report.split('## Ranked recommendations')[1].split('## Guardian Gate decisions')[0];
    const topRecommendation = recommendationSection.split('2. ')[0];
    expect(topRecommendation).toContain('Review and update the portal component');
    expect(topRecommendation).toContain('Decision: Rejected');
    expect(topRecommendation).not.toContain('Decision: Approved');
    expect(report).toContain('Defer until the owner verifies applicability');
    expect(report).toContain('Initial conditional support');
  });
});

describe('persistence boundary', () => {
  it('validates a complete seed and rejects malformed nested values and references', () => {
    const w = seedWorkspace();
    expect(isWorkspace(w)).toBe(true);
    expect(isWorkspace({ ...w, settings: {} })).toBe(false);
    expect(isWorkspace({ ...w, relationships: [{ ...w.relationships[0], target: 'missing' }] })).toBe(false);
    expect(isWorkspace({ ...w, assets: [{ ...w.assets[0], criticality: 'Impossible' }] })).toBe(false);
    expect(isWorkspace({ ...w, findings: [{ ...w.findings[0], baseScore: 200 }] })).toBe(false);
    const simulation = runSimulation(w, 'perimeter-to-data');
    expect(isWorkspace({ ...w, simulations: [simulation] })).toBe(true);
    expect(isWorkspace({ ...w, simulations: [{ ...simulation, pathAssetIds: [] }] })).toBe(false);
    expect(isWorkspace({ ...w, simulations: [{ ...simulation, relationshipIds: ['r-vpn-id'] }] })).toBe(false);
    expect(isWorkspace({ ...w, recommendations: [{ ...w.recommendations[0], findingId: 'F-001' }] })).toBe(false);
    expect(isWorkspace({ ...w, scenarios: [{ ...w.scenarios[0], targetAssetId: w.scenarios[0].startAssetId }] })).toBe(false);
  });
  it('roundtrips local changes and rejects corrupted or future-version saves', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k) });
    const w = seedWorkspace();
    w.settings.analystName = 'Local reviewer';
    expect(saveWorkspace(w).ok).toBe(true);
    expect(loadWorkspace().workspace.settings.analystName).toBe('Local reviewer');
    values.set(STORAGE_KEY, '{broken');
    expect(loadWorkspace().warning).toBeTruthy();
    values.set(STORAGE_KEY, JSON.stringify({ version: 2 }));
    expect(loadWorkspace().warning).toContain('unsupported data version');
    expect(values.get(STORAGE_KEY)).toBe('{"version":2}');
  });
  it('rejects absent simulation references and inconsistent modeled routes', () => {
    const w = seedWorkspace();
    const simulation = runSimulation(w, 'perimeter-to-data');
    expect(isWorkspace({ ...w, simulations: [{ ...simulation, scenarioId: 'missing-scenario' }] })).toBe(false);
    expect(isWorkspace({ ...w, simulations: [{ ...simulation, relationshipIds: [...simulation.relationshipIds.slice(0, -1), 'missing-edge'] }] })).toBe(false);
    expect(isWorkspace({ ...w, simulations: [{ ...simulation, pathAssetIds: ['missing-asset', ...simulation.pathAssetIds.slice(1)] }] })).toBe(false);
    expect(isWorkspace({ ...w, simulations: [{ ...simulation, pathAssetIds: [...simulation.pathAssetIds].reverse() }] })).toBe(false);
    expect(isWorkspace({ ...w, simulations: [{ ...simulation, outcome: 'No modeled path' }] })).toBe(false);
    expect(isWorkspace({ ...w, approvals: [{ id: 'invalid-link', recommendationId: 'REC-001', decision: 'Approved', notes: 'Review note', timestamp: '2026-11-13T10:00:00Z', reviewer: 'Analyst', simulationId: 'missing-run' }] })).toBe(false);
  });
  it.each([0, 2, '1', null])('rejects unsupported workspace version %s without overwriting it', version => {
    const saved = JSON.stringify({ ...seedWorkspace(), version });
    const write = vi.fn();
    vi.stubGlobal('localStorage', { getItem: () => saved, setItem: write });
    expect(isWorkspace(JSON.parse(saved))).toBe(false);
    const loaded = loadWorkspace();
    expect(loaded.warning).toContain('unsupported data version');
    expect(loaded.workspace.version).toBe(1);
    expect(write).not.toHaveBeenCalled();
  });
  it('accepts a valid empty workspace and supplies honest empty domain results', () => {
    const empty = { ...seedWorkspace(), assets: [], relationships: [], findings: [], events: [], scenarios: [], simulations: [], recommendations: [], approvals: [], audit: [], reports: [] };
    expect(isWorkspace(empty)).toBe(true);
    expect(workspaceRisk(empty)).toBe(0);
    expect(rankRecommendations(empty)).toEqual([]);
    expect(calculatePaths(empty, 'absent-start', 'absent-target')).toEqual([]);
    expect(() => runSimulation(empty, 'absent')).toThrow('Choose an available');
    const report = generateReport(empty);
    expect(report).toContain('Assets: 0 · Active findings: 0');
    expect(report).toContain('No simulations recorded.');
    expect(report).toContain('No decisions recorded.');
    expect(report).not.toContain('undefined');
  });
  it('surfaces storage failure without throwing away the in-memory workspace', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('Blocked'); }, setItem: () => { throw new Error('Quota'); } });
    expect(loadWorkspace().workspace.assets).toHaveLength(12);
    expect(loadWorkspace().warning).toContain('unavailable');
    expect(saveWorkspace(seedWorkspace())).toMatchObject({ ok: false });
  });
  it('validates and persists manual assets added to workspace inventory', () => {
    const w = seedWorkspace();
    const manualAsset = {
      id: 'asset-manual-01',
      name: 'auth-vault-manual',
      type: 'Server' as const,
      environment: 'Production' as const,
      criticality: 'High' as const,
      exposure: 'Internal' as const,
      owner: 'SecOps',
      status: 'Monitored' as const,
      address: '10.0.99.50',
      services: ['https', 'vault'],
      notes: 'Manually recorded asset metadata.',
      lastSeen: new Date().toISOString(),
      x: 50,
      y: 50,
    };
    const updated = { ...w, assets: [...w.assets, manualAsset] };
    expect(isWorkspace(updated)).toBe(true);
    expect(assetRisk(updated, manualAsset.id).score).toBe(0); // zero findings
  });
});
