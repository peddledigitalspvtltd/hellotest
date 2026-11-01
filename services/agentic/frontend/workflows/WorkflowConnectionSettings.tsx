import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { IconPlus, IconRefresh, IconTrash, IconCheck } from "@tabler/icons-react";
import { useAuth } from "@hellotest/platform/frontend/src/auth/AuthContext";
import { hasPermission } from "@hellotest/platform/frontend/src/platform/lib/permissions";
import { useCurrentProject } from "@hellotest/platform/frontend/src/platform/hooks/useCurrentProject";
import { agenticApi, type WorkflowConnectionSettingsInput, type ManagedWorkflowConnection } from "../api.client";
import "./WorkflowConnectionSettings.css";

export type WorkflowConnectionSettingsProps = { kind: "mcp" | "http"; connectionId?: string; onSaved: (id: string) => void; onClose: () => void };
const empty = (projectId: string, kind: "mcp" | "http"): WorkflowConnectionSettingsInput => ({ name: "", kind, url: "", project_id: projectId, tools: [], toolDefinitions: [], methods: ["GET", "HEAD"], authType: "none", header: "Authorization", secretEnv: "", secret: "", headers: {}, transport: "streamable-http", timeoutMs: 30000, allowPrivateNetwork: false, enabled: true });
export function WorkflowConnectionSettings(props: WorkflowConnectionSettingsProps) {
  const [projectId] = useCurrentProject();
  const { session } = useAuth();
  const canView = hasPermission(session, "integration.view");
  const query = useQuery({ queryKey: ["workflow-admin-connections", projectId], queryFn: () => agenticApi.workflowConnections.list(projectId), enabled: Boolean(projectId && canView) });
  if (!canView) return <p>Integration access is required to view this connection.</p>;
  if (!projectId) return <p>Select a project to configure this provider.</p>;
  const row = query.data?.find(item => item.id === props.connectionId);
  if (props.connectionId && !row) return query.isLoading ? <p role="status">Loading connection details…</p> : <p role="alert">This connection is unavailable in the current project. <button type="button" onClick={() => void query.refetch()}>Retry</button></p>;
  return <ConnectionForm key={`${projectId}:${props.kind}:${row?.id || "new"}`} {...props} projectId={projectId} row={row} canManage={hasPermission(session, "integration.manage")} />;
}
function ConnectionForm({ projectId, row, canManage, ...props }: WorkflowConnectionSettingsProps & { projectId: string; row?: ManagedWorkflowConnection; canManage: boolean }) {
  const client = useQueryClient();
  const [draft, setDraft] = useState<WorkflowConnectionSettingsInput>(row ? { ...row, secret: "" } : empty(projectId, props.kind));
  const [headers, setHeaders] = useState(() => Object.entries(row?.headers || {}).map(([name, value]) => ({ name, value })));
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [search, setSearch] = useState("");
  const [toolFilter, setToolFilter] = useState("all");
  const invalidate = async () => { await client.invalidateQueries({ queryKey: ["workflow-admin-connections"] }); await client.invalidateQueries({ queryKey: ["workflow-connections"] }); void client.invalidateQueries({ queryKey: ["workflow-mcp-tools"] }); };
  const patch = (values: Partial<WorkflowConnectionSettingsInput>, connectionChanged = false) => {
    setError(""); setMessage("");
    setDraft(current => ({ ...current, ...values, ...(connectionChanged ? { tools: [], toolDefinitions: [], discovered_at: undefined, serverInfo: undefined, protocolVersion: undefined } : {}) }));
  };
  const input = () => {
    if (new Set(headers.map(item => item.name.toLowerCase())).size !== headers.length) throw new Error("Use a unique name for each custom header.");
    if (draft.authType === "basic" && draft.secret && (!draft.username?.trim() || draft.username.includes(":"))) throw new Error("Enter a Basic authentication username without a colon.");
    return { ...draft, headers: Object.fromEntries(headers.map(item => [item.name, item.value])), secret: draft.authType === "basic" && draft.secret ? `${draft.username}:${draft.secret}` : draft.secret };
  };
  const reportError = (reason: unknown) => setError(reason instanceof Error ? reason.message : "The connection could not be completed.");
  const save = useMutation({ mutationFn: () => row ? agenticApi.workflowConnections.update(row.id, input()) : agenticApi.workflowConnections.create(input()),
    onSuccess: async saved => { setDraft({ ...saved, secret: "" }); setHeaders(Object.entries(saved.headers || {}).map(([name, value]) => ({ name, value }))); setError(""); setMessage("Connection saved. Enabled tools and settings are available to workflows in this project."); await invalidate(); props.onSaved(saved.id); }, onError: reportError });
  const discover = useMutation({ mutationFn: () => agenticApi.workflowConnections.discoverDraft(input(), row?.id),
    onSuccess: result => { setDraft(current => ({ ...current, toolDefinitions: result.tools, tools: current.tools.filter(name => result.tools.some(tool => tool.name === name)), serverInfo: result.serverInfo, protocolVersion: result.protocolVersion, discovered_at: result.discovered_at })); setError(""); setMessage(result.tools.length ? "Connected. Select the tools workflows may call, then save." : "Connected, but this server has no tools. You can save it as inactive."); }, onError: reason => { patch({}, true); reportError(reason); } });
  const remove = useMutation({ mutationFn: () => agenticApi.workflowConnections.delete(row!.id, projectId), onSuccess: async () => { await invalidate(); props.onClose(); }, onError: reportError });
  const busy = save.isPending || discover.isPending || remove.isPending;
  const tools = draft.toolDefinitions || [];
  const visibleTools = tools.filter(tool => `${tool.name} ${tool.description || ""}`.toLowerCase().includes(search.trim().toLowerCase()) &&
    (toolFilter === "all" || toolFilter === "enabled" && draft.tools.includes(tool.name) || toolFilter === "read" && tool.annotations?.readOnlyHint === true || toolFilter === "actions" && tool.annotations?.readOnlyHint !== true));
  const visibleNames = new Set(visibleTools.map(tool => tool.name));
  const selectVisible = (enabled: boolean) => patch({ tools: enabled ? Array.from(new Set([...draft.tools, ...visibleNames])) : draft.tools.filter(name => !visibleNames.has(name)) });
  const needsTools = draft.kind === "mcp" && draft.enabled && (!draft.discovered_at || !draft.tools.length);
  return <form className="workflow-connection-form form-grid" onSubmit={event => { event.preventDefault(); if (!needsTools) save.mutate(); }}>
    <p className="integration-helper">{draft.kind === "mcp" ? "Connect a remote MCP server, discover its tools, and choose which tools workflows may call." : "Configure an HTTP endpoint and the request methods workflows may use."} This connection belongs to the current project.</p>
    <fieldset disabled={busy || !canManage}>
      <label className="settings-input-field"><span>Connection name</span><input required minLength={2} maxLength={120} value={draft.name} onChange={event => patch({ name: event.target.value })} /></label>
      {draft.kind === "mcp" && <label className="settings-input-field"><span>Transport</span><select aria-label="Transport" value="streamable-http" onChange={() => {}}><option value="streamable-http">Streamable HTTP</option></select><small>Protocol and session details are negotiated automatically. Local stdio and legacy SSE endpoints are not supported.</small></label>}
      <label className="settings-input-field"><span>Server endpoint</span><input required type="url" value={draft.url} placeholder={draft.kind === "mcp" ? "https://tools.example.com/mcp" : "https://api.example.com/v1"} onChange={event => patch({ url: event.target.value }, true)} /></label>
      <label className="settings-input-field"><span>Connection timeout (ms)</span><input aria-label="Connection timeout (ms)" required type="number" min={1000} max={70000} step={1000} value={draft.timeoutMs || 30000} onChange={event => patch({ timeoutMs: Number(event.target.value) })} /><small>Used for discovery and as the default for new workflow nodes.</small></label>
      <label className="settings-input-field"><span>Authentication</span><select aria-label="Authentication" value={draft.authType} onChange={event => patch({ authType: event.target.value as WorkflowConnectionSettingsInput["authType"], secret: "", secretEnv: "", ...(event.target.value === "header" && draft.header === "Authorization" ? { header: "X-API-Key" } : {}) }, true)}><option value="none">None</option><option value="bearer">Bearer token</option><option value="header">API key header</option><option value="basic">Basic authentication</option></select><small>Use an existing server credential. OAuth sign-in and token refresh are not supported.</small></label>
      {draft.authType !== "none" && <>
        {draft.authType === "header" && <label className="settings-input-field"><span>Credential header</span><input required value={draft.header} onChange={event => patch({ header: event.target.value }, true)} /></label>}
        {draft.authType === "basic" && <label className="settings-input-field"><span>Username</span><input autoComplete="off" value={draft.username || ""} onChange={event => patch({ username: event.target.value }, true)} /></label>}
        <label className="settings-input-field"><span>{draft.authType === "basic" ? "Password" : "Credential"}</span><input aria-label={draft.authType === "basic" ? "Password" : "Credential"} type="password" autoComplete="new-password" value={draft.secret || ""} placeholder={row?.authenticated ? "Leave blank to keep the saved credential" : "Enter the server credential"} onChange={event => patch({ secret: event.target.value, secretEnv: "" }, true)} /><small>{draft.kind === "http" && ["bearer", "header"].includes(draft.authType) ? "For HelloTest Stories, use a personal key from Settings → API Keys with X-API-Key or Bearer authentication. Paste only the key. Credentials are encrypted on the server." : draft.authType === "bearer" ? "Paste only the token; the Bearer prefix is added automatically. For HelloTest MCP, use a host credential from Connect & inspect (expires in one hour)." : "Encrypted on the server; never included in workflow definitions."}</small></label>
        <label className="settings-input-field"><span>Secret environment reference (optional)</span><input aria-label="Secret environment reference (optional)" value={draft.secretEnv} placeholder="AGENTIC_SECRET_MY_SERVER" onChange={event => patch({ secretEnv: event.target.value, secret: "" }, true)} /><small>Use a server environment variable instead. For Basic authentication it contains username:password.</small></label>
      </>}
      <details className="workflow-connection-full workflow-request-headers"><summary>Additional request headers ({headers.length})</summary><p>Optional headers required by the server, such as a tenant or API version. Values are encrypted and masked after saving.</p>
        {headers.map((item, index) => <div className="workflow-header-row" key={index}><label><span>Header name {index + 1}</span><input value={item.name} onChange={event => { setHeaders(current => current.map((value, i) => i === index ? { ...value, name: event.target.value } : value)); patch({}, true); }} /></label><label><span>Header value {index + 1}</span><input type="password" autoComplete="new-password" value={item.value} placeholder="Leave blank to keep saved value" onChange={event => { setHeaders(current => current.map((value, i) => i === index ? { ...value, value: event.target.value } : value)); patch({}, true); }} /></label><button type="button" className="ghost-button" aria-label={`Remove header ${index + 1}`} onClick={() => { setHeaders(current => current.filter((_, i) => i !== index)); patch({}, true); }}><IconTrash size={16} /></button></div>)}
        <button type="button" className="ghost-button" disabled={headers.length >= 16} onClick={() => setHeaders(current => [...current, { name: "", value: "" }])}><IconPlus size={16} />Add header</button>
      </details>
      <label className="checkbox-field workflow-connection-full"><input type="checkbox" checked={draft.allowPrivateNetwork} onChange={event => patch({ allowPrivateNetwork: event.target.checked }, true)} /><span>Allow this connection to reach private network endpoints</span></label>
      {draft.kind === "mcp" ? <section className="workflow-connection-full workflow-tool-catalog" aria-label="Server tools">
        <div className="workflow-tool-heading"><div><h3>Server tools</h3><p>{draft.tools.length} enabled · {tools.length} discovered</p></div>{canManage && <button type="button" className="ghost-button" onClick={() => discover.mutate()}><IconRefresh size={16} />{discover.isPending ? "Connecting…" : "Test connection and discover tools"}</button>}</div>
        {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
        {draft.discovered_at ? <p className="workflow-discovery-status"><IconCheck size={16} />{draft.serverInfo?.name || "MCP server"}{draft.serverInfo?.version ? ` · ${draft.serverInfo.version}` : ""} · protocol {draft.protocolVersion} · discovered {new Date(draft.discovered_at).toLocaleString()}</p> : <p>Discover tools before saving an active MCP provider. Testing reads the catalog; it does not execute tools.</p>}
        {tools.length > 0 && <><div className="workflow-tool-filters"><label className="settings-input-field"><span>Search server tools</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label><label className="settings-input-field"><span>Show tools</span><select aria-label="Show tools" value={toolFilter} onChange={event => setToolFilter(event.target.value)}><option value="all">All tools</option><option value="read">Declared read only</option><option value="actions">Actions or unspecified</option><option value="enabled">Enabled tools</option></select></label></div>
          <div className="workflow-tool-bulk-actions"><span role="status">{visibleTools.length} shown · {visibleTools.filter(tool => draft.tools.includes(tool.name)).length} enabled</span><button type="button" className="ghost-button compact" disabled={!visibleTools.some(tool => !draft.tools.includes(tool.name))} onClick={() => selectVisible(true)}>Enable shown tools</button><button type="button" className="ghost-button compact" disabled={!visibleTools.some(tool => draft.tools.includes(tool.name))} onClick={() => selectVisible(false)}>Disable shown tools</button></div>
          <p>Selections apply when you save. Read-only labels come from the server; tools without that declaration appear under actions or unspecified.</p>
          <div className="workflow-tool-list">{visibleTools.map(tool => <article className="workflow-tool-card" key={tool.name}><label className="checkbox-field"><input aria-label={`Enable ${tool.name}`} type="checkbox" checked={draft.tools.includes(tool.name)} onChange={event => patch({ tools: event.target.checked ? [...draft.tools, tool.name] : draft.tools.filter(name => name !== tool.name) })} /><span><strong>{tool.name}</strong><small>{tool.description}</small></span></label>{tool.annotations?.destructiveHint === true && <small className="workflow-tool-warning">Server reports that this tool may change or delete data.</small>}<details><summary>Parameters and result schema</summary><pre>{JSON.stringify({ input: tool.inputSchema, ...(tool.outputSchema ? { output: tool.outputSchema } : {}) }, null, 2)}</pre></details></article>)}</div>{!visibleTools.length && <p>No tools match these filters.</p>}</>}
        {!tools.length && draft.tools.length > 0 && <p>Previously enabled: {draft.tools.join(", ")}. Discover to load current parameter details.</p>}
      </section> : <div className="workflow-connection-full"><strong>Allowed HTTP methods</strong>{["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].map(method => <label className="checkbox-field" key={method}><input type="checkbox" checked={draft.methods.includes(method)} onChange={event => patch({ methods: event.target.checked ? [...draft.methods, method] : draft.methods.filter(value => value !== method) })} /><span>{method}</span></label>)}</div>}
      <label className="checkbox-field workflow-connection-full"><input type="checkbox" checked={draft.enabled} onChange={event => patch({ enabled: event.target.checked })} /><span>Enabled for this project</span></label>
    </fieldset>
    {needsTools && canManage && <p className="workflow-connection-hint">Discover the server and select at least one tool, or save this connection as inactive.</p>}
    {draft.kind !== "mcp" && message && <p role="status">{message}</p>}{draft.kind !== "mcp" && error && <p role="alert">{error}</p>}
    <div className="workflow-connection-actions">{canManage && <button className="primary-button" type="submit" disabled={busy || needsTools}>{save.isPending ? "Saving…" : "Save connection"}</button>}<button className="ghost-button" type="button" disabled={busy} onClick={props.onClose}>Back to providers</button>{row && canManage && <button className="ghost-button" type="button" disabled={busy} onClick={() => setDeleting(true)}>Delete connection</button>}</div>
    {deleting && <div role="alert"><p>Delete this connection? Workflows using it will need a replacement.</p><button type="button" disabled={busy} onClick={() => remove.mutate()}>Confirm delete</button><button type="button" disabled={busy} onClick={() => setDeleting(false)}>Keep connection</button></div>}
  </form>;
}
