import { LoadingState } from "../components/LoadingState";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { IconArrowRight, IconClock, IconFileText, IconRefresh, IconSearch, IconSourceCode } from "@tabler/icons-react";
import { api } from "../lib/api";
import { asArray } from "../lib/collectionGuards";
import { HELLOTEST_AGENT_CATALOG } from "../components/AgenticExperience";
import { REPOSITORY_AGENTS, isRepositoryAgentType } from "./RepositoryAgents";
import type { RepositoryAgentType } from "./types";
import { agentReadinessLabel } from "./agentExperience";

export function AgentActivityCenter({ projectId, appTypeId, enabled, onOpenRepository, onOpenSession }: {
  projectId: string; appTypeId: string; enabled: boolean;
  onOpenRepository: (agent: RepositoryAgentType, runId: string) => void;
  onOpenSession: (agentId: string, sessionId: string) => void;
}) {
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");
  useEffect(() => { const update = () => setVisible(document.visibilityState === "visible"); document.addEventListener("visibilitychange", update); return () => document.removeEventListener("visibilitychange", update); }, []);
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("all");
  const [attention, setAttention] = useState(false);
  const canRead = Boolean(enabled && projectId);
  const sourceRuns = useQuery({ queryKey: ["repository-agent-activity", projectId, appTypeId], queryFn: ({ signal }) => api.repositoryAgents.list({ project_id: projectId, app_type_id: appTypeId || undefined }, { signal }), enabled: canRead, staleTime: 10000, retry: 1, refetchInterval: query => visible && asArray(query.state.data?.items).some(run => ["queued", "running"].includes(run.status)) ? 2000 : false, refetchIntervalInBackground: false });
  const sessions = useQuery({ queryKey: ["workspace-transactions", "ai-agent", projectId, appTypeId], queryFn: ({ signal }) => api.agenticWorkflows.listSessions({ project_id: projectId, app_type_id: appTypeId || undefined, limit: 20 }, { signal }), enabled: canRead, staleTime: 10000, retry: 1, refetchInterval: query => visible && asArray(query.state.data).some(run => ["queued", "running"].includes(run.status)) ? 2000 : false, refetchIntervalInBackground: false });
  const entries = useMemo(() => [
    ...asArray(sourceRuns.data?.items).filter(run => run.project_id === projectId && (!appTypeId || run.app_type_id === appTypeId)).map(run => ({ id: run.id, kind: "source", name: run.source.name || "Repository analysis", agentId: run.agent_type, agentName: REPOSITORY_AGENTS.find(agent => agent.id === run.agent_type)?.name || "Repository agent", status: run.status, statusLabel: ({ completed: "Ready for review", partial: "Review with gaps", failed: "Failed", cancelled: "Cancelled", queued: "Queued", running: "Analyzing" })[run.status], detail: ["queued", "running"].includes(run.status) ? "Analysis in progress. Open to see recorded progress or cancel." : `${Number(run.summary?.finding_count) || 0} findings · ${run.published?.items?.length || 0} published`, createdAt: run.created_at || "", needsAttention: ["partial", "failed", "cancelled"].includes(run.status) })),
    ...asArray(sessions.data).filter(run => run.project_id === projectId && (!appTypeId || run.app_type_id === appTypeId)).map(run => { const agentId = String(run.metadata.agent_id || "quality-orchestrator"); const result = run.metadata.result as { readiness?: { status: string }; grounding_status?: string } | undefined; const readiness = result?.readiness?.status; return { id: run.id, kind: "review", name: run.title || "Specialist review", agentId, agentName: HELLOTEST_AGENT_CATALOG.find(agent => agent.id === agentId)?.name || "Workspace specialist", status: run.status, statusLabel: run.metadata.cancelled ? "Stopped" : run.status === "completed" ? agentReadinessLabel(readiness) : run.status === "running" ? "Reviewing" : run.status === "aborted" ? "Stopped" : run.status === "failed" ? "Failed" : run.status, detail: run.description || "Open the saved review and its evidence.", createdAt: run.created_at || "", needsAttention: ["failed", "aborted"].includes(run.status) || readiness === "limited_evidence" || readiness === "insufficient_evidence" }; })
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [sourceRuns.data, sessions.data, projectId, appTypeId]);
  const filtered = entries.filter(entry => (kind === "all" || entry.kind === kind) && (!attention || entry.needsAttention) && [entry.name, entry.agentName, entry.statusLabel].join(" ").toLowerCase().includes(search.toLowerCase().trim()));
  const refresh = () => { void sourceRuns.refetch(); void sessions.refetch(); };
  const isLoading = sourceRuns.isLoading || sessions.isLoading;
  return <section className="agent-activity-center" aria-labelledby="agent-activity-title">
    <header className="agent-library-heading"><div><h2 id="agent-activity-title">Recent work</h2><p>Resume repository analyses and revisit saved specialist reviews in this application. Showing the latest 20 of each.</p></div><button type="button" className="ghost-button" disabled={!canRead || sourceRuns.isFetching || sessions.isFetching} onClick={refresh}><IconRefresh size={16} aria-hidden="true" />Refresh work</button></header>
    <div className="agent-activity-toolbar"><label className="agent-library-search"><IconSearch size={18} aria-hidden="true" /><input aria-label="Search recent agent work" value={search} onChange={event => setSearch(event.target.value)} placeholder="Find a task or agent" /></label><div className="agent-library-filters" role="group" aria-label="Recent work type">{[{ id: "all", label: "All work" }, { id: "source", label: "Source analyses" }, { id: "review", label: "Specialist reviews" }].map(item => <button type="button" key={item.id} aria-pressed={kind === item.id} onClick={() => setKind(item.id)}>{item.label}</button>)}</div><label className="agent-activity-attention"><input type="checkbox" checked={attention} onChange={event => setAttention(event.target.checked)} />Needs attention</label></div>
    {!projectId ? <div className="agent-library-empty"><h3>Select a project to see its work</h3></div> : !enabled ? <div className="agent-library-empty"><p>Agent activity is unavailable for this scope.</p></div> : isLoading ? <LoadingState label="Loading recent work" /> : <>
      {(sourceRuns.isError || sessions.isError) && <p role="alert" className="agent-specialist-error">Some recent work could not be loaded. Available results are shown; refresh to retry.</p>}
      <div className="agent-activity-list">{filtered.map(entry => <button className="agent-activity-row" type="button" key={`${entry.kind}:${entry.id}`} onClick={() => { if (entry.kind === "source" && isRepositoryAgentType(entry.agentId)) onOpenRepository(entry.agentId, entry.id); else if (entry.kind === "review") onOpenSession(entry.agentId, entry.id); }}>
        <span className="agent-activity-kind-icon">{entry.kind === "source" ? <IconSourceCode size={21} /> : <IconFileText size={21} />}</span><span className="agent-activity-copy"><small>{entry.agentName}</small><strong>{entry.name}</strong><span>{entry.detail}</span></span><span className="agent-activity-meta"><span className="agent-activity-status" data-attention={entry.needsAttention || undefined}>{entry.statusLabel}</span><time><IconClock size={13} aria-hidden="true" />{Number.isNaN(Date.parse(entry.createdAt)) ? "Date unavailable" : new Date(entry.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</time></span><IconArrowRight size={17} aria-hidden="true" />
      </button>)}</div>
      {!filtered.length && <div className="agent-library-empty"><IconFileText size={27} aria-hidden="true" /><h3>{entries.length ? "No work matches these filters" : "Your work will be here"}</h3><p>{entries.length ? "Change the search or filters to find another task." : "Start an agent from the library. Saved analyses and review briefs will appear here."}</p></div>}
    </>}
  </section>;
}
