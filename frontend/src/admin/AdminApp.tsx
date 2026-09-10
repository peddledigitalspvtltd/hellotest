import { SampleDataSetup as SetupPage } from './SampleDataSetup';
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  IconActivity as Activity, IconArrowRight as ArrowRight, IconBoxMultiple as Boxes,
  IconCheck as Check, IconChevronRight as ChevronRight, IconAlertCircle as CircleAlert,
  IconDatabase as Database, IconExternalLink as ExternalLink, IconAdjustments as Feature,
  IconGauge as Gauge, IconKey as KeyRound, IconLayoutDashboard as LayoutDashboard,
  IconLock as LockKeyhole, IconLogout as LogOut, IconMenu2 as Menu, IconPlugConnected as PlugZap,
  IconRefresh as RefreshCw, IconSearch as Search, IconServerCog as ServerCog,
  IconShieldCheck as ShieldCheck, IconSparkles as Sparkles, IconToggleLeft as ToggleLeft,
  IconToggleRight as ToggleRight, IconUserPlus as UserPlus, IconUsers as Users, IconX as X
} from "@tabler/icons-react";
import {
  adminApi, sessionStore, type AdminSession, type AuditEvent, type FlagSnapshot,
  type Integration, type IntegrationType, type Overview, type Role, type User
} from "./api";
import { createFeatureFlagPatch, effectiveFeatureFlags } from "../lib/featureFlags";

type Section = "overview" | "people" | "setup" | "features" | "integrations" | "audit" | "security";
type LoadState = "idle" | "loading" | "ready" | "error";

const nav: Array<{ id: Section; label: string; icon: ReactNode }> = [
  { id: "overview", label: "Control center", icon: <LayoutDashboard size={19} /> },
  { id: "people", label: "Administrators", icon: <Users size={19} /> },
  { id: "setup", label: "Instance setup", icon: <Database size={19} /> },
  { id: "features", label: "Feature availability", icon: <Feature size={19} /> },
  { id: "integrations", label: "Backend integrations", icon: <PlugZap size={19} /> },
  { id: "audit", label: "Audit activity", icon: <Activity size={19} /> },
  { id: "security", label: "Security", icon: <ShieldCheck size={19} /> }
];

const title: Record<Section, { eyebrow: string; heading: string; copy: string }> = {
  overview: { eyebrow: "Instance command", heading: "Control center", copy: "A live view of launch readiness, platform capacity, and the configuration that keeps HelloTest healthy." },
  people: { eyebrow: "Identity & access", heading: "Administrators", copy: "Onboard trusted operators and keep control-plane access intentional." },
  setup: { eyebrow: "Launch sequence", heading: "Instance setup", copy: "Validate the shared schema and install safe, idempotent sample content module by module." },
  features: { eyebrow: "Release control", heading: "Feature availability", copy: "Manage the capabilities available to your workspace. Published policy applies to API requests immediately; workspace controls refresh automatically." },
  integrations: { eyebrow: "Connected services", heading: "Backend integrations", copy: "Create and govern server-side connections without exposing credentials to the product UI." },
  audit: { eyebrow: "Governance trail", heading: "Audit activity", copy: "Review recent administrator actions across setup, people, flags, and integrations." },
  security: { eyebrow: "Account protection", heading: "Security", copy: "Replace bootstrap credentials and review the runtime boundary for this control plane." }
};

const formatDate = (value?: string) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Never";
const initials = (name?: string, email?: string) => (name || email || "A").split(/[\s@.]+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");

function Toast({ message, tone, onClose }: { message: string; tone: "success" | "error"; onClose: () => void }) {
  return <div className={`toast ${tone}`} role="status"><span>{tone === "success" ? <Check size={17} /> : <CircleAlert size={17} />}</span>{message}<button aria-label="Dismiss notification" onClick={onClose}><X size={16} /></button></div>;
}

function Login({ onAuthenticated }: { onAuthenticated: (session: AdminSession) => void }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<Record<string, unknown> | null>(null);
  useEffect(() => { void adminApi.status().then(setStatus).catch(() => setStatus(null)); }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try { const session = await adminApi.login(username, password); sessionStore.write(session); onAuthenticated(session); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Sign in failed"); }
    finally { setBusy(false); }
  };
  return <main className="login-page">
    <section className="login-story">
      <div className="brand"><span className="brand-mark"><Sparkles size={20} /></span><span>HelloTest <b>Administration</b></span></div>
      <div className="story-copy"><p className="kicker">Your quality platform, composed</p><h1>Launch with clarity.<br /><em>Operate with confidence.</em></h1><p>One secure control plane for the people, data, capabilities, and connected systems behind every HelloTest workspace.</p></div>
      <div className="story-stats"><div><strong>01</strong><span>Shared backend</span></div><div><strong>01</strong><span>Shared database</span></div><div><strong>100%</strong><span>Auditable</span></div></div>
      <div className="orb orb-one" /><div className="orb orb-two" />
    </section>
    <section className="login-panel"><div className="login-card">
      <div className="mobile-brand brand"><span className="brand-mark"><Sparkles size={19} /></span><span>HelloTest <b>Administration</b></span></div>
      <div className="status-pill"><i className={status?.database_ready ? "online" : "offline"} />{status?.database_ready ? "Control plane ready" : "Checking control plane"}</div>
      <h2>Welcome back</h2><p>Sign in with an administrator account to manage this instance.</p>
      <form onSubmit={submit}>
        <label>Username or email<input autoComplete="username" autoFocus value={username} onChange={(event) => setUsername(event.target.value)} /></label>
        <label>Password<div className="input-with-icon"><LockKeyhole size={17} /><input autoComplete="current-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></div></label>
        {error ? <div className="form-error"><CircleAlert size={16} />{error}</div> : null}
        <button className="primary-button login-button" disabled={busy}>{busy ? "Signing in…" : "Enter administration"}<ArrowRight size={18} /></button>
      </form>
      {status?.bootstrap_login_enabled ? <div className="bootstrap-note"><KeyRound size={18} /><div><strong>New instance access</strong><span>Use admin / admin, then replace the password from Security.</span></div></div> : null}
      <small className="login-foot">Separate portal · Same HelloTest backend and PostgreSQL data</small>
    </div></section>
  </main>;
}

function Metric({ label, value, detail, icon }: { label: string; value: string | number; detail: string; icon: ReactNode }) {
  return <article className="metric-card"><div className="metric-icon">{icon}</div><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function OverviewPage({ data, onNavigate }: { data: Overview; onNavigate: (section: Section) => void }) {
  const completion = Math.round(((data.schema.status === "ready" ? 1 : 0) + (data.metrics.administrators > 1 ? 1 : 0) + (data.metrics.active_integrations > 0 ? 1 : 0) + (data.metrics.enabled_features > 0 ? 1 : 0)) / 4 * 100);
  return <>
    <div className="metrics-grid">
      <Metric label="Launch readiness" value={`${completion}%`} detail={data.schema.status === "ready" ? "Schema is current" : "Schema needs attention"} icon={<Gauge />} />
      <Metric label="Administrators" value={data.metrics.administrators} detail={`${data.metrics.users} total workspace users`} icon={<Users />} />
      <Metric label="Active integrations" value={data.metrics.active_integrations} detail={`${data.metrics.integrations} configured`} icon={<PlugZap />} />
      <Metric label="Available features" value={`${data.metrics.enabled_features}/${data.metrics.total_features}`} detail="Across all product modules" icon={<Boxes />} />
    </div>
    <div className="dashboard-grid">
      <section className="surface readiness-panel"><div className="surface-heading"><div><p className="kicker">Launch path</p><h3>Instance readiness</h3></div><span className={`health-badge ${completion === 100 ? "good" : "warn"}`}>{completion === 100 ? "Ready" : "In progress"}</span></div>
        {[
          ["Database schema", data.schema.status === "ready", `${data.schema.available_tables}/${data.schema.required_tables} required tables`, "setup"],
          ["Administrator coverage", data.metrics.administrators > 1, data.metrics.administrators > 1 ? "Backup administrator onboarded" : "Add a second administrator", "people"],
          ["Feature policy", data.metrics.enabled_features > 0, `${data.metrics.enabled_features} capabilities available`, "features"],
          ["Service integrations", data.metrics.active_integrations > 0, data.metrics.active_integrations ? `${data.metrics.active_integrations} active connections` : "No active connections", "integrations"]
        ].map(([label, done, detail, section]) => <button className="check-row" key={String(label)} onClick={() => onNavigate(section as Section)}><span className={done ? "check done" : "check"}>{done ? <Check size={15} /> : null}</span><div><strong>{label}</strong><small>{detail}</small></div><ChevronRight size={18} /></button>)}
      </section>
      <section className="surface runtime-panel"><div className="surface-heading"><div><p className="kicker">Runtime</p><h3>Deployment boundary</h3></div><ServerCog size={24} /></div>
        <div className="runtime-map"><div className="runtime-node main"><span>ADMIN</span><strong>Control plane</strong><small>:{data.runtime.admin_port}</small></div><div className="connector" /><div className="runtime-children"><div className="runtime-node"><span>API</span><strong>Shared backend</strong><small>:{data.runtime.api_port}</small></div><div className="runtime-node"><span>DB</span><strong>PostgreSQL</strong><small>Shared data</small></div></div></div>
        <dl className="runtime-facts">{Object.entries(data.runtime).slice(0, 4).map(([key, value]) => <div key={key}><dt>{key.split("_").join(" ")}</dt><dd>{String(value)}</dd></div>)}</dl>
      </section>
    </div>
  </>;
}

function PeoplePage({ session, notify }: { session: AdminSession; notify: (message: string, tone?: "success" | "error") => void }) {
  const [users, setUsers] = useState<User[]>([]); const [roles, setRoles] = useState<Role[]>([]); const [showForm, setShowForm] = useState(false); const [search, setSearch] = useState("");
  const load = useCallback(async () => { const [nextUsers, nextRoles] = await Promise.all([adminApi.users(), adminApi.roles()]); setUsers(nextUsers); setRoles(nextRoles); }, []);
  useEffect(() => { void load(); }, [load]);
  const admins = users.filter((user) => user.role === "admin" && `${user.name} ${user.email}`.toLowerCase().includes(search.toLowerCase()));
  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget); const adminRole = roles.find((role) => role.name.toLowerCase() === "admin");
    if (!adminRole) return notify("Admin role is missing. Apply the schema setup first.", "error");
    try { await adminApi.createAdmin({ name: String(form.get("name")), email: String(form.get("email")), password: String(form.get("password")), role_id: adminRole.id }); notify("Administrator onboarded."); setShowForm(false); await load(); }
    catch (reason) { notify(reason instanceof Error ? reason.message : "Could not create administrator", "error"); }
  };
  const toggleStatus = async (user: User) => { try { await adminApi.setUserStatus(user.id, user.status === "suspended" ? "active" : "suspended"); notify(user.status === "suspended" ? "Administrator reactivated." : "Administrator suspended."); await load(); } catch (reason) { notify(reason instanceof Error ? reason.message : "Status update failed", "error"); } };
  return <section className="surface table-surface"><div className="toolbar"><div className="search"><Search size={17} /><input placeholder="Search administrators" value={search} onChange={(event) => setSearch(event.target.value)} /></div><button className="primary-button" onClick={() => setShowForm(true)}><UserPlus size={17} />Onboard admin</button></div>
    <div className="table-wrap"><table><thead><tr><th>Administrator</th><th>Status</th><th>Access</th><th>Last login</th><th /></tr></thead><tbody>{admins.map((user) => <tr key={user.id}><td><div className="person"><span className="avatar">{initials(user.name, user.email)}</span><div><strong>{user.name || "Unnamed administrator"}</strong><small>{user.email}</small></div></div></td><td><span className={`status-label ${user.status === "suspended" ? "muted" : "active"}`}><i />{user.status || "active"}</span></td><td><span className="role-chip">Workspace admin</span></td><td>{formatDate(user.last_login_at)}</td><td><button className="text-button" disabled={user.id === session.user.id} onClick={() => void toggleStatus(user)}>{user.status === "suspended" ? "Reactivate" : "Suspend"}</button></td></tr>)}</tbody></table></div>
    {showForm ? <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setShowForm(false)}><form className="modal" onSubmit={create}><div className="modal-head"><div><p className="kicker">Trusted operator</p><h3>Onboard administrator</h3></div><button type="button" onClick={() => setShowForm(false)}><X /></button></div><p>New administrators receive workspace-wide access and membership in current projects.</p><label>Full name<input name="name" required minLength={2} placeholder="e.g. Priya Sharma" /></label><label>Work email<input name="email" required type="email" placeholder="priya@company.com" /></label><label>Temporary password<input name="password" required minLength={8} type="password" placeholder="At least 8 characters" /></label><div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setShowForm(false)}>Cancel</button><button className="primary-button">Create administrator</button></div></form></div> : null}
  </section>;
}

function FeaturesPage({ notify }: { notify: (message: string, tone?: "success" | "error") => void }) {
  const [snapshot, setSnapshot] = useState<FlagSnapshot | null>(null);
  const [draft, setDraft] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoadState("loading");
    setError("");
    void adminApi.flags({ signal: controller.signal }).then((value) => {
      if (controller.signal.aborted) return;
      setSnapshot(value);
      setDraft(value.local_flags || value.flags);
      setLoadState("ready");
    }).catch((reason: unknown) => {
      if (controller.signal.aborted) return;
      setError(reason instanceof Error ? reason.message : "Feature availability could not be loaded.");
      setLoadState("error");
    });
    return () => controller.abort();
  }, [reload]);

  const patch = snapshot ? createFeatureFlagPatch(snapshot.local_flags || snapshot.flags, draft) : {};
  const changes = Object.keys(patch).length;
  const effective = effectiveFeatureFlags(draft, snapshot?.dependencies);
  const labels = new Map(snapshot?.groups.flatMap((group) => group.features.map((feature) => [feature.key, feature.label] as const)) || []);
  const filteredGroups = snapshot?.groups.map((group) => ({ ...group, features: group.features.filter((feature) =>
    `${feature.label} ${feature.description || ""} ${feature.key} ${(feature.routes || []).join(" ")}`.toLowerCase().includes(search.trim().toLowerCase())
  ) })).filter((group) => group.features.length) || [];

  const save = async () => {
    if (!snapshot || !changes || busy) return;
    setBusy(true);
    try {
      const result = await adminApi.updateFlags(patch);
      setSnapshot({ ...snapshot, local_flags: result.flags, flags: effectiveFeatureFlags(result.flags, snapshot.dependencies) });
      setDraft(result.flags);
      notify(`${changes} feature change${changes === 1 ? "" : "s"} published.`);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Feature update failed. Your changes are retained.", "error");
    } finally {
      setBusy(false);
    }
  };

  if (loadState === "loading") return <section className="surface loading" role="status"><RefreshCw className="spin" aria-hidden="true" /><span>Loading feature availability…</span></section>;
  if (loadState === "error") return <section className="surface empty-state" role="alert"><CircleAlert aria-hidden="true" /><h3>Feature availability is unavailable</h3><p>{error}</p><button className="secondary-button" onClick={() => setReload((value) => value + 1)} type="button">Try again</button></section>;

  return <>
    <div className="feature-toolbar">
      <div className="search"><Search size={17} aria-hidden="true" /><input aria-label="Find a capability" placeholder="Find a capability" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
      <div><span role="status">{changes ? `${changes} unpublished change${changes === 1 ? "" : "s"}` : "All changes published"}</span>
        {changes ? <button className="secondary-button" disabled={busy} onClick={() => setDraft(snapshot?.local_flags || snapshot?.flags || {})} type="button">Discard changes</button> : null}
        <button className="primary-button" disabled={!changes || busy} onClick={() => void save()} type="button">{busy ? "Publishing…" : "Publish changes"}</button>
      </div>
    </div>
    <div className="flag-groups">{filteredGroups.map((group) => <section className="surface flag-group" key={group.key}>
      <div className="flag-group-head"><div><h3>{group.label}</h3><p>{group.description}</p></div><span>{group.features.filter((feature) => effective[feature.key]).length}/{group.features.length} available</span></div>
      <div>{group.features.map((feature) => {
        const missingDependencies = (snapshot?.dependencies?.[feature.key] || []).filter((key) => !draft[key]);
        return <button aria-pressed={Boolean(draft[feature.key])} className="flag-row" disabled={busy} key={feature.key} onClick={() => setDraft((current) => ({ ...current, [feature.key]: !current[feature.key] }))} type="button">
          <div><strong>{feature.label}</strong>{feature.description ? <span>{feature.description}</span> : null}
            {draft[feature.key] && missingDependencies.length ? <span className="flag-dependency">Unavailable until {missingDependencies.map((key) => labels.get(key) || key).join(", ")} is enabled.</span> : null}
            <small>{feature.key}</small>
          </div><span aria-hidden="true" className={`toggle ${draft[feature.key] ? "on" : ""}`}>{draft[feature.key] ? <ToggleRight /> : <ToggleLeft />}</span>
        </button>;
      })}</div>
    </section>)}</div>
    {!filteredGroups.length ? <section className="surface empty-state"><Search aria-hidden="true" /><h3>No matching capabilities</h3><p>Try a feature name, task or page.</p><button className="secondary-button" onClick={() => setSearch("")} type="button">Clear search</button></section> : null}
  </>;
}

function IntegrationsPage({ notify }: { notify: (message: string, tone?: "success" | "error") => void }) {
  const [items, setItems] = useState<Integration[]>([]); const [types, setTypes] = useState<IntegrationType[]>([]); const [showForm, setShowForm] = useState(false); const [search, setSearch] = useState("");
  const load = useCallback(async () => { const [connections, availableTypes] = await Promise.all([adminApi.integrations(), adminApi.integrationTypes()]); setItems(connections); setTypes(availableTypes); }, []);
  useEffect(() => { void load(); }, [load]);
  const create = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); const form = new FormData(event.currentTarget); let config = {}; try { config = JSON.parse(String(form.get("config") || "{}")); } catch { return notify("Advanced configuration must be valid JSON.", "error"); } try { await adminApi.createIntegration({ type: form.get("type"), name: form.get("name"), base_url: form.get("base_url") || undefined, api_key: form.get("api_key") || undefined, model: form.get("model") || undefined, config, is_active: true }); notify("Backend integration created."); setShowForm(false); await load(); } catch (reason) { notify(reason instanceof Error ? reason.message : "Integration creation failed", "error"); } };
  const remove = async (item: Integration) => { if (!confirm(`Delete ${item.name}?`)) return; try { await adminApi.deleteIntegration(item.id); notify("Integration removed."); await load(); } catch (reason) { notify(reason instanceof Error ? reason.message : "Could not delete integration", "error"); } };
  const filtered = items.filter((item) => `${item.name} ${item.type}`.toLowerCase().includes(search.toLowerCase()));
  return <><div className="toolbar"><div className="search"><Search size={17} /><input placeholder="Search integrations" value={search} onChange={(event) => setSearch(event.target.value)} /></div><button className="primary-button" onClick={() => setShowForm(true)}><PlugZap size={17} />Create integration</button></div><div className="integration-grid">{filtered.map((item) => <article className="surface integration-card" key={item.id}><div className="integration-top"><span className="integration-logo">{item.type.slice(0, 2).toUpperCase()}</span><span className={`status-label ${item.is_active ? "active" : "muted"}`}><i />{item.is_active ? "Active" : "Inactive"}</span></div><h3>{item.name}</h3><p>{types.find((type) => type.value === item.type)?.description || item.type}</p><div className="integration-meta"><span>{item.type.split("_").join(" ")}</span><span>{item.base_url || item.model || "Server managed"}</span></div><div className="card-actions"><button className="text-button danger" onClick={() => void remove(item)}>Delete</button></div></article>)}</div>
    {!filtered.length ? <div className="empty-state"><PlugZap size={32} /><h3>No integrations found</h3><p>Create a backend connection for AI, issue tracking, identity, storage, or execution.</p></div> : null}
    {showForm ? <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setShowForm(false)}><form className="modal wide" onSubmit={create}><div className="modal-head"><div><p className="kicker">Server-side connection</p><h3>Create integration</h3></div><button type="button" onClick={() => setShowForm(false)}><X /></button></div><div className="form-grid"><label>Integration type<select name="type" required>{types.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label><label>Display name<input name="name" required minLength={2} placeholder="Production provider" /></label><label className="full">Base URL <span>optional</span><input name="base_url" type="url" placeholder="https://api.example.com" /></label><label>API key <span>encrypted boundary</span><input name="api_key" type="password" /></label><label>Model <span>for AI providers</span><input name="model" placeholder="e.g. gpt-5" /></label><label className="full">Advanced configuration <span>JSON</span><textarea name="config" defaultValue="{}" rows={5} /></label></div><div className="modal-actions"><button className="secondary-button" type="button" onClick={() => setShowForm(false)}>Cancel</button><button className="primary-button">Create connection</button></div></form></div> : null}</>;
}

function AuditPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]); useEffect(() => { void adminApi.audit().then(setEvents); }, []);
  return <section className="surface audit-surface"><div className="timeline">{events.map((event) => <div className="timeline-event" key={event.id}><span className="timeline-dot"><Activity size={15} /></span><div><div><strong>{event.summary}</strong><time>{formatDate(event.created_at)}</time></div><p>{event.actor_name || event.actor_email || "System administrator"} · {event.action.split("_").join(" ")}</p>{event.target_type ? <span className="target-chip">{event.target_type}</span> : null}</div></div>)}</div>{!events.length ? <div className="empty-state"><Activity size={30} /><h3>No administrator activity yet</h3><p>Control-plane changes will appear here.</p></div> : null}</section>;
}

function SecurityPage({ session, notify, onRefresh }: { session: AdminSession; notify: (message: string, tone?: "success" | "error") => void; onRefresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const next = String(form.get("new_password"));
    if (next !== String(form.get("confirm_password"))) {
      notify("New passwords do not match.", "error");
      return;
    }

    setBusy(true);
    try {
      await adminApi.changePassword(session.user.id, String(form.get("current_password")), next);
      formElement.reset();
      await onRefresh();
      notify("Administrator password replaced.");
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : "Password update failed", "error");
    } finally {
      setBusy(false);
    }
  };
  return <div className="security-grid"><section className="surface password-card"><div className="setup-icon"><LockKeyhole /></div><p className="kicker">Credentials</p><h3>Replace administrator password</h3><p>{session.user.must_change_password ? "This account is still using its bootstrap credential. Replace it before regular operation." : "Use a unique password reserved for this administration portal."}</p><form onSubmit={submit}><label>Current password<input disabled={busy} name="current_password" required type="password" /></label><label>New password<input disabled={busy} name="new_password" required minLength={8} type="password" /></label><label>Confirm new password<input disabled={busy} name="confirm_password" required minLength={8} type="password" /></label><button className="primary-button" disabled={busy}>{busy ? "Updating…" : "Update password"}</button></form></section><section className="surface boundary-card"><p className="kicker">Security boundary</p><h3>Control-plane protections</h3>{[["Administrator-only APIs", "Every mutable control route verifies workspace-admin status."], ["Masked credentials", "Integration secrets are never returned to this portal after save."], ["Dedicated session", "The admin portal uses its own local browser session namespace."], ["Audit trail", "Setup and governance mutations record actor and time."]].map(([heading, copy]) => <div className="protection" key={heading}><span><ShieldCheck size={18} /></span><div><strong>{heading}</strong><p>{copy}</p></div></div>)}</section></div>;
}

export function AdminApp() {
  const [session, setSession] = useState<AdminSession | null>(() => sessionStore.read()); const [section, setSection] = useState<Section>("overview"); const [overview, setOverview] = useState<Overview | null>(null); const [state, setState] = useState<LoadState>("idle"); const [sidebarOpen, setSidebarOpen] = useState(false); const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);
  const notify = (message: string, tone: "success" | "error" = "success") => { setToast({ message, tone }); window.setTimeout(() => setToast(null), 4200); };
  const loadOverview = useCallback(async () => { if (!sessionStore.read()) return; setState("loading"); try { setOverview(await adminApi.overview()); setState("ready"); } catch { setState("error"); } }, []);
  useEffect(() => { if (session) void loadOverview(); }, [session, loadOverview]);
  const refreshSession = async () => { try { const next = await adminApi.session(); sessionStore.write(next); setSession(next); } catch { /* current page already explains any failure */ } };
  const activeMeta = title[section];
  const content = useMemo(() => { if (!overview) return null; if (section === "overview") return <OverviewPage data={overview} onNavigate={setSection} />; if (section === "people" && session) return <PeoplePage session={session} notify={notify} />; if (section === "setup") return <SetupPage schema={overview.schema} notify={notify} refresh={() => void loadOverview()} />; if (section === "features") return <FeaturesPage notify={notify} />; if (section === "integrations") return <IntegrationsPage notify={notify} />; if (section === "audit") return <AuditPage />; if (section === "security" && session) return <SecurityPage session={session} notify={notify} onRefresh={refreshSession} />; return null; }, [overview, section, session, loadOverview]);
  if (!session) return <Login onAuthenticated={setSession} />;
  const logout = () => { sessionStore.clear(); setSession(null); };
  return <div className="admin-shell">
    <aside className={sidebarOpen ? "sidebar open" : "sidebar"}><div className="brand sidebar-brand"><span className="brand-mark"><Sparkles size={19} /></span><span>HelloTest <b>Admin</b></span><button aria-label="Close administration navigation" className="mobile-close" onClick={() => setSidebarOpen(false)}><X /></button></div><div className="instance-chip"><span>H</span><div><strong>HelloTest instance</strong><small><i /> Operational</small></div></div><nav>{nav.map((item) => <button className={section === item.id ? "active" : ""} key={item.id} onClick={() => { setSection(item.id); setSidebarOpen(false); }}>{item.icon}<span>{item.label}</span>{section === item.id ? <ChevronRight size={16} /> : null}</button>)}</nav><div className="sidebar-foot"><a href="http://localhost:5173" target="_blank" rel="noreferrer"><ExternalLink size={17} />Open HelloTest workspace</a><button onClick={logout}><LogOut size={17} />Sign out</button></div></aside>
    {sidebarOpen ? <div className="sidebar-scrim" onClick={() => setSidebarOpen(false)} /> : null}
    <main className="admin-main"><header className="topbar"><button aria-label="Open administration navigation" aria-expanded={sidebarOpen} className="menu-button" onClick={() => setSidebarOpen(true)}><Menu /></button><div className="breadcrumb"><span>Administration</span><ChevronRight size={15} /><strong>{activeMeta.heading}</strong></div><div className="top-actions"><button className="icon-button" onClick={() => void loadOverview()} title="Refresh"><RefreshCw size={18} /></button><button className="profile-button" onClick={() => setSection("security")}><span>{initials(session.user.name, session.user.email)}</span><div><strong>{session.user.name || "Administrator"}</strong><small>Workspace admin</small></div></button></div></header>
      {session.user.must_change_password ? <button className="security-banner" onClick={() => setSection("security")}><CircleAlert size={18} /><span><strong>Bootstrap password in use.</strong> Replace it now to secure this instance.</span><ArrowRight size={18} /></button> : null}
      <div className="page"><header className="page-heading"><div><p className="kicker">{activeMeta.eyebrow}</p><h1>{activeMeta.heading}</h1><p>{activeMeta.copy}</p></div>{section === "overview" ? <span className={`health-badge ${overview?.status === "operational" ? "good" : "warn"}`}><i />{overview?.status || "Checking"}</span> : null}</header>
        {state === "loading" && !overview ? <div className="loading"><RefreshCw className="spin" />Loading control plane…</div> : state === "error" && !overview ? <div className="empty-state"><CircleAlert /><h3>Control plane unavailable</h3><p>Confirm the backend and PostgreSQL are running, then retry.</p><button className="primary-button" onClick={() => void loadOverview()}>Retry</button></div> : content}
      </div>
    </main>{toast ? <Toast {...toast} onClose={() => setToast(null)} /> : null}
  </div>;
}
