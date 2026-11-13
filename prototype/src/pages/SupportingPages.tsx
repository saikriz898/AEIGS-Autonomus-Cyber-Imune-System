import { useState, type FormEvent } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  CheckCircle2,
  Database,
  FileText,
  FlaskConical,
  LockKeyhole,
  Network,
  RefreshCw,
  ScanLine,
  Settings2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useWorkspace } from "../state/WorkspaceContext";
import {
  PageHeading,
  Panel,
  Badge,
  Empty,
  Notice,
  AssetLink,
  formatTime,
} from "../components/ui";
import type { Page, ReportRecord } from "../domain/types";

const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "The local action could not be completed. Please try again.";

export function ScopePage() {
  const { workspace, updateScope } = useWorkspace();
  const [name, setName] = useState(workspace.name);
  const [scope, setScope] = useState(workspace.scope);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setSaved(false);
    if (name.trim().length < 3 || name.trim().length > 80) {
      setError("Enter a workspace name between 3 and 80 characters.");
      return;
    }
    if (scope.trim().length < 20 || scope.trim().length > 1500) {
      setError("Describe the authorized demo scope in 20 to 1,500 characters.");
      return;
    }
    try {
      updateScope(name.trim(), scope.trim());
      setSaved(true);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <>
      <PageHeading
        eyebrow="WORKSPACE / AUTHORIZATION"
        title="Scope & workspace"
        description="Define the boundaries of your local security workspace."
      />
      <Notice>
        This workspace contains synthetic
        infrastructure. Scope descriptions are local notes; no discovery or
        network traffic is authorized or initiated.
      </Notice>
      <div className="split-grid">
        <Panel
          title="Workspace boundaries"
          subtitle="A shared context for every module"
        >
          <form onSubmit={submit} className="stack">
            <label className="field">
              Workspace name
              <input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setSaved(false);
                }}
                minLength={3}
                maxLength={80}
                required
                autoComplete="off"
              />
            </label>
            <label className="field">
              Authorized demo scope
              <textarea
                value={scope}
                onChange={(e) => {
                  setScope(e.target.value);
                  setSaved(false);
                }}
                minLength={20}
                maxLength={1500}
                rows={7}
                required
              />
            </label>
            <p className="section-note">
              Changes appear across the workspace and in future report
              snapshots. All records remain in this browser.
            </p>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <div className="inline">
              <button type="submit" className="button primary">
                <Check size={15} /> Save workspace
              </button>
              {saved && (
                <span role="status" className="muted">
                  Workspace saved locally.
                </span>
              )}
            </div>
          </form>
        </Panel>
        <div className="stack">
          <Panel title="Scope at a glance">
            <dl className="detail-list">
              <div>
                <dt>Workspace ID</dt>
                <dd className="mono">{workspace.id}</dd>
              </div>
              <div>
                <dt>Data origin</dt>
                <dd>
                  <Badge tone="blue">Seeded demo</Badge>
                </dd>
              </div>
              <div>
                <dt>Included assets</dt>
                <dd>{workspace.assets.length}</dd>
              </div>
              <div>
                <dt>Relationships</dt>
                <dd>{workspace.relationships.length}</dd>
              </div>
              <div>
                <dt>Active discovery</dt>
                <dd>
                  <Badge tone="muted">None</Badge>
                </dd>
              </div>
              <div>
                <dt>Storage boundary</dt>
                <dd>This browser / this origin</dd>
              </div>
            </dl>
          </Panel>
          <Panel title="Included in this demonstration">
            <div className="stack">
              <p className="muted">
                Reserved example addresses, a synthetic enterprise graph,
                illustrative findings, and deterministic simulation scenarios.
              </p>
              <p className="muted">
                Real infrastructure connections, authentication, and
                multi-tenant isolation are unavailable. This is a personal local
                demo.
              </p>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}

export function DiscoveryPage() {
  const { workspace, refreshDiscovery, go } = useWorkspace();
  const [error, setError] = useState("");
  const [refreshed, setRefreshed] = useState(false);
  const refresh = () => {
    setError("");
    try {
      refreshDiscovery();
      setRefreshed(true);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <>
      <PageHeading
        eyebrow="WORKSPACE / ASSET DISCOVERY"
        title="Discovery"
        description="Refresh the synthetic inventory within your authorized demo scope."
      >
        <button className="button primary" onClick={refresh}>
          <RefreshCw size={16} /> Refresh seeded inventory
        </button>
      </PageHeading>
      <Notice>
        Demo-only discovery. This action updates seeded
        sample records locally. It never scans hosts, resolves domains, or sends
        network requests.
      </Notice>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {refreshed && (
        <p role="status" className="section-note">
          <CheckCircle2 size={15} /> Seeded inventory refreshed. Current assets
          and findings are available throughout AEGIS.
        </p>
      )}
      <div className="stat-grid">
        <div className="stat-card">
          <span className="muted">IN-SCOPE ASSETS</span>
          <strong>{workspace.assets.length}</strong>
          <span className="muted">Synthetic inventory records</span>
        </div>
        <div className="stat-card">
          <span className="muted">OBSERVED RELATIONSHIPS</span>
          <strong>
            {
              workspace.relationships.filter((r) => r.kind === "observed")
                .length
            }
          </strong>
          <span className="muted">Observed within the demo dataset</span>
        </div>
        <div className="stat-card">
          <span className="muted">REAL CONNECTIONS</span>
          <strong>0</strong>
          <span className="muted">No discovery connector configured</span>
        </div>
      </div>
      <div className="split-grid">
        <Panel
          title="Seeded discovery source"
          subtitle="Local dataset · no network access"
        >
          <div className="stack">
            <div className="inline">
              <Database size={27} />
              <div>
                <strong>AEGIS synthetic enterprise</strong>
                <p className="muted">
                  Gateways, application services, data stores, and endpoints.
                </p>
              </div>
              <Badge tone="green">Available locally</Badge>
            </div>
            <dl className="detail-list">
              <div>
                <dt>Scope</dt>
                <dd>{workspace.scope}</dd>
              </div>
              <div>
                <dt>Last local refresh</dt>
                <dd>{formatTime(workspace.lastDiscovery)}</dd>
              </div>
              <div>
                <dt>Refresh behavior</dt>
                <dd>
                  Restore missing seeded records and refresh last-seen times.
                  Existing analyst edits remain local.
                </dd>
              </div>
            </dl>
            <button className="button secondary" onClick={() => go("scope")}>
              Review workspace scope <ArrowRight size={15} />
            </button>
          </div>
        </Panel>
        <Panel title="Discovery connectors">
          <div className="stack">
            {["Network discovery", "Cloud inventory", "Endpoint inventory"].map(
              (name) => (
                <div className="record-card" key={name}>
                  <div className="record-head">
                    <strong>{name}</strong>
                    <Badge tone="muted">Not configured</Badge>
                  </div>
                  <p className="muted">
                    Unavailable in this local demonstration. No credentials or
                    remote connections are used.
                  </p>
                </div>
              ),
            )}
          </div>
        </Panel>
      </div>
      <Panel
        title="Inventory snapshot"
        action={
          <button className="button ghost small" onClick={() => go("assets")}>
            View inventory <ArrowRight size={14} />
          </button>
        }
      >
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Asset</th>
                <th>Type</th>
                <th>Exposure</th>
                <th>Status</th>
                <th>Last seen · demo</th>
              </tr>
            </thead>
            <tbody>
              {workspace.assets.map((asset) => (
                <tr key={asset.id}>
                  <td>
                    <AssetLink id={asset.id} />
                    <div className="muted mono">{asset.address}</div>
                  </td>
                  <td>{asset.type}</td>
                  <td>{asset.exposure}</td>
                  <td>
                    <Badge
                      tone={
                        asset.status === "Protected"
                          ? "green"
                          : asset.status === "Review"
                            ? "amber"
                            : "muted"
                      }
                    >
                      {asset.status}
                    </Badge>
                  </td>
                  <td>{formatTime(asset.lastSeen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

export function ThreatPage() {
  const { workspace, openFinding } = useWorkspace();
  const [query, setQuery] = useState("");
  const relevant = workspace.findings.filter((f) => f.cve || f.technique);
  const matches = relevant.filter((f) =>
    `${f.title} ${f.cve ?? ""} ${f.technique ?? ""}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  return (
    <>
      <PageHeading
        eyebrow="INTELLIGENCE / THREAT CONTEXT"
        title="Threat intelligence"
        description="Illustrative threat context connected to the findings in this workspace."
      >
        <Badge tone="blue">Seeded references</Badge>
      </PageHeading>
      <Notice>
        No live threat feed is configured. CVE references
        and ATT&CK mappings are seeded examples, not verified observations.
        Current vulnerability or CISA KEV status is unavailable.
      </Notice>
      <div className="stat-grid">
        <div className="stat-card">
          <span className="muted">CVE REFERENCES</span>
          <strong>
            {new Set(relevant.map((f) => f.cve).filter(Boolean)).size}
          </strong>
          <span className="muted">Seeded context · not live intelligence</span>
        </div>
        <div className="stat-card">
          <span className="muted">TECHNIQUE MAPPINGS</span>
          <strong>
            {new Set(relevant.map((f) => f.technique).filter(Boolean)).size}
          </strong>
          <span className="muted">Illustrative ATT&CK references</span>
        </div>
        <div className="stat-card">
          <span className="muted">CISA KEV FEED</span>
          <strong style={{ fontSize: 24 }}>Unavailable</strong>
          <span className="muted">Catalog not retrieved or verified</span>
        </div>
      </div>
      <Panel
        title="Finding context"
        subtitle="Use these examples to navigate the connected demo data"
        action={
          <label className="field">
            <span className="sr-only">Search threat references</span>
            <input
              placeholder="Search CVE, technique, finding…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        }
      >
        {matches.length ? (
          <div className="stack">
            {matches.map((f) => (
              <article className="record-card" key={f.id}>
                <div className="record-head">
                  <div>
                    <span className="eyebrow">
                      {f.id} / ILLUSTRATIVE MAPPING
                    </span>
                    <h3>{f.title}</h3>
                  </div>
                  <Badge
                    tone={
                      f.severity === "Critical"
                        ? "red"
                        : f.severity === "High"
                          ? "amber"
                          : "blue"
                    }
                  >
                    {f.severity}
                  </Badge>
                </div>
                <p className="muted">{f.description}</p>
                <div className="toolbar">
                  {f.cve && <Badge tone="muted">{f.cve}</Badge>}
                  {f.technique && (
                    <Badge tone="purple">ATT&CK {f.technique}</Badge>
                  )}
                  <AssetLink id={f.assetId} />
                </div>
                <p className="section-note">
                  Reference identifiers are supplied by the synthetic dataset.
                  Their applicability, exploitability, and current catalog
                  status have not been validated.
                </p>
                <button
                  className="button ghost small"
                  onClick={() => openFinding(f.id)}
                >
                  Review finding and evidence <ArrowRight size={14} />
                </button>
              </article>
            ))}
          </div>
        ) : (
          <Empty
            title="No matching threat references"
            description="Try another CVE identifier, technique, or finding title."
          />
        )}
      </Panel>
      <Panel title="Source availability">
        <div className="form-grid">
          {[
            {
              name: "CVE / NVD",
              description: "Seeded vulnerability reference identifiers only.",
            },
            {
              name: "CISA KEV",
              description: "No catalog loaded. KEV membership is unverified.",
            },
            {
              name: "MITRE ATT&CK",
              description:
                "Illustrative technique mapping; no observed adversary activity.",
            },
          ].map((source) => (
            <div className="record-card" key={source.name}>
              <div className="record-head">
                <strong>{source.name}</strong>
                <Badge tone="muted">Not connected</Badge>
              </div>
              <p className="muted">{source.description}</p>
            </div>
          ))}
        </div>
      </Panel>
    </>
  );
}

const agentRoles: {
  name: string;
  description: string;
  page: Page;
  label: string;
  icon: typeof Network;
}[] = [
  {
    name: "Scope curator",
    description:
      "Planned role for organizing authorized infrastructure. The current demo uses local seeded records.",
    page: "discovery",
    label: "Review discovery",
    icon: ScanLine,
  },
  {
    name: "Risk analyst",
    description:
      "Planned role for contextual risk analysis. Current scores use explicit deterministic rules.",
    page: "risk",
    label: "Inspect risk rules",
    icon: ShieldCheck,
  },
  {
    name: "Twin modeler",
    description:
      "Planned role for graph maintenance. Current paths traverse the shared seeded relationships.",
    page: "twin",
    label: "Open Digital Twin",
    icon: Network,
  },
  {
    name: "Scenario evaluator",
    description:
      "Planned role for comparing safe scenarios. Current simulation is a local graph calculation.",
    page: "simulation",
    label: "Explore scenarios",
    icon: FlaskConical,
  },
  {
    name: "Defense advisor",
    description:
      "Planned role for drafting recommendations. Current ranking uses risk reduction, effort, and disruption.",
    page: "advisor",
    label: "Review recommendations",
    icon: Sparkles,
  },
  {
    name: "Guardian reviewer",
    description:
      "Human review is active today. Approval records a local demo decision and never changes infrastructure.",
    page: "guardian",
    label: "Open Guardian Gate",
    icon: LockKeyhole,
  },
];

export function AgentsPage() {
  const { workspace, go } = useWorkspace();
  const activity = workspace.audit
    .filter((record) =>
      ["Simulation", "Decision", "Discovery", "Report", "Asset"].includes(
        record.category,
      ),
    )
    .slice(0, 8);
  return (
    <>
      <PageHeading
        eyebrow="INTELLIGENCE / ORCHESTRATION"
        title="AI Agent Center"
        description="Planned AEGIS roles and an honest view of actual local workflow activity."
      >
        <Badge tone="muted">LLM agents unavailable</Badge>
      </PageHeading>
      <Notice>
        No AI agents or language models run in this
        application. The activity below reflects analyst actions and
        deterministic demo workflow steps recorded by AEGIS.
      </Notice>
      <div className="form-grid">
        {agentRoles.map((role) => {
          const Icon = role.icon;
          return (
            <Panel key={role.name}>
              <div className="stack">
                <div className="record-head">
                  <Icon size={24} />
                  <Badge tone={role.page === "guardian" ? "green" : "muted"}>
                    {role.page === "guardian"
                      ? "Human review available"
                      : "Agent planned"}
                  </Badge>
                </div>
                <h3>{role.name}</h3>
                <p className="muted">{role.description}</p>
                <button
                  className="button secondary small"
                  onClick={() => go(role.page)}
                >
                  {role.label} <ArrowRight size={14} />
                </button>
              </div>
            </Panel>
          );
        })}
      </div>
      <Panel
        title="Recorded workflow activity"
        subtitle="Actual local events · no autonomous agent execution"
        action={
          <button className="button ghost small" onClick={() => go("audit")}>
            Full audit history <ArrowRight size={14} />
          </button>
        }
      >
        {activity.length ? (
          <div className="timeline">
            {activity.map((record) => (
              <div className="timeline-item" key={record.id}>
                <div className="record-head">
                  <strong>{record.action}</strong>
                  <Badge tone="blue">
                    {record.category === "Decision"
                      ? "Human action"
                      : "Local demo workflow"}
                  </Badge>
                </div>
                <p className="muted">{record.detail}</p>
                <small className="muted">{formatTime(record.timestamp)}</small>
              </div>
            ))}
          </div>
        ) : (
          <Empty
            title="No workflow activity yet"
            description="Refresh seeded discovery, run a simulation, or record a Guardian Gate decision to populate this view."
          >
            <button
              className="button secondary"
              onClick={() => go("simulation")}
            >
              Open simulation
            </button>
          </Empty>
        )}
      </Panel>
    </>
  );
}

export function ModelsPage() {
  const { workspace, go } = useWorkspace();
  return (
    <>
      <PageHeading
        eyebrow="INTELLIGENCE / MODEL MANAGEMENT"
        title="ML Model Center"
        description="Model and dataset concepts, with their current availability made explicit."
      >
        <Badge tone="muted">No trained models</Badge>
      </PageHeading>
      <Notice>
        AEGIS currently uses deterministic graph traversal
        and rule-based scoring. No machine learning model is trained, deployed,
        or used to make predictions.
      </Notice>
      <div className="split-grid">
        <Panel
          title="Model registry"
          subtitle="Planned capabilities · unavailable in this demo"
        >
          <div className="stack">
            {[
              {
                name: "Asset anomaly detector",
                purpose:
                  "Planned concept for highlighting changes in authorized infrastructure.",
                needs:
                  "Requires collected baseline telemetry and validated labels.",
              },
              {
                name: "Finding prioritization model",
                purpose:
                  "Planned concept for learning analyst prioritization preferences.",
                needs:
                  "Requires curated historical decisions and independent evaluation.",
              },
              {
                name: "Scenario outcome estimator",
                purpose:
                  "Planned concept for evaluating modeled risk scenarios.",
                needs:
                  "Requires representative training data and calibrated evaluation.",
              },
            ].map((model) => (
              <article className="record-card" key={model.name}>
                <div className="record-head">
                  <h3>{model.name}</h3>
                  <Badge tone="muted">Untrained / planned</Badge>
                </div>
                <p className="muted">{model.purpose}</p>
                <p className="section-note">{model.needs}</p>
                <dl className="detail-list">
                  <div>
                    <dt>Training runs</dt>
                    <dd>None</dd>
                  </div>
                  <div>
                    <dt>Metrics</dt>
                    <dd>Unavailable — not evaluated</dd>
                  </div>
                  <div>
                    <dt>Deployment</dt>
                    <dd>Not configured</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </Panel>
        <div className="stack">
          <Panel
            title="Workspace dataset"
            subtitle="Current synthetic records · not a training corpus"
          >
            <dl className="detail-list">
              <div>
                <dt>Asset records</dt>
                <dd>{workspace.assets.length}</dd>
              </div>
              <div>
                <dt>Graph relationships</dt>
                <dd>{workspace.relationships.length}</dd>
              </div>
              <div>
                <dt>Seeded findings</dt>
                <dd>{workspace.findings.length}</dd>
              </div>
              <div>
                <dt>Recorded simulations</dt>
                <dd>{workspace.simulations.length}</dd>
              </div>
              <div>
                <dt>Human review decisions</dt>
                <dd>{workspace.approvals.length}</dd>
              </div>
              <div>
                <dt>Dataset provenance</dt>
                <dd>Synthetic demo data and local analyst changes</dd>
              </div>
            </dl>
            <p className="section-note">
              This small, illustrative dataset does not establish real detection
              or prediction capability.
            </p>
          </Panel>
          <Panel title="What powers the demo">
            <div className="stack">
              <div className="inline">
                <Settings2 size={22} />
                <strong>Transparent local rules</strong>
              </div>
              <p className="muted">
                Risk uses finding base scores, asset exposure, and asset
                criticality. Path modeling follows directed graph relationships.
                Recommendation ranking has a visible weighted formula.
              </p>
              <button className="button secondary" onClick={() => go("risk")}>
                Review deterministic risk <ArrowRight size={14} />
              </button>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}

function downloadReport(report: ReportRecord) {
  const blob = new Blob([report.content], {
    type: "text/markdown;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `aegis-workspace-report-${report.generatedAt.slice(0, 10)}-${report.id.replace(/[^a-zA-Z0-9-]/g, "").slice(-12)}.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ReportsPage() {
  const { workspace, createReport, log, notify } = useWorkspace();
  const [selectedId, setSelectedId] = useState(workspace.reports[0]?.id ?? "");
  const [error, setError] = useState("");
  const selected =
    workspace.reports.find((report) => report.id === selectedId) ??
    workspace.reports[0];
  const generate = () => {
    setError("");
    try {
      const report = createReport();
      setSelectedId(report.id);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const download = (report: ReportRecord) => {
    setError("");
    try {
      downloadReport(report);
      log(
        "Report downloaded",
        `Downloaded local report snapshot: ${report.name}.`,
        "Report",
        report.id,
      );
      notify("Report downloaded as Markdown.");
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <>
      <PageHeading
        eyebrow="WORKSPACE / REPORTING"
        title="Reports"
        description="Generate a readable snapshot of your current workspace, analysis, and human decisions."
      >
        <button className="button primary" onClick={generate}>
          <FileText size={16} /> Generate workspace report
        </button>
      </PageHeading>
      <Notice>
        Reports are local snapshots of seeded data and
        your demo changes. They do not establish a real compromise, security
        validation, compliance, or production readiness.
      </Notice>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {selected ? (
        <div className="split-grid report-grid">
          <Panel
            title="Report library"
            subtitle={`${workspace.reports.length} locally saved snapshot${workspace.reports.length === 1 ? "" : "s"}`}
          >
            <div className="stack">
              {workspace.reports.map((report) => (
                <div className="record-card" key={report.id}>
                  <button
                    className={`button ghost${selected.id === report.id ? " active" : ""}`}
                    style={{
                      width: "100%",
                      justifyContent: "flex-start",
                      textAlign: "left",
                      whiteSpace: "normal",
                    }}
                    onClick={() => setSelectedId(report.id)}
                    aria-pressed={selected.id === report.id}
                  >
                    <FileText size={16} />
                    {report.name}
                  </button>
                  <p className="muted">{formatTime(report.generatedAt)}</p>
                  <button
                    className="button secondary small"
                    onClick={() => download(report)}
                  >
                    <ArrowDownToLine size={14} /> Download .md
                  </button>
                </div>
              ))}
            </div>
          </Panel>
          <Panel
            title={selected.name}
            subtitle={`Snapshot generated ${formatTime(selected.generatedAt)}`}
            action={
              <button
                className="button secondary small"
                onClick={() => download(selected)}
              >
                <ArrowDownToLine size={15} /> Download Markdown
              </button>
            }
          >
            <h3>Downloadable Markdown report</h3>
            <p className="section-note">
              Snapshots remain unchanged after later edits. Generate a new
              report to include the latest workspace data.
            </p>
            <pre
              className="report-document"
              style={{ whiteSpace: "pre-wrap" }}
            >
              {selected.content}
            </pre>
          </Panel>
        </div>
      ) : (
        <Panel>
          <Empty
            title="Your workspace, ready to report"
            description="Create your first snapshot with assets, findings, modeled paths, simulations, recommendations, review notes, and audit history."
          >
            <button className="button primary" onClick={generate}>
              <FileText size={16} /> Generate first report
            </button>
          </Empty>
        </Panel>
      )}
    </>
  );
}

export function SettingsPage() {
  const { workspace, updateSettings } = useWorkspace();
  const [analystName, setAnalystName] = useState(
    workspace.settings.analystName,
  );
  const [compactMode, setCompactMode] = useState(
    workspace.settings.compactMode,
  );
  const [reducedMotion, setReducedMotion] = useState(
    workspace.settings.reducedMotion,
  );
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setSaved(false);
    if (analystName.trim().length < 2 || analystName.trim().length > 60) {
      setError("Enter an analyst name between 2 and 60 characters.");
      return;
    }
    try {
      updateSettings({
        analystName: analystName.trim(),
        compactMode,
        reducedMotion,
      });
      setSaved(true);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <>
      <PageHeading
        eyebrow="WORKSPACE / PREFERENCES"
        title="Settings"
        description="Configure your local demo preferences and review integration availability."
      />
      <div className="split-grid">
        <Panel
          title="Analyst preferences"
          subtitle="Saved in this browser only"
        >
          <form onSubmit={submit} className="stack">
            <label className="field">
              Analyst display name
              <input
                value={analystName}
                onChange={(e) => {
                  setAnalystName(e.target.value);
                  setSaved(false);
                }}
                minLength={2}
                maxLength={60}
                required
                autoComplete="name"
              />
            </label>
            <p className="section-note">
              Used for future Guardian Gate decisions. This is a display name,
              not authenticated identity.
            </p>
            <label className="record-card inline" style={{ cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={compactMode}
                onChange={(e) => {
                  setCompactMode(e.target.checked);
                  setSaved(false);
                }}
              />
              <span>
                <strong>Compact layout</strong>
                <span className="muted" style={{ display: "block" }}>
                  Use tighter spacing for dense workspace views.
                </span>
              </span>
            </label>
            <label className="record-card inline" style={{ cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={reducedMotion}
                onChange={(e) => {
                  setReducedMotion(e.target.checked);
                  setSaved(false);
                }}
              />
              <span>
                <strong>Reduce motion</strong>
                <span className="muted" style={{ display: "block" }}>
                  Minimize decorative transitions and animation.
                </span>
              </span>
            </label>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <div className="inline">
              <button className="button primary" type="submit">
                <Check size={15} /> Save preferences
              </button>
              {saved && (
                <span role="status" className="muted">
                  Preferences saved locally.
                </span>
              )}
            </div>
          </form>
        </Panel>
        <div className="stack">
          <Panel title="Local data storage">
            <dl className="detail-list">
              <div>
                <dt>Persistence</dt>
                <dd>Browser localStorage</dd>
              </div>
              <div>
                <dt>Application mode</dt>
                <dd>
                  <Badge tone="blue">Local demonstration</Badge>
                </dd>
              </div>
              <div>
                <dt>API keys required</dt>
                <dd>None</dd>
              </div>
              <div>
                <dt>External services required</dt>
                <dd>None</dd>
              </div>
              <div>
                <dt>Workspace schema</dt>
                <dd>Version {workspace.version}</dd>
              </div>
            </dl>
            <p className="section-note">
              Data belongs to this browser and origin. Clearing browser site
              data removes local demo changes and saved report snapshots.
              Browser storage is not a secure secret store.
            </p>
          </Panel>
          <Panel title="Integrations">
            <div className="stack">
              {[
                "Threat intelligence feeds",
                "Cloud and endpoint inventory",
                "AI model provider",
                "Infrastructure change executor",
              ].map((name) => (
                <div className="record-card" key={name}>
                  <div className="record-head">
                    <strong>{name}</strong>
                    <Badge tone="muted">Not configured</Badge>
                  </div>
                  <p className="muted">
                    Unavailable in this demo. No external connection is made.
                  </p>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
