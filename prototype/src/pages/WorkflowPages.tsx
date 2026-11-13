import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, CheckCircle2, ChevronRight, CircleDot, FileCheck2, GitBranch, History, Play, Search, ShieldCheck, SlidersHorizontal, X } from 'lucide-react';
import { useWorkspace } from '../state/WorkspaceContext';
import { calculatePaths, rankRecommendations } from '../domain/engine';
import type { Approval, AuditRecord, Simulation } from '../domain/types';
import { PageHeading, Panel, Badge, Empty, Notice, AssetLink, formatTime } from '../components/ui';

function PathChain({ ids }: { ids: string[] }) {
  return <div className="path-chain">{ids.map((id, index) => <div className="path-chain-part" key={`${id}-${index}`}><div className="path-node"><span className="path-step">{String(index + 1).padStart(2, '0')}</span><AssetLink id={id} /></div>{index < ids.length - 1 && <ArrowRight size={16} aria-hidden="true" />}</div>)}</div>;
}

export function PathsPage() {
  const { workspace, go, log } = useWorkspace();
  const scenario = workspace.scenarios[0];
  const [start, setStart] = useState(scenario?.startAssetId ?? workspace.assets[0]?.id ?? '');
  const [target, setTarget] = useState(scenario?.targetAssetId ?? workspace.assets.at(-1)?.id ?? '');
  const [query, setQuery] = useState({ start, target });
  const [error, setError] = useState('');
  const paths = useMemo(() => calculatePaths(workspace, query.start, query.target), [workspace, query]);
  const matchingScenario = workspace.scenarios.find(item => item.startAssetId === query.start && item.targetAssetId === query.target);
  function analyze() {
    if (!start || !target || start === target) { setError('Select two different assets to model a path.'); return; }
    setError(''); setQuery({ start, target });
    log('Risk paths modeled', `Analyzed directed demo relationships from ${start} to ${target}. No traffic sent.`, 'Simulation', start);
  }
  return <>
    <PageHeading eyebrow="MODEL · EXPLORE · UNDERSTAND" title="Attack Path Explorer" description="Understand how connected exposures could lead to a sensitive asset."><Badge tone="purple">Modeled possibilities</Badge></PageHeading>
    <Notice>Paths are hypothetical risk models over the seeded Digital Twin. A connection is not evidence of a successful attack.</Notice>
    <Panel title="Define your path" subtitle="Explore the relationships already present in this workspace." action={<GitBranch size={19} />}>
      <div className="path-form"><label className="field">Starting asset<select value={start} onChange={event => setStart(event.target.value)}>{workspace.assets.map(asset => <option key={asset.id} value={asset.id}>{asset.name} · {asset.exposure}</option>)}</select></label><ArrowRight size={20} className="path-form-arrow" /><label className="field">Destination asset<select value={target} onChange={event => setTarget(event.target.value)}>{workspace.assets.map(asset => <option key={asset.id} value={asset.id}>{asset.name} · {asset.criticality}</option>)}</select></label><button className="button primary" onClick={analyze}><GitBranch size={16} />Analyze paths</button></div>
      {error && <p role="alert" className="form-error">{error}</p>}
    </Panel>
    <div className="workflow-section-heading"><div><span className="eyebrow">ANALYSIS RESULTS</span><h2>{paths.length} potential {paths.length === 1 ? 'path' : 'paths'}</h2></div><span className="muted">Directed relationships · up to 6 hops · 20 paths</span></div>
    <div className="stack">{paths.map((path, index) => <Panel key={path.id} title={`Path ${String(index + 1).padStart(2, '0')}`} subtitle={`${path.assetIds.length - 1} relationships · modeled possibility`} action={<Badge tone="amber">Potential exposure</Badge>}>
      <PathChain ids={path.assetIds} />
      <div className="path-detail-grid"><div><h3>Relationships</h3><div className="stack path-relations">{path.relationshipIds.map(id => { const relation = workspace.relationships.find(item => item.id === id); return relation ? <div key={id} className="path-relation"><span>{relation.label}</span><Badge tone={relation.kind === 'observed' ? 'blue' : relation.kind === 'inferred' ? 'amber' : 'purple'}>{relation.kind === 'observed' ? 'Observed demo' : relation.kind}</Badge></div> : null; })}</div></div><div><h3>Assumptions & impact</h3><ul className="assumption-list">{path.assumptions.map((item, i) => <li key={i}>{item}</li>)}</ul><p className="muted">{path.impact}</p></div></div>
      <div className="workflow-card-footer"><span className="muted">Validate assumptions before making a real-world decision.</span><button className="button secondary small" onClick={() => go('simulation', matchingScenario?.id)}><Play size={14} />{matchingScenario ? 'Simulate this scenario' : 'Open simulations'}</button></div>
    </Panel>)}</div>
    {!paths.length && <Empty title="No modeled route" description="The current directed graph has no route between these assets within six relationships. This does not establish that the infrastructure is secure."><button className="button secondary" onClick={() => go('twin')}>Inspect Digital Twin<ArrowRight size={15} /></button></Empty>}
  </>;
}

export function SimulationPage() {
  const { workspace, run, go, log, selectedRecordId } = useWorkspace();
  const initialScenarioId = workspace.scenarios.find(item => item.id === selectedRecordId)?.id ?? workspace.scenarios[0]?.id ?? '';
  const [scenarioId, setScenarioId] = useState(initialScenarioId);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(workspace.simulations.find(item => item.scenarioId === initialScenarioId)?.id ?? null);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const opened = useRef(false);
  useEffect(() => { if (selectedRecordId && workspace.scenarios.some(item => item.id === selectedRecordId)) { setScenarioId(selectedRecordId); setSelectedRunId(workspace.simulations.find(item => item.scenarioId === selectedRecordId)?.id ?? null); setError(''); } }, [selectedRecordId, workspace.scenarios]);
  useEffect(() => { if (!opened.current) { opened.current = true; log('Simulation workspace opened', 'Opened safe Digital Twin simulation workspace. No commands or network traffic executed.', 'Simulation'); } }, [log]);
  const scenario = workspace.scenarios.find(item => item.id === scenarioId);
  const result = workspace.simulations.find(item => item.id === selectedRunId);
  async function execute() {
    if (!scenario || running) return;
    setError(''); setRunning(true);
    try { await new Promise(resolve => window.setTimeout(resolve, 350)); const simulation = run(scenarioId); setSelectedRunId(simulation.id); } catch (cause) { setError(cause instanceof Error ? cause.message : 'The modeled scenario could not be evaluated. Try again.'); } finally { setRunning(false); }
  }
  return <>
    <PageHeading eyebrow="SAFE BY DESIGN" title="Attack Simulation" description="Test a defensive scenario in your Digital Twin. Learn from the model."><Badge tone="green"><ShieldCheck size={13} />Twin only</Badge></PageHeading>
    <Notice>Deterministic simulation only. No attacks, commands, discovery, or network traffic are executed. Guardian Gate approvals record review decisions and do not alter this graph.</Notice>
    <div className="split-grid simulation-layout">
      <div className="stack"><Panel title="Scenario configuration" subtitle="Choose a seeded, repeatable model.">
        <label className="field">Scenario<select value={scenarioId} disabled={running} onChange={event => { setScenarioId(event.target.value); go('simulation', event.target.value); }}>{workspace.scenarios.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
        {scenario && <><p className="muted">{scenario.description}</p><div className="simulation-endpoints"><div><span className="eyebrow">ENTRY POINT</span><AssetLink id={scenario.startAssetId} /></div><ArrowRight size={17} /><div><span className="eyebrow">SENSITIVE TARGET</span><AssetLink id={scenario.targetAssetId} /></div></div><h3>Scenario assumptions</h3><ul className="assumption-list">{scenario.assumptions.map(item => <li key={item}>{item}</li>)}</ul></>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button primary full-width" disabled={!scenario || running} onClick={() => void execute()}><Play size={16} />{running ? 'Evaluating model…' : 'Run safe simulation'}</button>
      </Panel><Panel title="Run history" action={<Badge tone="muted">{workspace.simulations.length} runs</Badge>}>
        {!workspace.simulations.length ? <p className="muted">No simulations yet. Run a scenario to create your first record.</p> : <div className="stack simulation-history">{workspace.simulations.map(item => <button key={item.id} className={`simulation-history-row ${item.id === selectedRunId ? 'selected' : ''}`} onClick={() => setSelectedRunId(item.id)}><div><strong>{workspace.scenarios.find(s => s.id === item.scenarioId)?.name ?? item.scenarioId}</strong><span>{formatTime(item.startedAt)}</span></div><ChevronRight size={16} /></button>)}</div>}
      </Panel></div>
      <Panel title="Simulation results" subtitle={result ? `Recorded ${formatTime(result.startedAt)}` : 'Your modeled results will appear here.'} action={result ? <Badge tone={result.outcome === 'Potential exposure' ? 'amber' : 'green'}>{result.outcome}</Badge> : <CircleDot size={18} />}>
        {running ? <div className="simulation-empty" role="status"><span className="simulation-orbit" /><h3>Evaluating seeded relationships</h3><p>Applying the deterministic scenario rules.</p></div> : result ? <SimulationResult result={result} onAdvisor={() => go('advisor', result.id)} /> : <div className="simulation-empty"><div className="simulation-illustration"><GitBranch size={42} strokeWidth={1.3} /></div><span className="eyebrow">A CONTROLLED ENVIRONMENT</span><h3>Explore without exposure</h3><p>Run a scenario to see its modeled path, assumptions, and potential impact.</p><Badge tone="muted">No external connections</Badge></div>}
      </Panel>
    </div>
  </>;
}

function SimulationResult({ result, onAdvisor }: { result: Simulation; onAdvisor: () => void }) {
  const { workspace } = useWorkspace();
  return <div className="stack"><div className="simulation-result-summary"><div><span className="eyebrow">MODELED OUTCOME</span><h3>{workspace.scenarios.find(s => s.id === result.scenarioId)?.name}</h3><p className="muted">{result.outcome === 'Potential exposure' ? 'A potential route to the target exists in the seeded graph. This is not a confirmed compromise.' : 'The model found no directed route within its search bounds. Other routes may exist outside the seeded data.'}</p></div><div className="simulation-score"><strong>{result.riskScore}</strong><span>risk / 100</span></div></div>
    {!!result.pathAssetIds.length && <PathChain ids={result.pathAssetIds} />}
    <h3>Modeled steps</h3><ol className="simulation-steps">{result.steps.map((step, index) => <li key={index}><span>{String(index + 1).padStart(2, '0')}</span><div>{step}</div><Check size={14} aria-label="Modeled step evaluated" /></li>)}</ol>
    <div className="record-card"><h3>Assumptions recorded with this run</h3><ul className="assumption-list">{result.assumptions.map((item, index) => <li key={index}>{item}</li>)}</ul></div>
    <div className="workflow-card-footer"><span className="muted">Rules evaluated locally · no LLM or ML model used</span><button className="button primary small" onClick={onAdvisor}>Review recommendations<ArrowRight size={15} /></button></div>
  </div>;
}

export function AdvisorPage() {
  const { workspace, go, selectedRecordId } = useWorkspace();
  const recommendations = rankRecommendations(workspace);
  const simulationContext = workspace.simulations.find(item => item.id === selectedRecordId) ?? workspace.simulations[0];
  const relatedAssetIds = new Set(simulationContext?.pathAssetIds ?? []);
  const [filter, setFilter] = useState('All recommendations');
  const shown = recommendations.filter(item => filter === 'All recommendations' || (filter === 'Related to simulation' ? relatedAssetIds.has(item.assetId) : filter === 'Pending review' ? !item.decision : item.decision?.decision === filter));
  return <>
    <PageHeading eyebrow="UNDERSTAND · PRIORITIZE · REVIEW" title="Defense Advisor" description="A clear next step for every exposure. You stay in control."><button className="button secondary" onClick={() => go('guardian')}><ShieldCheck size={16} />Guardian Gate</button></PageHeading>
    {simulationContext && <Notice><strong>Simulation context: {workspace.scenarios.find(item => item.id === simulationContext.scenarioId)?.name ?? simulationContext.scenarioId}.</strong> {simulationContext.pathAssetIds.length} assets in this recorded model · {simulationContext.outcome.toLowerCase()}. Recommendations on those assets are marked as related. Global ranks stay unchanged; relevance does not establish that a control is effective.</Notice>}
    <div className="advisor-formula"><div className="advisor-formula-icon"><SlidersHorizontal size={21} /></div><div><strong>Transparent by design</strong><p>Priority = (risk reduction × 2) − (operational disruption × 5) − (implementation effort × 3).</p><span className="muted">Illustrative reduction points: 0–100. Disruption and effort: 1–5, lower is better. Scores are deterministic planning estimates, not validated efficacy.</span></div><Badge tone="blue">Rules based</Badge></div>
    <div className="toolbar"><span className="muted">{shown.length} recommendations · ranked by priority</span><label className="field compact-field"><span className="sr-only">Filter recommendations</span><select value={filter} onChange={event => setFilter(event.target.value)}>{['All recommendations', ...(simulationContext ? ['Related to simulation'] : []), 'Pending review', 'Approved', 'Rejected'].map(value => <option key={value}>{value}</option>)}</select></label></div>
    <div className="stack">{shown.map(item => <Panel key={item.id} className="recommendation-panel" title={item.title} subtitle={item.description} action={<div className="inline"><Badge tone={item.decision?.decision === 'Approved' ? 'green' : item.decision?.decision === 'Rejected' ? 'red' : 'amber'}>{item.decision?.decision ?? 'Pending review'}</Badge><span className="recommendation-rank">#{String(item.rank).padStart(2, '0')}</span></div>}>
      <div className="recommendation-content"><div><div className="recommendation-target"><span className="muted">AFFECTED ASSET</span><AssetLink id={item.assetId} />{relatedAssetIds.has(item.assetId) && <Badge tone="blue">Related to simulation</Badge>}</div><h3>Why this ranks #{item.rank}</h3><p className="muted">{item.rationale}</p><p className="recommendation-control"><ShieldCheck size={15} /><span>{item.control}</span></p>{item.findingId && <p className="muted">Linked finding: {workspace.findings.find(f => f.id === item.findingId)?.title ?? item.findingId}</p>}</div><div className="recommendation-scores"><div><span>Risk reduction</span><strong className="green-text">{item.riskReduction} pts</strong></div><div><span>Disruption</span><strong>{item.disruption} / 5</strong></div><div><span>Effort</span><strong>{item.effort} / 5</strong></div><div className="priority-total"><span>Priority score</span><strong>{item.score}</strong></div></div></div>
      <div className="workflow-card-footer"><span className="muted">{item.decision ? `Last reviewed by ${item.decision.reviewer} · ${formatTime(item.decision.timestamp)}` : 'Human review required · simulation-record purposes only'}</span><button className="button secondary small" onClick={() => go('guardian', item.id)}>Review recommendation<ArrowRight size={15} /></button></div>
    </Panel>)}</div>
    {!shown.length && <Empty title="No recommendations in this view" description="Try another review status to see your workspace recommendations." />}
  </>;
}

export function GuardianPage() {
  const { workspace, decide, selectedRecordId, go } = useWorkspace();
  const ranked = rankRecommendations(workspace);
  const [recommendationId, setRecommendationId] = useState(ranked.find(item => item.id === selectedRecordId)?.id ?? ranked[0]?.id ?? '');
  const [decision, setDecision] = useState<Approval['decision']>('Approved');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  useEffect(() => { if (selectedRecordId && workspace.recommendations.some(item => item.id === selectedRecordId)) { setRecommendationId(selectedRecordId); setNotes(''); setError(''); setSuccess(''); } }, [selectedRecordId, workspace.recommendations]);
  const recommendation = ranked.find(item => item.id === recommendationId);
  const history = workspace.approvals.filter(item => item.recommendationId === recommendationId);
  function recordDecision() {
    setError(''); setSuccess('');
    const cleanNotes = notes.trim();
    if (!recommendation) { setError('Select a recommendation to review.'); return; }
    if (cleanNotes.length < 5 || cleanNotes.length > 1000) { setError('Add review notes between 5 and 1,000 characters.'); return; }
    try { decide(recommendation.id, decision, cleanNotes); setSuccess(`${decision} decision recorded in the local audit history.`); setNotes(''); } catch (cause) { setError(cause instanceof Error ? cause.message : 'The review could not be recorded.'); }
  }
  return <>
    <PageHeading eyebrow="HUMAN OVERSIGHT" title="Guardian Gate" description="Review the reasoning. Record your decision. Keep a clear trail."><Badge tone="green"><ShieldCheck size={13} />Human in control</Badge></PageHeading>
    <Notice>Approvals and rejections are local review records only. They do not change infrastructure, resolve findings, modify the Digital Twin, or apply defensive controls.</Notice>
    <div className="split-grid guardian-layout"><div className="stack"><Panel title="Review recommendation" subtitle="Every decision begins with context.">
      <label className="field">Recommendation<select value={recommendationId} onChange={event => { setRecommendationId(event.target.value); setNotes(''); setError(''); setSuccess(''); go('guardian', event.target.value); }}>{ranked.map(item => <option value={item.id} key={item.id}>#{item.rank} · {item.title}</option>)}</select></label>
      {recommendation && <><div className="guardian-review-heading"><h3>{recommendation.title}</h3><Badge tone={recommendation.decision?.decision === 'Approved' ? 'green' : recommendation.decision?.decision === 'Rejected' ? 'red' : 'amber'}>{recommendation.decision?.decision ?? 'Pending review'}</Badge></div><p className="muted">{recommendation.description}</p><div className="guardian-asset"><span className="eyebrow">AFFECTED ASSET</span><AssetLink id={recommendation.assetId} /></div><div className="record-card"><h3>Proposed defensive control</h3><p>{recommendation.control}</p><p className="muted">{recommendation.rationale}</p></div><div className="guardian-metrics"><div><span>Risk reduction</span><strong>{recommendation.riskReduction} pts</strong></div><div><span>Disruption</span><strong>{recommendation.disruption}/5</strong></div><div><span>Effort</span><strong>{recommendation.effort}/5</strong></div></div><p className="section-note">These are illustrative planning estimates. A real implementation would require independent validation, change controls, and an authorized operator.</p></>}
    </Panel><Panel title="Review history" action={<History size={17} />}>
      {history.length ? <div className="timeline">{history.map(item => <div className="timeline-item decision-history" key={item.id}><div className={`decision-history-icon ${item.decision === 'Approved' ? 'approved' : 'rejected'}`}>{item.decision === 'Approved' ? <Check size={14} /> : <X size={14} />}</div><div><div className="record-head"><strong>{item.decision}</strong><span className="muted">{formatTime(item.timestamp)}</span></div><p>{item.notes}</p><span className="muted">{item.reviewer} · local demo review</span></div></div>)}</div> : <p className="muted">No review decisions for this recommendation yet.</p>}
    </Panel></div><Panel title="Record a decision" subtitle="Your review will be retained in the audit history." action={<FileCheck2 size={19} />}>
      <fieldset className="guardian-decision"><legend>Review outcome</legend><label className={`decision-option ${decision === 'Approved' ? 'chosen' : ''}`}><input type="radio" name="decision" value="Approved" checked={decision === 'Approved'} onChange={() => setDecision('Approved')} /><span><strong><CheckCircle2 size={17} />Approve recommendation</strong><small>Record support for the proposed defense.</small></span></label><label className={`decision-option ${decision === 'Rejected' ? 'chosen' : ''}`}><input type="radio" name="decision" value="Rejected" checked={decision === 'Rejected'} onChange={() => setDecision('Rejected')} /><span><strong><X size={17} />Reject recommendation</strong><small>Record a concern or alternative approach.</small></span></label></fieldset>
      <label className="field">Review notes <span className="muted">Required · 5–1,000 characters</span><textarea value={notes} onChange={event => setNotes(event.target.value)} maxLength={1000} rows={5} placeholder="Explain the decision, tradeoffs, and any conditions for a future implementation." /></label><div className="guardian-note-meta"><span>Reviewer: {workspace.settings.analystName}</span><span>{notes.length}/1,000</span></div>
      {error && <p className="form-error" role="alert">{error}</p>}{success && <p className="form-success" role="status"><CheckCircle2 size={15} />{success}</p>}
      <button className="button primary full-width" onClick={recordDecision} disabled={!recommendation}><ShieldCheck size={16} />Record {decision === 'Approved' ? 'approval' : 'rejection'}</button><p className="section-note">Decision time is captured automatically. Earlier decisions remain in history when a new review is recorded.</p>
    </Panel></div>
  </>;
}

export function AuditPage() {
  const { workspace } = useWorkspace();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All actions');
  const categories: AuditRecord['category'][] = ['Workspace', 'Asset', 'Simulation', 'Decision', 'Report', 'Discovery', 'Settings'];
  const rows = workspace.audit.filter(item => (category === 'All actions' || item.category === category) && `${item.action} ${item.detail} ${item.relatedId ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  return <>
    <PageHeading eyebrow="WORKSPACE HISTORY" title="Audit Logs" description="A readable history of the actions taken in this local workspace."><Badge tone="muted">{workspace.audit.length} records</Badge></PageHeading>
    <Notice>This is browser-local demo history, not a tamper-resistant compliance log. The initial workspace entry is seeded; subsequent records reflect actual demo actions.</Notice>
    <Panel title="Activity ledger" subtitle="Simulation runs, review decisions, asset changes, and reports.">
      <div className="toolbar"><label className="search-field"><Search size={16} /><span className="sr-only">Search audit history</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search actions, details, or records…" /></label><label className="field compact-field"><span className="sr-only">Filter audit category</span><select value={category} onChange={event => setCategory(event.target.value)}><option>All actions</option>{categories.map(item => <option key={item}>{item}</option>)}</select></label></div>
      <div className="table-wrap"><table className="data-table audit-table"><thead><tr><th>Time</th><th>Action</th><th>Category</th><th>Details</th></tr></thead><tbody>{rows.map(item => <tr key={item.id}><td className="mono nowrap">{formatTime(item.timestamp)}</td><td><strong>{item.action}</strong>{item.relatedId && <span className="audit-record-id mono">{item.relatedId}</span>}</td><td><Badge tone={item.category === 'Decision' ? 'green' : item.category === 'Simulation' ? 'purple' : 'muted'}>{item.category}</Badge></td><td className="muted">{item.detail}</td></tr>)}</tbody></table></div>
      {!rows.length && <Empty title="No matching activity" description="Adjust the search or category filter. New demo actions will appear here." />}
      <div className="workflow-card-footer"><span className="muted">Showing {rows.length} of {workspace.audit.length} records</span><span className="muted">Stored on this browser</span></div>
    </Panel>
  </>;
}
