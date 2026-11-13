import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Asset, AuditRecord, Page, ReportRecord, Settings, Severity, Workspace } from '../domain/types';
import { seedWorkspace } from '../domain/seed';
import { generateReport, runSimulation } from '../domain/engine';
import { loadWorkspace, saveWorkspace } from '../domain/storage';

const pages: Page[] = ['command', 'scope', 'discovery', 'assets', 'risk', 'threat', 'twin', 'paths', 'simulation', 'advisor', 'guardian', 'agents', 'models', 'reports', 'audit', 'settings'];
function readRoute(): { page: Page; recordId?: string } { const [candidate, encodedId] = window.location.hash.replace(/^#\/?/, '').split('/'); let recordId: string | undefined; try { recordId = encodedId ? decodeURIComponent(encodedId) : undefined; } catch { recordId = undefined; } return { page: pages.includes(candidate as Page) ? candidate as Page : 'command', recordId }; }
function audit(action: string, detail: string, category: AuditRecord['category'], relatedId?: string): AuditRecord { return { id: crypto.randomUUID(), action, detail, category, relatedId, timestamp: new Date().toISOString() }; }
function useWorkspaceState() {
  const [initial] = useState(loadWorkspace);
  const [workspace, setWorkspace] = useState<Workspace>(initial.workspace);
  const [storageWarning, setStorageWarning] = useState(initial.warning ?? '');
  const workspaceRef = useRef(workspace);
  const [route, setRoute] = useState(readRoute);
  const [selectedAssetId, setSelectedAssetId] = useState<string>();
  const [selectedFindingId, setSelectedFindingId] = useState<string>();
  const [toast, setToast] = useState('');
  useEffect(() => { const onHash = () => setRoute(readRoute()); window.addEventListener('hashchange', onHash); return () => window.removeEventListener('hashchange', onHash); }, []);
  useEffect(() => { if (!toast) return; const timeout = window.setTimeout(() => setToast(''), 4500); return () => clearTimeout(timeout); }, [toast]);
  useEffect(() => { document.documentElement.dataset.compact = String(workspace.settings.compactMode); document.documentElement.dataset.reducedMotion = String(workspace.settings.reducedMotion); }, [workspace.settings]);
  function commit(next: Workspace) { workspaceRef.current = next; setWorkspace(next); const result = saveWorkspace(next); if (!result.ok) setStorageWarning(result.error || 'Local storage is unavailable. Changes will last for this session only.'); }
  function change(transform: (current: Workspace) => Workspace) { commit(transform(workspaceRef.current)); }
  function log(action: string, detail: string, category: AuditRecord['category'], relatedId?: string) { change(w => ({ ...w, audit: [audit(action, detail, category, relatedId), ...w.audit] })); }
  function go(page: Page, recordId?: string) { const next = { page, recordId }; setRoute(next); window.location.hash = `/${page}${recordId ? `/${encodeURIComponent(recordId)}` : ''}`; setSelectedAssetId(undefined); setSelectedFindingId(undefined); window.scrollTo({ top: 0, behavior: 'instant' }); }
  function openAsset(id: string) { if (workspaceRef.current.assets.some(a => a.id === id)) { setSelectedAssetId(id); setSelectedFindingId(undefined); } }
  function updateAsset(id: string, patch: Partial<Asset>) {
    const current = workspaceRef.current.assets.find(a => a.id === id); if (!current) throw new Error('Asset no longer exists.');
    const allowed: Partial<Asset> = {};
    if (patch.owner !== undefined) { if (!patch.owner.trim() || patch.owner.length > 80) throw new Error('Owner must contain 1–80 characters.'); allowed.owner = patch.owner.trim(); }
    if (patch.notes !== undefined) { if (patch.notes.length > 1500) throw new Error('Notes must be 1,500 characters or fewer.'); allowed.notes = patch.notes; }
    if (patch.criticality !== undefined) { if (!['Critical', 'High', 'Medium', 'Low'].includes(patch.criticality)) throw new Error('Choose a valid criticality.'); allowed.criticality = patch.criticality; }
    if (patch.exposure !== undefined) { if (!['Internet', 'Internal', 'Isolated'].includes(patch.exposure)) throw new Error('Choose a valid exposure.'); allowed.exposure = patch.exposure; }
    if (patch.status !== undefined) { if (!['Monitored', 'Review', 'Protected'].includes(patch.status)) throw new Error('Choose a valid status.'); allowed.status = patch.status; }
    change(w => ({ ...w, assets: w.assets.map(a => a.id === id ? { ...a, ...allowed } : a), audit: [audit('Asset updated', `${current.name}: demo metadata updated. Relationships and infrastructure are unchanged.`, 'Asset', id), ...w.audit] })); setToast('Asset changes saved locally');
  }
  function addAsset(input: {
    name: string;
    type: "Gateway" | "Server" | "Database" | "Endpoint" | "Cloud";
    owner: string;
    criticality: Severity;
    exposure: "Internet" | "Internal" | "Isolated";
    environment?: "Production" | "Staging" | "Corporate";
    address?: string;
    services?: string[];
    notes?: string;
  }) {
    if (!input.name.trim() || input.name.length > 120) throw new Error('Asset name must be 1–120 characters.');
    if (!input.owner.trim() || input.owner.length > 80) throw new Error('Owner must be 1–80 characters.');
    const id = `asset-${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const newAsset: Asset = {
      id,
      name: input.name.trim(),
      type: input.type,
      environment: input.environment || 'Production',
      criticality: input.criticality,
      exposure: input.exposure,
      owner: input.owner.trim(),
      status: 'Monitored',
      address: input.address?.trim() || '10.0.99.1',
      services: input.services || [],
      notes: input.notes?.trim() || 'Manually recorded asset.',
      lastSeen: now,
      x: Math.floor(20 + Math.random() * 60),
      y: Math.floor(20 + Math.random() * 60),
    };
    change(w => ({
      ...w,
      assets: [...w.assets, newAsset],
      audit: [audit('Manual asset added', `${newAsset.name} (${newAsset.type}): manually recorded into inventory. No network discovery performed.`, 'Asset', id), ...w.audit]
    }));
    setToast(`Manual asset "${newAsset.name}" added to inventory`);
    return newAsset;
  }
  function updateFinding(id: string, status: 'Open' | 'Investigating' | 'Resolved') { if (!['Open', 'Investigating', 'Resolved'].includes(status)) throw new Error('Invalid finding status.'); const finding = workspaceRef.current.findings.find(f => f.id === id); if (!finding) throw new Error('Finding not found.'); change(w => ({ ...w, findings: w.findings.map(f => f.id === id ? { ...f, status } : f), audit: [audit('Finding status updated', `${finding.title}: ${status} (demo record only).`, 'Asset', id), ...w.audit] })); setToast('Finding status saved locally'); }
  function refreshDiscovery() { const now = new Date().toISOString(); const seed = seedWorkspace(); change(w => ({ ...w, assets: [...w.assets.map(a => ({ ...a, lastSeen: now })), ...seed.assets.filter(a => !w.assets.some(existing => existing.id === a.id)).map(a => ({ ...a, lastSeen: now }))], lastDiscovery: now, audit: [audit('Demo inventory refreshed', 'Refreshed seeded asset timestamps. No network discovery or traffic occurred.', 'Discovery'), ...w.audit] })); setToast('Seeded inventory refreshed · no network traffic'); }
  function run(scenarioId: string) { const simulation = runSimulation(workspaceRef.current, scenarioId); change(w => ({ ...w, simulations: [simulation, ...w.simulations], audit: [audit('Simulation completed', `${w.scenarios.find(s => s.id === scenarioId)?.name}: ${simulation.outcome}. Digital Twin only.`, 'Simulation', simulation.id), ...w.audit] })); setToast('Deterministic simulation recorded'); return simulation; }
  function decide(recommendationId: string, decision: 'Approved' | 'Rejected', notes: string) {
    const current = workspaceRef.current;
    const recommendation = current.recommendations.find(r => r.id === recommendationId);
    if (!recommendation) throw new Error('Recommendation not found.');
    if (!['Approved', 'Rejected'].includes(decision)) throw new Error('Invalid decision.');
    if (notes.trim().length < 5 || notes.length > 1000) throw new Error('Add review notes between 5 and 1,000 characters.');
    const linkedSimulation = current.simulations.find(s => s.pathAssetIds.includes(recommendation.assetId));
    const approval = { id: crypto.randomUUID(), recommendationId, decision, notes: notes.trim(), timestamp: new Date().toISOString(), reviewer: current.settings.analystName, simulationId: linkedSimulation?.id };
    change(w => ({ ...w, approvals: [approval, ...w.approvals], audit: [audit(`Recommendation ${decision.toLowerCase()}`, `${recommendation.title}. ${notes.trim()} Record only; no control applied.`, 'Decision', approval.id), ...w.audit] }));
    setToast(`Decision recorded: ${decision.toLowerCase()}`);
  }
  function createReport(): ReportRecord { const current = workspaceRef.current; const record = { id: crypto.randomUUID(), generatedAt: new Date().toISOString(), name: `AEGIS workspace review ${new Date().toLocaleDateString('en-GB')}`, content: generateReport(current) }; change(w => ({ ...w, reports: [record, ...w.reports], audit: [audit('Report generated', `Workspace snapshot with ${w.assets.length} assets, ${w.simulations.length} simulations and ${w.approvals.length} decisions.`, 'Report', record.id), ...w.audit] })); setToast('Workspace report generated'); return record; }
  function updateScope(name: string, scope: string) { if (!name.trim() || name.length > 80 || scope.trim().length < 10 || scope.length > 2000) throw new Error('Workspace name must be 1–80 characters; scope must be 10–2,000 characters.'); change(w => ({ ...w, name: name.trim(), scope: scope.trim(), audit: [audit('Workspace scope updated', 'Local demo workspace description updated. Scope text never initiates discovery.', 'Workspace'), ...w.audit] })); setToast('Workspace saved locally'); }
  function updateSettings(patch: Partial<Settings>) { if (patch.analystName !== undefined && (!patch.analystName.trim() || patch.analystName.length > 60)) throw new Error('Analyst name must contain 1–60 characters.'); const clean = { ...patch, ...(patch.analystName ? { analystName: patch.analystName.trim() } : {}) }; change(w => ({ ...w, settings: { ...w.settings, ...clean }, audit: [audit('Preferences updated', 'Local demo preferences saved.', 'Settings'), ...w.audit] })); setToast('Preferences saved'); }
  function openFinding(id: string) { if (workspaceRef.current.findings.some(f => f.id === id)) { setSelectedAssetId(undefined); setSelectedFindingId(id); } }
  return { workspace, page: route.page, selectedRecordId: route.recordId, go, openAsset, addAsset, selectedAssetId, closeAsset: () => setSelectedAssetId(undefined), selectedFindingId, openFinding, closeFinding: () => setSelectedFindingId(undefined), updateAsset, updateFinding, refreshDiscovery, run, decide, createReport, updateScope, updateSettings, log, notify: setToast, toast, storageWarning, dismissWarning: () => setStorageWarning('') };
}
const Context = createContext<ReturnType<typeof useWorkspaceState> | null>(null);
export function WorkspaceProvider({ children }: { children: ReactNode }) { const state = useWorkspaceState(); return <Context.Provider value={state}>{children}</Context.Provider>; }
export function useWorkspace() { const context = useContext(Context); if (!context) throw new Error('Workspace provider is missing.'); return context; }
