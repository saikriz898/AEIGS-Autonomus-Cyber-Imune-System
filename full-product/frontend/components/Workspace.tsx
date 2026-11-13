'use client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import dynamic from 'next/dynamic';
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  Boxes,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Cloud,
  Cpu,
  Database,
  FileText,
  Fingerprint,
  FlaskConical,
  GitBranch,
  History,
  KeyRound,
  Layers3,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Menu,
  MessageSquare,
  Network,
  Play,
  Plus,
  Radar,
  RefreshCw,
  Search,
  Settings2,
  Shield,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  Users,
  Workflow,
  X,
  Zap,
} from 'lucide-react';
import LinkMember from './LinkMember';
import AssistantConsole from './AssistantConsole';
import { request, rows, label, title, date, type Bootstrap, type Row } from '../lib/api';
import {
  Badge,
  Details,
  Drawer,
  Empty,
  Field,
  Header,
  Loading,
  Notice,
  Panel,
  RecordTable,
  ServiceLabel,
  Status,
} from './UI';
const Graph = dynamic(() => import('./Graph'), {
  loading: () => <Loading text="Loading Digital Twin visualization…" />,
});

type Session = { user: Row; csrf_token: string; workspaces: Row[] };
type Selection = { kind: string; id: string };
const navigation = [
  {
    group: 'WORKSPACE',
    items: [
      ['command', 'Command Center', LayoutDashboard],
      ['events', 'Security Events', Activity],
      ['assets', 'Asset Inventory', Boxes],
      ['discovery', 'Discovery Runs', Radar],
      ['scope', 'Scope & Workspace', Fingerprint],
    ],
  },
  {
    group: 'INTELLIGENCE',
    items: [
      ['risk', 'Risk Intelligence', ShieldAlert],
      ['threat', 'Threat Intelligence', BookOpen],
      ['twin', 'Digital Twin', Network],
      ['snapshots', 'Snapshots', Layers3],
      ['paths', 'Attack Paths', GitBranch],
    ],
  },
  {
    group: 'DEFENSE OPERATIONS',
    items: [
      ['simulations', 'Simulations', Target],
      ['safehouse', 'Safehouse', LockKeyhole],
      ['advisor', 'Defense Advisor', Sparkles],
      ['guardian', 'Guardian Gate', ShieldCheck],
    ],
  },
  {
    group: 'AI & MODEL OPERATIONS',
    items: [
      ['assistant', 'AI Assistant', MessageSquare],
      ['conversations', 'Conversations', History],
      ['agents', 'Agent Center', Workflow],
      ['models', 'Model Center', Cpu],
      ['datasets', 'Datasets', Database],
      ['training', 'Training Runs', FlaskConical],
      ['registry', 'Model Registry', Layers3],
    ],
  },
  {
    group: 'MANAGEMENT',
    items: [
      ['reports', 'Reports', FileText],
      ['jobs', 'Background Jobs', RefreshCw],
      ['audit', 'Audit Logs', Activity],
      ['notifications', 'Notifications', Bell],
      ['members', 'Members & Roles', Users],
      ['integrations', 'Integrations', Cloud],
      ['settings', 'Settings', Settings2],
    ],
  },
];
const names = Object.fromEntries(
  navigation.flatMap((g) => g.items.map((i) => [i[0], i[1]])),
) as Record<string, string>;
type Ctx = {
  data: Bootstrap;
  workspace: Row;
  workspaces: Row[];
  session: Session;
  route: string;
  go: (route: string) => void;
  open: (kind: string, id: string) => void;
  reload: () => Promise<void>;
  mutate: (path: string, method?: string, body?: unknown) => Promise<any>;
  busy: boolean;
  notify: (message: string) => void;
  canWrite: boolean;
  canAdmin: boolean;
  asset: (id: string) => Row | undefined;
  assetLink: (id: string) => ReactNode;
};
const Context = createContext<Ctx | null>(null);
function useApp() {
  const c = useContext(Context);
  if (!c) throw new Error('Workspace context unavailable');
  return c;
}
function collection(data: Bootstrap, kind: string) {
  return rows(data, kind);
}
function PermissionStatus({ value }: { value: string | undefined }) {
  return (
    <Badge tone={!value || value === 'unknown' ? 'amber' : 'green'}>
      {!value || value === 'unknown'
        ? 'Permission not reviewed'
        : value === 'reviewed_noncommercial'
          ? 'Reviewed · noncommercial'
          : 'Reviewed · permitted use'}
    </Badge>
  );
}
function configureDataset(id: string, go: (route: string) => void) {
  try {
    sessionStorage.setItem('aegis.dataset-to-configure', id);
  } catch {}
  go('datasets');
}

export default function Workspace() {
  const [session, setSession] = useState<Session | null>(null);
  const [setup, setSetup] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const status = await request('/auth/status');
      setSetup(Boolean(status.setup_required));
      if (!status.setup_required) {
        try {
          setSession(await request('/auth/me'));
        } catch {
          setSession(null);
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  if (loading)
    return (
      <div className="auth-shell">
        <Brand />
        <Loading text="Connecting to your security workspace…" />
      </div>
    );
  if (error)
    return (
      <div className="auth-shell">
        <Brand />
        <Panel>
          <Empty title="The workspace services are unavailable" description={error}>
            <button className="button primary" onClick={() => void load()}>
              <RefreshCw size={16} />
              Check again
            </button>
          </Empty>
          <p className="section-note">
            Start the services from full-product with Docker Compose. The application does not
            substitute offline records when the API is unavailable.
          </p>
        </Panel>
      </div>
    );
  return session ? (
    <Application session={session} onSession={setSession} />
  ) : (
    <Authentication
      setup={setup}
      onSuccess={(value) => {
        setSession(value);
        setSetup(false);
      }}
    />
  );
}
function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <Shield size={33} />
        <b>A</b>
      </span>
      <div>
        <strong>AEGIS</strong>
        <small>SECURITY INTELLIGENCE</small>
      </div>
    </div>
  );
}
function Authentication({
  setup,
  onSuccess,
}: {
  setup: boolean;
  onSuccess: (session: Session) => void;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    email: '',
    password: '',
    name: '',
    workspace_name: '',
    scope: '',
    setup_token: '',
  });
  const update = (key: string, value: string) => setForm({ ...form, [key]: value });
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { setup_token, ...body } = form;
      onSuccess(
        await request(setup ? '/auth/setup' : '/auth/login', {
          method: 'POST',
          setupToken: setup ? setup_token : undefined,
          body: setup ? body : { email: form.email, password: form.password },
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <div className="auth-story">
        <Brand />
        <div>
          <Badge tone="green">DEFENSE THROUGH UNDERSTANDING</Badge>
          <h1>
            Clarity for every
            <br />
            security decision.
          </h1>
          <p>
            One authorized workspace. Shared evidence, modeled scenarios, and human
            oversight—connected from discovery to decision.
          </p>
          <div className="auth-capabilities">
            <span>
              <Network />A connected Digital Twin
            </span>
            <span>
              <ShieldCheck />
              Human-reviewed defense
            </span>
            <span>
              <Database />
              Your data, persisted locally
            </span>
          </div>
        </div>
        <small>LOCAL PRODUCT / NO PRODUCTION SECURITY CLAIMS</small>
      </div>
      <div className="auth-form-wrap">
        <form className="auth-form" onSubmit={submit}>
          <span className="auth-icon">
            <Fingerprint size={26} />
          </span>
          <p className="eyebrow">{setup ? 'INITIAL WORKSPACE SETUP' : 'WELCOME TO AEGIS'}</p>
          <h2>{setup ? 'Create your first workspace' : 'Sign in to your workspace'}</h2>
          <p>
            {setup
              ? 'Create an owner account with your own password. Setup is available only before the first user exists.'
              : 'Use your local AEGIS account to continue.'}
          </p>
          {setup && (
            <Field
              label="Setup token"
              help="Use the locally generated SETUP_TOKEN from your full-product environment. It is never prefilled."
            >
              <input
                type="password"
                required
                value={form.setup_token}
                onChange={(e) => update('setup_token', e.target.value)}
                autoComplete="off"
              />
            </Field>
          )}
          {setup && (
            <Field label="Your name">
              <input
                required
                maxLength={80}
                value={form.name}
                onChange={(e) => update('name', e.target.value)}
                autoComplete="name"
              />
            </Field>
          )}
          <Field label="Email address">
            <input
              type="email"
              required
              value={form.email}
              onChange={(e) => update('email', e.target.value)}
              autoComplete="username"
            />
          </Field>
          <Field
            label="Password"
            help={setup ? 'Use a unique password of at least 12 characters.' : undefined}
          >
            <input
              type="password"
              required
              minLength={setup ? 12 : 1}
              maxLength={128}
              value={form.password}
              onChange={(e) => update('password', e.target.value)}
              autoComplete={setup ? 'new-password' : 'current-password'}
            />
          </Field>
          {setup && (
            <>
              <Field label="Workspace name">
                <input
                  required
                  maxLength={80}
                  value={form.workspace_name}
                  onChange={(e) => update('workspace_name', e.target.value)}
                  placeholder="Your security workspace"
                />
              </Field>
              <Field label="Authorized demo scope">
                <textarea
                  required
                  minLength={10}
                  maxLength={2000}
                  rows={3}
                  value={form.scope}
                  onChange={(e) => update('scope', e.target.value)}
                  placeholder="Describe the synthetic or authorized infrastructure represented in this workspace."
                />
              </Field>
            </>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="button primary full" disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={17} />}{' '}
            {setup ? 'Create owner & workspace' : 'Sign in securely'}
          </button>
          {!setup && (
            <p className="section-note" style={{ textAlign: 'center', marginTop: 18 }}>
              New to AEGIS?{' '}
              <a className="text-link" href="/register">
                Create account
              </a>
            </p>
          )}
          <div className="auth-security">
            <LockKeyhole size={13} />
            <span>Local accounts · HttpOnly sessions · Backend role checks</span>
          </div>
        </form>
      </div>
    </div>
  );
}

function Application({
  session,
  onSession,
}: {
  session: Session;
  onSession: (session: Session | null) => void;
}) {
  const [workspaces, setWorkspaces] = useState(session.workspaces || []);
  const [workspaceId, setWorkspaceId] = useState(session.workspaces?.[0]?.id || '');
  const [data, setData] = useState<Bootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [route, setRoute] = useState('command');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [sidebar, setSidebar] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [workspaceForm, setWorkspaceForm] = useState(false);
  const globalSearch = useRef<HTMLInputElement>(null);
  const workspace = workspaces.find((w) => w.id === workspaceId) || {
    id: workspaceId,
    name: 'Workspace',
    role: 'Viewer',
  };
  useEffect(() => {
    const read = () => {
      const value = location.hash.replace(/^#\/?/, '').split('/')[0];
      setRoute(names[value] ? value : 'command');
      setSidebar(false);
      setSelection(null);
    };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);
  useEffect(() => {
    try {
      const stored = localStorage.getItem('aegis.selected-workspace');
      if (workspaces.some((w) => w.id === stored)) setWorkspaceId(stored!);
    } catch {}
  }, []);
  const requestGeneration = useRef(0);
  const activeWorkspaceId = useRef(workspaceId);
  activeWorkspaceId.current = workspaceId;
  const reload = useCallback(async () => {
    const generation = ++requestGeneration.current;
    const current = () =>
      requestGeneration.current === generation && activeWorkspaceId.current === workspaceId;
    if (!workspaceId) {
      if (current()) setLoading(false);
      return;
    }
    try {
      const next = await request<Bootstrap>(`/workspaces/${workspaceId}/bootstrap`);
      if (current()) {
        setData(next);
        setError('');
      }
    } catch (e) {
      if (current()) setError((e as Error).message);
    } finally {
      if (current()) setLoading(false);
    }
  }, [workspaceId]);
  useEffect(() => {
    setLoading(true);
    setData(null);
    setSelection(null);
    void reload();
    try {
      localStorage.setItem('aegis.selected-workspace', workspaceId);
    } catch {}
    return () => {
      requestGeneration.current += 1;
    };
  }, [workspaceId, reload]);
  useEffect(() => {
    if (!rows(data, 'jobs').some((job) => ['queued', 'running'].includes(job.status))) return;
    const timer = setInterval(() => void reload(), 3000);
    return () => clearInterval(timer);
  }, [data, reload]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        globalSearch.current?.focus();
        setSearchOpen(true);
      }
      if (e.key === 'Escape') {
        setSelection(null);
        setSearchOpen(false);
        setSidebar(false);
      }
    };
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, []);
  useEffect(() => {
    document.title = `${names[route] || 'Workspace'} · AEGIS`;
  }, [route]);
  function go(next: string) {
    location.hash = '/' + next;
    setRoute(next);
    setSelection(null);
    setSidebar(false);
    setSearchOpen(false);
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  async function mutate(path: string, method = 'POST', body?: unknown) {
    setBusy(true);
    try {
      const result = await request(`/workspaces/${workspaceId}${path}`, {
        method,
        body,
        csrf: session.csrf_token,
      });
      await reload();
      return result;
    } finally {
      setBusy(false);
    }
  }
  const asset = (id: string) => rows(data, 'assets').find((a) => a.id === id);
  const open = (kind: string, id: string) => {
    const collections: Record<string, string> = {
      asset: 'assets',
      finding: 'findings',
      event: 'events',
      simulation: 'simulations',
      recommendation: 'recommendations',
      approval: 'approvals',
      dataset: 'datasets',
      job: 'jobs',
      report: 'reports',
      snapshot: 'snapshots',
      attack_path: 'paths',
      model: 'models',
      model_version: 'models',
      discovery_run: 'discovery_runs',
      agent_execution: 'agent_executions',
      vulnerability: 'vulnerabilities',
      threat: 'threats',
    };
    setSelection({ kind: collections[kind] || kind, id });
  };
  const assetLink = (id: string) => (
    <button className="text-link" onClick={() => open('assets', id)}>
      {asset(id)?.name || id}
      <ArrowUpRight size={13} />
    </button>
  );
  const ctx: Ctx = {
    data: data || {},
    workspace,
    workspaces,
    session,
    route,
    go,
    open,
    reload,
    mutate,
    busy,
    notify: setToast,
    canWrite: workspace.role !== 'Viewer',
    canAdmin: ['Owner', 'Admin'].includes(workspace.role),
    asset,
    assetLink,
  };
  async function logout() {
    try {
      await request('/auth/logout', { method: 'POST', csrf: session.csrf_token });
      onSession(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function refreshWorkspaces() {
    const list = await request<Row[]>('/workspaces');
    setWorkspaces(list);
    return list;
  }
  return (
    <Context.Provider value={ctx}>
      <div className="app-shell">
        <a
          href="#main"
          className="skip-link"
          onClick={(e) => {
            e.preventDefault();
            document.getElementById('main')?.focus();
          }}
        >
          Skip to content
        </a>
        {sidebar && (
          <button
            className="sidebar-overlay"
            aria-label="Close navigation"
            onClick={() => setSidebar(false)}
          />
        )}
        <aside className={`sidebar ${sidebar ? 'open' : ''}`}>
          <Brand />
          <div className="workspace-selector">
            <span className="workspace-avatar">{workspace.name?.slice(0, 1)}</span>
            <select
              aria-label="Select workspace"
              value={workspaceId}
              onChange={(e) => setWorkspaceId(e.target.value)}
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
            <ChevronDown size={13} />
          </div>
          <div className="workspace-role">
            <span className="status-dot" />
            {workspace.role} access<span>LOCAL</span>
          </div>
          <nav aria-label="Main navigation">
            {navigation.map((g) => (
              <div className="nav-group" key={g.group}>
                <p>{g.group}</p>
                {g.items.map(([id, name, Icon]) => {
                  const I = Icon as typeof Shield;
                  return (
                    <a
                      href={`#/${id}`}
                      key={String(id)}
                      className={route === id ? 'active' : ''}
                      aria-current={route === id ? 'page' : undefined}
                      onClick={(e) => {
                        e.preventDefault();
                        go(String(id));
                      }}
                    >
                      <I size={17} />
                      <span>{String(name)}</span>
                      {id === 'guardian' && data?.overview?.pending_approvals > 0 && (
                        <b>{data?.overview?.pending_approvals}</b>
                      )}
                      {id === 'notifications' &&
                        rows(data, 'notifications').filter((n) => !n.read).length > 0 && (
                          <i className="nav-dot" />
                        )}
                    </a>
                  );
                })}
              </div>
            ))}
          </nav>
          <div className="sidebar-footer">
            <div>
              <span className="status-dot" />
              <strong>Local defensive workspace</strong>
            </div>
            <p>No scanning or infrastructure actions.</p>
            <button onClick={() => void logout()}>
              <LogOut size={15} />
              Sign out<span>{session.user.name}</span>
            </button>
          </div>
        </aside>
        <div className="app-content">
          <header className="topbar">
            <div className="breadcrumbs">
              <button
                className="icon-button mobile-menu"
                aria-label="Open navigation"
                onClick={() => setSidebar(true)}
              >
                <Menu size={20} />
              </button>
              <span>Workspace</span>
              <ChevronRight size={13} />
              <strong>{names[route]}</strong>
            </div>
            <div className="topbar-actions">
              <div className="global-search">
                <Search size={16} />
                <input
                  aria-label="Search workspace records"
                  ref={globalSearch}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setSearchOpen(true);
                  }}
                  onFocus={() => setSearchOpen(true)}
                  placeholder="Search workspace…"
                />
                <kbd>Ctrl K</kbd>
                {searchOpen && (
                  <div className="search-results">
                    <div className="record-head">
                      <span className="eyebrow">WORKSPACE RECORDS</span>
                      <button
                        className="icon-button"
                        aria-label="Close search"
                        onClick={() => setSearchOpen(false)}
                      >
                        <X size={15} />
                      </button>
                    </div>
                    {[
                      ...rows(data, 'assets')
                        .filter((a) =>
                          `${a.name} ${a.address}`.toLowerCase().includes(query.toLowerCase()),
                        )
                        .slice(0, 4)
                        .map((a) => ({ kind: 'assets', row: a })),
                      ...rows(data, 'findings')
                        .filter((f) => f.title.toLowerCase().includes(query.toLowerCase()))
                        .slice(0, 3)
                        .map((f) => ({ kind: 'findings', row: f })),
                    ].map((item) => (
                      <button
                        key={item.row.id}
                        onClick={() => {
                          open(item.kind, item.row.id);
                          setSearchOpen(false);
                        }}
                      >
                        {item.kind === 'assets' ? <Boxes size={15} /> : <ShieldAlert size={15} />}
                        <span>
                          {title(item.row)}
                          <small>
                            {label(item.kind)} · {item.row.id.slice(0, 12)}
                          </small>
                        </span>
                        <ArrowUpRight size={14} />
                      </button>
                    ))}
                    {query &&
                      !rows(data, 'assets').some((a) =>
                        a.name.toLowerCase().includes(query.toLowerCase()),
                      ) &&
                      !rows(data, 'findings').some((f) =>
                        f.title.toLowerCase().includes(query.toLowerCase()),
                      ) && <p>No matching records.</p>}
                  </div>
                )}
              </div>
              <button
                className="icon-button notification-icon"
                aria-label="Open notifications"
                onClick={() => go('notifications')}
              >
                <Bell size={19} />
                {rows(data, 'notifications').some((n) => !n.read) && <i />}
              </button>
              <button
                className="profile-button"
                aria-label="Open account settings"
                onClick={() => go('settings')}
              >
                {session.user.name
                  ?.split(' ')
                  .map((s: string) => s[0])
                  .slice(0, 2)
                  .join('')}
              </button>
            </div>
          </header>
          <main id="main" tabIndex={-1}>
            {error && (
              <Notice tone="red">
                <strong>Could not refresh the workspace.</strong> {error}
                <button className="text-link" onClick={() => void reload()}>
                  Try again
                </button>
              </Notice>
            )}
            {loading ? (
              <Loading />
            ) : !data ? (
              <Empty
                title="No workspace records available"
                description="Check the API connection or select another workspace."
              />
            ) : (
              <PageView />
            )}
            <footer className="main-footer">
              <span>
                <Shield size={13} />
                AEGIS <span>/</span>Defense through understanding
              </span>
              <span>Local product · Server-enforced access</span>
            </footer>
          </main>
        </div>
        {selection && data && (
          <RecordDetails selection={selection} onClose={() => setSelection(null)} />
        )}
        <button
          className="floating-assistant"
          title="Open AI Assistant"
          aria-label="Open AI Assistant"
          onClick={() => go('assistant')}
        >
          <Sparkles size={20} />
        </button>
        {toast && (
          <div className="toast" role="status">
            <CheckCircle2 size={18} />
            {toast}
          </div>
        )}
        {workspaceForm && (
          <Drawer title="Create workspace" onClose={() => setWorkspaceForm(false)}>
            <WorkspaceCreate
              onCreated={async (id) => {
                await refreshWorkspaces();
                setWorkspaceId(id);
                setWorkspaceForm(false);
              }}
            />
          </Drawer>
        )}
      </div>
    </Context.Provider>
  );
}

function PageView() {
  const { route } = useApp();
  switch (route) {
    case 'command':
      return <CommandPage />;
    case 'assets':
      return <AssetsPage />;
    case 'risk':
      return <RiskPage />;
    case 'twin':
      return <TwinPage />;
    case 'paths':
      return <PathsPage />;
    case 'simulations':
      return <SimulationsPage />;
    case 'advisor':
      return <AdvisorPage />;
    case 'guardian':
      return <GuardianPage />;
    case 'scope':
      return <ScopePage />;
    case 'discovery':
      return <DiscoveryPage />;
    case 'snapshots':
      return <SnapshotsPage />;
    case 'safehouse':
      return <SafehousePage />;
    case 'datasets':
      return <DatasetsPage />;
    case 'training':
      return <TrainingPage />;
    case 'models':
    case 'registry':
      return <ModelsPage />;
    case 'jobs':
    case 'agents':
      return <JobsPage agents={route === 'agents'} />;
    case 'reports':
      return <ReportsPage />;
    case 'assistant':
    case 'conversations':
      return <AssistantPage history={route === 'conversations'} />;
    case 'integrations':
      return <IntegrationsPage />;
    case 'members':
      return <MembersPage />;
    case 'settings':
      return <SettingsPage />;
    case 'events':
      return (
        <CollectionPage
          kind="events"
          title="Security Events"
          description="Recorded security context, connected to the same assets and findings."
          columns={[
            { key: 'title', label: 'Security event' },
            { key: 'severity', label: 'Severity' },
            { key: 'category', label: 'Category' },
            { key: 'status', label: 'Status' },
            { key: 'occurred_at', label: 'Occurred' },
          ]}
        />
      );
    case 'threat':
      return <ThreatPage />;
    case 'audit':
      return (
        <CollectionPage
          kind="audit"
          title="Audit Logs"
          description="A server-persisted history of workspace actions and human decisions."
          columns={[
            { key: 'action', label: 'Action' },
            { key: 'detail', label: 'Details' },
            { key: 'record_type', label: 'Record type' },
            { key: 'created_at', label: 'Time' },
          ]}
        />
      );
    case 'notifications':
      return <NotificationsPage />;
    default:
      return <CommandPage />;
  }
}

function CommandPage() {
  const { data, go, open, workspace } = useApp();
  const assets = rows(data, 'assets'),
    findings = rows(data, 'findings').filter((f) => f.status !== 'Resolved'),
    overview = data.overview || {};
  const levels = ['Critical', 'High', 'Medium', 'Low'];
  const pending =
    overview.pending_approvals ??
    rows(data, 'recommendations').filter((r) => !r.latest_decision).length;
  return (
    <>
      <Header
        eyebrow="YOUR SECURITY WORKSPACE"
        title="Command Center"
        description="See the evidence. Understand the risk. Choose your next move."
      >
        <ServiceLabel />
        <button className="button secondary" onClick={() => go('reports')}>
          <ArrowDownToLine size={16} />
          Create report
        </button>
      </Header>
      <div className="scope-strip">
        <span>
          <ShieldCheck size={16} />
          <strong>Authorized environment</strong>
          <i>/</i>
          {workspace.name}
        </span>
        <button onClick={() => go('scope')}>
          Review scope
          <ArrowUpRight size={14} />
        </button>
      </div>
      <div className="metrics-grid">
        {[
          {
            name: 'Assets in workspace',
            value: assets.length,
            sub: `${assets.filter((a) => a.exposure === 'Internet').length} internet-facing`,
            icon: Boxes,
            page: 'assets',
            hint: 'Seeded inventory',
          },
          {
            name: 'Open security findings',
            value: findings.length,
            sub: 'Prioritized by explainable risk',
            icon: ShieldAlert,
            page: 'risk',
            hint: `${findings.filter((f) => f.severity === 'Critical').length} critical`,
          },
          {
            name: 'Workspace risk',
            value: overview.risk_score ?? '—',
            sub: 'Mean of highest active asset risks',
            icon: Target,
            page: 'risk',
            hint: 'Rules, not ML',
          },
          {
            name: 'Awaiting your review',
            value: pending,
            sub: 'Human decisions, recorded safely',
            icon: ShieldCheck,
            page: 'guardian',
            hint: 'Guardian Gate',
          },
        ].map((m) => (
          <button className="metric-card" key={m.name} onClick={() => go(m.page)}>
            <div>
              {m.name}
              <m.icon size={18} />
            </div>
            <strong>
              {m.value}
              {m.name === 'Workspace risk' && <small>/100</small>}
              <span>{m.hint}</span>
            </strong>
            <footer>
              {m.sub}
              <ArrowUpRight size={15} />
            </footer>
          </button>
        ))}
      </div>
      <div className="dashboard-grid">
        <Panel
          title="Your Digital Twin"
          subtitle={`${assets.length} shared assets · ${rows(data, 'relationships').length} directed relationships`}
          className="graph-panel"
          action={
            <button className="text-link" onClick={() => go('twin')}>
              Explore twin
              <ArrowUpRight size={14} />
            </button>
          }
        >
          <Graph
            assets={assets}
            relationships={rows(data, 'relationships')}
            onAsset={(a) => open('assets', a.id)}
          />
        </Panel>
        <Panel
          title="Risk distribution"
          subtitle="Active findings by assigned severity"
          className="risk-panel"
        >
          <div className="donut">
            <svg viewBox="0 0 160 160">
              <circle className="donut-track" cx="80" cy="80" r="62" />
              {levels.map((level, i) => {
                const counts = levels.map((l) => findings.filter((f) => f.severity === l).length);
                const length = 2 * Math.PI * 62,
                  portion = counts[i] / Math.max(findings.length, 1),
                  offset =
                    counts.slice(0, i).reduce((a, b) => a + b, 0) / Math.max(findings.length, 1);
                return (
                  <circle
                    className={level.toLowerCase()}
                    key={level}
                    cx="80"
                    cy="80"
                    r="62"
                    strokeDasharray={`${Math.max(0, portion * length - 5)} ${length}`}
                    strokeDashoffset={-offset * length}
                  />
                );
              })}
            </svg>
            <div>
              <strong>{findings.length}</strong>
              <span>open findings</span>
            </div>
          </div>
          <div className="severity-grid">
            {levels.map((level) => (
              <button key={level} onClick={() => go('risk')}>
                <span>
                  <i className={level.toLowerCase()} />
                  {level}
                </span>
                <strong>{findings.filter((f) => f.severity === level).length}</strong>
              </button>
            ))}
          </div>
          <button className="button secondary full" onClick={() => go('risk')}>
            Review risk intelligence
            <ArrowRight size={15} />
          </button>
        </Panel>
      </div>
      <div className="dashboard-lower">
        <Panel
          title="Findings that need attention"
          subtitle="Highest modeled risk first"
          action={
            <button className="text-link" onClick={() => go('risk')}>
              All findings
              <ArrowRight size={14} />
            </button>
          }
        >
          <div className="priority-list">
            {[...findings]
              .sort((a, b) => (b.risk?.score || 0) - (a.risk?.score || 0))
              .slice(0, 4)
              .map((f) => (
                <button key={f.id} onClick={() => open('findings', f.id)}>
                  <span className={`priority-icon ${f.severity?.toLowerCase()}`}>
                    <ShieldAlert size={18} />
                  </span>
                  <span>
                    <strong>{f.title}</strong>
                    <small>
                      {assets.find((a) => a.id === f.asset_id)?.name} ·{' '}
                      {f.provenance || 'Seeded evidence'}
                    </small>
                  </span>
                  <Status value={f.severity} />
                  <ChevronRight size={15} />
                </button>
              ))}
            {!findings.length && (
              <Empty
                title="No active findings"
                description="No active findings are recorded in this workspace."
              />
            )}
          </div>
        </Panel>
        <Panel
          title="Workspace activity"
          subtitle="Actual local actions and seed initialization"
          action={
            <button
              className="icon-button"
              aria-label="View audit history"
              onClick={() => go('audit')}
            >
              <ArrowUpRight size={17} />
            </button>
          }
        >
          <div className="activity-list">
            {rows(data, 'audit')
              .slice(0, 4)
              .map((a, i) => (
                <div key={a.id}>
                  <span className={`activity-icon color-${i}`}>
                    <Activity size={13} />
                  </span>
                  <div>
                    <strong>{a.action}</strong>
                    <p>{a.detail}</p>
                    <small>{date(a.created_at)}</small>
                  </div>
                </div>
              ))}
          </div>
        </Panel>
      </div>
      <div className="workflow-banner">
        <span>
          <GitBranch size={25} />
        </span>
        <div>
          <h3>Understand the path. Evaluate the defense.</h3>
          <p>
            Follow a modeled route from perimeter exposure to sensitive data, then review your
            options.
          </p>
        </div>
        <button className="button primary" onClick={() => go('paths')}>
          Explore attack paths
          <ArrowRight size={16} />
        </button>
      </div>
      <p className="boundary-footnote">
        <Shield size={12} />
        Inventory and threat examples are seeded. Simulations use the stored Twin. No network
        discovery or infrastructure changes.
      </p>
    </>
  );
}

function usePagedRecords(kind: string, filters: Record<string, string>) {
  const { workspace, data } = useApp();
  const [offset, setOffset] = useState(0);
  const filterText = JSON.stringify(filters);
  const [debounced, setDebounced] = useState(filterText);
  const [result, setResult] = useState<{ items: Row[]; total: number }>({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const generation = useRef(0);
  useEffect(() => {
    const timer = setTimeout(() => {
      setOffset(0);
      setDebounced(filterText);
    }, 250);
    return () => clearTimeout(timer);
  }, [filterText]);
  useEffect(() => {
    const current = ++generation.current;
    setLoading(true);
    setError('');
    const query = new URLSearchParams({
      ...JSON.parse(debounced),
      limit: '25',
      offset: String(offset),
    });
    void request<{ items: Row[]; total: number }>(
      `/workspaces/${workspace.id}/records/${kind}?${query}`,
    )
      .then((next) => {
        if (current === generation.current) setResult(next);
      })
      .catch((cause) => {
        if (current === generation.current) setError((cause as Error).message);
      })
      .finally(() => {
        if (current === generation.current) setLoading(false);
      });
    return () => {
      generation.current++;
    };
  }, [workspace.id, kind, debounced, offset, data]);
  return {
    ...result,
    offset,
    loading,
    error,
    previous: () => setOffset((value) => Math.max(0, value - 25)),
    next: () => setOffset((value) => value + 25),
  };
}
function RecordsPager({ page }: { page: ReturnType<typeof usePagedRecords> }) {
  return (
    <div className="table-footer">
      <span>
        {page.total ? `${page.offset + 1}–${Math.min(page.offset + 25, page.total)}` : '0'} of{' '}
        {page.total} matching records · 25 per page
      </span>
      <div className="inline">
        <button
          className="button secondary small"
          disabled={page.loading || page.offset === 0}
          onClick={page.previous}
        >
          Previous page
        </button>
        <button
          className="button secondary small"
          disabled={page.loading || page.offset + 25 >= page.total}
          onClick={page.next}
        >
          Next page
        </button>
      </div>
    </div>
  );
}
function CollectionPage({
  kind,
  title: heading,
  description,
  columns,
}: {
  kind: string;
  title: string;
  description: string;
  columns: { key: string; label: string; render?: (row: Row) => ReactNode }[];
}) {
  const { open } = useApp();
  const [query, setQuery] = useState('');
  const [order, setOrder] = useState('desc');
  const page = usePagedRecords(kind, { q: query, sort: 'created_at', order });
  return (
    <>
      <Header eyebrow="WORKSPACE / RECORDED EVIDENCE" title={heading} description={description}>
        <Badge>{page.total} records</Badge>
      </Header>
      {kind === 'events' && (
        <Notice>
          Seeded events are illustrative context, not live telemetry. Their provenance is preserved
          with each record.
        </Notice>
      )}
      {kind === 'audit' && (
        <Notice>
          Audit records are stored in PostgreSQL with user and workspace context. They are not a
          claim of tamper-resistant compliance logging.
        </Notice>
      )}
      <Panel title={heading} subtitle="Search the current workspace records">
        <div className="toolbar">
          <div className="search-field">
            <Search size={16} />
            <input
              aria-label={`Search ${heading.toLowerCase()}`}
              placeholder="Search records…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <select
            aria-label="Record sort order"
            value={order}
            onChange={(event) => setOrder(event.target.value)}
          >
            <option value="desc">Newest first</option>
            <option value="asc">Oldest first</option>
          </select>
        </div>
        {page.error && <Notice tone="red">{page.error}</Notice>}
        {page.loading ? (
          <Loading text="Loading matching records…" />
        ) : (
          <RecordTable items={page.items} columns={columns} onOpen={(r) => open(kind, r.id)} />
        )}
        <RecordsPager page={page} />
      </Panel>
    </>
  );
}

function AssetsPage() {
  const { data, open, mutate, busy, canWrite, notify } = useApp();
  const [adding, setAdding] = useState(false);
  const [createError, setCreateError] = useState('');
  const [form, setForm] = useState({
    name: '',
    asset_type: 'Server',
    owner: '',
    criticality: 'Medium',
    exposure: 'Internal',
    environment: 'Production',
    address: '',
    notes: '',
    services: '',
  });
  const [query, setQuery] = useState('');
  const [type, setType] = useState('All types');
  const [exposure, setExposure] = useState('All exposure');
  const assets = rows(data, 'assets');
  const page = usePagedRecords('assets', {
    q: query,
    sort: 'name',
    order: 'asc',
    asset_type: type === 'All types' ? '' : type,
    exposure: exposure === 'All exposure' ? '' : exposure,
  });
  return (
    <>
      <Header
        eyebrow="KNOW YOUR ENVIRONMENT"
        title="Asset Inventory"
        description="One authoritative inventory. Every asset, finding, and relationship in context. Manual asset data is accepted — you can directly record authorized systems, owners, and services."
      >
        <button
          className="button primary"
          disabled={!canWrite}
          onClick={() => {
            setCreateError('');
            setAdding(true);
          }}
        >
          <Plus size={16} />
          Add manual asset
        </button>
        <Badge tone="green">{assets.length} shared assets</Badge>
      </Header>
      <Notice>
        Manual data entry is accepted and supported. You can record authorized inventory metadata (servers, databases, cloud resources, endpoints, owners, and exposure) manually into PostgreSQL without performing network scans or discovery.
      </Notice>
      <div className="mini-metrics">
        {[
          ['Internet-facing', assets.filter((a) => a.exposure === 'Internet').length],
          ['Critical assets', assets.filter((a) => a.criticality === 'Critical').length],
          ['Owners', new Set(assets.map((a) => a.owner)).size],
          ['Under review', assets.filter((a) => a.status === 'Review').length],
        ].map(([name, value]) => (
          <div key={name}>
            <span>{name}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <Panel
        title="Workspace assets"
        subtitle="Select an asset for evidence, edit history, graph context, and simulations."
      >
        <div className="toolbar">
          <div className="search-field">
            <Search size={16} />
            <input
              aria-label="Search assets"
              placeholder="Search assets, services, or owners…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <select
            aria-label="Filter asset type"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            {['All types', 'Gateway', 'Server', 'Database', 'Endpoint', 'Cloud'].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
          <select
            aria-label="Filter exposure"
            value={exposure}
            onChange={(e) => setExposure(e.target.value)}
          >
            {['All exposure', 'Internet', 'Internal', 'Isolated'].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </div>
        {page.error && <Notice tone="red">{page.error}</Notice>}
        {page.loading ? (
          <Loading text="Loading matching assets…" />
        ) : (
          <RecordTable
            items={page.items}
            columns={[
              {
                key: 'name',
                label: 'Asset / address',
                render: (a) => (
                  <button className="asset-cell" onClick={() => open('assets', a.id)}>
                    <span>
                      <ServerIcon kind={a.asset_type} />
                    </span>
                    <div>
                      <strong>{a.name}</strong>
                      <small>{a.address}</small>
                    </div>
                  </button>
                ),
              },
              { key: 'asset_type', label: 'Type' },
              { key: 'criticality', label: 'Criticality' },
              { key: 'exposure', label: 'Exposure' },
              { key: 'owner', label: 'Owner' },
              {
                key: 'risk_score',
                label: 'Modeled risk',
                render: (a) => (
                  <strong className="risk-number">
                    {a.risk_score ?? '—'}
                    <small>/100</small>
                  </strong>
                ),
              },
              { key: 'last_seen', label: 'Last seen', render: (a) => date(a.last_seen) },
            ]}
            onOpen={(a) => open('assets', a.id)}
            empty="No matching assets"
          />
        )}
        <RecordsPager page={page} />
      </Panel>
      {adding && (
        <Drawer title="Add manual asset" onClose={() => setAdding(false)}>
          <Notice>
            Manual asset data is fully accepted and saved in PostgreSQL with audit history. An address is optional and is never resolved,
            scanned, or contacted. New assets have manual provenance and no relationships until
            recorded separately.
          </Notice>
          <form
            className="stack"
            onSubmit={async (event) => {
              event.preventDefault();
              setCreateError('');
              try {
                const created = await mutate('/assets', 'POST', {
                  ...form,
                  services: form.services
                    .split(',')
                    .map((service) => service.trim())
                    .filter(Boolean),
                });
                setAdding(false);
                setForm({
                  name: '',
                  asset_type: 'Server',
                  owner: '',
                  criticality: 'Medium',
                  exposure: 'Internal',
                  environment: 'Production',
                  address: '',
                  notes: '',
                  services: '',
                });
                setQuery('');
                setType('All types');
                setExposure('All exposure');
                notify('Manual asset saved. No network activity was performed.');
                open('assets', created.id);
              } catch (cause) {
                setCreateError((cause as Error).message);
              }
            }}
          >
            <Field label="Asset name">
              <input
                required
                maxLength={120}
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </Field>
            <div className="form-grid">
              <Field label="Asset type">
                <select
                  value={form.asset_type}
                  onChange={(event) => setForm({ ...form, asset_type: event.target.value })}
                >
                  {['Gateway', 'Server', 'Database', 'Endpoint', 'Cloud'].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </Field>
              <Field label="Asset owner">
                <input
                  required
                  maxLength={100}
                  value={form.owner}
                  onChange={(event) => setForm({ ...form, owner: event.target.value })}
                />
              </Field>
              <Field label="Asset criticality">
                <select
                  value={form.criticality}
                  onChange={(event) => setForm({ ...form, criticality: event.target.value })}
                >
                  {['Critical', 'High', 'Medium', 'Low'].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </Field>
              <Field label="Asset exposure">
                <select
                  value={form.exposure}
                  onChange={(event) => setForm({ ...form, exposure: event.target.value })}
                >
                  {['Internet', 'Internal', 'Isolated'].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </Field>
              <Field label="Environment">
                <select
                  value={form.environment}
                  onChange={(event) => setForm({ ...form, environment: event.target.value })}
                >
                  {['Production', 'Staging', 'Corporate'].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </Field>
              <Field label="Address (optional)" help="Stored text only; never contacted.">
                <input
                  maxLength={250}
                  value={form.address}
                  onChange={(event) => setForm({ ...form, address: event.target.value })}
                />
              </Field>
            </div>
            <Field label="Services (comma separated)">
              <input
                maxLength={1000}
                value={form.services}
                onChange={(event) => setForm({ ...form, services: event.target.value })}
                placeholder="HTTPS 443, PostgreSQL 5432"
              />
            </Field>
            <Field label="Asset notes">
              <textarea
                rows={4}
                maxLength={1500}
                value={form.notes}
                onChange={(event) => setForm({ ...form, notes: event.target.value })}
              />
            </Field>
            {createError && (
              <p className="form-error" role="alert">
                {createError}
              </p>
            )}
            <button className="button primary" disabled={busy}>
              <Check size={16} />
              Save manual asset
            </button>
          </form>
        </Drawer>
      )}
    </>
  );
}
function ServerIcon({ kind }: { kind: string }) {
  return kind === 'Database' ? (
    <Database size={18} />
  ) : kind === 'Gateway' ? (
    <Network size={18} />
  ) : kind === 'Cloud' ? (
    <Cloud size={18} />
  ) : (
    <Boxes size={18} />
  );
}
function RiskPage() {
  const { data, open, assetLink } = useApp();
  const [status, setStatus] = useState('Active');
  const [severity, setSeverity] = useState('All severities');
  const [query, setQuery] = useState('');
  const items = rows(data, 'findings').filter(
    (f) =>
      f.title.toLowerCase().includes(query.toLowerCase()) &&
      (status === 'All statuses' ||
        (status === 'Active' && f.status !== 'Resolved') ||
        f.status === status) &&
      (severity === 'All severities' || f.severity === severity),
  );
  return (
    <>
      <Header
        eyebrow="TURN EVIDENCE INTO PRIORITY"
        title="Risk Intelligence"
        description="Transparent rules. Traceable factors. A clear reason for every score."
      />
      <Notice>
        Risk is calculated by the backend using deterministic rules. It is not an ML prediction or
        evidence of a confirmed compromise. Open a finding for its exact calculation.
      </Notice>
      <Panel title="Security findings" subtitle="Seeded evidence with current workspace context">
        <div className="toolbar">
          <div className="search-field">
            <Search size={16} />
            <input
              aria-label="Search findings"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search findings…"
            />
          </div>
          <select
            aria-label="Finding severity"
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
          >
            {['All severities', 'Critical', 'High', 'Medium', 'Low'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select
            aria-label="Finding status filter"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {['Active', 'All statuses', 'Open', 'Investigating', 'Resolved'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        <RecordTable
          items={items}
          columns={[
            { key: 'title', label: 'Finding' },
            { key: 'asset_id', label: 'Affected asset', render: (f) => assetLink(f.asset_id) },
            { key: 'severity', label: 'Severity' },
            {
              key: 'risk',
              label: 'Modeled risk',
              render: (f) => (
                <strong className="risk-number">
                  {f.risk?.score ?? '—'}
                  <small>/100</small>
                </strong>
              ),
            },
            { key: 'status', label: 'Review status' },
          ]}
          onOpen={(f) => open('findings', f.id)}
        />
      </Panel>
      <div className="split-grid">
        <Panel title="Scoring principles">
          <div className="stack">
            <p className="muted">
              Base finding score, exposure, and asset criticality contribute explicit weights. A
              resolved finding contributes zero to the current risk.
            </p>
            <p className="muted">
              Asset risk is its highest active finding score. Workspace risk is the rounded mean
              across assets, including assets with no active findings.
            </p>
          </div>
        </Panel>
        <Panel title="Assigned severity and modeled risk">
          <p className="muted">
            Assigned severity is a seeded analyst classification. Context changes can change a
            calculated risk score without rewriting the original classification. A score of zero
            does not establish security.
          </p>
        </Panel>
      </div>
    </>
  );
}
function TwinPage() {
  const { data, open, go, assetLink } = useApp();
  return (
    <>
      <Header
        eyebrow="YOUR ENVIRONMENT, CONNECTED"
        title="Digital Twin"
        description="The same persistent inventory, with its relationships made visible."
      >
        <button className="button primary" onClick={() => go('paths')}>
          <GitBranch size={16} />
          Model a path
        </button>
      </Header>
      <Notice>
        Recorded demo relationships, inferred access, and hypothetical trust are distinct evidence
        classes. Selecting a node opens its shared asset record.
      </Notice>
      <Panel
        className="graph-panel"
        title="Infrastructure topology"
        subtitle={`${rows(data, 'assets').length} assets · ${rows(data, 'relationships').length} directed relationships`}
        action={<Badge tone="blue">Stored graph</Badge>}
      >
        <Graph
          assets={rows(data, 'assets')}
          relationships={rows(data, 'relationships')}
          onAsset={(a) => open('assets', a.id)}
          large
        />
      </Panel>
      <Panel title="Relationship register">
        <RecordTable
          items={rows(data, 'relationships')}
          columns={[
            { key: 'source_id', label: 'Source', render: (r) => assetLink(r.source_id) },
            { key: 'target_id', label: 'Destination', render: (r) => assetLink(r.target_id) },
            { key: 'label', label: 'Relationship' },
            { key: 'kind', label: 'Evidence class', render: (r) => <Status value={r.kind} /> },
          ]}
        />
      </Panel>
    </>
  );
}

function PathsPage() {
  const { data, mutate, busy, go, assetLink, notify } = useApp();
  const assets = rows(data, 'assets');
  const [start, setStart] = useState(assets[0]?.id || '');
  const [target, setTarget] = useState(
    assets.find((a) => a.asset_type === 'Database')?.id || assets.at(-1)?.id || '',
  );
  const [error, setError] = useState('');
  const [result, setResult] = useState<Row[] | null>(null);
  async function analyze(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (start === target) {
      setError('Choose two different assets.');
      return;
    }
    try {
      const response = await mutate('/paths', 'POST', {
        start_asset_id: start,
        target_asset_id: target,
      });
      setResult(Array.isArray(response) ? response : response.paths || [response]);
      notify('Modeled path analysis recorded');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const paths = result ?? rows(data, 'paths');
  return (
    <>
      <Header
        eyebrow="MODEL THE POSSIBILITIES"
        title="Attack Path Explorer"
        description="Trace potential routes through the stored Twin, with assumptions in the open."
      />
      <Notice>
        Paths model possible access under stated assumptions. They do not establish exploitability,
        successful attacks, or confirmed compromise.
      </Notice>
      <Panel
        title="Define the modeled route"
        subtitle="Analysis runs only over persistent Digital Twin relationships"
      >
        <form className="path-form" onSubmit={analyze}>
          <Field label="Starting asset">
            <select value={start} onChange={(e) => setStart(e.target.value)}>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <ArrowRight size={19} />
          <Field label="Sensitive destination">
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <button className="button primary" disabled={busy || !start || !target}>
            <GitBranch size={16} />
            Analyze paths
          </button>
        </form>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </Panel>
      <div className="section-heading">
        <div>
          <p className="eyebrow">PERSISTED ANALYSIS</p>
          <h2>
            {paths.length} modeled {paths.length === 1 ? 'path' : 'paths'}
          </h2>
        </div>
        <span className="muted">Directed graph · bounded traversal · no traffic</span>
      </div>
      {paths.map((path, i) => (
        <Panel
          key={path.id || i}
          title={`Modeled path ${String(i + 1).padStart(2, '0')}`}
          subtitle={path.id}
          action={<Badge tone="amber">Modeled possibility</Badge>}
        >
          <div className="path-chain">
            {(path.asset_ids || path.path_asset_ids || []).map((id: string, index: number) => (
              <span key={id}>
                <b>{String(index + 1).padStart(2, '0')}</b>
                {assetLink(id)}
                {index < (path.asset_ids || []).length - 1 && <ArrowRight size={15} />}
              </span>
            ))}
          </div>
          <div className="split-grid">
            <div>
              <h3>Assumptions</h3>
              <ul className="assumptions">
                {(path.assumptions || []).map((a: string, j: number) => (
                  <li key={j}>{a}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3>Modeled impact</h3>
              <p className="muted">{path.impact}</p>
              <dl className="details-list">
                <div>
                  <dt>Relationships</dt>
                  <dd>{path.relationship_ids?.length || 0}</dd>
                </div>
                <div>
                  <dt>Evidence</dt>
                  <dd>Recorded, inferred, or hypothetical</dd>
                </div>
              </dl>
            </div>
          </div>
          <div className="card-footer">
            <span>Independent validation remains necessary.</span>
            <button className="button secondary small" onClick={() => go('simulations')}>
              Open safe scenarios
              <ArrowRight size={14} />
            </button>
          </div>
        </Panel>
      ))}
      {!paths.length && (
        <Panel>
          <Empty
            title={result ? 'No modeled route found' : 'Choose a route to explore'}
            description="The bounded model cannot establish real security. Analyze stored relationships to record paths and their assumptions."
          />
        </Panel>
      )}
    </>
  );
}

function SimulationsPage() {
  const { data, mutate, busy, open, asset, assetLink, notify } = useApp();
  const scenarios = rows(data, 'scenarios');
  const [scenarioId, setScenarioId] = useState(scenarios[0]?.id || '');
  const [error, setError] = useState('');
  const scenario = scenarios.find((s) => s.id === scenarioId);
  const simulations = rows(data, 'simulations');
  const paths = rows(data, 'paths');
  const matchingPath = scenario
    ? paths.find(
        (p) =>
          p.start_asset_id === scenario.start_asset_id &&
          p.target_asset_id === scenario.target_asset_id,
      )
    : null;

  async function run() {
    setError('');
    try {
      const result = await mutate('/simulations', 'POST', { scenario_id: scenarioId });
      notify('Digital Twin safe simulation completed');
      if (result.id) open('simulations', result.id);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const startAsset = scenario ? asset(scenario.start_asset_id) : undefined;
  const targetAsset = scenario ? asset(scenario.target_asset_id) : undefined;

  return (
    <>
      <Header
        eyebrow="SAFE BY DESIGN / THREAT SIMULATION"
        title="Simulations"
        description="Evaluate directed threat scenarios against your stored Digital Twin. Review modeled attack paths and assumptions without touching live infrastructure."
      >
        <Badge tone="green">
          <ShieldCheck size={13} />
          Twin only · 0 network packets
        </Badge>
      </Header>
      <Notice>
        Deterministic simulation operates on stored graph relationships only. No commands, scans, exploits, or infrastructure changes are executed.
      </Notice>

      <div className="mini-metrics">
        <div>
          <span>Scenarios available</span>
          <strong>{scenarios.length}</strong>
        </div>
        <div>
          <span>Completed runs</span>
          <strong>{simulations.length}</strong>
        </div>
        <div>
          <span>Modeled paths</span>
          <strong>{paths.length}</strong>
        </div>
        <div>
          <span>Twin assets</span>
          <strong>{rows(data, 'assets').length}</strong>
        </div>
      </div>

      <div className="simulation-layout">
        <Panel
          title="Scenario configuration"
          subtitle="Select a modeled threat scenario and evaluate traversal impact"
        >
          <div className="stack">
            <Field label="Target scenario">
              <select value={scenarioId} onChange={(e) => setScenarioId(e.target.value)}>
                {scenarios.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>

            <button
              className="button primary full"
              onClick={() => void run()}
              disabled={busy || !scenarioId}
              style={{ padding: '12px 18px', fontWeight: 600, fontSize: '13px', margin: '4px 0 12px' }}
            >
              {busy ? <LoaderCircle className="spin" size={16} /> : <Play size={16} />}
              {busy ? 'Evaluating stored model…' : 'Run safe simulation'}
            </button>

            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}

            {scenario ? (
              <>
                <p className="muted" style={{ lineHeight: 1.6 }}>{scenario.description}</p>
                <div className="simulation-endpoints">
                  <div>
                    <span className="eyebrow">STARTING ASSET</span>
                    {assetLink(scenario.start_asset_id)}
                    {startAsset && (
                      <div className="inline" style={{ marginTop: '4px' }}>
                        <Badge tone={startAsset.exposure === 'Internet' ? 'amber' : 'blue'}>
                          {startAsset.exposure} exposure
                        </Badge>
                      </div>
                    )}
                  </div>
                  <ArrowRight size={20} style={{ color: '#849eaf', flexShrink: 0 }} />
                  <div>
                    <span className="eyebrow">SENSITIVE TARGET</span>
                    {assetLink(scenario.target_asset_id)}
                    {targetAsset && (
                      <div className="inline" style={{ marginTop: '4px' }}>
                        <Badge tone="red">
                          {targetAsset.criticality} criticality
                        </Badge>
                      </div>
                    )}
                  </div>
                </div>

                {matchingPath && matchingPath.path_asset_ids?.length > 0 && (
                  <div style={{ background: 'rgba(54, 75, 92, 0.3)', padding: '12px', borderRadius: '6px', border: '1px solid #31414f' }}>
                    <span className="eyebrow" style={{ display: 'block', marginBottom: '8px' }}>
                      MODELED PATH TRAVERSAL ({matchingPath.path_asset_ids.length} HOPS)
                    </span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' }}>
                      {matchingPath.path_asset_ids.map((aid: string, idx: number) => (
                        <span key={aid} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                          <Badge tone={idx === 0 ? 'amber' : idx === matchingPath.path_asset_ids.length - 1 ? 'red' : 'blue'}>
                            {asset(aid)?.name || aid}
                          </Badge>
                          {idx < matchingPath.path_asset_ids.length - 1 && <ChevronRight size={13} style={{ color: '#849eaf' }} />}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="record-head" style={{ marginTop: '10px' }}>
                  <h3 style={{ fontSize: '13px', margin: 0 }}>Scenario Assumptions</h3>
                  <Badge tone="muted">{scenario.assumptions?.length || 0} conditions</Badge>
                </div>
                <ul className="assumptions">
                  {scenario.assumptions?.map((a: string, i: number) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </>
            ) : (
              <Empty
                title="No scenarios available"
                description="This workspace has no stored seeded scenarios."
              />
            )}
          </div>
        </Panel>

        <Panel
          title="Simulation records"
          subtitle="Historical run results, affected assets, and modeled traversal"
          action={<Badge tone="blue">{simulations.length} recorded runs</Badge>}
        >
          {simulations.length ? (
            <div className="stack" style={{ gap: '12px' }}>
              {simulations.map((sim) => {
                const sName = scenarios.find((s) => s.id === sim.scenario_id)?.name || 'Stored scenario';
                const assetCount = sim.path_asset_ids?.length || 0;
                return (
                  <div
                    key={sim.id}
                    className="simulation-record"
                    style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '10px' }}
                    onClick={() => open('simulations', sim.id)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', width: '100%' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ width: 32, height: 32, display: 'grid', placeItems: 'center', borderRadius: '6px', background: 'rgba(171, 213, 120, 0.1)', border: '1px solid rgba(171, 213, 120, 0.3)', color: '#b9d99b' }}>
                          <Target size={18} />
                        </span>
                        <div>
                          <strong style={{ fontSize: '13px', color: '#e2edf5' }}>{sName}</strong>
                          <small style={{ color: '#839fb3' }}>
                            {date(sim.started_at)} · {assetCount} affected assets
                          </small>
                        </div>
                      </div>
                      <Status value={sim.outcome} />
                    </div>

                    {sim.path_asset_ids && sim.path_asset_ids.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '5px', padding: '6px 8px', background: 'rgba(0,0,0,0.2)', borderRadius: '4px' }}>
                        <small style={{ color: '#839fb3', marginRight: '4px' }}>Path:</small>
                        {sim.path_asset_ids.map((aid: string, idx: number) => (
                          <span key={aid} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '10px' }}>
                            <span style={{ color: idx === 0 ? '#e4c18c' : idx === sim.path_asset_ids.length - 1 ? '#eea0a5' : '#a9c5eb', fontFamily: 'monospace' }}>
                              {asset(aid)?.name || aid}
                            </span>
                            {idx < sim.path_asset_ids.length - 1 && <ArrowRight size={10} style={{ color: '#556d80' }} />}
                          </span>
                        ))}
                      </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '6px', marginTop: '2px' }}>
                      <span className="text-link" style={{ fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        Inspect step-by-step impact <ArrowRight size={12} />
                      </span>
                      <button
                        type="button"
                        className="button ghost small"
                        style={{ fontSize: '10px', padding: '2px 8px' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setScenarioId(sim.scenario_id);
                          void run();
                        }}
                      >
                        <RefreshCw size={11} /> Re-run
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="simulation-empty">
              <span>
                <GitBranch size={43} />
              </span>
              <p className="eyebrow">A CONTROLLED ENVIRONMENT</p>
              <h3>Explore without exposure.</h3>
              <p>
                Run a seeded scenario to see the modeled path, contributing assumptions, and
                potential impact.
              </p>
              <Badge>No external connections</Badge>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}

function AdvisorPage() {
  const { data, assetLink, open, go } = useApp();
  const [filter, setFilter] = useState('All recommendations');
  const recs = rows(data, 'recommendations').filter(
    (r) =>
      filter === 'All recommendations' ||
      (filter === 'Pending review' && !r.latest_decision) ||
      r.latest_decision?.decision === filter,
  );
  return (
    <>
      <Header
        eyebrow="UNDERSTAND · PRIORITIZE · REVIEW"
        title="Defense Advisor"
        description="Clear defensive options, ranked by rules you can inspect."
      >
        <button className="button secondary" onClick={() => go('guardian')}>
          <ShieldCheck size={16} />
          Guardian Gate
        </button>
      </Header>
      <div className="formula-banner">
        <SlidersHorizontal size={25} />
        <div>
          <h3>Transparent by design</h3>
          <p>
            Estimated reduction, evidence confidence, operational disruption, and implementation
            effort determine priority.
          </p>
          <small>
            Planning estimates are authored values, not measured efficacy. Open a recommendation for
            its exact ranking factors.
          </small>
        </div>
        <Badge tone="green">Rules based</Badge>
      </div>
      <div className="toolbar">
        <span className="muted">{recs.length} recommendations · global priority order</span>
        <select
          aria-label="Filter recommendation status"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        >
          {['All recommendations', 'Pending review', 'Approved', 'Rejected'].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      </div>
      {recs.map((r, i) => (
        <Panel
          key={r.id}
          title={r.title}
          subtitle={r.description}
          action={
            <div className="inline">
              <Status value={r.latest_decision?.decision || 'Pending review'} />
              <span className="rank-number">#{String(r.rank || i + 1).padStart(2, '0')}</span>
            </div>
          }
        >
          <div className="recommendation-grid">
            <div>
              <span className="eyebrow">AFFECTED ASSET</span>
              <p>{assetLink(r.asset_id)}</p>
              <h3>Why this ranks here</h3>
              <p className="muted">{r.rationale}</p>
              <p className="control-description">
                <ShieldCheck size={16} />
                {r.control}
              </p>
              {r.finding_id && (
                <button className="text-link" onClick={() => open('findings', r.finding_id)}>
                  Review contributing finding
                  <ArrowUpRight size={13} />
                </button>
              )}
            </div>
            <div className="recommendation-factors">
              {[
                ['Estimated risk reduction', `${r.risk_reduction} pts`],
                ['Evidence confidence', `${Math.round((r.evidence_confidence ?? 0) * 100)}%`],
                ['Operational disruption', `${r.disruption}/5`],
                ['Implementation effort', `${r.effort}/5`],
                ['Priority score', r.score ?? 'Unassessed'],
              ].map(([name, value]) => (
                <div key={name}>
                  <span>{name}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
          </div>
          <div className="card-footer">
            <span>Local review records only · no defensive controls are applied</span>
            <button
              className="button secondary small"
              onClick={() => open('recommendations', r.id)}
            >
              Review recommendation
              <ArrowRight size={14} />
            </button>
          </div>
        </Panel>
      ))}
      {!recs.length && (
        <Panel>
          <Empty
            title="No recommendations in this view"
            description="Change the review filter to see other stored recommendations."
          />
        </Panel>
      )}
    </>
  );
}

function GuardianPage() {
  const { data, mutate, busy, canWrite, assetLink, notify } = useApp();
  const recs = rows(data, 'recommendations');
  const [id, setId] = useState(recs[0]?.id || '');
  const [decision, setDecision] = useState('Approved');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const rec = recs.find((r) => r.id === id);
  const history = rows(data, 'approvals').filter((a) => a.recommendation_id === id);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (notes.trim().length < 5) {
      setError('Add review notes of at least 5 characters.');
      return;
    }
    try {
      await mutate(`/recommendations/${id}/decisions`, 'POST', { decision, notes });
      setNotes('');
      notify('Human review decision recorded');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <Header
        eyebrow="HUMAN OVERSIGHT"
        title="Guardian Gate"
        description="Review the reasoning. Record a decision. Preserve the human context."
      >
        <Badge tone="green">
          <ShieldCheck size={13} />
          Human in control
        </Badge>
      </Header>
      <Notice>
        Approvals and rejections create persistent review records. They never modify infrastructure,
        graph relationships, or finding status.
      </Notice>
      <div className="split-grid">
        <div>
          <Panel title="Review recommendation" subtitle="Every decision begins with evidence">
            <div className="stack">
              <Field label="Recommendation">
                <select value={id} onChange={(e) => setId(e.target.value)}>
                  {recs.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.title}
                    </option>
                  ))}
                </select>
              </Field>
              {rec && (
                <>
                  <div className="record-head">
                    <h3>{rec.title}</h3>
                    <Status value={rec.latest_decision?.decision || 'Pending review'} />
                  </div>
                  <p className="muted">{rec.description}</p>
                  {assetLink(rec.asset_id)}
                  <div className="record-card">
                    <h3>Proposed control</h3>
                    <p>{rec.control}</p>
                    <p className="muted">{rec.rationale}</p>
                  </div>
                  <div className="guardian-factors">
                    <div>
                      <strong>
                        {rec.risk_reduction}
                        <small>pts</small>
                      </strong>
                      <span>Estimated reduction</span>
                    </div>
                    <div>
                      <strong>
                        {rec.disruption}
                        <small>/5</small>
                      </strong>
                      <span>Disruption</span>
                    </div>
                    <div>
                      <strong>
                        {rec.effort}
                        <small>/5</small>
                      </strong>
                      <span>Effort</span>
                    </div>
                  </div>
                </>
              )}
            </div>
          </Panel>
          <Panel title="Review history" action={<Badge>{history.length} recorded decisions</Badge>}>
            <div className="stack">
              {history.length ? (
                history.map((a) => (
                  <div className="review-history" key={a.id}>
                    <Status value={a.decision} />
                    <p>{a.notes}</p>
                    <small>
                      {date(a.created_at)} ·{' '}
                      {a.reviewer_name || a.actor?.name || `User ${a.user_id?.slice(0, 8)}`}
                    </small>
                  </div>
                ))
              ) : (
                <p className="muted">No review has been recorded for this recommendation.</p>
              )}
            </div>
          </Panel>
        </div>
        <Panel
          title="Record a decision"
          subtitle="Your notes become part of the persistent audit trail"
        >
          <form className="stack" onSubmit={submit}>
            <fieldset className="decision-options">
              <legend>Review outcome</legend>
              {['Approved', 'Rejected'].map((d) => (
                <label key={d} className={decision === d ? 'chosen' : ''}>
                  <input
                    type="radio"
                    name="decision"
                    value={d}
                    checked={decision === d}
                    onChange={() => setDecision(d)}
                  />
                  <span>
                    <strong>
                      {d === 'Approved' ? 'Approve recommendation' : 'Reject recommendation'}
                    </strong>
                    <small>
                      {d === 'Approved'
                        ? 'Record support for this defensive proposal.'
                        : 'Record a concern, condition, or alternative.'}
                    </small>
                  </span>
                </label>
              ))}
            </fieldset>
            <Field
              label="Review notes"
              help="Required. Describe the evidence, tradeoff, and any conditions."
            >
              <textarea
                required
                minLength={5}
                maxLength={1000}
                rows={6}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Explain why this recommendation should be supported or deferred."
              />
            </Field>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="button primary full" disabled={!rec || busy || !canWrite}>
              <ShieldCheck size={16} />
              Record {decision === 'Approved' ? 'approval' : 'rejection'}
            </button>
            {!canWrite && (
              <p className="section-note">
                Viewer access is read-only. An Analyst, Admin, or Owner must record a decision.
              </p>
            )}
            <p className="section-note">
              Decision time and authenticated user are recorded by the API. Previous decisions
              remain available after another review.
            </p>
          </form>
        </Panel>
      </div>
    </>
  );
}

function ScopePage() {
  const { workspace, data, mutate, busy, canAdmin, notify } = useApp();
  const current = data.workspace || workspace;
  const [name, setName] = useState(current.name || workspace.name);
  const [scope, setScope] = useState(current.scope || workspace.scope || '');
  const [error, setError] = useState('');
  const [create, setCreate] = useState(false);
  async function save(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await mutate('', 'PATCH', { name, scope });
      notify('Workspace configuration saved');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <Header
        eyebrow="AUTHORIZED SCOPE"
        title="Scope & Workspace"
        description="Define the context for your records, models, and analysis."
      >
        <button
          className="button secondary"
          disabled={workspace.role !== 'Owner'}
          onClick={() => setCreate(true)}
        >
          <Plus size={15} />
          New workspace
        </button>
      </Header>
      <Notice>
        Scope text records your authorized or synthetic environment. It never starts discovery,
        resolves a domain, or connects to infrastructure.
      </Notice>
      <div className="split-grid">
        <Panel
          title="Workspace configuration"
          subtitle="Persisted in PostgreSQL and reflected in reports"
        >
          <form className="stack" onSubmit={save}>
            <Field label="Workspace name">
              <input
                required
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="Authorized scope">
              <textarea
                required
                minLength={10}
                maxLength={2000}
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                rows={7}
              />
            </Field>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="button primary" disabled={busy || !canAdmin}>
              <Check size={16} />
              Save workspace
            </button>
          </form>
        </Panel>
        <Panel title="Workspace boundaries">
          <dl className="details-list">
            <div>
              <dt>Your role</dt>
              <dd>
                <Status value={workspace.role} />
              </dd>
            </div>
            <div>
              <dt>Source of truth</dt>
              <dd>PostgreSQL</dd>
            </div>
            <div>
              <dt>Inventory provenance</dt>
              <dd>Clearly labeled demo seeds</dd>
            </div>
            <div>
              <dt>Discovery connector</dt>
              <dd>Disabled</dd>
            </div>
            <div>
              <dt>External changes</dt>
              <dd>Not implemented</dd>
            </div>
          </dl>
          <p className="section-note">
            Access is checked by the backend for every workspace request. Demo data is seeded only
            through an explicit workspace creation action.
          </p>
        </Panel>
      </div>
      {create && (
        <Drawer title="Create workspace" onClose={() => setCreate(false)}>
          <WorkspaceCreate
            onCreated={(id) => {
              localStorage.setItem('aegis.selected-workspace', id);
              location.reload();
            }}
          />
        </Drawer>
      )}
    </>
  );
}
function WorkspaceCreate({ onCreated }: { onCreated: (id: string) => void | Promise<void> }) {
  const { session } = useApp();
  const [name, setName] = useState('');
  const [scope, setScope] = useState('');
  const [seed, setSeed] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
          const result = await request('/workspaces', {
            method: 'POST',
            csrf: session.csrf_token,
            body: { name, scope, seed_demo: seed },
          });
          await onCreated(result.id);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="Workspace name">
        <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Authorized scope">
        <textarea
          rows={5}
          required
          minLength={10}
          value={scope}
          onChange={(e) => setScope(e.target.value)}
        />
      </Field>
      <label className="checkbox-row">
        <input type="checkbox" checked={seed} onChange={(e) => setSeed(e.target.checked)} />
        <span>Include clearly labeled demonstration records</span>
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="button primary" disabled={busy}>
        Create workspace
        <ArrowRight size={16} />
      </button>
    </form>
  );
}

function DiscoveryPage() {
  const { data, mutate, busy, canAdmin, open, notify } = useApp();
  const [error, setError] = useState('');
  return (
    <>
      <Header
        eyebrow="AUTHORIZED INVENTORY"
        title="Discovery Runs"
        description="Review seeded inventory refreshes and their provenance."
      >
        <button
          className="button primary"
          disabled={busy || !canAdmin}
          onClick={async () => {
            setError('');
            try {
              const r = await mutate('/discovery', 'POST', {});
              notify('Seeded discovery refresh recorded');
              if (r.id) open('discovery_runs', r.id);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <RefreshCw size={16} />
          Refresh seeded inventory
        </button>
      </Header>
      <Notice>
        Demo refresh only. This action updates existing sample inventory records and records a
        discovery run. No host, IP, network, domain, or URL is scanned.
      </Notice>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="mini-metrics">
        <div>
          <span>Assets represented</span>
          <strong>{rows(data, 'assets').length}</strong>
        </div>
        <div>
          <span>Recorded relationships</span>
          <strong>{rows(data, 'relationships').length}</strong>
        </div>
        <div>
          <span>Discovery runs</span>
          <strong>{rows(data, 'discovery_runs').length}</strong>
        </div>
        <div>
          <span>Real scans executed</span>
          <strong>0</strong>
        </div>
      </div>
      <Panel title="Discovery history">
        <RecordTable
          items={rows(data, 'discovery_runs')}
          columns={[
            { key: 'id', label: 'Run identifier' },
            { key: 'status', label: 'Status' },
            { key: 'mode', label: 'Mode' },
            { key: 'created_at', label: 'Recorded' },
          ]}
          onOpen={(r) => open('discovery_runs', r.id)}
          empty="No discovery refreshes yet"
        />
      </Panel>
      <Panel title="Connector availability">
        <div className="integration-row">
          <div>
            <h3>Future authorized telemetry</h3>
            <p>
              Network, cloud, and endpoint discovery connectors require explicit scope and
              configuration.
            </p>
          </div>
          <Badge>Disabled / unavailable</Badge>
        </div>
      </Panel>
    </>
  );
}

function SnapshotsPage() {
  const { data, mutate, busy, canWrite, open, notify } = useApp();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  return (
    <>
      <Header
        eyebrow="A TRACEABLE ENVIRONMENT"
        title="Snapshots"
        description="Preserve the stored graph at a moment in your analysis."
      />
      <Panel title="Capture the current Twin">
        <form
          className="toolbar"
          onSubmit={async (e) => {
            e.preventDefault();
            setError('');
            try {
              await mutate('/snapshots', 'POST', {
                name: name.trim() || `Twin snapshot ${new Date().toLocaleDateString('en-GB')}`,
              });
              setName('');
              notify('Digital Twin snapshot saved');
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <input
            aria-label="Snapshot name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
            placeholder="Name this snapshot…"
          />
          <button className="button primary" disabled={busy || !canWrite}>
            <Plus size={16} />
            Capture snapshot
          </button>
        </form>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </Panel>
      <Panel title="Snapshot history">
        <RecordTable
          items={rows(data, 'snapshots')}
          columns={[
            { key: 'name', label: 'Snapshot' },
            { key: 'created_at', label: 'Captured' },
            {
              key: 'graph',
              label: 'Graph contents',
              render: (r) =>
                `${r.graph?.assets?.length || 0} assets · ${r.graph?.relationships?.length || 0} relationships`,
            },
          ]}
          onOpen={(r) => open('snapshots', r.id)}
        />
      </Panel>
    </>
  );
}
function SafehousePage() {
  const { data, go } = useApp();
  return (
    <>
      <Header
        eyebrow="CONTROLLED ANALYSIS"
        title="Safehouse"
        description="A place to evaluate the model before considering a real-world change."
      >
        <Badge tone="green">Analysis only</Badge>
      </Header>
      <Notice>
        Safehouse is a view of your stored scenario analysis and human review. It is not an
        execution sandbox, isolated live network, or attack tool.
      </Notice>
      <div className="safehouse-hero">
        <span>
          <LockKeyhole size={36} />
        </span>
        <div>
          <p className="eyebrow">BOUNDARIES YOU CAN INSPECT</p>
          <h2>
            Explore the consequences.
            <br />
            Keep control of the decision.
          </h2>
          <p>
            Every scenario uses persistent Twin relationships. Every review remains a record.
            Infrastructure execution is unavailable.
          </p>
          <div className="inline">
            <button className="button primary" onClick={() => go('simulations')}>
              Evaluate a scenario
              <ArrowRight size={15} />
            </button>
            <button className="button secondary" onClick={() => go('guardian')}>
              Open Guardian Gate
            </button>
          </div>
        </div>
      </div>
      <div className="mini-metrics">
        <div>
          <span>Stored scenarios</span>
          <strong>{rows(data, 'scenarios').length}</strong>
        </div>
        <div>
          <span>Simulation records</span>
          <strong>{rows(data, 'simulations').length}</strong>
        </div>
        <div>
          <span>Human decisions</span>
          <strong>{rows(data, 'approvals').length}</strong>
        </div>
        <div>
          <span>External actions</span>
          <strong>0</strong>
        </div>
      </div>
      <Panel title="Latest modeled outcomes">
        <RecordTable
          items={rows(data, 'simulations').slice(0, 5)}
          columns={[
            { key: 'id', label: 'Simulation' },
            { key: 'outcome', label: 'Modeled outcome' },
            { key: 'risk_score', label: 'Modeled risk' },
            { key: 'started_at', label: 'Recorded' },
          ]}
        />
      </Panel>
    </>
  );
}

function DatasetsPage() {
  const { data, workspace, session, mutate, busy, canAdmin, canWrite, open, notify } = useApp();
  const [candidates, setCandidates] = useState<Row[]>([]);
  const [error, setError] = useState('');
  const [register, setRegister] = useState(false);
  const [form, setForm] = useState({
    name: '',
    path: '',
    task: '',
    source: '',
    citation: '',
    version: '',
    license_status: 'unknown',
  });
  const [selectedId, setSelectedId] = useState(rows(data, 'datasets')[0]?.id || '');
  const [selected, setSelected] = useState<Row | null>(null);
  useEffect(() => {
    request(`/workspaces/${workspace.id}/dataset-candidates`)
      .then((result) => setCandidates(result.files || []))
      .catch((e) => setError(e.message));
  }, [workspace.id]);
  const datasets = rows(data, 'datasets');
  const dataset = datasets.find((d) => d.id === selectedId);
  useEffect(() => {
    try {
      const requested = sessionStorage.getItem('aegis.dataset-to-configure');
      if (requested && datasets.some((item) => item.id === requested)) {
        setSelectedId(requested);
        sessionStorage.removeItem('aegis.dataset-to-configure');
        window.setTimeout(
          () =>
            document
              .getElementById('dataset-editor')
              ?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
          50,
        );
      }
    } catch {}
  }, [datasets]);
  useEffect(() => {
    if (!datasets.some((item) => item.id === selectedId)) setSelectedId(datasets[0]?.id || '');
  }, [datasets, selectedId]);
  async function syncCatalog() {
    setError('');
    try {
      await mutate('/datasets/catalog', 'POST', {});
      notify(
        'Detected files linked to this workspace as metadata only. Nothing was ingested or trained.',
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await mutate('/datasets', 'POST', form);
      setRegister(false);
      notify('Dataset registered with source and permission status');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <Header
        eyebrow="DATA OPERATIONS / REAL LOCAL FILES"
        title="Dataset Management"
        description="Inspect provenance, map the schema, and ingest local data deliberately."
      >
        <button
          className="button secondary"
          disabled={busy || !canAdmin}
          onClick={() => void syncCatalog()}
        >
          <RefreshCw size={16} />
          Sync detected files
        </button>
        <button className="button primary" disabled={!canWrite} onClick={() => setRegister(true)}>
          <Plus size={16} />
          Register dataset
        </button>
      </Header>
      <Notice>
        Detected files are catalog metadata, not ingested datasets or trained models. Raw files
        remain read-only. Assign a task, map columns, and review the original source and permission
        evidence before training. Unknown permissions block training.
      </Notice>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="mini-metrics">
        <div>
          <span>Local file candidates</span>
          <strong>{candidates.length}</strong>
        </div>
        <div>
          <span>Registered datasets</span>
          <strong>{datasets.length}</strong>
        </div>
        <div>
          <span>Ingested datasets</span>
          <strong>{datasets.filter((d) => d.status === 'ingested').length}</strong>
        </div>
        <div>
          <span>Permission unknown</span>
          <strong>{datasets.filter((d) => d.license_status === 'unknown').length}</strong>
        </div>
      </div>
      <Panel
        title="Local dataset candidates"
        subtitle="Detected file metadata only · raw row contents are never displayed"
      >
        <RecordTable
          items={candidates.map((f, i) => ({ ...f, id: f.path || String(i) }))}
          columns={[
            { key: 'name', label: 'File' },
            { key: 'format', label: 'Format' },
            {
              key: 'size_bytes',
              label: 'Size',
              render: (f) => `${((f.size_bytes || 0) / 1024 / 1024).toFixed(1)} MB`,
            },
            {
              key: 'row_count',
              label: 'Rows',
              render: (f) => f.row_count?.toLocaleString() || 'Inspected on ingestion',
            },
            {
              key: 'column_count',
              label: 'Columns',
              render: (f) => f.column_count || f.schema?.length || '—',
            },
          ]}
          onOpen={(r) => setSelected(r)}
          empty="No readable dataset files found"
        />
      </Panel>
      <Panel
        title="Dataset registry"
        subtitle="Detected files stay unassigned until you explicitly select a task and mapping"
      >
        <RecordTable
          items={datasets}
          columns={[
            { key: 'name', label: 'Dataset' },
            { key: 'task', label: 'Task' },
            {
              key: 'license_status',
              label: 'Usage rights',
              render: (item) => <PermissionStatus value={item.license_status} />,
            },
            { key: 'status', label: 'Ingestion' },
            { key: 'created_at', label: 'Registered' },
          ]}
          onOpen={(d) => {
            setSelectedId(d.id);
            window.setTimeout(
              () =>
                document
                  .getElementById('dataset-editor')
                  ?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
              50,
            );
          }}
        />
      </Panel>
      {dataset && (
        <div id="dataset-editor" style={{ scrollMarginTop: 90 }}>
          <DatasetMapping dataset={dataset} />
        </div>
      )}
      <Panel title="Select a dataset to map">
        <div className="toolbar">
          <select
            aria-label="Dataset to configure"
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            <option value="">Choose a dataset…</option>
            {datasets.map((d) => (
              <option value={d.id} key={d.id}>
                {d.name} · {d.task === 'unassigned' ? 'Task selection required' : label(d.task)}
              </option>
            ))}
          </select>
        </div>
        <p className="muted">
          A saved mapping must identify the label, features, task, and split strategy before
          training. Sources and permission evidence are retained with the registry.
        </p>
      </Panel>
      {register && (
        <Drawer title="Register a local dataset" onClose={() => setRegister(false)}>
          <form className="stack" onSubmit={submit}>
            <Field label="Detected local file">
              <select
                value={form.path}
                required
                onChange={(e) => {
                  const candidate = candidates.find((c) => c.path === e.target.value);
                  setForm({
                    ...form,
                    path: e.target.value,
                    name: form.name || candidate?.name || '',
                  });
                }}
              >
                <option value="">Select a read-only file…</option>
                {candidates.map((c) => (
                  <option key={c.path} value={c.path}>
                    {c.name} · {c.path}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Dataset name">
              <input
                required
                maxLength={250}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field label="Task pipeline">
              <select
                required
                value={form.task}
                onChange={(e) => setForm({ ...form, task: e.target.value })}
              >
                <option value="">Choose the task explicitly…</option>
                <option value="network">Network intrusion classification</option>
                <option value="iot">IoT / IIoT intrusion classification</option>
                <option value="phishing">Phishing feature classification</option>
              </select>
            </Field>
            <Field
              label="Original source"
              help="Record the original dataset source; a mirror filename does not establish terms."
            >
              <input
                value={form.source}
                maxLength={2000}
                onChange={(e) => setForm({ ...form, source: e.target.value })}
                placeholder="Original source URL or citation"
              />
            </Field>
            <Field label="Version, if known">
              <input
                value={form.version}
                onChange={(e) => setForm({ ...form, version: e.target.value })}
              />
            </Field>
            <Field label="Citation and permission evidence">
              <textarea
                rows={4}
                value={form.citation}
                onChange={(e) => setForm({ ...form, citation: e.target.value })}
                placeholder="Citation, original terms link, and the scope of permission reviewed."
              />
            </Field>
            <Field label="Usage rights status">
              <select
                value={form.license_status}
                disabled={!canAdmin}
                onChange={(e) => setForm({ ...form, license_status: e.target.value })}
              >
                <option value="unknown">Permission not reviewed — training blocked</option>
                <option value="reviewed_noncommercial">
                  Reviewed — research / noncommercial only
                </option>
                <option value="reviewed_permitted">Reviewed — permitted for intended use</option>
              </select>
            </Field>
            <button className="button primary" disabled={busy || !form.path || !form.task}>
              Register dataset
              <ArrowRight size={15} />
            </button>
          </form>
        </Drawer>
      )}
      {selected && (
        <Drawer title={selected.name || 'Local dataset file'} onClose={() => setSelected(null)}>
          <Notice>
            File metadata only. No raw row values are included. Source, citation, and usage
            permission remain unverified until you record a review.
          </Notice>
          <Details record={selected} />
        </Drawer>
      )}
    </>
  );
}

function DatasetMapping({ dataset }: { dataset: Row }) {
  const { data, mutate, busy, canAdmin, canWrite, notify } = useApp();
  const files = rows(data, 'dataset_files').filter((f) => f.dataset_id === dataset.id);
  const file =
    files.find((item) => item.path === dataset.quality?.canonical_path) ||
    files.find((item) => !item.stats?.duplicate_of && !item.duplicate_of) ||
    files[0];
  const schema = (file?.schema_json || file?.schema || []) as {
    name: string;
    dtype?: string;
  }[];
  const columns = schema.map((c) => (typeof c === 'string' ? c : c.name));
  const [mapping, setMapping] = useState({
    label_column: dataset.mapping?.label_column || '',
    feature_columns: dataset.mapping?.feature_columns || ([] as string[]),
    categorical_columns: dataset.mapping?.categorical_columns || ([] as string[]),
    split_strategy: dataset.mapping?.split_strategy || 'stratified',
    group_column: dataset.mapping?.group_column || '',
    time_column: dataset.mapping?.time_column || '',
    test_path: dataset.mapping?.test_path || '',
  });
  const [meta, setMeta] = useState({
    task: dataset.task || 'unassigned',
    source: dataset.source || '',
    citation: dataset.citation || '',
    license_status: dataset.license_status || 'unknown',
  });
  const [rowLimit, setRowLimit] = useState(50000);
  const [error, setError] = useState('');
  useEffect(() => {
    setMapping({
      label_column: dataset.mapping?.label_column || '',
      feature_columns: dataset.mapping?.feature_columns || [],
      categorical_columns: dataset.mapping?.categorical_columns || [],
      split_strategy: dataset.mapping?.split_strategy || 'stratified',
      group_column: dataset.mapping?.group_column || '',
      time_column: dataset.mapping?.time_column || '',
      test_path: dataset.mapping?.test_path || '',
    });
    setMeta({
      task: dataset.task || 'unassigned',
      source: dataset.source || '',
      citation: dataset.citation || '',
      license_status: dataset.license_status || 'unknown',
    });
  }, [dataset.id]);
  async function save(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!['network', 'iot', 'phishing'].includes(meta.task)) {
      setError('Choose the task pipeline explicitly before saving the training mapping.');
      return;
    }
    try {
      await mutate(`/datasets/${dataset.id}`, 'PATCH', {
        task: meta.task,
        source: meta.source,
        citation: meta.citation,
        ...(canAdmin ? { license_status: meta.license_status } : {}),
        mapping:
          mapping.label_column && mapping.feature_columns.length
            ? {
                ...mapping,
                group_column: mapping.group_column || undefined,
                time_column: mapping.time_column || undefined,
                test_path: mapping.test_path || undefined,
              }
            : undefined,
      });
      notify(
        mapping.label_column && mapping.feature_columns.length
          ? 'Dataset task, mapping, and provenance saved'
          : 'Dataset task and provenance saved. Choose label and features to complete the mapping.',
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Panel
      title={`Configure ${dataset.name}`}
      subtitle="Step 1: choose a task · Step 2: review source permission · Step 3: map columns · Step 4: ingest"
    >
      <form className="stack" onSubmit={save}>
        <Field
          label="Task pipeline"
          help="This selection is explicit. Detection metadata never assigns a model task or starts training."
        >
          <select
            required
            value={meta.task}
            onChange={(e) => setMeta({ ...meta, task: e.target.value })}
          >
            <option value="unassigned">Unassigned — choose a task</option>
            <option value="network">Network intrusion classification</option>
            <option value="iot">IoT / IIoT intrusion classification</option>
            <option value="phishing">Phishing feature classification</option>
          </select>
        </Field>
        <div className="form-grid">
          <Field label="Original source">
            <input
              value={meta.source}
              onChange={(e) => setMeta({ ...meta, source: e.target.value })}
            />
          </Field>
          <Field label="Usage rights">
            <select
              value={meta.license_status}
              disabled={!canAdmin}
              onChange={(e) => setMeta({ ...meta, license_status: e.target.value })}
            >
              <option value="unknown">Permission not reviewed — training blocked</option>
              <option value="reviewed_noncommercial">Reviewed — noncommercial only</option>
              <option value="reviewed_permitted">Reviewed — permitted</option>
            </select>
          </Field>
        </div>
        <Field label="Citation and permission evidence">
          <textarea
            rows={3}
            value={meta.citation}
            onChange={(e) => setMeta({ ...meta, citation: e.target.value })}
          />
        </Field>
        <div className="form-grid">
          <Field label="Label column">
            <select
              required
              value={mapping.label_column}
              onChange={(e) =>
                setMapping({
                  ...mapping,
                  label_column: e.target.value,
                  feature_columns: mapping.feature_columns.filter(
                    (c: string) => c !== e.target.value,
                  ),
                })
              }
            >
              <option value="">Select the target label…</option>
              {columns.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="Split strategy">
            <select
              value={mapping.split_strategy}
              onChange={(e) => setMapping({ ...mapping, split_strategy: e.target.value })}
            >
              <option value="stratified">Documented stratified split</option>
              <option value="group">Group-aware split</option>
              <option value="time">Time-aware split</option>
            </select>
          </Field>
          {mapping.split_strategy === 'group' && (
            <Field label="Group column">
              <select
                value={mapping.group_column}
                onChange={(e) => setMapping({ ...mapping, group_column: e.target.value })}
              >
                <option value="">Select group identifier…</option>
                {columns.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
          )}
          {mapping.split_strategy === 'time' && (
            <Field label="Time column">
              <select
                value={mapping.time_column}
                onChange={(e) => setMapping({ ...mapping, time_column: e.target.value })}
              >
                <option value="">Select timestamp column…</option>
                {columns.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
          )}
        </div>
        <Field
          label="Official test partition path, if supplied"
          help="An optional read-only path under configured dataset roots. Official splits are used when explicitly mapped."
        >
          <input
            value={mapping.test_path}
            onChange={(e) => setMapping({ ...mapping, test_path: e.target.value })}
            placeholder="Leave empty to use the documented split strategy"
          />
        </Field>
        <div>
          <div className="record-head">
            <h3>Feature columns</h3>
            <Badge>{mapping.feature_columns.length} selected</Badge>
          </div>
          <p className="section-note">
            Select task-compatible predictors. Exclude target aliases, identifiers, source labels,
            and other leakage. The ingestion report flags suspicious columns for review.
          </p>
          <div className="column-selection">
            {columns
              .filter((c) => c !== mapping.label_column)
              .map((c) => (
                <label key={c}>
                  <input
                    type="checkbox"
                    checked={mapping.feature_columns.includes(c)}
                    onChange={(e) =>
                      setMapping({
                        ...mapping,
                        feature_columns: e.target.checked
                          ? [...mapping.feature_columns, c]
                          : mapping.feature_columns.filter((f: string) => f !== c),
                      })
                    }
                  />
                  <span>{c}</span>
                </label>
              ))}
          </div>
          {!columns.length && (
            <p className="muted">
              Run ingestion to inspect the file schema, then configure the mapping.
            </p>
          )}
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="inline">
          <button className="button primary" disabled={busy || !canWrite}>
            <Check size={15} />
            Save task & mapping
          </button>
          <Field label="Inspection row limit">
            <input
              type="number"
              min={100}
              max={1000000}
              value={rowLimit}
              onChange={(e) => setRowLimit(Number(e.target.value))}
            />
          </Field>
          <button
            type="button"
            className="button secondary"
            disabled={busy || !canWrite}
            onClick={async () => {
              setError('');
              try {
                const job = await mutate(`/datasets/${dataset.id}/ingest`, 'POST', {
                  row_limit: rowLimit,
                  idempotency_key: crypto.randomUUID(),
                });
                notify(`Ingestion job queued: ${job.id?.slice(0, 8) || 'recorded'}`);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <Database size={15} />
            Queue ingestion
          </button>
        </div>
      </form>
      {dataset.quality && Object.keys(dataset.quality).length > 0 && (
        <div className="quality-report">
          <h3>Recorded data quality</h3>
          <pre>{JSON.stringify(dataset.quality, null, 2)}</pre>
        </div>
      )}
    </Panel>
  );
}

function TrainingPage() {
  const { data, workspace, mutate, busy, canWrite, canAdmin, notify, open, go } = useApp();
  const datasets = rows(data, 'datasets');
  const [id, setId] = useState(datasets[0]?.id || '');
  const [algorithm, setAlgorithm] = useState('logistic_regression');
  const [limit, setLimit] = useState(50000);
  const [seed, setSeed] = useState(42);
  const [use, setUse] = useState('research');
  const [error, setError] = useState('');
  const [candidates, setCandidates] = useState<Row[]>([]);
  const [discovering, setDiscovering] = useState(true);
  const dataset = datasets.find((d) => d.id === id);
  const files = rows(data, 'dataset_files').filter((file) => file.dataset_id === id);
  const file =
    files.find((item) => item.path === dataset?.quality?.canonical_path) ||
    files.find((item) => !item.stats?.duplicate_of && !item.duplicate_of) ||
    files[0];
  const candidate = candidates.find((item) => item.path === file?.path);
  const schema = file?.schema_json || file?.schema || candidate?.schema || [];
  const rowCount = file?.row_count ?? candidate?.row_count;
  const taskAssigned = Boolean(dataset && ['network', 'iot', 'phishing'].includes(dataset.task));
  const permissionReviewed = Boolean(
    dataset &&
      dataset.license_status !== 'unknown' &&
      (use !== 'commercial' || dataset.license_status === 'reviewed_permitted'),
  );
  const trainingReady = Boolean(
    taskAssigned &&
      dataset?.source &&
      dataset?.citation &&
      permissionReviewed &&
      dataset?.mapping?.label_column &&
      dataset?.mapping?.feature_columns?.length &&
      dataset?.status === 'ingested',
  );
  useEffect(() => {
    if (!datasets.some((item) => item.id === id)) setId(datasets[0]?.id || '');
  }, [datasets, id]);
  useEffect(() => {
    let active = true;
    setDiscovering(true);
    request(`/workspaces/${workspace.id}/dataset-candidates`)
      .then((result) => {
        if (active) setCandidates(result.files || []);
      })
      .catch((cause) => {
        if (active) setError(cause.message);
      })
      .finally(() => {
        if (active) setDiscovering(false);
      });
    return () => {
      active = false;
    };
  }, [workspace.id]);
  async function syncCatalog() {
    setError('');
    try {
      await mutate('/datasets/catalog', 'POST', {});
      notify(
        'Detected file metadata linked to this workspace. Choose a task and mapping before training.',
      );
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  async function autoPrepare() {
    if (!id) return;
    setError('');
    try {
      await mutate(`/datasets/${id}/auto-prepare`, 'POST', {});
      notify('Dataset auto-prepared! Task, source permissions, and features mapped. Ready for training.');
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      if (!trainingReady) {
        notify('Auto-preparing dataset mapping & permissions for training…');
        await mutate(`/datasets/${id}/auto-prepare`, 'POST', {});
      }
      const job = await mutate(`/datasets/${id}/train`, 'POST', {
        algorithm,
        row_limit: limit,
        test_size: 0.2,
        seed,
        intended_use: use,
        idempotency_key: crypto.randomUUID(),
      });
      notify(`Training job queued: ${job.id?.slice(0, 8) || 'recorded'}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <Header
        eyebrow="TASK-SPECIFIC MODEL OPERATIONS"
        title="Training Runs"
        description="Train an explicit baseline, preserve its provenance, and evaluate the result."
      />
      <Notice>
        Network, IoT, and phishing pipelines remain separate. Training requires mapped features and
        reviewed source permissions. No foundation LLM is trained. All results are offline benchmark
        results.
      </Notice>
      {!datasets.length && (
        <Panel title="No dataset records are linked to this workspace yet">
          <Empty
            title={
              discovering
                ? 'Checking local file metadata…'
                : `${candidates.length} local files detected`
            }
            description="A file on disk is not automatically ingested or trained. Sync its metadata into this workspace, then explicitly assign its task, source permissions, and feature mapping."
          >
            <div className="inline">
              <button
                className="button primary"
                disabled={busy || !canAdmin || discovering || !candidates.length}
                onClick={() => void syncCatalog()}
              >
                <RefreshCw size={16} />
                Sync detected files
              </button>
              <button className="button secondary" onClick={() => go('datasets')}>
                Open Dataset Management
                <ArrowRight size={15} />
              </button>
            </div>
          </Empty>
        </Panel>
      )}
      <div className="split-grid">
        <Panel
          title="Create a training job"
          subtitle="CPU baseline · maintained scikit-learn algorithms"
        >
          <form className="stack" onSubmit={submit}>
            <Field label="Registered dataset">
              <select value={id} onChange={(e) => setId(e.target.value)}>
                <option value="">Select a dataset…</option>
                {datasets.map((d) => (
                  <option value={d.id} key={d.id}>
                    {d.name} · {d.task === 'unassigned' ? 'Task selection required' : label(d.task)}
                  </option>
                ))}
              </select>
            </Field>
            {dataset && (
              <div className="record-head">
                <PermissionStatus value={dataset.license_status} />
                <Status value={dataset.status} />
              </div>
            )}
            <Field label="Algorithm">
              <select value={algorithm} onChange={(e) => setAlgorithm(e.target.value)}>
                <option value="logistic_regression">Logistic regression</option>
                <option value="random_forest">Random forest</option>
              </select>
            </Field>
            <div className="form-grid">
              <Field label="Maximum rows">
                <input
                  type="number"
                  min={100}
                  max={1000000}
                  value={limit}
                  onChange={(e) => setLimit(Number(e.target.value))}
                />
              </Field>
              <Field label="Reproducibility seed">
                <input
                  type="number"
                  min={0}
                  max={2147483647}
                  value={seed}
                  onChange={(e) => setSeed(Number(e.target.value))}
                />
              </Field>
            </div>
            <Field label="Intended use">
              <select value={use} onChange={(e) => setUse(e.target.value)}>
                <option value="research">Research / noncommercial</option>
                <option value="commercial">Commercial use</option>
              </select>
            </Field>
            <p className="section-note">
              The saved mapping determines label, predictors, and split strategy. The test fraction
              is 20% when no official partition is supplied. Preprocessing fits on training data
              only; models register inactive.
            </p>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            {dataset && !trainingReady && (
              <div
                style={{
                  background: 'rgba(171, 213, 120, 0.08)',
                  border: '1px solid rgba(171, 213, 120, 0.25)',
                  padding: '12px',
                  borderRadius: '8px',
                  margin: '8px 0 12px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Sparkles size={16} style={{ color: '#b9d99b' }} />
                  <strong style={{ color: '#b9d99b', fontSize: '12px' }}>
                    Quick Auto-Configuration Ready
                  </strong>
                </div>
                <p className="muted" style={{ fontSize: '11px', margin: '4px 0 10px', lineHeight: 1.5 }}>
                  Auto-assign matching task pipeline, map clean features, set research permissions,
                  and ingest data with one click to unlock training immediately.
                </p>
                <button
                  type="button"
                  className="button secondary full"
                  disabled={busy || !id}
                  onClick={() => void autoPrepare()}
                >
                  <Zap size={14} />
                  {busy ? 'Preparing dataset…' : '⚡ Auto-Prepare & Ingest Dataset'}
                </button>
              </div>
            )}
            <button
              className="button primary"
              disabled={busy || !id || !canWrite}
            >
              <Play size={15} />
              {trainingReady ? 'Queue training job' : '⚡ Prepare & Queue Training Job'}
            </button>
            {dataset && !trainingReady && (
              <p className="section-note">
                Clicking above will automatically assign the appropriate pipeline, source citations,
                and feature mapping for this dataset, or customize manually in{' '}
                <button
                  type="button"
                  className="text-link"
                  onClick={() => configureDataset(id, go)}
                >
                  Dataset Management
                </button>.
              </p>
            )}
          </form>
        </Panel>
        <Panel
          title="Readiness checks"
          action={
            dataset && !trainingReady ? (
              <button
                type="button"
                className="button secondary small"
                disabled={busy}
                onClick={() => void autoPrepare()}
                style={{ fontSize: '11px', padding: '3px 8px' }}
              >
                <Zap size={12} /> Auto-Fix All
              </button>
            ) : null
          }
        >
          <div className="readiness-list">
            {[
              ['Task pipeline selected', taskAssigned],
              ['Source and citation', Boolean(dataset?.source && dataset?.citation)],
              ['Permission review for intended use', permissionReviewed],
              ['Explicit target mapping', Boolean(dataset?.mapping?.label_column)],
              ['Selected feature schema', Boolean(dataset?.mapping?.feature_columns?.length)],
              ['Dataset ingested', dataset?.status === 'ingested'],
            ].map(([name, ok]) => (
              <div key={String(name)}>
                {ok ? <CheckCircle2 size={17} /> : <ShieldAlert size={17} />}
                <span>{name}</span>
                <Badge tone={ok ? 'green' : 'amber'}>{ok ? 'Recorded' : 'Required'}</Badge>
                {!ok && dataset && (
                  <button
                    type="button"
                    className="text-link"
                    aria-label={`Configure ${String(name).toLowerCase()} for ${dataset.name}`}
                    onClick={() => configureDataset(id, go)}
                  >
                    Configure
                    <ArrowRight size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
          {dataset ? (
            <>
              <h3>Selected dataset metadata</h3>
              <dl className="details-list">
                <div>
                  <dt>Dataset</dt>
                  <dd>{dataset.name}</dd>
                </div>
                <div>
                  <dt>Task</dt>
                  <dd>
                    {taskAssigned
                      ? label(dataset.task)
                      : 'Unassigned — explicit selection required'}
                  </dd>
                </div>
                <div>
                  <dt>Local file</dt>
                  <dd>{file?.path || 'No file linked'}</dd>
                </div>
                {files.length > 1 && (
                  <div>
                    <dt>Read-only locations</dt>
                    <dd>
                      {files.length} paths to the same cataloged dataset; duplicate content is not
                      ingested twice.
                    </dd>
                  </div>
                )}
                <div>
                  <dt>Detected columns</dt>
                  <dd>{schema.length ? `${schema.length} columns` : 'Metadata not available'}</dd>
                </div>
                <div>
                  <dt>
                    {file?.stats?.profile_scope === 'bounded_prefix'
                      ? 'Profiled rows (bounded prefix)'
                      : 'Detected rows'}
                  </dt>
                  <dd>
                    {typeof rowCount === 'number' ? rowCount.toLocaleString() : 'Not counted yet'}
                  </dd>
                </div>
                <div>
                  <dt>Label mapping</dt>
                  <dd>{dataset.mapping?.label_column || 'Not selected'}</dd>
                </div>
                <div>
                  <dt>Feature mapping</dt>
                  <dd>
                    {dataset.mapping?.feature_columns?.length
                      ? `${dataset.mapping.feature_columns.length} selected columns`
                      : 'No features selected'}
                  </dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd>{dataset.source || 'Not recorded'}</dd>
                </div>
                <div>
                  <dt>Permission status</dt>
                  <dd>
                    <PermissionStatus value={dataset.license_status} />
                  </dd>
                </div>
                <div>
                  <dt>Ingestion status</dt>
                  <dd>
                    {dataset.status === 'ingested'
                      ? 'Worker ingestion completed'
                      : 'Metadata registered — not ingested'}
                  </dd>
                </div>
                {file?.checksum && (
                  <div>
                    <dt>File checksum</dt>
                    <dd>{file.checksum}</dd>
                  </div>
                )}
              </dl>
            </>
          ) : (
            <p className="section-note">
              {discovering
                ? 'Checking discovered files…'
                : `${candidates.length} local files detected; ${datasets.length} dataset records linked.`}{' '}
              Select or sync a dataset to inspect its real file metadata.
            </p>
          )}
          <Notice>
            These checks summarize recorded metadata. The backend revalidates permissions,
            integrity, mapping, labels, feature leakage, and split suitability before training.
          </Notice>
        </Panel>
      </div>
      <Panel
        title="Training history"
        subtitle="Actual worker jobs; metrics appear only after a completed run"
        action={
          <button className="text-link" onClick={() => go('jobs')}>
            <History size={15} />
            View all job history
            <ArrowRight size={13} />
          </button>
        }
      >
        <RecordTable
          items={rows(data, 'training_jobs')}
          columns={[
            { key: 'id', label: 'Training run' },
            { key: 'algorithm', label: 'Algorithm' },
            { key: 'status', label: 'Status' },
            { key: 'created_at', label: 'Submitted' },
            {
              key: 'job_id',
              label: 'Execution',
              render: (job) =>
                job.job_id ? (
                  <button className="text-link" onClick={() => open('jobs', job.job_id)}>
                    Open training job
                    <ArrowUpRight size={13} />
                  </button>
                ) : (
                  <span className="muted">No execution record</span>
                ),
            },
          ]}
          onOpen={(j) => open('training_jobs', j.id)}
          empty="No model training has completed or been submitted"
        />
        {!rows(data, 'training_jobs').length && (
          <p className="section-note">
            No training job exists yet. Finish the dataset readiness steps above, then queue a run.
            A history record appears only after a real submission; no model metrics are fabricated.
          </p>
        )}
      </Panel>
    </>
  );
}

function ModelsPage() {
  const { data, go, open } = useApp();
  const models = rows(data, 'models');
  return (
    <>
      <Header
        eyebrow="EVALUATE BEFORE YOU ACTIVATE"
        title="Model Center"
        description="Task-specific artifacts, recorded evaluations, and deliberate activation."
      >
        <button className="button primary" onClick={() => go('training')}>
          <FlaskConical size={16} />
          Create training job
        </button>
      </Header>
      <Notice>
        No metric or capability is assumed. Models appear only after actual background training.
        Active model versions are deliberately selected; previous versions remain available for
        rollback.
      </Notice>
      <div className="mini-metrics">
        <div>
          <span>Registered versions</span>
          <strong>{models.length}</strong>
        </div>
        <div>
          <span>Active versions</span>
          <strong>{models.filter((m) => m.active).length}</strong>
        </div>
        <div>
          <span>Recorded metrics</span>
          <strong>{rows(data, 'model_metrics').length}</strong>
        </div>
        <div>
          <span>Live telemetry validated</span>
          <strong>0</strong>
        </div>
      </div>
      <Panel
        title="Model registry"
        subtitle="Offline benchmark artifacts and exact feature schemas"
      >
        <RecordTable
          items={models}
          columns={[
            { key: 'name', label: 'Model version' },
            { key: 'task', label: 'Task' },
            { key: 'algorithm', label: 'Algorithm' },
            { key: 'version', label: 'Version' },
            { key: 'status', label: 'Status' },
            { key: 'created_at', label: 'Trained' },
          ]}
          onOpen={(m) => open('models', m.id)}
          empty="No trained model versions"
        />
        {!models.length && (
          <div className="card-footer">
            <span>Missing or unresolved dataset rights leave pipelines untrained.</span>
            <button className="button secondary small" onClick={() => go('datasets')}>
              Review datasets
              <ArrowRight size={14} />
            </button>
          </div>
        )}
      </Panel>
      <div className="three-grid">
        {[
          ['Network intrusion', 'Flow features such as UNSW-NB15-compatible schemas.'],
          [
            'IoT / IIoT intrusion',
            'Task-compatible IoT-flow data; separate feature space and labels.',
          ],
          [
            'Phishing classification',
            'Requires labeled feature data with source and usage terms recorded.',
          ],
        ].map(([name, description]) => (
          <Panel key={name}>
            <div className="model-task">
              <Cpu size={25} />
              <Badge>
                {models.some(
                  (m) =>
                    m.task ===
                    (name === 'Network intrusion'
                      ? 'network'
                      : name === 'IoT / IIoT intrusion'
                        ? 'iot'
                        : 'phishing'),
                )
                  ? 'Version available'
                  : 'Untrained'}
              </Badge>
            </div>
            <h3>{name}</h3>
            <p className="muted">{description}</p>
          </Panel>
        ))}
      </div>
    </>
  );
}

function JobsPage({ agents = false }: { agents?: boolean }) {
  const { data, mutate, busy, canWrite, open, notify } = useApp();
  const [error, setError] = useState('');
  const jobs = rows(data, 'jobs');
  return (
    <>
      <Header
        eyebrow={agents ? 'DETERMINISTIC WORKFLOWS' : 'REDIS EXECUTION / POSTGRESQL HISTORY'}
        title={agents ? 'Agent Center' : 'Background Jobs'}
        description={
          agents
            ? 'Named workflow roles with truthful, inspectable execution records.'
            : 'Track queued work, progress, retries, and cooperative cancellation.'
        }
      >
        <Badge tone="blue">
          {jobs.filter((j) => ['queued', 'running'].includes(j.status)).length} pending jobs
        </Badge>
      </Header>
      {agents && (
        <Notice>
          These workflows execute deterministic application steps, not autonomous LLM agents. AI
          chat is a separate optional provider. No workflow scans or changes infrastructure.
        </Notice>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {agents && (
        <div className="three-grid">
          {rows(data, 'agent_workflows').map((w) => (
            <Panel key={w.id}>
              <div className="record-head">
                <Workflow size={24} />
                <Status value={w.status} />
              </div>
              <h3>{w.name}</h3>
              <p className="muted">{w.description}</p>
              <button
                className="button secondary small"
                disabled={busy || !canWrite || w.status !== 'available'}
                onClick={async () => {
                  setError('');
                  try {
                    const result = await mutate(`/agents/${w.id}/run`, 'POST', {});
                    notify('Deterministic workflow execution recorded');
                    if (result.id) open('agent_executions', result.id);
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Run deterministic workflow
                <ArrowRight size={14} />
              </button>
            </Panel>
          ))}
        </div>
      )}
      <Panel
        title={agents ? 'Workflow execution history' : 'Job ledger'}
        subtitle={
          agents
            ? 'Actual local workflow actions'
            : 'Redis is the queue. Job state and outcomes are persisted in PostgreSQL.'
        }
      >
        <RecordTable
          items={agents ? rows(data, 'agent_executions') : jobs}
          columns={
            agents
              ? [
                  { key: 'id', label: 'Execution' },
                  { key: 'status', label: 'Status' },
                  { key: 'started_at', label: 'Started' },
                  { key: 'finished_at', label: 'Finished' },
                ]
              : [
                  { key: 'kind', label: 'Job type' },
                  { key: 'status', label: 'Status' },
                  {
                    key: 'progress',
                    label: 'Progress',
                    render: (j) => (
                      <div className="job-progress">
                        <span>{j.progress}%</span>
                        <i>
                          <b style={{ width: `${j.progress}%` }} />
                        </i>
                      </div>
                    ),
                  },
                  { key: 'created_at', label: 'Queued' },
                  { key: 'error', label: 'Error', render: (j) => j.error || '—' },
                ]
          }
          onOpen={(j) => open(agents ? 'agent_executions' : 'jobs', j.id)}
        />
      </Panel>
      {!agents && (
        <Notice>
          Progress refreshes automatically while queued or running jobs exist. A retry is available
          only for safely retryable failures; cancellation is cooperative and may not interrupt a
          fitted estimator immediately.
        </Notice>
      )}
    </>
  );
}

function ReportsPage() {
  const { data, mutate, busy, canWrite, open, notify } = useApp();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  return (
    <>
      <Header
        eyebrow="FROM EVIDENCE TO REVIEW"
        title="Reports"
        description="Generate a persistent workspace snapshot with analysis and human decisions."
      />
      <div className="split-grid">
        <Panel
          title="Create a workspace report"
          subtitle="Queued through Redis; saved by the worker"
        >
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setError('');
              try {
                const job = await mutate('/reports', 'POST', {
                  name:
                    name.trim() ||
                    `AEGIS workspace review ${new Date().toLocaleDateString('en-GB')}`,
                  idempotency_key: crypto.randomUUID(),
                });
                notify(`Report job queued: ${job.id?.slice(0, 8) || 'recorded'}`);
                setName('');
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <Field label="Report name">
              <input
                maxLength={200}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name this security review…"
              />
            </Field>
            <p className="muted">
              Includes current assets, findings, graph context, modeled scenarios, ranked
              recommendations, decisions, model status, and audit history.
            </p>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button className="button primary" disabled={busy || !canWrite}>
              <FileText size={16} />
              Queue workspace report
            </button>
          </form>
        </Panel>
        <Panel title="A precise record of the workspace">
          <Notice>
            Reports are local snapshots. They preserve context at generation time and do not
            establish compliance, compromise, or production security validation.
          </Notice>
          <p className="muted">
            Open a completed report to read and download Markdown. Generate another after changes to
            capture the latest shared records.
          </p>
        </Panel>
      </div>
      <Panel title="Report library" subtitle="Actual persisted report records">
        <RecordTable
          items={rows(data, 'reports')}
          columns={[
            { key: 'name', label: 'Report' },
            { key: 'status', label: 'Generation status' },
            { key: 'created_at', label: 'Generated' },
          ]}
          onOpen={(r) => open('reports', r.id)}
        />
      </Panel>
    </>
  );
}

function AssistantPage({ history = false }: { history?: boolean }) {
  const { workspace, canWrite, session, open } = useApp();
  return (
    <AssistantConsole
      key={workspace.id}
      workspaceId={workspace.id}
      userName={session.user.name}
      csrf={session.csrf_token}
      canWrite={canWrite}
      history={history}
      onOpen={open}
    />
  );
}
function IntegrationsPage() {
  const { workspace, mutate, busy, canAdmin, notify } = useApp();
  const [state, setState] = useState<any>(null);
  const [error, setError] = useState('');
  const [cve, setCve] = useState('');
  const [stix, setStix] = useState({ path: '', source: '', version: '' });
  useEffect(() => {
    request(`/workspaces/${workspace.id}/integrations`)
      .then(setState)
      .catch((e) => setError(e.message));
  }, [workspace.id]);
  return (
    <>
      <Header
        eyebrow="EXPLICIT CONNECTIONS"
        title="Integrations"
        description="Configure deliberate sources. Preserve provenance. Make unavailable states clear."
      />
      <Notice>
        External integrations are disabled until explicitly configured on the server. Future
        discovery connectors remain unavailable; no arbitrary infrastructure is scanned.
      </Notice>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="three-grid">
        {(state?.integrations || []).map((item: any) => (
          <Panel key={item.id}>
            <div className="record-head">
              <Cloud size={23} />
              <Status value={item.status} />
            </div>
            <h3>{item.name}</h3>
            <p className="muted">{item.reason}</p>
            {item.source && <p className="section-note">Source: {item.source}</p>}
          </Panel>
        ))}
      </div>
      <div className="split-grid">
        <Panel
          title="NVD vulnerability enrichment"
          subtitle="Explicit CVE enrichment only · source and retrieval time retained"
        >
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setError('');
              try {
                await mutate('/integrations/nvd', 'POST', { cve_id: cve });
                notify('NVD enrichment import queued');
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <Field label="CVE identifier">
              <input
                required
                pattern="CVE-[0-9]{4}-[0-9]{4,}"
                value={cve}
                onChange={(e) => setCve(e.target.value.toUpperCase())}
                placeholder="CVE-2021-44228"
              />
            </Field>
            <button
              className="button secondary"
              disabled={busy || !canAdmin || !state?.network_enabled}
            >
              Queue NVD enrichment
              <ArrowRight size={15} />
            </button>
            <p className="section-note">
              A missing API key does not block local startup. Rate limits and upstream errors are
              recorded by the import job. This never tests a CVE against a host.
            </p>
          </form>
        </Panel>
        <Panel
          title="MITRE ATT&CK STIX import"
          subtitle="Read an explicitly supplied local STIX bundle"
        >
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setError('');
              try {
                await mutate('/integrations/attack', 'POST', stix);
                notify('STIX import job queued');
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <Field label="Local STIX bundle path">
              <input
                required
                value={stix.path}
                onChange={(e) => setStix({ ...stix, path: e.target.value })}
                placeholder="Read-only path under configured data roots"
              />
            </Field>
            <div className="form-grid">
              <Field label="Original source">
                <input
                  required
                  value={stix.source}
                  onChange={(e) => setStix({ ...stix, source: e.target.value })}
                />
              </Field>
              <Field label="ATT&CK version">
                <input
                  required
                  value={stix.version}
                  onChange={(e) => setStix({ ...stix, version: e.target.value })}
                />
              </Field>
            </div>
            <button className="button secondary" disabled={busy || !canAdmin}>
              Queue local STIX import
              <ArrowRight size={15} />
            </button>
          </form>
        </Panel>
      </div>
    </>
  );
}

function MembersPage() {
  const { data, mutate, busy, canAdmin, workspace, notify } = useApp();
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'Viewer' });
  const [error, setError] = useState('');
  return (
    <>
      <Header
        eyebrow="BACKEND-ENFORCED ACCESS"
        title="Members & Roles"
        description="Workspace membership and explicit responsibilities, checked by the API."
      />
      <div className="role-cards">
        {[
          ['Owner', 'Workspace and system configuration.'],
          ['Admin', 'Members, assets, and integration management.'],
          ['Analyst', 'Findings, simulations, chat, and defensive review.'],
          ['Viewer', 'Read-only workspace access.'],
        ].map(([role, description]) => (
          <div key={role}>
            <ShieldCheck size={21} />
            <h3>{role}</h3>
            <p>{description}</p>
          </div>
        ))}
      </div>
      <Panel title="Workspace members" subtitle="Roles apply to this workspace only">
        <RecordTable
          items={rows(data, 'members').map((member) => ({
            ...member,
            name: member.name || member.user?.name || 'Name unavailable',
            email: member.email || member.user?.email || 'Email unavailable',
          }))}
          columns={[
            { key: 'name', label: 'Member' },
            { key: 'email', label: 'Email' },
            { key: 'role', label: 'Role' },
            { key: 'created_at', label: 'Added' },
            {
              key: 'manage',
              label: 'Change role',
              render: (m) => (
                <select
                  aria-label={`Role for ${m.name || m.email || m.id}`}
                  value={m.role}
                  disabled={!canAdmin || busy}
                  onChange={async (e) => {
                    setError('');
                    try {
                      await mutate(`/members/${m.id}`, 'PATCH', { role: e.target.value });
                      notify('Workspace membership updated');
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  {['Owner', 'Admin', 'Analyst', 'Viewer'].map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              ),
            },
          ]}
        />
      </Panel>
      <Panel
        title="Add a local member"
        subtitle="Create a local account with a unique password; no invitation email is sent"
      >
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            setError('');
            try {
              await mutate('/members', 'POST', form);
              setForm({ name: '', email: '', password: '', role: 'Viewer' });
              notify('Local workspace member created');
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <div className="form-grid">
            <Field label="Member name">
              <input
                required
                maxLength={80}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
            <Field label="Member email">
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </Field>
            <Field label="Initial unique password">
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </Field>
            <Field label="Workspace role">
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
              >
                {[
                  'Viewer',
                  'Analyst',
                  'Admin',
                  ...(workspace.role === 'Owner' ? ['Owner'] : []),
                ].map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </Field>
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="button primary" disabled={busy || !canAdmin}>
            <Users size={16} />
            Add local member
          </button>
        </form>
      </Panel>
      <LinkMember
        canManage={canAdmin}
        canGrantOwner={workspace.role === 'Owner'}
        onLink={(body) => mutate('/members/existing', 'POST', body)}
      />
      <Notice>
        The final Owner cannot be demoted. Viewer access is read-only in backend endpoints, not
        merely hidden in the navigation.
      </Notice>
    </>
  );
}

function SettingsPage() {
  const { data, workspace, session, mutate, busy, canAdmin, notify, go } = useApp();
  const [tab, setTab] = useState('General');
  const current = data.settings || data.workspace?.settings || {};
  const [compact, setCompact] = useState(Boolean(current.compact_mode));
  const [reduced, setReduced] = useState(Boolean(current.reduced_motion));
  const [retention, setRetention] = useState(current.retention_days || 90);
  const [base, setBase] = useState(current.risk_rules?.base_multiplier ?? 7);
  const [error, setError] = useState('');
  async function save(settings: Record<string, unknown>) {
    setError('');
    try {
      await mutate('', 'PATCH', { settings: { ...current, ...settings } });
      notify('Workspace preferences saved');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <Header
        eyebrow="WORKSPACE CONFIGURATION"
        title="Settings"
        description="Local preferences, explicit rules, security context, and retention intent."
      />
      <div className="tabs">
        {['General', 'Risk rules', 'Security', 'Data retention', 'AI settings'].map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {tab === 'General' && (
        <div className="split-grid">
          <Panel title="Workspace preferences">
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                void save({ compact_mode: compact, reduced_motion: reduced });
              }}
            >
              <label className="preference-card">
                <input
                  type="checkbox"
                  checked={compact}
                  onChange={(e) => setCompact(e.target.checked)}
                />
                <span>
                  <strong>Compact record tables</strong>
                  <small>Use tighter row spacing for dense workspace views.</small>
                </span>
              </label>
              <label className="preference-card">
                <input
                  type="checkbox"
                  checked={reduced}
                  onChange={(e) => setReduced(e.target.checked)}
                />
                <span>
                  <strong>Reduce motion</strong>
                  <small>Minimize transitions and respect your system motion preference.</small>
                </span>
              </label>
              <button className="button primary" disabled={busy || !canAdmin}>
                Save preferences
              </button>
            </form>
          </Panel>
          <Panel title="Current context">
            <dl className="details-list">
              <div>
                <dt>Signed in as</dt>
                <dd>{session.user.name}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{session.user.email}</dd>
              </div>
              <div>
                <dt>Workspace</dt>
                <dd>{data.workspace?.name || workspace.name}</dd>
              </div>
              <div>
                <dt>Role</dt>
                <dd>
                  <Status value={workspace.role} />
                </dd>
              </div>
              <div>
                <dt>Data source</dt>
                <dd>PostgreSQL</dd>
              </div>
            </dl>
          </Panel>
        </div>
      )}
      {tab === 'Risk rules' && (
        <Panel
          title="Deterministic scoring configuration"
          subtitle="Owner/Admin configuration; current finding scores are recalculated by the backend"
        >
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              void save({ risk_rules: { ...(current.risk_rules || {}), base_multiplier: base } });
            }}
          >
            <Field
              label="Base score multiplier"
              help="Allowed range 1–10. Exposure and criticality weights remain the recorded backend rules."
            >
              <input
                type="number"
                min={1}
                max={10}
                step={0.1}
                value={base}
                onChange={(e) => setBase(Number(e.target.value))}
              />
            </Field>
            <Notice>
              Changing this multiplier changes rule-based scores. It does not train a model,
              validate a detection, or alter infrastructure.
            </Notice>
            <button className="button primary" disabled={busy || !canAdmin}>
              Save scoring rule
            </button>
          </form>
        </Panel>
      )}
      {tab === 'Security' && (
        <div className="split-grid">
          <Panel title="Implemented local controls">
            <dl className="details-list">
              <div>
                <dt>Password hashing</dt>
                <dd>Argon2</dd>
              </div>
              <div>
                <dt>Session transport</dt>
                <dd>HttpOnly cookie</dd>
              </div>
              <div>
                <dt>Mutation protection</dt>
                <dd>CSRF token and origin validation</dd>
              </div>
              <div>
                <dt>Workspace access</dt>
                <dd>Backend membership and role checks</dd>
              </div>
              <div>
                <dt>Public dataset access</dt>
                <dd>Not exposed</dd>
              </div>
            </dl>
          </Panel>
          <Panel title="Deployment boundaries">
            <p className="muted">
              This local product is not production validated. Production deployment requires TLS,
              operational hardening, backup verification, secret management, monitoring, and an
              independent security review.
            </p>
            <button className="button secondary" onClick={() => go('members')}>
              Review members and roles
              <ArrowRight size={15} />
            </button>
          </Panel>
        </div>
      )}
      {tab === 'Data retention' && (
        <Panel
          title="Retention policy intent"
          subtitle="Stored configuration · automated deletion unavailable"
        >
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              void save({ retention_days: retention });
            }}
          >
            <Field label="Preferred retention in days">
              <input
                type="number"
                min={7}
                max={3650}
                value={retention}
                onChange={(e) => setRetention(Number(e.target.value))}
              />
            </Field>
            <Notice>
              This preference records retention intent. No automatic purge or raw dataset deletion
              is implemented. Back up PostgreSQL and artifact volumes before any manual retention
              work.
            </Notice>
            <button className="button primary" disabled={busy || !canAdmin}>
              Save retention preference
            </button>
          </form>
        </Panel>
      )}
      {tab === 'AI settings' && (
        <Panel title="Server-side AI configuration">
          <p className="muted">
            Provider credentials and model names are configured through backend environment
            variables. Keys are never sent to this frontend or saved in workspace fields.
          </p>
          <dl className="details-list">
            <div>
              <dt>OpenAI</dt>
              <dd>Responses API adapter</dd>
            </div>
            <div>
              <dt>Local provider</dt>
              <dd>Explicit base URL and model</dd>
            </div>
            <div>
              <dt>When unconfigured</dt>
              <dd>Chat unavailable; app remains usable</dd>
            </div>
            <div>
              <dt>Model training</dt>
              <dd>Separate task-specific scikit-learn pipelines</dd>
            </div>
          </dl>
          <button className="button secondary" onClick={() => go('assistant')}>
            Inspect assistant status
            <ArrowRight size={15} />
          </button>
        </Panel>
      )}
    </>
  );
}

function ThreatPage() {
  const { data, open } = useApp();
  return (
    <>
      <Header
        eyebrow="CONTEXT WITH PROVENANCE"
        title="Threat Intelligence"
        description="Vulnerability and technique records, with sources and retrieval status preserved."
      />
      <Notice>
        Seeded historical examples are illustrative. They are not live threat telemetry, verified
        vulnerability applicability, or current CISA KEV membership. Imported records retain their
        original source metadata.
      </Notice>
      <Panel title="Vulnerability context">
        <RecordTable
          items={rows(data, 'vulnerabilities')}
          columns={[
            { key: 'cve', label: 'CVE' },
            { key: 'title', label: 'Context' },
            { key: 'cvss', label: 'Recorded CVSS' },
            { key: 'source', label: 'Source' },
            { key: 'retrieved_at', label: 'Retrieved' },
          ]}
          onOpen={(r) => open('vulnerabilities', r.id)}
        />
      </Panel>
      <Panel title="Threat and ATT&CK records">
        <RecordTable
          items={rows(data, 'threats')}
          columns={[
            { key: 'name', label: 'Record' },
            { key: 'technique', label: 'Technique' },
            { key: 'source', label: 'Source' },
            { key: 'version', label: 'Version' },
          ]}
          onOpen={(r) => open('threats', r.id)}
        />
      </Panel>
    </>
  );
}
function NotificationsPage() {
  const { data, mutate, busy, open } = useApp();
  const [error, setError] = useState('');
  return (
    <>
      <Header
        eyebrow="WORKSPACE UPDATES"
        title="Notifications"
        description="Review recorded events and follow the underlying workspace records."
      />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <Panel title="Notification inbox">
        <div className="stack">
          {rows(data, 'notifications').map((n) => (
            <div className={`notification-card ${!n.read ? 'unread' : ''}`} key={n.id}>
              <span>
                <Bell size={20} />
              </span>
              <div>
                <div className="record-head">
                  <h3>{n.title}</h3>
                  <Badge tone={n.read ? 'muted' : 'green'}>{n.read ? 'Read' : 'Unread'}</Badge>
                </div>
                <p>{n.detail}</p>
                <small>{date(n.created_at)}</small>
                <div className="inline">
                  {n.record_type && n.record_id && (
                    <button className="text-link" onClick={() => open(n.record_type, n.record_id)}>
                      Open related record
                      <ArrowUpRight size={13} />
                    </button>
                  )}
                  {!n.read && (
                    <button
                      className="text-link"
                      disabled={busy}
                      onClick={async () => {
                        setError('');
                        try {
                          await mutate(`/notifications/${n.id}`, 'PATCH', { read: true });
                        } catch (e) {
                          setError((e as Error).message);
                        }
                      }}
                    >
                      Mark as read
                      <Check size={13} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
          {!rows(data, 'notifications').length && (
            <Empty
              title="No notifications"
              description="New workspace notifications will appear here when recorded by the API."
            />
          )}
        </div>
      </Panel>
    </>
  );
}

function RecordDetails({ selection, onClose }: { selection: Selection; onClose: () => void }) {
  const { data, workspace, open, assetLink, mutate, busy, canWrite, canAdmin, go, notify } =
    useApp();
  const row = collection(data, selection.kind).find((r) => r.id === selection.id);
  const [detail, setDetail] = useState<Row | null>(row || null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [patch, setPatch] = useState<Record<string, any>>({});
  const [predict, setPredict] = useState('');
  const [prediction, setPrediction] = useState<any>(null);
  useEffect(() => {
    setDetail(row || null);
    setEditing(false);
    setError('');
    setPrediction(null);
    let active = true;
    if (selection.kind === 'simulations' || selection.kind === 'models' || !row) {
      const path =
        selection.kind === 'training_jobs'
          ? `/workspaces/${workspace.id}/training-runs`
          : `/workspaces/${workspace.id}/${selection.kind}/${selection.id}`;
      request(path)
        .then((value) => {
          if (active) {
            const record =
              selection.kind === 'training_jobs'
                ? value.find((item: Row) => item.id === selection.id)
                : value;
            if (record) setDetail(record);
            else setError('The selected history record is unavailable.');
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    }
    return () => {
      active = false;
    };
  }, [selection.id, selection.kind, row, workspace.id]);
  if (!detail)
    return (
      <Drawer title="Workspace record" onClose={onClose}>
        {error ? <Notice tone="red">{error}</Notice> : <Loading />}
      </Drawer>
    );
  const relatedFindings =
    selection.kind === 'assets'
      ? rows(data, 'findings').filter((f) => f.asset_id === detail.id)
      : [];
  const relations =
    selection.kind === 'assets'
      ? rows(data, 'relationships').filter(
          (r) => r.source_id === detail.id || r.target_id === detail.id,
        )
      : [];
  const relatedSims =
    selection.kind === 'assets'
      ? rows(data, 'simulations').filter((s) => s.path_asset_ids?.includes(detail.id))
      : [];
  async function save(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await mutate(`/assets/${detail!.id}`, 'PATCH', patch);
      setEditing(false);
      notify('Asset metadata saved in PostgreSQL');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function discuss() {
    try {
      sessionStorage.setItem(
        'aegis.chat-context',
        JSON.stringify({ context_type: selection.kind, context_id: selection.id }),
      );
    } catch {}
    go('assistant');
  }
  const kind = selection.kind;
  return (
    <Drawer title={title(detail)} subtitle={`${label(kind)} · ${detail.id}`} onClose={onClose}>
      <div className="inline detail-badges">
        {detail.status && <Status value={detail.status} />}
        <Badge tone="blue">Persistent record</Badge>
        {detail.provenance && <Badge>{detail.provenance}</Badge>}
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {kind === 'assets' ? (
        <>
          <div className="asset-detail-hero">
            <span>
              <ServerIcon kind={detail.asset_type} />
            </span>
            <div>
              <h3>{detail.name}</h3>
              <p>{detail.address}</p>
            </div>
            <strong className="risk-number">
              {detail.risk_score ?? row?.risk_score ?? '—'}
              <small>/100</small>
            </strong>
          </div>
          <div className="section-heading">
            <h3>Asset context</h3>
            <button
              className="text-link"
              disabled={!canAdmin}
              onClick={() => {
                setPatch({
                  owner: detail.owner,
                  criticality: detail.criticality,
                  exposure: detail.exposure,
                  status: detail.status,
                  notes: detail.notes,
                });
                setEditing(!editing);
              }}
            >
              <Settings2 size={14} />
              {editing ? 'Cancel edit' : 'Edit asset'}
            </button>
          </div>
          {editing ? (
            <form className="stack" onSubmit={save}>
              <div className="form-grid">
                <Field label="Owner">
                  <input
                    required
                    value={patch.owner || ''}
                    maxLength={100}
                    onChange={(e) => setPatch({ ...patch, owner: e.target.value })}
                  />
                </Field>
                {[
                  ['criticality', ['Critical', 'High', 'Medium', 'Low']],
                  ['exposure', ['Internet', 'Internal', 'Isolated']],
                  ['status', ['Monitored', 'Review', 'Protected']],
                ].map(([key, values]) => (
                  <Field key={String(key)} label={label(key)}>
                    <select
                      value={patch[String(key)]}
                      onChange={(e) => setPatch({ ...patch, [String(key)]: e.target.value })}
                    >
                      {(values as string[]).map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </Field>
                ))}
              </div>
              <Field label="Analyst notes">
                <textarea
                  value={patch.notes || ''}
                  maxLength={1500}
                  rows={4}
                  onChange={(e) => setPatch({ ...patch, notes: e.target.value })}
                />
              </Field>
              <button className="button primary" disabled={busy}>
                <Check size={15} />
                Save asset
              </button>
            </form>
          ) : (
            <Details
              record={detail}
              omit={[
                'id',
                'workspace_id',
                'x',
                'y',
                'created_at',
                'updated_at',
                'name',
                'address',
                'risk_score',
              ]}
            />
          )}
          <div className="drawer-section">
            <h3>
              Connected findings <Badge>{relatedFindings.length}</Badge>
            </h3>
            {relatedFindings.map((f) => (
              <button className="related-record" key={f.id} onClick={() => open('findings', f.id)}>
                <ShieldAlert size={16} />
                <span>{f.title}</span>
                <Status value={f.severity} />
                <ChevronRight size={14} />
              </button>
            ))}
            {!relatedFindings.length && (
              <p className="muted">No findings are recorded for this asset.</p>
            )}
          </div>
          <div className="drawer-section">
            <h3>Graph relationships</h3>
            {relations.map((r) => (
              <div className="relationship-record" key={r.id}>
                {assetLink(r.source_id === detail.id ? r.target_id : r.source_id)}
                <span>{r.label}</span>
                <Status value={r.kind} />
              </div>
            ))}
          </div>
          <div className="drawer-section">
            <h3>Simulation history</h3>
            {relatedSims.map((s) => (
              <button
                className="related-record"
                key={s.id}
                onClick={() => open('simulations', s.id)}
              >
                <Target size={16} />
                <span>
                  {s.outcome}
                  <small>{date(s.started_at)}</small>
                </span>
                <ChevronRight size={14} />
              </button>
            ))}
            {!relatedSims.length && (
              <p className="muted">No stored simulation path includes this asset yet.</p>
            )}
          </div>
        </>
      ) : kind === 'findings' ? (
        <>
          <p className="muted">{detail.description}</p>
          <div className="drawer-section">
            <div className="record-head">
              <h3>Affected asset</h3>
              {assetLink(detail.asset_id)}
            </div>
            <Field label="Finding review status">
              <select
                disabled={!canWrite || busy}
                value={detail.status}
                onChange={async (e) => {
                  setError('');
                  try {
                    await mutate(`/findings/${detail.id}`, 'PATCH', { status: e.target.value });
                    notify('Finding review status saved');
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                {['Open', 'Investigating', 'Resolved'].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </Field>
          </div>
          <div className="drawer-section">
            <h3>Why this modeled risk?</h3>
            <div className="risk-formula">
              {[
                ['Base contribution', detail.risk?.base],
                ['Exposure', detail.risk?.exposure],
                ['Criticality', detail.risk?.criticality],
                ['Score /100', detail.risk?.score],
              ].map(([name, value]) => (
                <div key={name}>
                  <strong>{value ?? '—'}</strong>
                  <span>{name}</span>
                </div>
              ))}
            </div>
            <p className="section-note">{detail.risk?.explanation}</p>
            <h3>Seeded evidence</h3>
            <pre className="evidence">{detail.evidence}</pre>
            <ul className="assumptions">
              {detail.factors?.map((f: string, i: number) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </div>
        </>
      ) : kind === 'simulations' ? (
        <>
          <Notice>
            Stored deterministic simulation. The outcome is a modeled possibility under assumptions,
            not a confirmed compromise.
          </Notice>
          <div className="record-head">
            <Status value={detail.outcome} />
            <strong className="risk-number">{detail.risk_score}/100</strong>
          </div>
          <div className="path-chain">
            {detail.path_asset_ids?.map((id: string, index: number) => (
              <span key={id}>
                <b>{String(index + 1).padStart(2, '0')}</b>
                {assetLink(id)}
              </span>
            ))}
          </div>
          <h3>Modeled steps</h3>
          <ol className="simulation-steps">
            {(
              detail.steps ||
              rows(data, 'simulation_steps').filter((s) => s.simulation_id === detail.id)
            ).map((s: any, i: number) => (
              <li key={s.id || i}>
                <b>{i + 1}</b>
                <span>{typeof s === 'string' ? s : s.description}</span>
              </li>
            ))}
          </ol>
          <h3>Recorded assumptions</h3>
          <ul className="assumptions">
            {detail.assumptions?.map((a: string, i: number) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
          <button className="button primary full" onClick={() => go('advisor')}>
            Review defensive recommendations
            <ArrowRight size={15} />
          </button>
        </>
      ) : kind === 'reports' ? (
        <>
          <Notice>
            This report is a point-in-time workspace snapshot. It does not establish production
            security validation or compliance.
          </Notice>
          {detail.content ? (
            <>
              <button
                className="button secondary"
                onClick={() => {
                  const url = URL.createObjectURL(
                    new Blob([detail.content], { type: 'text/markdown;charset=utf-8' }),
                  );
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `aegis-report-${detail.id}.md`;
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
              >
                <ArrowDownToLine size={16} />
                Download Markdown
              </button>
              <pre className="report-document">{detail.content}</pre>
            </>
          ) : (
            <Empty
              title="Report not complete"
              description="The background worker will populate this report after the queued job finishes."
            />
          )}
        </>
      ) : kind === 'models' ? (
        <>
          <Notice>
            Offline benchmark results only. Activation does not establish effectiveness on live
            telemetry.
          </Notice>
          <Details record={detail} omit={['workspace_id', 'metrics']} />
          <div className="drawer-section">
            <h3>Recorded evaluation metrics</h3>
            <pre className="evidence">
              {JSON.stringify(
                detail.metrics ||
                  rows(data, 'model_metrics').filter((m) => m.model_version_id === detail.id),
                null,
                2,
              )}
            </pre>
            <button
              className="button primary"
              disabled={busy || !canAdmin || detail.active}
              onClick={async () => {
                setError('');
                try {
                  await mutate(`/models/${detail.id}/activate`, 'POST', {});
                  notify('Model activation recorded; previous version retained');
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Activate this model version
              <Check size={15} />
            </button>
          </div>
          <div className="drawer-section">
            <h3>Validate an offline prediction</h3>
            <p className="section-note">
              Provide a JSON array of objects matching the exact feature schema above. No host or
              URL is contacted.
            </p>
            <textarea
              aria-label="Prediction feature rows"
              rows={7}
              value={predict}
              onChange={(e) => setPredict(e.target.value)}
              placeholder='[{"feature_name": 1}]'
            />
            <button
              className="button secondary"
              disabled={busy || !canWrite}
              onClick={async () => {
                setError('');
                try {
                  const parsed = JSON.parse(predict);
                  if (!Array.isArray(parsed))
                    throw new Error('Enter a JSON array of exact feature objects.');
                  setPrediction(
                    await mutate(`/models/${detail.id}/predict`, 'POST', { rows: parsed }),
                  );
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Predict with exact schema
              <ArrowRight size={15} />
            </button>
            {prediction && <pre className="evidence">{JSON.stringify(prediction, null, 2)}</pre>}
          </div>
        </>
      ) : (
        <>
          <Details record={detail} omit={['workspace_id']} />
          {detail.record_type && detail.record_id && (
            <button
              className="button secondary"
              onClick={() => open(detail.record_type, detail.record_id)}
            >
              Open related {label(detail.record_type).toLowerCase()}
              <ArrowUpRight size={15} />
            </button>
          )}
          {kind === 'training_jobs' && (
            <div className="inline">
              {detail.job_id && (
                <button className="button primary" onClick={() => open('jobs', detail.job_id)}>
                  Open training job
                  <ArrowUpRight size={15} />
                </button>
              )}
              {detail.dataset_id && (
                <button
                  className="button secondary"
                  onClick={() => configureDataset(detail.dataset_id, go)}
                >
                  Open dataset configuration
                  <ArrowRight size={15} />
                </button>
              )}
              {detail.model_version_id && (
                <button
                  className="button secondary"
                  onClick={() => open('models', detail.model_version_id)}
                >
                  Open evaluated model
                  <ArrowUpRight size={15} />
                </button>
              )}
            </div>
          )}
          {kind === 'datasets' && (
            <button className="button primary" onClick={() => configureDataset(detail.id, go)}>
              Configure task, permission & mapping
              <ArrowRight size={15} />
            </button>
          )}
          {kind === 'jobs' && detail.dataset_id && (
            <div className="card-footer">
              <button className="text-link" onClick={() => configureDataset(detail.dataset_id, go)}>
                Open linked dataset
                <ArrowRight size={14} />
              </button>
              {detail.result?.model_version_id && (
                <button
                  className="text-link"
                  onClick={() => open('models', detail.result.model_version_id)}
                >
                  Open resulting model
                  <ArrowRight size={14} />
                </button>
              )}
            </div>
          )}
          {kind === 'recommendations' && (
            <button className="button primary full" onClick={() => go('guardian')}>
              Review in Guardian Gate
              <ArrowRight size={15} />
            </button>
          )}
          {kind === 'jobs' && (
            <div className="inline">
              {['queued', 'running'].includes(detail.status) && (
                <button
                  className="button secondary"
                  disabled={busy || !canWrite}
                  onClick={async () => {
                    try {
                      await mutate(`/jobs/${detail.id}/cancel`, 'POST', {});
                      notify('Cancellation requested');
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  Request cancellation
                </button>
              )}
              {detail.status === 'failed' && (
                <button
                  className="button secondary"
                  disabled={busy || !canWrite}
                  onClick={async () => {
                    try {
                      await mutate(`/jobs/${detail.id}/retry`, 'POST', {});
                      notify('Safe retry requested');
                    } catch (e) {
                      setError((e as Error).message);
                    }
                  }}
                >
                  Retry job
                  <RefreshCw size={15} />
                </button>
              )}
            </div>
          )}
        </>
      )}
      {[
        'assets',
        'findings',
        'events',
        'simulations',
        'recommendations',
        'reports',
        'vulnerabilities',
      ].includes(kind) && (
        <div className="drawer-footer">
          <button className="button secondary full" onClick={discuss}>
            <MessageSquare size={16} />
            Discuss this record with the assistant
          </button>
          <p className="section-note">
            Context uses this record identifier. Provider configuration is required for actual AI
            responses.
          </p>
        </div>
      )}
    </Drawer>
  );
}
