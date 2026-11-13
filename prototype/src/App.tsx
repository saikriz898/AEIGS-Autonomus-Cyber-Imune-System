import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  Bell,
  BookOpen,
  Boxes,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Cpu,
  FileText,
  Fingerprint,
  GitBranch,
  LayoutDashboard,
  Menu,
  Network,
  Radar,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  ShieldAlert,
  Sparkles,
  Target,
  Workflow,
  X,
  CheckCircle2,
  ArrowRight,
} from "lucide-react";
import { WorkspaceProvider, useWorkspace } from "./state/WorkspaceContext";
import { AssetDetails, FindingDetails } from "./components/Details";
import { Badge, formatTime } from "./components/ui";
import { CommandPage, AssetsPage, RiskPage, TwinPage } from "./pages/CorePages";
import {
  PathsPage,
  SimulationPage,
  AdvisorPage,
  GuardianPage,
  AuditPage,
} from "./pages/WorkflowPages";
import {
  ScopePage,
  DiscoveryPage,
  ThreatPage,
  AgentsPage,
  ModelsPage,
  ReportsPage,
  SettingsPage,
} from "./pages/SupportingPages";
import type { Page } from "./domain/types";

const navigation = [
  {
    label: "WORKSPACE",
    items: [
      { id: "command", label: "Command Center", icon: LayoutDashboard },
      { id: "scope", label: "Scope & Workspace", icon: Fingerprint },
      { id: "discovery", label: "Discovery", icon: Radar },
      { id: "assets", label: "Asset Inventory", icon: Boxes },
    ],
  },
  {
    label: "INTELLIGENCE",
    items: [
      { id: "risk", label: "Risk Intelligence", icon: ShieldAlert },
      { id: "threat", label: "Threat Intelligence", icon: BookOpen },
      { id: "twin", label: "Digital Twin", icon: Network },
      { id: "paths", label: "Attack Path Explorer", icon: GitBranch },
    ],
  },
  {
    label: "DEFENSE OPERATIONS",
    items: [
      { id: "simulation", label: "Attack Simulation", icon: Target },
      { id: "advisor", label: "Defense Advisor", icon: Sparkles },
      { id: "guardian", label: "Guardian Gate", icon: ShieldCheck },
    ],
  },
  {
    label: "MANAGEMENT",
    items: [
      { id: "agents", label: "AI Agent Center", icon: Workflow },
      { id: "models", label: "ML Model Center", icon: Cpu },
      { id: "reports", label: "Reports", icon: FileText },
      { id: "audit", label: "Audit Logs", icon: Activity },
      { id: "settings", label: "Settings", icon: Settings },
    ],
  },
];
const views = {
  command: CommandPage,
  scope: ScopePage,
  discovery: DiscoveryPage,
  assets: AssetsPage,
  risk: RiskPage,
  threat: ThreatPage,
  twin: TwinPage,
  paths: PathsPage,
  simulation: SimulationPage,
  advisor: AdvisorPage,
  guardian: GuardianPage,
  agents: AgentsPage,
  models: ModelsPage,
  reports: ReportsPage,
  audit: AuditPage,
  settings: SettingsPage,
};
function Shell() {
  const {
    workspace: w,
    page,
    go,
    openAsset,
    openFinding,
    toast,
    storageWarning,
    dismissWarning,
  } = useWorkspace();
  const [menu, setMenu] = useState(false);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [notifications, setNotifications] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const notificationsRef = useRef<HTMLDivElement>(null);
  const activeItem = navigation
    .flatMap((n) => n.items)
    .find((i) => i.id === page)!;
  const activeGroup = navigation.find((n) =>
    n.items.some((i) => i.id === page),
  )!;
  const View = views[page];
  const pending = w.recommendations.filter(
    (r) => !w.approvals.some((a) => a.recommendationId === r.id),
  ).length;
  useEffect(() => {
    function keyboard(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
        setSearchOpen(true);
      }
      if (e.key === "Escape") {
        setSearchOpen(false);
        setNotifications(false);
        setMenu(false);
      }
    }
    function outside(e: MouseEvent) {
      if (!searchBoxRef.current?.contains(e.target as Node))
        setSearchOpen(false);
      if (!notificationsRef.current?.contains(e.target as Node))
        setNotifications(false);
    }
    document.addEventListener("keydown", keyboard);
    document.addEventListener("mousedown", outside);
    return () => {
      document.removeEventListener("keydown", keyboard);
      document.removeEventListener("mousedown", outside);
    };
  }, []);
  useEffect(() => {
    document.title = `${activeItem.label} · AEGIS`;
    setMenu(false);
  }, [page, activeItem.label]);
  const assets = w.assets
    .filter((a) =>
      `${a.name} ${a.address} ${a.owner}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    )
    .slice(0, 4);
  const findings = w.findings
    .filter((f) => f.title.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 3);
  const routes = navigation
    .flatMap((g) => g.items)
    .filter((i) => i.label.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 3);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content" onClick={event=>{event.preventDefault();document.getElementById('main-content')?.focus();document.getElementById('main-content')?.scrollIntoView();}}>
        Skip to content
      </a>
      {menu && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setMenu(false)}
        />
      )}
      <aside
        className={`sidebar ${menu ? "open" : ""}`}
        aria-label="Main navigation"
      >
        <a className="brand" href="#/command" aria-label="AEGIS Command Center">
          <div className="brand-mark">
            <Shield size={27} />
            <span>A</span>
          </div>
          <div>
            <strong>
              AEGIS
            </strong>
            <small>SECURITY INTELLIGENCE</small>
          </div>
        </a>
        <button className="workspace-switcher" onClick={() => go("scope")}>
          <span className="workspace-avatar">{w.name.charAt(0).toUpperCase()}</span>
          <span>
            <strong>{w.name}</strong>
            <small>Local workspace</small>
          </span>
          <ChevronDown size={14} />
        </button>
        <nav aria-label="Main navigation">
          {navigation.map((group) => (
            <div className="nav-group" key={group.label}>
              <p>{group.label}</p>
              {group.items.map((item) => (
                <a
                  href={`#/${item.id}`}
                  key={item.id}
                  className={`nav-item ${page === item.id ? "active" : ""}`}
                  aria-current={page === item.id ? "page" : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    go(item.id as Page);
                    setMenu(false);
                  }}
                >
                  <item.icon size={17} />
                  <span>{item.label}</span>
                  {item.id === "guardian" && pending > 0 ? (
                    <span className="nav-count">{pending}</span>
                  ) : item.id === "command" && page === item.id ? (
                    <span className="active-dot" />
                  ) : null}
                </a>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="local-status">
            <span className="status-dot" />
            <strong>Local environment</strong>
            <span>DEMO</span>
          </div>
          <p>Explore safely. Decide thoughtfully.</p>
          <button onClick={() => go("scope")}>
            <CircleHelp size={14} />
            About this workspace
            <ChevronRight size={13} />
          </button>
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <div className="topbar-start">
            <button
              className="icon-button mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMenu(true)}
            >
              <Menu size={21} />
            </button>
            <span className="breadcrumb">
              {activeGroup.label
                .toLowerCase()
                .replace(/^./, (s) => s.toUpperCase())}
              <ChevronRight size={12} />
              <strong>{activeItem.label}</strong>
            </span>
          </div>
          <div className="topbar-actions">
            <div className="global-search" ref={searchBoxRef}>
              <Search size={15} />
              <input
                ref={searchRef}
                aria-label="Search workspace"
                value={query}
                placeholder="Search workspace…"
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSearchOpen(true);
                }}
                onFocus={() => setSearchOpen(true)}
              />
              <kbd>Ctrl K</kbd>
              {searchOpen && (
                <div className="search-popover">
                  <p className="eyebrow">
                    {query ? "WORKSPACE RESULTS" : "QUICK NAVIGATION"}
                  </p>
                  {!query ? (
                    navigation[0].items.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => {
                          go(item.id as Page);
                          setSearchOpen(false);
                        }}
                      >
                        <item.icon size={15} />
                        {item.label}
                        <ArrowRight size={13} />
                      </button>
                    ))
                  ) : (
                    <>
                      {assets.map((a) => (
                        <button
                          key={a.id}
                          onClick={() => {
                            openAsset(a.id);
                            setSearchOpen(false);
                          }}
                        >
                          <Boxes size={15} />
                          <span>
                            {a.name}
                            <small>Asset · {a.address}</small>
                          </span>
                          <ArrowRight size={13} />
                        </button>
                      ))}
                      {findings.map((f) => (
                        <button
                          key={f.id}
                          onClick={() => {
                            openFinding(f.id);
                            setSearchOpen(false);
                          }}
                        >
                          <ShieldAlert size={15} />
                          <span>
                            {f.title}
                            <small>Seeded finding</small>
                          </span>
                          <ArrowRight size={13} />
                        </button>
                      ))}
                      {routes.map((r) => (
                        <button
                          key={r.id}
                          onClick={() => {
                            go(r.id as Page);
                            setSearchOpen(false);
                          }}
                        >
                          <r.icon size={15} />
                          <span>
                            {r.label}
                            <small>Application module</small>
                          </span>
                          <ArrowRight size={13} />
                        </button>
                      ))}
                      {!assets.length && !findings.length && !routes.length && (
                        <p className="search-empty">
                          No records found. Try an asset name or module.
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
            <span className="topbar-divider" />
            <div className="notification-container" ref={notificationsRef}>
              <button
                className={`icon-button notification-button ${notifications ? "selected" : ""}`}
                aria-label="Workspace notifications"
                aria-expanded={notifications}
                onClick={() => setNotifications(!notifications)}
              >
                <Bell size={18} />
                <i />
              </button>
              {notifications && (
                <div className="notification-popover">
                  <div className="section-title">
                    <h3>Workspace updates</h3>
                    <Badge>Local demo</Badge>
                  </div>
                  {w.audit.slice(0, 2).map((a) => (
                    <div className="notification-record" key={a.id}>
                      <strong>{a.action}</strong>
                      <span>{formatTime(a.timestamp)}</span>
                    </div>
                  ))}
                  {w.events.slice(0, 3).map((e) => (
                    <div className="notification-record" key={e.id}>
                      <strong>{e.title}</strong>
                      <p>{e.detail}</p>
                      <span>{formatTime(e.timestamp)} · Seeded</span>
                    </div>
                  ))}
                  <button
                    className="button secondary full"
                    onClick={() => {
                      go("audit");
                      setNotifications(false);
                    }}
                  >
                    View audit history
                    <ArrowRight size={14} />
                  </button>
                </div>
              )}
            </div>
            <button
              className="profile-button"
              aria-label="Open analyst settings"
              onClick={() => go("settings")}
            >
              {w.settings.analystName
                .split(" ")
                .map((s) => s[0])
                .slice(0, 2)
                .join("")
                .toUpperCase()}
            </button>
          </div>
        </header>
        <main id="main-content" className="main-content" tabIndex={-1}>
          {storageWarning && (
            <div className="storage-warning" role="alert">
              <ShieldAlert size={17} />
              <span>{storageWarning}</span>
              <button
                className="icon-button"
                aria-label="Dismiss storage notice"
                onClick={dismissWarning}
              >
                <X size={16} />
              </button>
            </div>
          )}
          <View key={`${page}`} />
          <footer className="main-footer">
            <span>
              <Shield size={12} />
              AEGIS<span className="tiny-separator">/</span>Defense through
              understanding
            </span>
            <span>
              Local demo<span className="tiny-separator">·</span>v1.0
            </span>
          </footer>
        </main>
      </div>
      <AssetDetails />
      <FindingDetails />
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
        </div>
      )}
    </div>
  );
}
class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <div className="fatal-error">
        <ShieldAlert size={40} />
        <h1>The workspace could not be displayed</h1>
        <p>Your saved local data is kept. Reload to retry the application.</p>
        <button
          className="button primary"
          onClick={() => window.location.reload()}
        >
          Reload workspace
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
export default function App() {
  return (
    <ErrorBoundary>
      <WorkspaceProvider>
        <Shell />
      </WorkspaceProvider>
    </ErrorBoundary>
  );
}
