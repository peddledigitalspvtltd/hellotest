import { useEffect, useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { AgenticWorkflowNode, AgenticWorkflowNodeData } from "@hellotest/platform/frontend/src/types";
import { agenticApi } from "../api.client";
import "./SprintAutomatorSetup.css";

type Props = {
  projectId: string;
  input: string;
  onInput: (input: string) => void;
  nodes: AgenticWorkflowNode[];
  onNodeChange: (id: string, patch: Partial<AgenticWorkflowNodeData>) => void;
  editable: boolean;
  canRun?: boolean;
  busy: boolean;
  providers: Array<{ value: string; label: string }>;
  canViewSprints: boolean;
};
function configuration(input: string): { value: Record<string, unknown> | null; error: string } {
  try {
    const value: unknown = JSON.parse(input.trim() || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return { value: null, error: "Manual trigger input must be a JSON object. Correct the raw input before changing these fields." };
    return { value: value as Record<string, unknown>, error: "" };
  } catch {
    return { value: null, error: "Manual trigger input contains invalid JSON. Correct the raw input before changing these fields; your text has been preserved." };
  }
}
const text = (value: unknown) => typeof value === "string" ? value : "";
const message = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

/** Guided fields and the raw trigger editor share one input object. */
export function SprintAutomatorSetup(props: Props) {
  const id = useId();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const parsed = configuration(props.input);
  const values = parsed.value || {};
  const sprintId = text(values.sprint_id);
  const integrationId = text(values.integration_id);
  const sourceNodes = props.nodes.filter(node => node.data.apiResource === "sprintStories");
  const connectionId = text(sourceNodes[0]?.data.connectionId);
  const disabled = !props.editable || props.busy;
  const triggerDisabled = (!props.editable && !props.canRun) || props.busy;
  const inputDisabled = triggerDisabled || !parsed.value;
  useEffect(() => { setSearch(""); setQuery(""); }, [props.projectId]);
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), search ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [search]);
  const sprints = useQuery({
    queryKey: ["sprint-automator-sprints", props.projectId, query],
    queryFn: ({ signal }) => agenticApi.evidenceScope.options({ project_id: props.projectId, field: "sprint_id", limit: 10, search: query }, { signal }),
    enabled: Boolean(props.projectId && props.canViewSprints),
    retry: false,
    staleTime: 30000,
  });
  const connections = useQuery({
    queryKey: ["workflow-connections", props.projectId],
    queryFn: () => agenticApi.agenticWorkflows.connections(props.projectId),
    enabled: Boolean(props.projectId),
    retry: false,
    staleTime: 30000,
  });
  const availableConnections = (connections.data || []).filter(connection => connection.kind === "http" && connection.authenticated && connection.methods.includes("GET"));
  const availableSprints = (sprints.data?.items || []).slice(0, 10);
  const patchInput = (patch: Record<string, unknown>) => {
    if (inputDisabled || !parsed.value) return;
    props.onInput(JSON.stringify({ ...parsed.value, ...patch }, null, 2));
  };
  const chooseConnection = (value: string) => {
    if (disabled) return;
    const connection = availableConnections.find(item => item.id === value);
    if (value && !connection) return;
    sourceNodes.forEach(node => props.onNodeChange(node.id, {
      connectionId: connection?.id || "", apiUrl: connection?.url || "", apiMethod: "GET", apiPagination: "cursor",
      apiAuth: "", credentialId: "", retryCount: "0",
      ...(connection?.timeoutMs ? { timeoutMs: String(connection.timeoutMs) } : {}),
    }));
  };
  const caseCount = values.max_cases_per_story ?? 5;
  const invalidCases = !Number.isInteger(Number(caseCount)) || Number(caseCount) < 1 || Number(caseCount) > 10;
  const startUrl = text(values.automation_start_url);
  let invalidStartUrl = false;
  if (startUrl) {
    try { const url = new URL(startUrl); invalidStartUrl = !["http:", "https:"].includes(url.protocol) || Boolean(url.username || url.password); }
    catch { invalidStartUrl = true; }
  }
  return <section className="sprint-automator-setup" aria-labelledby={`${id}-heading`} aria-busy={props.busy}>
    <header><div><h3 id={`${id}-heading`}>Sprint Automator setup</h3><p>Choose a Sprint and API connection, then configure the drafts generated for each Story.</p></div><span className="sprint-setup-limit">Up to 100 Stories</span></header>
    {parsed.error && <p className="sprint-setup-error" role="alert">{parsed.error}</p>}
    {!props.projectId && <p role="status">Select a project to load Sprints and API connections.</p>}
    <div className="sprint-setup-grid sprint-setup-sources">
      <div className="sprint-setup-source">
        <label><span>Search Sprints</span><input aria-label="Search Sprints" type="search" value={search} placeholder="Search by Sprint name or ID" maxLength={255} disabled={triggerDisabled || !props.projectId || !props.canViewSprints} onChange={event => setSearch(event.target.value)} /></label>
        <label><span>Sprint</span><select aria-label="Sprint" value={sprintId} disabled={inputDisabled || !props.projectId || !props.canViewSprints} onChange={event => patchInput({ sprint_id: event.target.value })}>
          <option value="">Choose a Sprint</option>
          {sprintId && !availableSprints.some(sprint => sprint.id === sprintId) && <option value={sprintId}>Selected Sprint · {sprintId}</option>}
          {availableSprints.map(sprint => <option key={sprint.id} value={sprint.id}>{sprint.label}{sprint.label !== sprint.id ? ` · ${sprint.id}` : ""}</option>)}
        </select></label>
        {!props.canViewSprints ? <p role="status">Sprint access is required to browse this project's Sprints.</p>
          : sprints.isFetching ? <p role="status">Loading Sprints…</p>
          : sprints.isError ? <p className="sprint-setup-error" role="alert">{message(sprints.error, "Sprints could not be loaded.")} <button type="button" disabled={triggerDisabled} onClick={() => void sprints.refetch()}>Retry Sprints</button></p>
          : props.projectId && !availableSprints.length ? <p role="status">{query ? "No matching Sprints. Try another name or ID." : "No Sprints are available in this project."}</p>
          : sprints.data?.has_more ? <p>Showing the first 10 Sprints. Search to narrow the list.</p> : null}
      </div>
      <div className="sprint-setup-source">
        <label><span>Stories API connection</span><select aria-label="Stories API connection" value={connectionId} disabled={disabled || !props.projectId || !sourceNodes.length} onChange={event => chooseConnection(event.target.value)}>
          <option value="">Choose an API key connection</option>
          {connectionId && !availableConnections.some(connection => connection.id === connectionId) && <option value={connectionId}>Unavailable connection · {connectionId}</option>}
          {availableConnections.map(connection => <option key={connection.id} value={connection.id}>{connection.name}</option>)}
        </select></label>
        <p>Uses a personal Settings API key in <code>X-API-Key</code> or Bearer authentication. Set the connection base URL to your HelloTest <code>/api</code> endpoint.</p>
        <div className="sprint-setup-links"><Link to="/integrations?provider=http" target="_blank" rel="noreferrer">Manage API connections</Link><Link to="/admin-space?section=settings#api-keys" target="_blank" rel="noreferrer">Settings → API Keys</Link><button type="button" disabled={disabled || !props.projectId || connections.isFetching} onClick={() => void connections.refetch()}>Refresh API connections</button></div>
        {connections.isFetching ? <p role="status">Loading API connections…</p>
          : connections.isError ? <p className="sprint-setup-error" role="alert">{message(connections.error, "API connections could not be loaded.")} <button type="button" disabled={disabled} onClick={() => void connections.refetch()}>Retry API connections</button></p>
          : props.projectId && !availableConnections.length ? <p role="status">No authenticated HTTP connections allow GET. Add one in Integrations, then refresh.</p>
          : connectionId && !availableConnections.some(connection => connection.id === connectionId) ? <p className="sprint-setup-error" role="alert">The selected connection is unavailable or no longer allows authenticated GET.</p> : null}
        {!sourceNodes.length && <p className="sprint-setup-error" role="alert">Add the Read all Sprint Stories node to bind this connection.</p>}
      </div>
    </div>
    <div className="sprint-setup-grid sprint-setup-generation">
      <label><span>Generation model</span><select aria-label="Generation model" value={integrationId} disabled={inputDisabled} onChange={event => patchInput({ integration_id: event.target.value })}>
        <option value="">Use configured project model</option>
        {integrationId && !props.providers.some(provider => provider.value === integrationId) && <option value={integrationId}>Selected model · {integrationId}</option>}
        {props.providers.filter(provider => provider.value).map(provider => <option key={provider.value} value={provider.value}>{provider.label}</option>)}
      </select><small>Each native task uses this model unless its node explicitly selects another.</small></label>
      <label><span>Test Cases per Story</span><input aria-label="Test Cases per Story" type="number" min={1} max={10} step={1} value={typeof caseCount === "number" || typeof caseCount === "string" ? caseCount : ""} aria-invalid={invalidCases} disabled={inputDisabled} onChange={event => patchInput({ max_cases_per_story: event.target.value === "" ? "" : Number(event.target.value) })} />{invalidCases && <small className="sprint-setup-error" role="alert">Choose a whole number from 1 to 10.</small>}</label>
      <label><span>Test Case format</span><select aria-label="Test Case format" value={text(values.authoring_mode) || "structured"} disabled={inputDisabled} onChange={event => patchInput({ authoring_mode: event.target.value })}><option value="structured">Structured steps</option><option value="gherkin">Gherkin scenarios</option></select></label>
      <label><span>Browser Start URL (optional)</span><input aria-label="Browser Start URL (optional)" type="url" value={startUrl} placeholder="https://your-application.example" aria-invalid={invalidStartUrl} disabled={inputDisabled} onChange={event => patchInput({ automation_start_url: event.target.value })} /><small>{invalidStartUrl ? "Enter a complete HTTP or HTTPS URL without embedded credentials." : "Required for generated browser actions. Leave blank for API-only cases."}</small></label>
    </div>
    <label className="sprint-setup-guidance"><span>Generation guidance (optional)</span><textarea aria-label="Generation guidance (optional)" rows={2} value={text(values.generation_instructions)} disabled={inputDisabled} placeholder="Coverage priorities, test data constraints, or specific outcomes to verify" onChange={event => patchInput({ generation_instructions: event.target.value })} /></label>
  </section>;
}
