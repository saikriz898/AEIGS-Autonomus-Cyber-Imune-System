import { useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Activity,
  Boxes,
  ChevronRight,
  CircleDot,
  Download,
  GitBranch,
  Plus,
  Search,
  ShieldCheck,
  ShieldAlert,
  Target,
  X,
} from "lucide-react";
import { useWorkspace } from "../state/WorkspaceContext";
import {
  assetRisk,
  findingRisk,
  workspaceRisk,
  rankRecommendations,
} from "../domain/engine";
import {
  AssetLink,
  Badge,
  Empty,
  formatTime,
  Notice,
  PageHeading,
  Panel,
  severityTone,
} from "../components/ui";
import Topology, { AssetIcon } from "../components/Topology";
import type { Severity } from "../domain/types";

export function CommandPage() {
  const { workspace: w, go, openFinding } = useWorkspace();
  const risk = workspaceRisk(w);
  const open = w.findings.filter((f) => f.status !== "Resolved");
  const critical = open.filter((f) => f.severity === "Critical");
  const pending = rankRecommendations(w).filter(
    (r) => !w.approvals.some((a) => a.recommendationId === r.id),
  );
  const top = [...open]
    .sort(
      (a, b) =>
        findingRisk(b, w.assets.find((x) => x.id === b.assetId)!).score -
        findingRisk(a, w.assets.find((x) => x.id === a.assetId)!).score,
    )
    .slice(0, 4);
  return (
    <>
      <PageHeading
        eyebrow="YOUR SECURITY WORKSPACE"
        title="Command Center"
        description="A clearer picture. A more considered defense."
      >
        <span className="workspace-status">
          <span className="status-dot" />
          Local demo workspace
        </span>
        <button className="button secondary" onClick={() => go("reports")}>
          <Download size={15} />
          Create report
        </button>
      </PageHeading>
      <div className="overview-strip">
        <span>
          <ShieldCheck size={15} />
          <strong>Authorized environment</strong>
          <span className="strip-separator">/</span>
          {w.name}
        </span>
        <button onClick={() => go("scope")}>
          View scope
          <ArrowUpRight size={14} />
        </button>
      </div>
      <div className="overview-metrics">
        <button className="overview-metric" onClick={() => go("assets")}>
          <div className="metric-label">
            Assets in workspace
            <Boxes size={17} />
          </div>
          <div className="metric-number">
            {w.assets.length}
            <span className="metric-mini">
              <span className="status-dot" />
              Seeded inventory
            </span>
          </div>
          <div className="metric-foot">
            <span>
              {w.assets.filter((a) => a.exposure === "Internet").length}{" "}
              internet-facing
            </span>
            <ArrowUpRight size={15} />
          </div>
        </button>
        <button className="overview-metric" onClick={() => go("risk")}>
          <div className="metric-label">
            Open findings
            <ShieldAlert size={17} />
          </div>
          <div className="metric-number">
            {open.length}
            <span className="metric-mini danger">
              {critical.length} critical
            </span>
          </div>
          <div className="metric-foot">
            <span>Prioritized by modeled risk</span>
            <ArrowUpRight size={15} />
          </div>
        </button>
        <button className="overview-metric" onClick={() => go("risk")}>
          <div className="metric-label">
            Workspace risk
            <Target size={17} />
          </div>
          <div className="metric-number">
            {risk}
            <small>/100</small>
            <span className="metric-mini">Mean asset risk</span>
          </div>
          <div className="metric-foot">
            <span>Deterministic assessment</span>
            <Badge tone={risk >= 75 ? "red" : risk >= 50 ? "amber" : risk >= 25 ? "blue" : "green"}>
              {risk >= 75 ? "Critical" : risk >= 50 ? "High" : risk >= 25 ? "Medium" : "Low"}
            </Badge>
          </div>
        </button>
        <button className="overview-metric" onClick={() => go("guardian")}>
          <div className="metric-label">
            Awaiting your review
            <ShieldCheck size={17} />
          </div>
          <div className="metric-number">
            {pending.length}
            <span className="metric-mini">Guardian Gate</span>
          </div>
          <div className="metric-foot">
            <span>Human decisions, recorded locally</span>
            <ArrowUpRight size={15} />
          </div>
        </button>
      </div>
      <div className="dashboard-middle">
        <Panel
          title="Your Digital Twin"
          subtitle={`${w.assets.length} assets · ${w.relationships.length} modeled relationships`}
          className="twin-panel"
          action={
            <button className="text-link" onClick={() => go("twin")}>
              Explore twin
              <ArrowUpRight size={14} />
            </button>
          }
        >
          <Topology compact />
        </Panel>
        <Panel
          title="Risk distribution"
          subtitle="Open findings across your workspace"
          className="posture-panel"
        >
          <div className="risk-donut">
            <svg
              viewBox="0 0 160 160"
              aria-label={`${open.length} open findings`}
            >
              <circle className="donut-track" cx="80" cy="80" r="63" />
              {(["Critical", "High", "Medium", "Low"] as Severity[]).map(
                (s, i) => {
                  const counts = ["Critical", "High", "Medium", "Low"].map(
                    (sev) => open.filter((f) => f.severity === sev).length,
                  );
                  const length = 2 * Math.PI * 63;
                  const amount = counts[i] / Math.max(open.length, 1);
                  const offset =
                    counts.slice(0, i).reduce((a, b) => a + b, 0) /
                    Math.max(open.length, 1);
                  return (
                    <circle
                      key={s}
                      className={`donut-segment ${s.toLowerCase()}`}
                      cx="80"
                      cy="80"
                      r="63"
                      strokeDasharray={`${Math.max(0, amount * length - 5)} ${length}`}
                      strokeDashoffset={-offset * length}
                    />
                  );
                },
              )}
            </svg>
            <div>
              <strong>{open.length}</strong>
              <span>open findings</span>
            </div>
          </div>
          <div className="risk-breakdown">
            {(["Critical", "High", "Medium", "Low"] as Severity[]).map((s) => (
              <button key={s} onClick={() => go("risk", s)}>
                <span>
                  <i className={`severity-dot ${s.toLowerCase()}`} />
                  {s}
                </span>
                <strong>{open.filter((f) => f.severity === s).length}</strong>
              </button>
            ))}
          </div>
          <button className="button secondary full" onClick={() => go("risk")}>
            Review risk intelligence
            <ArrowRight size={14} />
          </button>
        </Panel>
      </div>
      <div className="dashboard-bottom">
        <Panel
          title="Findings that need attention"
          subtitle="Highest modeled risk first"
          action={
            <button className="text-link" onClick={() => go("risk")}>
              All findings
              <ArrowRight size={14} />
            </button>
          }
        >
          <div className="finding-list">
            {top.length ? (
              top.map((f) => (
                <button
                  className="finding-row"
                  key={f.id}
                  onClick={() => openFinding(f.id)}
                >
                  <span
                    className={`finding-symbol ${f.severity.toLowerCase()}`}
                  >
                    <ShieldAlert size={16} />
                  </span>
                  <span className="finding-row-copy">
                    <strong>{f.title}</strong>
                    <span>
                      {w.assets.find((a) => a.id === f.assetId)?.name}
                      <span className="tiny-separator">·</span>
                      {f.id.toUpperCase()}
                    </span>
                  </span>
                  <Badge tone={severityTone(f.severity)}>{f.severity}</Badge>
                  <ChevronRight size={15} />
                </button>
              ))
            ) : (
              <Empty
                title="All findings resolved"
                description="Your demo workspace has no open findings."
              />
            )}
          </div>
        </Panel>
        <Panel
          title="Workspace activity"
          subtitle="Seeded events and your local actions"
          action={
            <button
              className="icon-button"
              aria-label="View audit history"
              onClick={() => go("audit")}
            >
              <ArrowUpRight size={17} />
            </button>
          }
        >
          <div className="activity-feed">
            {[
              ...w.audit
                .slice(0, 3)
                .map((a) => ({
                  id: a.id,
                  title: a.action,
                  detail: a.detail,
                  time: a.timestamp,
                  local: a.id !== 'AUD-SEED',
                })),
              ...w.events.map((e) => ({
                id: e.id,
                title: e.title,
                detail: e.detail,
                time: e.timestamp,
                local: false,
              })),
            ]
              .slice(0, 4)
              .map((e, i) => (
                <div className="activity-item" key={e.id}>
                  <div className={`activity-dot dot-${i}`}>
                    <Activity size={12} />
                  </div>
                  <div>
                    <strong>{e.title}</strong>
                    <p>{e.detail}</p>
                    <span>
                      {formatTime(e.time)}
                      <span className="tiny-separator">·</span>
                      {e.local ? "Local action" : "Seeded event"}
                    </span>
                  </div>
                </div>
              ))}
          </div>
        </Panel>
      </div>
      <div className="workflow-banner">
        <div className="banner-icon">
          <GitBranch size={23} />
        </div>
        <div>
          <h3>Understand the path. Evaluate the defense.</h3>
          <p>
            Explore a modeled route from perimeter exposure to sensitive data.
          </p>
        </div>
        <button className="button primary" onClick={() => go("paths")}>
          Explore attack paths
          <ArrowRight size={15} />
        </button>
      </div>
      <p className="page-footnote">
        <CircleDot size={12} />
        All data is seeded. Simulations run on the Digital Twin. No network
        traffic or infrastructure changes.
      </p>
    </>
  );
}

export function AssetsPage() {
  const { workspace: w, openAsset, addAsset } = useWorkspace();
  const [query, setQuery] = useState("");
  const [type, setType] = useState("All types");
  const [exposure, setExposure] = useState("All exposure");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "",
    type: "Server" as const,
    owner: "",
    criticality: "Medium" as Severity,
    exposure: "Internal" as const,
    environment: "Production" as const,
    address: "",
    services: "",
    notes: "",
  });
  const assets = w.assets.filter(
    (a) =>
      `${a.name} ${a.address} ${a.owner} ${a.services.join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (type === "All types" || a.type === type) &&
      (exposure === "All exposure" || a.exposure === exposure),
  );
  return (
    <>
      <PageHeading
        eyebrow="KNOW YOUR ENVIRONMENT"
        title="Asset Inventory"
        description="One shared inventory. Every asset in context. Manual asset data is accepted — you can directly record authorized systems, owners, and services."
      >
        <button
          className="button primary"
          onClick={() => {
            setError("");
            setAdding(true);
          }}
        >
          <Plus size={16} />
          Add manual asset
        </button>
        <Badge tone="green">{w.assets.length} total assets</Badge>
      </PageHeading>
      <Notice>
        Manual data entry is accepted and supported. You can record authorized inventory metadata (servers, databases, cloud resources, endpoints, owners, and exposure) manually into your workspace inventory without performing network scans or discovery.
      </Notice>
      <div className="mini-stats">
        {[
          [
            "Internet-facing",
            w.assets.filter((a) => a.exposure === "Internet").length,
          ],
          [
            "Critical assets",
            w.assets.filter((a) => a.criticality === "Critical").length,
          ],
          ["Owners", new Set(w.assets.map((a) => a.owner)).size],
          [
            "Under review",
            w.assets.filter((a) => a.status === "Review").length,
          ],
        ].map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <Panel
        title="Workspace assets"
        subtitle="Select an asset to inspect findings, relationships, and history."
      >
        <div className="toolbar">
          <div className="search-field">
            <Search size={16} />
            <input
              aria-label="Search assets"
              placeholder="Search assets, services, owners…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <select
            aria-label="Filter asset type"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            {[
              "All types",
              "Gateway",
              "Server",
              "Database",
              "Endpoint",
              "Cloud",
            ].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <select
            aria-label="Filter asset exposure"
            value={exposure}
            onChange={(e) => setExposure(e.target.value)}
          >
            {["All exposure", "Internet", "Internal", "Isolated"].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <div className="table-wrap">
          <table className="data-table asset-table">
            <thead>
              <tr>
                <th>Asset / address</th>
                <th>Type</th>
                <th>Criticality</th>
                <th>Exposure</th>
                <th>Owner</th>
                <th>Risk</th>
                <th>Last seen</th>
                <th>
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {assets.map((a) => {
                const risk = assetRisk(w, a.id);
                return (
                  <tr key={a.id}>
                    <td>
                      <button
                        className="asset-cell"
                        onClick={() => openAsset(a.id)}
                      >
                        <span className="asset-type-icon">
                          <AssetIcon type={a.type} />
                        </span>
                        <span>
                          <strong>{a.name}</strong>
                          <small>{a.address}</small>
                        </span>
                      </button>
                    </td>
                    <td>{a.type}</td>
                    <td>
                      <Badge tone={severityTone(a.criticality)}>
                        {a.criticality}
                      </Badge>
                    </td>
                    <td>
                      <span
                        className={`exposure ${a.exposure === "Internet" ? "internet" : ""}`}
                      >
                        <span className="status-dot" />
                        {a.exposure}
                      </span>
                    </td>
                    <td>{a.owner}</td>
                    <td>
                      <span
                        className={`risk-value ${risk.level.toLowerCase()}`}
                      >
                        {risk.score}
                        <small>/100</small>
                      </span>
                    </td>
                    <td className="table-date">{formatTime(a.lastSeen)}</td>
                    <td>
                      <button
                        aria-label={`Open ${a.name}`}
                        className="icon-button"
                        onClick={() => openAsset(a.id)}
                      >
                        <ChevronRight size={16} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!assets.length && (
          <Empty
            title="No matching assets"
            description="Try a different name, service, owner, or filter."
          >
            <button
              className="button secondary"
              onClick={() => {
                setQuery("");
                setType("All types");
                setExposure("All exposure");
              }}
            >
              Clear filters
            </button>
          </Empty>
        )}
        <div className="table-footer">
          Showing {assets.length} of {w.assets.length} assets
          <span>Seeded and manual inventory · no discovery agent connected</span>
        </div>
      </Panel>
      {adding && (
        <div className="dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setAdding(false); }}>
          <div className="detail-drawer" role="dialog" aria-modal="true" aria-label="Add manual asset" tabIndex={-1}>
            <div className="drawer-header">
              <span className="eyebrow">MANUAL INVENTORY ENTRY</span>
              <button aria-label="Close" className="icon-button" onClick={() => setAdding(false)}>
                <X size={20} />
              </button>
            </div>
            <div className="drawer-title">
              <h2>Add manual asset</h2>
            </div>
            <Notice>
              Manual asset data is accepted and saved locally in browser storage. An address or hostname is documentation only and is never probed or scanned.
            </Notice>
            {error && <p role="alert" className="error-text">{error}</p>}
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                setError("");
                try {
                  const servicesList = form.services
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean);
                  const created = addAsset({
                    name: form.name,
                    type: form.type,
                    owner: form.owner,
                    criticality: form.criticality,
                    exposure: form.exposure,
                    environment: form.environment,
                    address: form.address || "10.0.99.1",
                    services: servicesList,
                    notes: form.notes,
                  });
                  setAdding(false);
                  setForm({
                    name: "",
                    type: "Server",
                    owner: "",
                    criticality: "Medium",
                    exposure: "Internal",
                    environment: "Production",
                    address: "",
                    services: "",
                    notes: "",
                  });
                  openAsset(created.id);
                } catch (err) {
                  setError((err as Error).message);
                }
              }}
            >
              <label className="field">
                Asset name *
                <input
                  required
                  maxLength={120}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. core-auth-srv"
                />
              </label>
              <div className="form-grid">
                <label className="field">
                  Asset type
                  <select
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value as any })}
                  >
                    {["Gateway", "Server", "Database", "Endpoint", "Cloud"].map((v) => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Asset owner *
                  <input
                    required
                    maxLength={80}
                    value={form.owner}
                    onChange={(e) => setForm({ ...form, owner: e.target.value })}
                    placeholder="e.g. Infrastructure Team"
                  />
                </label>
              </div>
              <div className="form-grid">
                <label className="field">
                  Criticality
                  <select
                    value={form.criticality}
                    onChange={(e) => setForm({ ...form, criticality: e.target.value as Severity })}
                  >
                    {["Critical", "High", "Medium", "Low"].map((v) => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Exposure
                  <select
                    value={form.exposure}
                    onChange={(e) => setForm({ ...form, exposure: e.target.value as any })}
                  >
                    {["Internet", "Internal", "Isolated"].map((v) => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="form-grid">
                <label className="field">
                  Environment
                  <select
                    value={form.environment}
                    onChange={(e) => setForm({ ...form, environment: e.target.value as any })}
                  >
                    {["Production", "Staging", "Corporate"].map((v) => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Address / Host (optional)
                  <input
                    maxLength={250}
                    value={form.address}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                    placeholder="e.g. 10.0.1.20 (never contacted)"
                  />
                </label>
              </div>
              <label className="field">
                Services (comma-separated)
                <input
                  value={form.services}
                  onChange={(e) => setForm({ ...form, services: e.target.value })}
                  placeholder="e.g. https, ssh, postgres"
                />
              </label>
              <label className="field">
                Notes
                <textarea
                  rows={3}
                  maxLength={1500}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="Manual asset context, tags, or operational role"
                />
              </label>
              <div style={{ display: "flex", gap: "10px", marginTop: "12px", justifyContent: "flex-end" }}>
                <button type="button" className="button secondary" onClick={() => setAdding(false)}>
                  Cancel
                </button>
                <button type="submit" className="button primary">
                  Save manual asset
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

export function RiskPage() {
  const { workspace: w, selectedRecordId, openFinding } = useWorkspace();
  const [severity, setSeverity] = useState(
    ["Critical", "High", "Medium", "Low"].includes(selectedRecordId ?? "")
      ? selectedRecordId!
      : "All severities",
  );
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("Active");
  const findings = w.findings
    .filter(
      (f) =>
        f.title.toLowerCase().includes(query.toLowerCase()) &&
        (severity === "All severities" || f.severity === severity) &&
        (status === "All statuses" ||
          (status === "Active" && f.status !== "Resolved") ||
          f.status === status),
    )
    .sort(
      (a, b) =>
        findingRisk(b, w.assets.find((x) => x.id === b.assetId)!).score -
        findingRisk(a, w.assets.find((x) => x.id === a.assetId)!).score,
    );
  return (
    <>
      <PageHeading
        eyebrow="TURN SIGNAL INTO PRIORITY"
        title="Risk Intelligence"
        description="Understand each finding, its evidence, and the rules behind its risk."
      />
      <Notice>
        Demo risk = base score × 7 + exposure weight + criticality weight,
        capped at 100. Resolved findings contribute 0. Asset risk is its highest
        active finding; workspace risk is the mean across all assets.
      </Notice>
      <Panel
        title="Security findings"
        subtitle="Seeded evidence · deterministic prioritization"
      >
        <div className="toolbar">
          <div className="search-field">
            <Search size={16} />
            <input
              aria-label="Search findings"
              placeholder="Search findings…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <select
            aria-label="Filter severity"
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
          >
            {["All severities", "Critical", "High", "Medium", "Low"].map(
              (s) => (
                <option key={s}>{s}</option>
              ),
            )}
          </select>
          <select
            aria-label="Filter finding status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {[
              "Active",
              "All statuses",
              "Open",
              "Investigating",
              "Resolved",
            ].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Finding</th>
                <th>Affected asset</th>
                <th>Severity</th>
                <th>Modeled risk</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {findings.map((f) => (
                <tr key={f.id}>
                  <td>
                    <button
                      className="finding-title"
                      onClick={() => openFinding(f.id)}
                    >
                      {f.title}
                      <small>
                        {f.id.toUpperCase()}
                        {f.cve ? ` · ${f.cve}` : ""}
                      </small>
                    </button>
                  </td>
                  <td>
                    <AssetLink id={f.assetId} />
                  </td>
                  <td>
                    <Badge tone={severityTone(f.severity)}>{f.severity}</Badge>
                  </td>
                  <td>
                    <strong
                      className={`risk-value ${findingRisk(f, w.assets.find((a) => a.id === f.assetId)!).level.toLowerCase()}`}
                    >
                      {
                        findingRisk(
                          f,
                          w.assets.find((a) => a.id === f.assetId)!,
                        ).score
                      }
                      <small>/100</small>
                    </strong>
                  </td>
                  <td>
                    <Badge tone={f.status === "Resolved" ? "green" : "muted"}>
                      {f.status}
                    </Badge>
                  </td>
                  <td>
                    <button
                      className="icon-button"
                      aria-label={`Inspect ${f.title}`}
                      onClick={() => openFinding(f.id)}
                    >
                      <ChevronRight size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!findings.length && (
          <Empty
            title="No matching findings"
            description="Change your search or filters to see more records."
          />
        )}
      </Panel>
      <div className="split-grid">
        <Panel title="Exposure weights">
          <dl className="detail-list">
            <div>
              <dt>Internet-facing</dt>
              <dd>+15 points</dd>
            </div>
            <div>
              <dt>Internal</dt>
              <dd>+5 points</dd>
            </div>
            <div>
              <dt>Isolated</dt>
              <dd>+0 points</dd>
            </div>
          </dl>
        </Panel>
        <Panel title="Criticality weights">
          <dl className="detail-list">
            {[
              ["Critical", 15],
              ["High", 10],
              ["Medium", 5],
              ["Low", 0],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>+{value} points</dd>
              </div>
            ))}
          </dl>
          <p className="section-note">
            Risk bands: Critical ≥75, High ≥50, Medium ≥25, Low &lt;25. These
            demo rules are not a validated detection model.
          </p>
        </Panel>
      </div>
    </>
  );
}

export function TwinPage() {
  const { workspace: w, go } = useWorkspace();
  return (
    <>
      <PageHeading
        eyebrow="YOUR ENVIRONMENT, CONNECTED"
        title="Digital Twin"
        description="Explore the relationships behind your security posture."
      >
        <button className="button primary" onClick={() => go("paths")}>
          <GitBranch size={15} />
          Model a path
        </button>
      </PageHeading>
      <Notice>
        Every node comes from your shared inventory. Lines represent seeded
        observed data, inferred access, or hypothetical trust. Select any asset
        to review its details. Arrows show modeled direction.
      </Notice>
      <Panel
        title="Infrastructure topology"
        subtitle={`${w.assets.length} assets · ${w.relationships.length} directed relationships`}
        className="full-twin"
        action={<Badge tone="blue">Demo model</Badge>}
      >
        <Topology />
      </Panel>
      <Panel
        title="Relationship register"
        subtitle="An explicit record of each modeled connection"
      >
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Destination</th>
                <th>Relationship</th>
                <th>Evidence class</th>
              </tr>
            </thead>
            <tbody>
              {w.relationships.map((r) => (
                <tr key={r.id}>
                  <td>
                    <AssetLink id={r.source} />
                  </td>
                  <td>
                    <AssetLink id={r.target} />
                  </td>
                  <td>{r.label}</td>
                  <td>
                    <Badge
                      tone={
                        r.kind === "observed"
                          ? "green"
                          : r.kind === "inferred"
                            ? "blue"
                            : "purple"
                      }
                    >
                      {r.kind === "observed" ? "Observed demo" : r.kind}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

