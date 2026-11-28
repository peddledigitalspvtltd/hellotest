import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { IconCopy, IconKey, IconPlus, IconTrash } from "@tabler/icons-react";
import { DialogCloseButton } from "@hellotest/platform/frontend/src/shared/components/DialogCloseButton";
import { useDialogFocus } from "@hellotest/platform/frontend/src/shared/hooks/useDialogFocus";
import { agenticApi, MCP_CREDENTIAL_LIFETIMES, type McpBuiltinServer, type McpCredentialInput, type McpCredentialLifetime, type McpIssuedHostCredential } from "../api.client";
import { McpToolCatalog } from "./McpToolCatalog";

const sections = [
  ["connect", "Connect"], ["tools", "Tools"], ["access", "Access tokens"], ["plans", "Action plans"]
] as const;
type ServerSection = typeof sections[number][0];
type ServerView = ServerSection | "create" | "receipt";
type Feedback = { kind: "error" | "status"; message: string };
type CopyFeedback = { field: "endpoint" | "token"; kind: "error" | "status" };

function exactReceipt(row: McpIssuedHostCredential, requested: McpCredentialInput) {
  const lifetime = Date.parse(row.expires_at) - Date.parse(row.issued_at);
  const names = Array.isArray(row.tool_names) ? new Set(row.tool_names) : null;
  return typeof row.token === "string" && row.token.length > 0 && lifetime === requested.expires_in * 1000
    && names?.size === requested.tool_names.length && requested.tool_names.every(name => names.has(name));
}

function ConnectedHostDetails({ server }: { server: McpBuiltinServer }) {
  const contract = server.client_contract;
  const discovery = server.discovery;
  if (!contract) return null;
  return <details className="mcp-panel-disclosure">
    <summary>Client connection contract</summary>
    <div className="mcp-disclosure-body">
      <dl className="mcp-connection-details">
        <div><dt>Transport</dt><dd>{contract.stateless ? "Stateless Streamable HTTP" : "Streamable HTTP"}</dd></div>
        {server.protocol_versions?.length ? <div><dt>Protocol revisions</dt><dd>{server.protocol_versions.join(", ")}</dd></div> : null}
        <div><dt>Accept header</dt><dd><code>{contract.accept}</code></dd></div>
        {server.authentication ? <div><dt>Authentication</dt><dd>{server.authentication}</dd></div> : null}
        {discovery?.resources.length ? <div><dt>Resources</dt><dd>{discovery.resources.join(", ")}</dd></div> : null}
        {discovery?.resource_templates.length ? <div><dt>Resource templates</dt><dd>{discovery.resource_templates.join(", ")}</dd></div> : null}
        {discovery?.prompts.length ? <div><dt>Prompts</dt><dd>{discovery.prompts.join(", ")}</dd></div> : null}
      </dl>
      {contract.oauth_supported ? <div className="mcp-oauth-discovery-links">
        {contract.oauth_authorization_server_metadata ? <a href={contract.oauth_authorization_server_metadata} target="_blank" rel="noreferrer">Authorization server metadata</a> : null}
        {contract.oauth_resource_metadata ? <a href={contract.oauth_resource_metadata} target="_blank" rel="noreferrer">Protected resource metadata</a> : null}
      </div> : null}
      <p className="mcp-muted">Use an endpoint the host can reach. In containers, localhost refers to the host container.</p>
    </div>
  </details>;
}

export function McpBuiltinServerDialog({ projectId, server, onClose }: { projectId: string; server: McpBuiltinServer; onClose: () => void }) {
  const [view, setView] = useState<ServerView>("connect");
  const [selectedNames, setSelectedNames] = useState<Set<string>>(() => new Set());
  const [expiry, setExpiry] = useState<McpCredentialLifetime>(3600);
  const [issued, setIssued] = useState<McpIssuedHostCredential | null>(null);
  const [visibleSecret, setVisibleSecret] = useState(false);
  const [connection, setConnection] = useState<Feedback | null>(null);
  const [notice, setNotice] = useState<Feedback | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const copyVersion = useRef(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const focusAfterChange = useRef(false);
  const expiryRef = useRef<HTMLSelectElement>(null);
  const receiptRef = useRef<HTMLHeadingElement>(null);
  const formId = useId();
  const headingId = useId();

  const contract = server.client_contract;
  const endpoint = new URL(server.endpoint, window.location.origin).href;
  const toolSets = server.tool_sets || [];
  const availableTools = server.tools.filter(tool => tool.credential_selectable !== false);
  const availableNames = new Set(availableTools.map(tool => tool.name));
  const expiryOptions = MCP_CREDENTIAL_LIFETIMES.filter(option => contract?.credential_expiry_options_seconds?.includes(option.seconds));
  const manualSupported = contract?.credential_issuance_enabled === true;
  const canIssue = manualSupported && expiryOptions.length > 0 && availableTools.length > 0;
  const currentExpiry = expiryOptions.some(option => option.seconds === expiry) ? expiry : expiryOptions[0]?.seconds;
  const exactSelection = Array.from(selectedNames).filter(name => availableNames.has(name)).sort();
  const selectedAction = availableTools.some(tool => !tool.read_only && selectedNames.has(tool.name));
  const activeSection = view === "create" || view === "receipt" ? "access" : view;
  const credentials = useQuery({ queryKey: ["mcp-credentials", projectId], queryFn: () => agenticApi.mcp.credentials(projectId), enabled: activeSection === "access" });
  const plans = useQuery({ queryKey: ["mcp-plans", projectId], queryFn: () => agenticApi.mcp.plans(projectId), enabled: view === "plans", refetchInterval: view === "plans" ? 5000 : false });

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
    if (!focusAfterChange.current) return;
    focusAfterChange.current = false;
    if (view === "create") expiryRef.current?.focus({ preventScroll: true });
    else if (view === "receipt") receiptRef.current?.focus({ preventScroll: true });
    else navRef.current?.querySelector<HTMLButtonElement>('button[aria-current="page"]')?.focus({ preventScroll: true });
  }, [view]);
  useEffect(() => () => { copyVersion.current++; clearTimeout(copyTimer.current); }, []);

  const reportError = (error: Error) => setNotice({ kind: "error", message: error.message });
  const navigate = (destination: ServerView) => {
    setNotice(null);
    setIssued(null);
    setVisibleSecret(false);
    copyVersion.current++;
    clearTimeout(copyTimer.current);
    setCopyFeedback(null);
    focusAfterChange.current = true;
    setView(destination);
  };
  const begin = () => {
    setSelectedNames(new Set());
    setExpiry(3600);
    navigate("create");
  };

  const issue = useMutation({
    gcTime: 0,
    mutationFn: async (input: McpCredentialInput) => {
      const row = await agenticApi.mcp.issue(projectId, input);
      if (!exactReceipt(row, input)) {
        // Withhold the secret if a gateway cannot confirm that it enforced the selected scope.
        try { await agenticApi.mcp.revoke(projectId, row.id); }
        catch { throw new Error("The server could not confirm the token scope or expiry. Revoke the latest token in Access tokens."); }
        throw new Error("The server could not confirm the token scope or expiry. The token was revoked.");
      }
      navigate("receipt");
      setIssued(row);
    },
    onMutate: () => setNotice(null),
    onSuccess: () => { void credentials.refetch(); },
    onError: error => { reportError(error); void credentials.refetch(); }
  });
  const check = useMutation({
    mutationFn: () => agenticApi.mcp.status(projectId),
    onMutate: () => setConnection(null),
    onSuccess: row => {
      const external = row.external_transport;
      const warning = external?.public_endpoint_configured === false ? " Cloud hosts need a configured public MCP URL."
        : external?.request_host_allowed === false ? " This gateway Host is blocked for external MCP."
        : external?.request_origin_allowed === false ? " This request origin is blocked for external MCP." : "";
      setConnection({ kind: "status", message: `Connected. ${row.tool_count} tools available for your project session.${warning}` });
    },
    onError: error => setConnection({ kind: "error", message: error.message })
  });
  const revoke = useMutation({ mutationFn: (id: string) => agenticApi.mcp.revoke(projectId, id), onSuccess: () => {
    setNotice({ kind: "status", message: "Token revoked." });
    void credentials.refetch();
  }, onError: reportError });
  const approve = useMutation({ mutationFn: (plan: { id: string; digest: string }) => agenticApi.mcp.authorize(projectId, plan.id, plan.digest), onSuccess: () => {
    setNotice({ kind: "status", message: "This exact plan is authorized. The host can execute it once." });
    void plans.refetch();
  }, onError: reportError });
  const dialogRef = useDialogFocus<HTMLDivElement>({ closeDisabled: issue.isPending, onClose });

  async function copy(field: CopyFeedback["field"], value: string) {
    const version = ++copyVersion.current;
    clearTimeout(copyTimer.current);
    try {
      await navigator.clipboard.writeText(value);
      if (version !== copyVersion.current) return;
      setCopyFeedback({ field, kind: "status" });
      copyTimer.current = setTimeout(() => setCopyFeedback(null), 2000);
    } catch {
      if (version === copyVersion.current) setCopyFeedback({ field, kind: "error" });
    }
  }

  const changeTools = (names: string[], selected: boolean) => setSelectedNames(current => {
    const next = new Set(current);
    for (const name of names) {
      if (selected) next.add(name);
      else next.delete(name);
    }
    return next;
  });
  const submitReady = canIssue && currentExpiry !== undefined && exactSelection.length > 0 && exactSelection.length === selectedNames.size;

  return <div className="modal-backdrop mcp-server-backdrop" onClick={() => { if (!issue.isPending) onClose(); }}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={headingId} className="modal-card mcp-server-dialog mcp-server-dialog--builtin" onClick={event => event.stopPropagation()} tabIndex={-1}>
      <header className="mcp-dialog-header">
        <h2 id={headingId}>HelloTest MCP server</h2>
        <DialogCloseButton disabled={issue.isPending} onClick={onClose} />
      </header>
      <nav ref={navRef} className="mcp-server-sections" aria-label="Server sections">
        {sections.map(([key, label]) => <button key={key} type="button" disabled={issue.isPending} aria-current={activeSection === key ? "page" : undefined}
          onClick={() => { if (activeSection !== key || view !== key) navigate(key); }}>{label}</button>)}
      </nav>
      <div ref={bodyRef} className="mcp-server-dialog-body">
        {view === "connect" ? <div className="mcp-view">
          <section className="mcp-dialog-block" aria-label="Endpoint">
            <h3>Server endpoint</h3>
            <div className="mcp-value-line">
              <code>{endpoint}</code>
              <button className="ghost-button compact" type="button" onClick={() => void copy("endpoint", endpoint)}><IconCopy size={15} aria-hidden="true" />{copyFeedback?.field === "endpoint" && copyFeedback.kind === "status" ? "Copied" : "Copy endpoint"}</button>
            </div>
            {copyFeedback?.field === "endpoint" && copyFeedback.kind === "error" ? <p className="mcp-feedback is-error" role="alert">Could not copy. Select the endpoint and copy it manually.</p> : null}
            <button className="ghost-button compact mcp-self-start" type="button" disabled={check.isPending} onClick={() => check.mutate()}>{check.isPending ? "Checking…" : "Check connection status"}</button>
            {connection ? <p className={`mcp-connection-status mcp-feedback${connection.kind === "error" ? " is-error" : ""}`} role={connection.kind === "error" ? "alert" : "status"}>{connection.message}</p> : null}
          </section>
          <section className="mcp-dialog-block" aria-label="Host access">
            <h3>Connect a host</h3>
            <p className="mcp-muted">{contract?.oauth_supported ? "OAuth with PKCE is active. Choose HelloTest in your host’s sign-in flow." : "HelloTest uses your signed-in project session. External hosts need a delegated token or OAuth."}</p>
            {canIssue ? <button className="primary-button compact mcp-self-start" type="button" onClick={begin}><IconKey size={15} aria-hidden="true" />Create access token</button> : null}
          </section>
          <ConnectedHostDetails server={server} />
        </div> : null}

        {view === "tools" ? <div className="mcp-view"><McpToolCatalog tools={server.tools} toolSets={toolSets} /></div> : null}

        {view === "access" ? <div className="mcp-view">
          <div className="mcp-section-title">
            <h3>Access tokens</h3>
            {canIssue ? <button className="primary-button compact" type="button" onClick={begin}><IconPlus size={15} aria-hidden="true" />Create access token</button> : null}
          </div>
          {!canIssue ? <p className="mcp-muted">{manualSupported ? "Scoped token creation requires a compatible MCP server and available tools." : contract?.oauth_supported ? "Connect through your host’s HelloTest sign-in to grant access." : "External access is available when OAuth is configured."}</p> : null}
          {credentials.isPending ? <p className="mcp-muted" role="status">Loading access tokens…</p> : null}
          {credentials.isError ? <div className="mcp-inline-actions"><p className="mcp-feedback is-error" role="alert">Access tokens could not be loaded.</p><button className="ghost-button compact" type="button" onClick={() => void credentials.refetch()}>Retry</button></div> : null}
          {credentials.data?.length === 0 ? <p className="mcp-muted">No access tokens yet.</p> : null}
          <div className="mcp-record-list">
            {credentials.data?.map(row => {
              const expires = new Date(row.expires_at);
              return <article className="mcp-credential-row" key={row.id}>
                <div>
                  <strong title={row.client_id}>{row.client_id}</strong>
                  <p className="mcp-muted">{row.revoked_at ? "Revoked" : expires <= new Date() ? "Expired" : `Expires ${expires.toLocaleString()}`}</p>
                  {row.tool_names?.length ? <details className="mcp-record-details"><summary>{row.tool_names.length} {row.tool_names.length === 1 ? "tool" : "tools"}</summary><ul>{row.tool_names.map(name => <li key={name}><code>{name}</code></li>)}</ul></details>
                    : row.scopes?.length ? <p className="mcp-muted">{row.scopes.map(scope => toolSets.find(set => set.id === scope)?.title || scope).join(" · ")}</p> : null}
                </div>
                {!row.revoked_at ? <button aria-label={`Revoke ${row.client_id}`} title="Revoke access token" className="ghost-button compact" type="button" disabled={revoke.isPending} onClick={() => revoke.mutate(row.id)}><IconTrash size={16} aria-hidden="true" /></button> : null}
              </article>;
            })}
          </div>
        </div> : null}

        {view === "create" ? <form className="mcp-view mcp-token-form" id={formId} onSubmit={event => {
          event.preventDefault();
          if (submitReady && currentExpiry && !issue.isPending) issue.mutate({ expires_in: currentExpiry, tool_names: exactSelection });
        }}>
          <div className="mcp-section-title">
            <div><h3>Create access token</h3><p className="mcp-muted">Select the tools this host can use in this project.</p></div>
            <label className="form-field mcp-token-expiry"><span>Token expiry</span><select aria-label="Token expiry" ref={expiryRef} value={currentExpiry ?? ""} disabled={issue.isPending} onChange={event => {
              const next = expiryOptions.find(option => option.seconds === Number(event.target.value));
              if (next) setExpiry(next.seconds);
            }}>{expiryOptions.map(option => <option key={option.seconds} value={option.seconds}>{option.label}</option>)}</select></label>
          </div>
          {selectedAction ? <p className="mcp-muted">Running a reviewed plan requires your approval and the Execute plan tool.</p> : null}
          <McpToolCatalog tools={availableTools} toolSets={toolSets} selection={{ names: selectedNames, onChange: changeTools, disabled: issue.isPending }} />
        </form> : null}

        {view === "receipt" && issued ? <section className="mcp-view" aria-label="Token receipt">
          <h3 ref={receiptRef} tabIndex={-1}>Access token created</h3>
          <p className="mcp-muted">Shown once. Expires {new Date(issued.expires_at).toLocaleString()}.</p>
          <label className="form-field"><span>Access token</span><input aria-label="Access token" readOnly autoComplete="off" spellCheck={false} type={visibleSecret ? "text" : "password"} value={issued.token} /></label>
          <div className="mcp-inline-actions">
            <button className="primary-button compact" type="button" onClick={() => void copy("token", issued.token)}><IconCopy size={15} aria-hidden="true" />{copyFeedback?.field === "token" && copyFeedback.kind === "status" ? "Copied" : "Copy token"}</button>
            <button className="ghost-button compact" type="button" onClick={() => setVisibleSecret(current => !current)}>{visibleSecret ? "Hide token" : "Show token"}</button>
          </div>
          {copyFeedback?.field === "token" && copyFeedback.kind === "error" ? <p className="mcp-feedback is-error" role="alert">Could not copy. Show the token and copy it manually.</p> : null}
        </section> : null}

        {view === "plans" ? <div className="mcp-view">
          <div className="mcp-section-title"><div><h3>Action plans</h3><p className="mcp-muted">Review the exact change before authorizing it.</p></div></div>
          {plans.isPending ? <p className="mcp-muted" role="status">Loading action plans…</p> : null}
          {plans.isError ? <div className="mcp-inline-actions"><p className="mcp-feedback is-error" role="alert">Action plans could not be loaded.</p><button className="ghost-button compact" type="button" onClick={() => void plans.refetch()}>Retry</button></div> : null}
          {plans.data?.length === 0 ? <p className="mcp-muted">No action plans yet.</p> : null}
          {plans.data?.map(plan => <details className="mcp-plan mcp-panel-disclosure" key={plan.id}>
            <summary><span>{plan.operation.method} {plan.operation.path}</span><small>{plan.state === "requires_authorization" ? "Needs authorization" : plan.state.replace(/_/g, " ")}</small></summary>
            <div className="mcp-disclosure-body">
              <p className="mcp-muted">{plan.id.slice(0, 8)} · {plan.client_id}{plan.operation.permission ? ` · ${plan.operation.permission}` : ""}</p>
              <pre>{JSON.stringify(plan.arguments, null, 2)}</pre>
              <p className="mcp-muted">Expires {new Date(plan.expires_at).toLocaleString()}</p>
              {plan.state === "requires_authorization" ? <button className="primary-button compact mcp-self-start" type="button" disabled={approve.isPending || new Date(plan.expires_at) <= new Date()} onClick={() => approve.mutate(plan)}>Authorize this exact plan</button> : null}
              {plan.receipt ? <pre>{JSON.stringify(plan.receipt, null, 2)}</pre> : null}
            </div>
          </details>)}
        </div> : null}
        {notice && view !== "create" ? <p className={`mcp-feedback${notice.kind === "error" ? " is-error" : ""}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.message}</p> : null}
      </div>
      {view === "create" ? <footer className="mcp-dialog-footer">
        <div className="mcp-token-selection-state">
          <p role="status">{exactSelection.length} {exactSelection.length === 1 ? "tool" : "tools"} selected</p>
          {exactSelection.length !== selectedNames.size ? <p className="mcp-feedback is-error" role="alert">Some selected tools are unavailable. Restart token creation to choose from the latest catalog.</p> : null}
          {notice ? <p className="mcp-feedback is-error" role="alert">{notice.message}</p> : null}
        </div>
        <div className="mcp-inline-actions">
          <button className="ghost-button" type="button" disabled={issue.isPending} onClick={() => navigate("access")}>Cancel</button>
          <button className="primary-button" type="submit" form={formId} disabled={!submitReady || issue.isPending}>{issue.isPending ? "Creating…" : "Create token"}</button>
        </div>
      </footer> : null}
      {view === "receipt" ? <footer className="mcp-dialog-footer"><button className="primary-button" type="button" onClick={() => navigate("access")}>Done</button></footer> : null}
    </div>
  </div>;
}
