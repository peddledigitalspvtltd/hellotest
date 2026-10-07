import { FormattedText } from "@hellotest/platform/frontend/src/shared/components/FormattedText";
import { LoadingState } from "@hellotest/platform/frontend/src/shared/components/LoadingState";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  IconApi, IconArrowLeft, IconArrowRight, IconBook2, IconBrandGithub,
  IconCheck, IconChevronRight, IconClock, IconComponents, IconDatabase,
  IconDownload, IconFileCode, IconGitBranch, IconPlayerStop,
  IconRefresh, IconScan, IconSearch, IconShieldCheck, IconUpload
} from "@tabler/icons-react";
import { useAuth } from "@hellotest/platform/frontend/src/auth/AuthContext";
import { agenticApi } from "../api.client";
import { integrationApi } from "@hellotest/integration/frontend/api.client";
import { testingApi } from "@hellotest/testing/frontend/api.client";
import { asArray } from "@hellotest/platform/frontend/src/shared/lib/collectionGuards";
import { hasPermission } from "@hellotest/platform/frontend/src/platform/lib/permissions";
import type { Integration } from "@hellotest/platform/frontend/src/types";
import type {
  RepositoryAgentDefinition, RepositoryAgentFinding,
  RepositoryAgentRun, RepositoryAgentType, RepositoryAgentPublishResult
} from "./agentTypes";
import "./RepositoryAgents.css";

export const REPOSITORY_AGENTS: Array<RepositoryAgentDefinition & { icon: ReactNode; accent: string; outputLabel: string }> = [
  { id: "object_repository", name: "Object Repository Generator", description: "Discover screens, elements and locator candidates from your application's source.", outcome: "Review source-backed objects and import them into Object Repository.", outputLabel: "Screens & locators", icon: <IconScan />, accent: "teal" },
  { id: "api_tests", name: "API Test Case Generator", description: "Turn discovered routes and API contracts into traceable test case drafts.", outcome: "Review requests, expected results and coverage before creating test cases.", outputLabel: "API test drafts", icon: <IconApi />, accent: "blue" },
  { id: "repository_knowledge", name: "Repository Knowledge Builder", description: "Build searchable project knowledge from a repository's code and documentation.", outcome: "Publish selected evidence into Knowledge Repo for grounded AI answers.", outputLabel: "Searchable knowledge", icon: <IconBook2 />, accent: "amber" },
  { id: "component_tests", name: "Component Test Generator", description: "Discover components and source-backed checks, then generate reviewable test contracts.", outcome: "Review component test contracts and create draft cases for validation.", outputLabel: "Component test contracts", icon: <IconComponents />, accent: "violet" }
];

export function isRepositoryAgentType(value: unknown): value is RepositoryAgentType {
  return REPOSITORY_AGENTS.some((agent) => agent.id === value);
}

const statusLabels: Record<string, string> = {
  queued: "Queued", running: "Analyzing", completed: "Ready to review", partial: "Review with gaps",
  failed: "Analysis failed", cancelled: "Cancelled", passed: "Complete", pending: "Waiting",
  skipped: "Skipped", success: "Complete", warning: "Review needed"
};
const groupLabels = { objects: "Objects", test_cases: "Test cases", knowledge: "Knowledge", components: "Components" };
type FindingGroup = keyof typeof groupLabels;
const DEFAULT_GROUPS: Record<RepositoryAgentType, FindingGroup> = {
  object_repository: "objects", api_tests: "test_cases", repository_knowledge: "knowledge", component_tests: "test_cases"
};
const SOURCE_GUIDANCE: Record<RepositoryAgentType, { supported: string; review: string; limit: string }> = {
  object_repository: { supported: "JSX, TSX, HTML and static Vue / Svelte markup", review: "Check screen grouping, locator uniqueness and visible application state.", limit: "Up to 600 screens and objects per analysis" },
  api_tests: { supported: "OpenAPI JSON / YAML, Express, Fastify and Next.js route declarations", review: "Confirm endpoint prefixes, authentication, typed request data and expected responses.", limit: "Up to 250 declared API contracts per analysis" },
  repository_knowledge: { supported: "Source code, README files, Markdown and API documentation", review: "Check excerpt coverage and existing repository documents before publishing a new revision.", limit: "Repository overview and up to 160 source excerpts" },
  component_tests: { supported: "JSX, TSX, HTML and static Vue / Svelte markup", review: "Arrange fixtures and component state, then validate the proposed visibility checks.", limit: "Up to 120 component groups with five scenarios each" }
};
type PublicationFilter = "all" | "pending" | "published";
const PAGE_SIZE = 20;
const isActive = (run?: RepositoryAgentRun | null) => Boolean(run && ["queued", "running"].includes(run.status));
const stringValue = (value: unknown) => typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
const objectValue = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const displayDate = (value?: string) => {
  if (!value || Number.isNaN(new Date(value).getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
};
const formatBytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(bytes < 1024 * 1024 ? 1 : 0)} MB`;
const safeInternalUrl = (url?: string) => url && /^\/(?!\/)[^\\\s]*$/.test(url) ? url : null;

function usePageVisibility() {
  const [visible, setVisible] = useState(() => document.visibilityState !== "hidden");
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

function RunBadge({ status }: { status: string }) {
  return <span className={`repository-agent-status is-${status}`}>
    {status === "running" || status === "queued" ? <LoadingState label={status === "queued" ? "Analysis queued" : "Analyzing repository"} /> : null}
    {statusLabels[status] || status.replace(/_/g, " ")}
  </span>;
}

export function RepositoryAgentCatalog({ onOpen }: { onOpen: (agent: RepositoryAgentType) => void }) {
  return <section className="repository-agent-catalog" aria-labelledby="repository-agent-catalog-title">
    <div className="repository-agent-section-heading">
      <div><span className="repository-agent-eyebrow">Build from your repository</span><h2 id="repository-agent-catalog-title">Source in. Reviewable assets out.</h2></div>
      <p>Four focused agents turn repository evidence into usable quality assets. Choose an outcome to get started.</p>
    </div>
    <div className="repository-agent-cards">
      {REPOSITORY_AGENTS.map((agent) => <article className={`repository-agent-card accent-${agent.accent}`} key={agent.id}>
        <header><span className="repository-agent-symbol">{agent.icon}</span><span className="repository-agent-output-label">{agent.outputLabel}</span></header>
        <div><h3>{agent.name}</h3><p>{agent.description}</p></div>
        <footer><span><IconFileCode size={14} aria-hidden="true" /> ZIP or GitHub</span><button className="ghost-button compact" type="button" onClick={() => onOpen(agent.id)} aria-label={`Open ${agent.name}`}>Open agent <IconArrowRight size={15} aria-hidden="true" /></button></footer>
      </article>)}
    </div>
  </section>;
}

function EvidencePreview({ finding }: { finding: RepositoryAgentFinding }) {
  const evidence = asArray(finding.evidence);
  return <section className="repository-agent-evidence" aria-label="Source evidence">
    <h5><IconFileCode size={15} aria-hidden="true" /> Source evidence</h5>
    {evidence.length ? evidence.slice(0, 10).map((entry, index) => <div key={`${entry.path}:${entry.line}:${index}`}>
      <code>{entry.path}{entry.line ? `:${entry.line}` : ""}</code>
      {entry.excerpt ? <pre>{entry.excerpt.slice(0, 3000)}</pre> : null}
    </div>) : <p>No source location was provided. Verify this finding before publishing.</p>}
    {evidence.length > 10 ? <p>{evidence.length - 10} more source locations are included in the downloadable artifacts.</p> : null}
  </section>;
}

function FindingPreview({ finding, group }: { finding: RepositoryAgentFinding; group: FindingGroup }) {
  const description = stringValue(finding.description || finding.content || finding.summary || finding.business_meaning);
  const fields: Array<[string, unknown]> = group === "objects"
    ? [["Screen", finding.screen_name || finding.screen], ["Locator", finding.record_type === "screen" ? undefined : finding.locator || finding.primary_locator], ["Strategy", finding.record_type === "screen" ? undefined : finding.locator_kind || finding.strategy], ["Role", finding.record_type === "screen" ? "Screen" : finding.object_role || finding.role], ["Route", finding.page_url]]
    : group === "test_cases"
      ? [["Method", finding.method], ["Endpoint", finding.path || finding.endpoint], ["Expected status", finding.expected_status ?? (finding.method ? "Not established in source · review required" : undefined)], ["Content type", finding.content_type], ["Priority", finding.priority], ["Preconditions", finding.preconditions]]
      : group === "components" ? [["Component", finding.component || finding.name], ["Source", finding.path || finding.file], ["Framework", finding.framework]] : [["Content type", finding.content_type]];
  const steps = asArray(finding.steps) as Array<Record<string, unknown>>;
  const parameters = asArray(finding.parameters) as Array<Record<string, unknown>>;
  const assertions = asArray(finding.assertions) as Array<Record<string, unknown>>;
  const assumptions = [...new Set([...asArray(finding.review_reasons), ...asArray(finding.assumptions)].map((value) => stringValue(value) || stringValue(objectValue(value).message)).filter(Boolean))];
  const metadata = objectValue(finding.metadata);
  const locators = asArray(finding.locators) as Array<Record<string, unknown>>;
  const componentCases = asArray(finding.test_cases) as Array<Record<string, unknown>>;
  return <div className="repository-agent-finding-detail">
    {assumptions.length ? <section className="repository-agent-assumptions"><h5>Review checklist</h5><ul>{assumptions.slice(0, 20).map((assumption) => <li key={assumption}>{assumption}</li>)}</ul></section> : null}
    {metadata.truncated === true ? <p className="repository-agent-inline-note">Partial source excerpt{typeof metadata.end_line === "number" ? ` · lines ${metadata.start_line || 1}–${metadata.end_line}` : ""}. Inspect the full file before relying on implementation details outside this range.</p> : null}
    {description ? <p className="repository-agent-description">{description.slice(0, 6000)}{description.length > 6000 ? "\n[Preview shortened. Download the artifact for the full finding.]" : ""}</p> : null}
    {fields.some(([, value]) => stringValue(value)) ? <dl className="repository-agent-facts">{fields.filter(([, value]) => stringValue(value)).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{stringValue(value)}</dd></div>)}</dl> : null}
    {steps.length ? <ol className="repository-agent-test-steps" aria-label="Generated test steps">{steps.slice(0, 30).map((step, index) => <li key={index}><strong>{stringValue(step.action || step.description || step.name)}</strong>{step.expected_result ? <p>{stringValue(step.expected_result)}</p> : null}</li>)}</ol> : null}
    {parameters.length ? <section className="repository-agent-contract"><h5>Request parameters</h5><div className="repository-agent-parameter-table"><table><thead><tr><th scope="col">Parameter</th><th scope="col">Location</th><th scope="col">Contract</th></tr></thead><tbody>{parameters.slice(0, 40).map((parameter, index) => <tr key={index}><th scope="row">{stringValue(parameter.name)}</th><td>{stringValue(parameter.in)}</td><td>{parameter.required ? "Required" : "Optional"}{objectValue(parameter.schema).type ? ` · ${stringValue(objectValue(parameter.schema).type)}` : ""}</td></tr>)}</tbody></table></div></section> : null}
    {finding.body != null || finding.body_schema ? <section className="repository-agent-contract"><h5>Request body {finding.body != null ? "example" : "schema"}</h5><pre>{JSON.stringify(finding.body ?? finding.body_schema, null, 2).slice(0, 8000)}</pre>{finding.body != null && finding.body_schema ? <details><summary>Body schema</summary><pre>{JSON.stringify(finding.body_schema, null, 2).slice(0, 8000)}</pre></details> : null}</section> : null}
    {assertions.length ? <section className="repository-agent-contract"><h5>Proposed assertions</h5><ul>{assertions.slice(0, 30).map((assertion, index) => <li key={index}><strong>{stringValue(assertion.kind).replace(/_/g, " ")}</strong>{assertion.locator ? <code>{stringValue(assertion.locator)}</code> : null}{assertion.expected != null ? <span>Expected: {stringValue(assertion.expected)}</span> : null}</li>)}</ul></section> : null}
    {locators.length ? <section className="repository-agent-contract"><h5>Component elements</h5><ul>{locators.slice(0, 30).map((locator, index) => <li key={index}><strong>{stringValue(locator.name || locator.role)}</strong><code>{stringValue(locator.locator)}</code></li>)}</ul></section> : null}
    {componentCases.length ? <section className="repository-agent-contract"><h5>Proposed scenarios</h5><ul>{componentCases.slice(0, 30).map((item, index) => <li key={index}>{stringValue(item.title || item.name)}</li>)}</ul></section> : null}
    <EvidencePreview finding={finding} />
  </div>;
}

type RepositoryAgentsProps = {
  projectId: string;
  appTypeId: string;
  scopeLabel: string;
  agentType: RepositoryAgentType;
  runId: string;
  enabled: boolean;
  onOpen: (agent: RepositoryAgentType, runId?: string) => void;
  onBack: () => void;
};

export function RepositoryAgents({ projectId, appTypeId, scopeLabel, agentType, runId, enabled, onOpen, onBack }: RepositoryAgentsProps) {
  const { session } = useAuth();
  const client = useQueryClient();
  const visible = usePageVisibility();
  const agent = REPOSITORY_AGENTS.find((item) => item.id === agentType)!;
  const canView = enabled && hasPermission(session, "agentic_workflow.view", projectId);
  const canRun = enabled && hasPermission(session, "agentic_workflow.run", projectId);
  const [sourceType, setSourceType] = useState<"zip" | "github">("zip");
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [ref, setRef] = useState("");
  const [integrationId, setIntegrationId] = useState("");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("error");
  const [messageArea, setMessageArea] = useState<"source" | "review">("source");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [group, setGroup] = useState<FindingGroup>(DEFAULT_GROUPS[agentType]);
  const [search, setSearch] = useState("");
  const [publicationFilter, setPublicationFilter] = useState<PublicationFilter>("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [moduleId, setModuleId] = useState("");
  const [downloading, setDownloading] = useState("");
  const [publishReceipt, setPublishReceipt] = useState<RepositoryAgentPublishResult | null>(null);
  const mounted = useRef(true);
  const mutationController = useRef(new AbortController());
  const launchKey = useRef({ signature: "", id: "" });
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => { mounted.current = true; if (mutationController.current.signal.aborted) mutationController.current = new AbortController(); return () => { mounted.current = false; mutationController.current.abort(); }; }, []);

  const catalog = useQuery({ queryKey: ["repository-agent-catalog"], queryFn: ({ signal }) => agenticApi.repositoryAgents.catalog({ signal }), enabled: canView, staleTime: 60_000, retry: 1 });
  const history = useQuery({
    queryKey: ["repository-agent-runs", projectId, appTypeId, agentType, historyPage],
    queryFn: ({ signal }) => agenticApi.repositoryAgents.list({ project_id: projectId, app_type_id: appTypeId || undefined, agent_type: agentType, page: historyPage }, { signal }),
    enabled: Boolean(projectId) && canView && historyOpen,
    refetchInterval: (query) => visible && asArray(query.state.data?.items).some(isActive) ? 2000 : false,
    refetchIntervalInBackground: false, retry: 1
  });
  const selectedRun = useQuery({
    queryKey: ["repository-agent-run", projectId, appTypeId, runId],
    queryFn: ({ signal }) => agenticApi.repositoryAgents.get(runId, { signal }),
    enabled: Boolean(projectId && runId) && canView,
    refetchInterval: (query) => visible && isActive(query.state.data) ? 2000 : false,
    refetchIntervalInBackground: false, retry: 1
  });
  const run = selectedRun.data?.project_id === projectId && (!appTypeId || selectedRun.data.app_type_id === appTypeId) && selectedRun.data.agent_type === agentType ? selectedRun.data : null;
  const githubProfiles = useQuery({
    queryKey: ["integrations", "repository-agents", "github"],
    queryFn: () => integrationApi.integrations.list({ type: "github" }),
    enabled: sourceType === "github" && canRun && hasPermission(session, "integration.view", projectId), staleTime: 60_000
  });
  const modules = useQuery({
    queryKey: ["test-case-modules", "repository-agents", projectId, appTypeId],
    queryFn: () => testingApi.testCaseModules.list({ project_id: projectId, app_type_id: appTypeId }),
    enabled: Boolean(appTypeId && run?.result) && group === "test_cases" && hasPermission(session, "testcase.view", projectId)
  });
  const active = isActive(run);
  const findings = run?.result?.findings;
  const groups = (Object.keys(groupLabels) as FindingGroup[]).filter((key) => asArray(findings?.[key]).length);
  const effectiveGroup = groups.includes(group) ? group : groups[0] || DEFAULT_GROUPS[agentType];
  const rows = asArray(findings?.[effectiveGroup]);
  const published = useMemo(() => new Map(asArray(run?.published?.items).map((item) => [item.finding_id, item])), [run?.published]);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return rows.filter((item) => (effectiveGroup !== "components" && publicationFilter !== "all" ? published.has(item.id) === (publicationFilter === "published") : true)
      && (!query || [item.title, item.name, item.screen_name, item.locator, item.path, ...asArray(item.evidence).map((entry) => entry.path)].join(" ").toLowerCase().includes(query)));
  }, [rows, search, publicationFilter, published, effectiveGroup]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const publishableRows = rows.filter((item) => !published.has(item.id));
  const selectedIds = publishableRows.filter((item) => selected.has(item.id)).map((item) => item.id);
  const publishPermission = effectiveGroup === "objects" ? "automation.repository.import" : effectiveGroup === "knowledge" ? "knowledge.manage" : "testcase.create";
  const canPublish = canRun && hasPermission(session, publishPermission, projectId) && effectiveGroup === DEFAULT_GROUPS[agentType];
  const canPublishInScope = canPublish && (effectiveGroup === "knowledge" || Boolean(appTypeId));
  const selectablePageRows = pageRows.filter((item) => !published.has(item.id));
  const allPageSelected = selectablePageRows.length > 0 && selectablePageRows.every((item) => selected.has(item.id));
  const warnings = asArray(run?.warnings?.length ? run.warnings : run?.result?.warnings);
  const stages = asArray(run?.stages?.length ? run.stages : run?.result?.stages);
  const summary = run?.result?.summary || run?.summary || {};
  const metrics = ([
    ["files_scanned", "Files analyzed"],
    [agentType === "api_tests" ? "contracts_discovered" : agentType === "component_tests" ? "component_count" : agentType === "repository_knowledge" ? "knowledge_count" : "object_count", agentType === "api_tests" ? "API contracts" : agentType === "component_tests" ? "Components" : agentType === "repository_knowledge" ? "Knowledge documents" : "Screens & objects"],
    ["files_skipped", "Files excluded"]
  ] as const).filter(([key]) => typeof summary[key] === "number");
  const maxBytes = catalog.data?.limits.max_archive_bytes || 20 * 1024 * 1024;
  const requiresApplication = agentType !== "repository_knowledge";
  const canStart = canRun && Boolean(projectId) && (!requiresApplication || Boolean(appTypeId)) && catalog.data?.runtime.available === true;

  useEffect(() => { setSelected(new Set()); setSearch(""); setPublicationFilter("all"); setPage(1); setModuleId(""); }, [runId, effectiveGroup]);

  const reportError = (error: unknown, area: "source" | "review" = "source") => {
    if (!mounted.current || mutationController.current.signal.aborted) return;
    setMessageArea(area); setMessageTone("error"); setMessage(error instanceof Error ? error.message : "The request could not be completed. Try again.");
  };
  const refreshRuns = () => {
    void client.invalidateQueries({ queryKey: ["repository-agent-runs", projectId] });
    void client.invalidateQueries({ queryKey: ["repository-agent-run", projectId] });
  };
  const start = useMutation({
    mutationFn: () => sourceType === "zip"
      ? agenticApi.repositoryAgents.upload({ project_id: projectId, app_type_id: appTypeId || undefined, agent_type: agentType, file: file! }, { signal: mutationController.current.signal, idempotencyKey: launchKey.current.id })
      : agenticApi.repositoryAgents.create({ project_id: projectId, app_type_id: appTypeId || undefined, agent_type: agentType, source: { type: "github", repository_url: repositoryUrl.trim(), ref: ref.trim() || undefined, integration_id: integrationId || undefined } }, { signal: mutationController.current.signal, idempotencyKey: launchKey.current.id }),
    onSuccess: (next) => { if (!mounted.current) return; setMessage(""); refreshRuns(); onOpen(next.agent_type, next.id); }, onError: (error) => reportError(error)
  });
  const cancel = useMutation({
    mutationFn: () => agenticApi.repositoryAgents.cancel(runId, { signal: mutationController.current.signal }),
    onSuccess: (next) => { if (!mounted.current) return; client.setQueryData(["repository-agent-run", projectId, appTypeId, runId], next); refreshRuns(); }, onError: (error) => reportError(error)
  });
  const retry = useMutation({
    mutationFn: () => agenticApi.repositoryAgents.retry(runId, { signal: mutationController.current.signal }),
    onSuccess: (next) => { if (!mounted.current) return; setMessage(""); refreshRuns(); onOpen(next.agent_type, next.id); }, onError: (error) => reportError(error)
  });
  const publish = useMutation({
    mutationFn: () => agenticApi.repositoryAgents.publish(runId, { item_ids: selectedIds, module_id: effectiveGroup === "test_cases" ? moduleId || undefined : undefined }, { signal: mutationController.current.signal }),
    onSuccess: (result) => {
      if (!mounted.current) return;
      setSelected(new Set()); setMessageArea("review"); setMessageTone("success"); setPublishReceipt(result);
      setMessage(`${result.items.length} ${result.items.length === 1 ? "item" : "items"} published${result.skipped ? `; ${result.skipped} skipped` : ""}.${result.message ? ` ${result.message}` : ""}`);
      refreshRuns();
      for (const key of ["knowledge", "knowledge-sources", "knowledge-overview", "automation-learning-cache", "automation-repository-context", "test-cases", "test-case-modules"]) void client.invalidateQueries({ queryKey: [key] });
    }, onError: (error) => reportError(error, "review")
  });
  const busy = start.isPending || cancel.isPending || retry.isPending || publish.isPending;
  const chooseArchive = (archive?: File) => {
    if (!archive) return;
    if (!/\.zip$/i.test(archive.name) || archive.size === 0 || archive.size > maxBytes) {
      reportError(new Error(`Choose a nonempty .zip repository archive up to ${formatBytes(maxBytes)}.`));
      return;
    }
    setFile(archive); setMessage("");
  };
  const submit = (event: FormEvent) => {
    event.preventDefault(); setMessage("");
    if (!canStart) return;
    if (sourceType === "zip" && (!file || !/\.zip$/i.test(file.name) || file.size > maxBytes || file.size === 0)) { reportError(new Error(`Choose a nonempty .zip repository archive up to ${formatBytes(maxBytes)}.`)); return; }
    if (sourceType === "github") {
      try {
        const url = new URL(repositoryUrl.trim());
        if (url.protocol !== "https:" || url.hostname !== "github.com" || !/^\/[^/]+\/[^/]+\/?$/.test(url.pathname) || url.username || url.password || url.search || url.hash) throw new Error();
      } catch { reportError(new Error("Enter a GitHub repository URL such as https://github.com/owner/repository. Use a ZIP archive for other hosts.")); return; }
    }
    const signature = JSON.stringify([projectId, appTypeId, agentType, sourceType, repositoryUrl.trim(), ref.trim(), integrationId, file?.name, file?.size, file?.lastModified]);
    if (launchKey.current.signature !== signature) launchKey.current = { signature, id: crypto.randomUUID() };
    start.mutate();
  };
  const selectProfile = (id: string) => {
    setIntegrationId(id);
    const profile = asArray(githubProfiles.data).find((item) => item.id === id) as Integration | undefined;
    if (!repositoryUrl && profile?.config?.owner && profile.config.repo) setRepositoryUrl(`https://github.com/${profile.config.owner}/${profile.config.repo}`);
    if (!ref && typeof profile?.config?.branch === "string") setRef(profile.config.branch);
  };
  const download = async (name: string) => {
    setDownloading(name);
    try {
      const blob = await agenticApi.repositoryAgents.artifact(runId, name);
      if (!mounted.current) return;
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
      anchor.href = url; anchor.download = name.split(/[\\/]/).pop() || "agent-artifact";
      document.body.append(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { reportError(error); } finally { if (mounted.current) setDownloading(""); }
  };
  const toggle = (id: string) => setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else if (next.size < 50) next.add(id); return next; });

  return <div className={`repository-agents-workspace accent-${agent.accent}${runId ? " has-run" : ""}`}>
    <div className="repository-agent-workspace-heading">
      <button className="repository-agent-back" type="button" onClick={onBack}><IconArrowLeft size={16} aria-hidden="true" /> All agents</button>
      <nav className="repository-agent-journey" aria-label="Analysis steps"><span aria-current={!runId ? "step" : undefined}><b>{runId ? <IconCheck size={12} /> : "1"}</b> Source</span><IconChevronRight size={14} aria-hidden="true" /><span aria-current={runId ? "step" : undefined}><b>2</b> Review & publish</span></nav>
      <div className="repository-agent-heading-actions"><button className="ghost-button compact" type="button" aria-expanded={historyOpen} onClick={() => setHistoryOpen((open) => !open)}><IconClock size={15} aria-hidden="true" /> Recent analyses</button>{runId && canRun ? <button className="ghost-button compact" type="button" disabled={busy} onClick={() => onOpen(agentType)}><IconFileCode size={15} aria-hidden="true" /> New analysis</button> : null}</div>
    </div>
    {!canView ? <div className="repository-agent-notice is-warning" role="status">Repository agents are unavailable in this project or your role cannot view agent runs.</div> : null}
    {message && messageArea !== "review" ? <div className={`repository-agent-notice is-${messageTone}`} role={messageTone === "error" ? "alert" : "status"}>{message}<button type="button" aria-label="Dismiss agent message" onClick={() => setMessage("")}>×</button></div> : null}
    {publishReceipt?.skipped_items?.length ? <details className="repository-agent-warning-list repository-agent-publish-skips"><summary>{publishReceipt.skipped_items.length} {publishReceipt.skipped_items.length === 1 ? "item was" : "items were"} skipped during publishing <IconChevronRight size={15} aria-hidden="true" /></summary><ul>{publishReceipt.skipped_items.map((item) => <li key={item.finding_id}><strong>{rows.find((row) => row.id === item.finding_id)?.title || "Finding"}: </strong>{item.reason}</li>)}</ul></details> : null}
    {historyOpen ? <div className="repository-agent-history-panel">        <section className="repository-agent-history" aria-labelledby="repository-agent-history-title">
          <header><h3 id="repository-agent-history-title">Recent analyses</h3><button type="button" className="icon-button" aria-label="Refresh recent analyses" disabled={history.isFetching} onClick={() => void history.refetch()}><IconRefresh size={16} /></button></header>
          {history.isLoading ? <LoadingState label="Loading analyses" /> : history.isError ? <p className="repository-agent-error">Recent analyses could not be loaded.</p> : !asArray(history.data?.items).length ? <p className="repository-agent-muted">Your analyses will appear here. You can return to review their results.</p> : <div className="repository-agent-history-list">{asArray(history.data?.items).map((item) => <button type="button" key={item.id} className={item.id === runId ? "is-selected" : ""} aria-current={item.id === runId ? "true" : undefined} onClick={() => onOpen(item.agent_type, item.id)}><span><strong>{item.source?.name || "Repository"}</strong><RunBadge status={item.status} /></span><small>{REPOSITORY_AGENTS.find((entry) => entry.id === item.agent_type)?.outputLabel || item.agent_type} · {displayDate(item.created_at)}</small></button>)}</div>}
          {historyPage > 1 || history.data?.has_more ? <div className="repository-agent-pagination"><button className="text-button" type="button" disabled={historyPage <= 1 || history.isFetching} onClick={() => setHistoryPage((current) => current - 1)}>Previous</button><span>Page {historyPage}</span><button className="text-button" type="button" disabled={!history.data?.has_more || history.isFetching} onClick={() => setHistoryPage((current) => current + 1)}>Next</button></div> : null}
        </section></div> : null}
    <div className="repository-agent-workspace-grid">
      {!runId ? <aside className="repository-agent-source-column" aria-label="Repository source">
        <form className="repository-agent-source-card" onSubmit={submit}>
          <header><span className="repository-agent-symbol">{agent.icon}</span><div><span className="repository-agent-eyebrow">01 · Source</span><h2>Choose your repository</h2></div></header>
          <p>{agent.description}</p>
          <p className="repository-agent-inline-note">Source extraction runs without an LLM. Findings remain proposals until you review and publish them.</p>
          <details className="repository-agent-source-support"><summary>Supported source & limits</summary><p>{SOURCE_GUIDANCE[agentType].supported}</p><small>{SOURCE_GUIDANCE[agentType].limit}</small></details>
          <div className="repository-agent-source-switch" role="group" aria-label="Repository source type">
            <button aria-pressed={sourceType === "zip"} type="button" disabled={start.isPending} onClick={() => setSourceType("zip")}><IconUpload size={16} aria-hidden="true" /> ZIP archive</button>
            <button aria-pressed={sourceType === "github"} type="button" disabled={start.isPending} onClick={() => setSourceType("github")}><IconBrandGithub size={16} aria-hidden="true" /> GitHub</button>
          </div>
          {sourceType === "zip" ? <div className={`repository-agent-upload${dragActive ? " is-dragging" : ""}`}
            onDragOver={event => { event.preventDefault(); if (canRun && !start.isPending) setDragActive(true); }}
            onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragActive(false); }}
            onDrop={event => {
              event.preventDefault(); setDragActive(false);
              if (!canRun || start.isPending) return;
              if (event.dataTransfer.files.length !== 1) { reportError(new Error("Drop one repository ZIP archive at a time.")); return; }
              chooseArchive(event.dataTransfer.files[0]);
            }}>
            <IconFileCode size={30} aria-hidden="true" /><strong>{file?.name || "Add a repository archive"}</strong>
            <span>{file ? formatBytes(file.size) : `Drop a .zip here · up to ${formatBytes(maxBytes)}`}</span>
            <label className="ghost-button compact">{file ? "Choose another file" : "Choose ZIP file"}<input ref={fileInput} aria-label="Repository ZIP archive" type="file" accept=".zip,application/zip" disabled={!canRun || start.isPending} onChange={(event) => chooseArchive(event.target.files?.[0])} /></label>
            {file && <button className="text-button" type="button" disabled={start.isPending} onClick={() => { setFile(null); if (fileInput.current) fileInput.current.value = ""; }} aria-label={`Remove ${file.name}`}>Remove file</button>}
            <small>Source files are analyzed without running repository commands.</small>
          </div> : <div className="repository-agent-fields">
            <label>Repository URL<input type="url" value={repositoryUrl} placeholder="https://github.com/owner/repository" disabled={start.isPending} onChange={(event) => setRepositoryUrl(event.target.value)} required={sourceType === "github"} /></label>
            <label>Branch, tag or commit <span>Optional</span><input value={ref} placeholder="Repository default branch" maxLength={200} disabled={start.isPending} onChange={(event) => setRef(event.target.value)} /></label>
            <label>GitHub connection <span>Optional for public repos</span><select value={integrationId} disabled={start.isPending || githubProfiles.isLoading} onChange={(event) => selectProfile(event.target.value)}><option value="">Public repository · no credentials</option>{asArray(githubProfiles.data).filter((item) => item.type === "github" && item.config?.project_id === projectId).map((profile) => <option key={profile.id} value={profile.id}>{profile.name}{profile.is_active ? "" : " · inactive"}</option>)}</select></label>
            {githubProfiles.isError ? <small className="repository-agent-error">Connections could not be loaded. <button className="text-button" type="button" onClick={() => void githubProfiles.refetch()}>Try again</button></small> : <small>Private repositories require a saved connection with access to this repository.</small>}
          </div>}
          <div className="repository-agent-scope"><IconDatabase size={15} aria-hidden="true" /><div><span>Publish destination</span><strong>{scopeLabel || "Select a project"}</strong></div></div>
          {catalog.isError ? <div className="repository-agent-inline-note is-error">Agent availability could not be checked. <button className="text-button" type="button" onClick={() => void catalog.refetch()}>Check again</button></div> : catalog.data?.runtime.available === false ? <p className="repository-agent-inline-note is-error">{catalog.data.runtime.detail || "The repository analysis runtime is unavailable."}</p> : null}
          {requiresApplication && !appTypeId ? <p className="repository-agent-inline-note">Select an application to generate assets for this agent.</p> : null}
          {!canRun ? <p className="repository-agent-inline-note">Your role can review runs. Starting an analysis requires permission to run agents.</p> : null}
          <button type="submit" className="primary-button repository-agent-start" disabled={!canStart || busy || (sourceType === "zip" ? !file : !repositoryUrl.trim())}>{start.isPending ? <><LoadingState label="Preparing analysis" /> Preparing analysis…</> : <><IconArrowRight size={17} aria-hidden="true" /> Analyze repository</>}</button>
          <small className="repository-agent-source-note">{agent.outcome}</small>
        </form>

      </aside> : null}
      <section className="repository-agent-output" aria-label="Repository agent analysis">
        {!runId ? <section className="repository-agent-welcome"><span className="repository-agent-welcome-icon">{agent.icon}</span><span className="repository-agent-eyebrow">Built for a reviewable outcome</span><h2>{agent.outputLabel}, grounded in your source</h2><p>{agent.outcome}</p><ol><li><span>1</span><div><strong>Choose a source</strong><p>Upload a ZIP or connect a GitHub repository.</p></div></li><li><span>2</span><div><strong>Follow the analysis</strong><p>See source discovery, quality checks and any evidence gaps.</p></div></li><li><span>3</span><div><strong>Review and publish</strong><p>Inspect source locations, select useful findings and publish them.</p></div></li></ol><p className="repository-agent-limit-note"><IconShieldCheck size={16} aria-hidden="true" /> Generated tests and locator candidates still need validation against your running application.</p></section> : selectedRun.isLoading ? <LoadingState label="Loading analysis" /> : selectedRun.isError || !run ? <section className="repository-agent-welcome"><h2>Analysis unavailable</h2><p>{selectedRun.error instanceof Error ? selectedRun.error.message : "This analysis does not belong to the selected project, application or agent."}</p><button type="button" className="ghost-button" onClick={() => void selectedRun.refetch()}>Try again</button></section> : <>
          <section className="repository-agent-receipt">
            <header><div><span className="repository-agent-eyebrow">{agent.outputLabel} · Source snapshot</span><h2>{run.source?.name || "Repository analysis"}</h2></div><div className="repository-agent-receipt-status"><RunBadge status={run.status} /><button type="button" className="icon-button" aria-label="Refresh status" title="Refresh status" disabled={selectedRun.isFetching} onClick={() => void selectedRun.refetch()}><IconRefresh size={15} aria-hidden="true" /></button></div></header>
            <div className="repository-agent-run-meta"><span><IconDatabase size={14} aria-hidden="true" />{scopeLabel}</span><span>{run.source?.type === "github" ? <IconBrandGithub size={14} aria-hidden="true" /> : <IconUpload size={14} aria-hidden="true" />}{run.source?.type === "github" ? "GitHub" : "ZIP archive"}</span><span><IconClock size={14} aria-hidden="true" />{displayDate(run.created_at)}</span>{run.source?.ref ? <span><IconGitBranch size={14} aria-hidden="true" />{run.source.ref}</span> : null}{run.source?.commit_sha ? <code title={run.source.commit_sha}>{run.source.commit_sha.slice(0, 12)}</code> : null}{typeof run.source?.file_count === "number" ? <span>{run.source.file_count.toLocaleString()} source files</span> : null}</div>
            {metrics.length ? <dl className="repository-agent-analysis-metrics">{metrics.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{Number(summary[key]).toLocaleString()}</dd></div>)}</dl> : null}
            {run.cached_from ? <p className="repository-agent-cache-note"><IconCheck size={14} aria-hidden="true" /> Reused results from the same source content and compiler version.</p> : null}
            {active ? <div className="repository-agent-progress"><div role="progressbar" aria-label="Repository analysis progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.max(0, Math.min(100, run.progress || 0))}><span style={{ width: `${Math.max(2, Math.min(100, run.progress || 0))}%` }} /></div><span aria-live="polite">{Math.round(run.progress || 0)}% · {stages.find((stage) => stage.status === "running")?.label || "Preparing repository analysis"}</span></div> : null}
            {canRun && (active || ["failed", "cancelled"].includes(run.status)) ? <div className="repository-agent-run-actions">{active && canRun ? <button type="button" className="ghost-button compact" disabled={busy} onClick={() => cancel.mutate()}><IconPlayerStop size={14} aria-hidden="true" />{cancel.isPending ? "Cancelling…" : "Cancel analysis"}</button> : null}{!active && canRun && ["failed", "cancelled"].includes(run.status) ? <button type="button" className="ghost-button compact" disabled={busy || !canStart} onClick={() => retry.mutate()}><IconRefresh size={14} aria-hidden="true" />{retry.isPending ? "Retrying…" : "Retry analysis"}</button> : null}</div> : null}
            {run.error ? <p className="repository-agent-inline-note is-error" role="alert">{run.error}</p> : null}
            {stages.length ? <details className="repository-agent-stages" open={active}><summary>Analysis workflow <span>{stages.filter((stage) => ["completed", "passed", "success"].includes(stage.status)).length} of {stages.length} complete</span><IconChevronRight size={15} aria-hidden="true" /></summary><ol>{stages.map((stage, index) => <li key={`${stage.id}-${index}`}><span className={`repository-agent-stage-marker is-${stage.status}`}>{["completed", "passed", "success"].includes(stage.status) ? <IconCheck size={14} /> : stage.status === "running" ? <LoadingState label={`Running ${stage.label}`} /> : index + 1}</span><div><strong>{stage.label}</strong>{stage.detail ? <p>{stage.detail}</p> : null}</div><small>{["completed", "passed", "success"].includes(stage.status) ? "Complete" : statusLabels[stage.status] || stage.status}{typeof stage.duration_ms === "number" ? ` · ${(stage.duration_ms / 1000).toFixed(1)}s` : ""}</small></li>)}</ol></details> : null}
          </section>
          {warnings.length ? <details className="repository-agent-warning-list" open={run.status === "partial"}><summary>{warnings.length} analysis {warnings.length === 1 ? "note" : "notes"} · review source coverage <IconChevronRight size={15} aria-hidden="true" /></summary><ul>{warnings.slice(0, 30).map((warning, index) => <li key={`${warning.code}-${index}`}>{warning.message}</li>)}</ul>{warnings.length > 30 ? <p>Additional warnings are included in the analysis artifacts.</p> : null}</details> : null}
          {run.result ? <section className="repository-agent-review" aria-labelledby="repository-agent-review-title">
            <header><div><span className="repository-agent-eyebrow">Review & publish</span><h2 id="repository-agent-review-title">Review generated findings</h2><p>{SOURCE_GUIDANCE[agentType].review}</p></div><span className="repository-agent-count"><IconShieldCheck size={14} aria-hidden="true" /> Review before use</span></header>
            {groups.length ? <>
              <div className="repository-agent-result-tabs" aria-label="Finding categories">{groups.map((key) => <button type="button" key={key} aria-pressed={effectiveGroup === key} onClick={() => { setGroup(key); setSelected(new Set()); setPage(1); }}><span>{groupLabels[key]}</span><strong>{asArray(findings?.[key]).length}</strong></button>)}</div>
              <div className="repository-agent-review-toolbar"><label className="repository-agent-search"><IconSearch size={16} aria-hidden="true" /><input type="search" value={search} aria-label="Search generated findings" placeholder="Find by name, locator or source…" onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></label><span>{selectedIds.length ? `${selectedIds.length}/50 selected` : `${filtered.length} ${groupLabels[effectiveGroup].toLowerCase()}`}</span></div>
              {effectiveGroup !== "components" ? <div className="repository-agent-publication-filters" role="group" aria-label="Publication status">{([["all", "All findings", rows.length], ["pending", "To publish", publishableRows.length], ["published", "Published", rows.length - publishableRows.length]] as const).map(([value, label, count]) => <button type="button" key={value} aria-label={label} aria-pressed={publicationFilter === value} onClick={() => { setPublicationFilter(value); setSelected(new Set()); setPage(1); }}><span>{label}</span><strong aria-hidden="true">{count}</strong></button>)}</div> : null}
              {canPublishInScope && publishableRows.length ? <div className="repository-agent-selection-row"><label><input type="checkbox" ref={(element) => { if (element) element.indeterminate = !allPageSelected && pageRows.some((item) => selected.has(item.id)); }} checked={allPageSelected} disabled={busy || !selectablePageRows.length || (selected.size >= 50 && !selectablePageRows.some((item) => selected.has(item.id)))} onChange={() => setSelected((current) => { const next = new Set(current); for (const item of selectablePageRows) if (!published.has(item.id)) { if (allPageSelected) next.delete(item.id); else if (next.size < 50) next.add(item.id); } return next; })} /> Select this page</label>{selected.size ? <button type="button" className="text-button" disabled={busy} onClick={() => setSelected(new Set())}>Clear selection</button> : null}</div> : null}
              <div className="repository-agent-findings">{pageRows.map((finding) => { const title = stringValue(finding.title || finding.name || finding.object_name || finding.screen_name) || "Untitled finding"; const target = published.get(finding.id); const evidenceLevel = typeof finding.confidence === "number" ? finding.confidence >= .9 ? "Direct source evidence" : finding.confidence >= .75 ? "Source-based draft" : "Needs closer review" : "Review required"; const firstEvidence = asArray(finding.evidence)[0]; return <article className={`repository-agent-finding ${selected.has(finding.id) ? "is-selected" : ""}`} key={finding.id}>
                <div className="repository-agent-finding-select">{target ? <IconCheck size={17} aria-label="Published" /> : canPublishInScope ? <input type="checkbox" checked={selected.has(finding.id)} disabled={busy || (!selected.has(finding.id) && selected.size >= 50)} onChange={() => toggle(finding.id)} aria-label={`Select ${title}`} /> : <IconFileCode size={17} aria-hidden="true" />}</div>
                <details><summary><div><strong>{title}</strong><span>{firstEvidence ? `${firstEvidence.path}${firstEvidence.line ? `:${firstEvidence.line}` : ""}` : "Source evidence needs review"}</span></div><div className="repository-agent-finding-tags">{target ? <span className="is-published">Published</span> : effectiveGroup === "objects" && finding.record_type === "screen" ? <span>Screen</span> : <span title="Static evidence quality. Runtime behavior still requires validation.">{evidenceLevel}</span>}<IconChevronRight size={16} aria-hidden="true" /></div></summary><FindingPreview finding={finding} group={effectiveGroup} />{target && safeInternalUrl(target.url) ? <Link className="repository-agent-target-link" to={safeInternalUrl(target.url)!}>Open published {groupLabels[effectiveGroup].toLowerCase().replace(/s$/, "")} <IconArrowRight size={14} aria-hidden="true" /></Link> : null}</details>
              </article>; })}</div>
              {!pageRows.length ? <p className="repository-agent-empty-filter">{publicationFilter === "published" && !search ? "No findings have been published yet. Select reviewed findings to create your assets." : publicationFilter === "pending" && !search ? "Every finding in this category has been published. Open Published to continue with the created assets." : "No findings match these filters."}</p> : null}
              {pageCount > 1 ? <div className="repository-agent-pagination"><button type="button" className="ghost-button compact" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Previous</button><span>{(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length}</span><button type="button" className="ghost-button compact" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>Next</button></div> : null}
              {message && messageArea === "review" ? <div className={`repository-agent-notice repository-agent-review-message is-${messageTone}`} role={messageTone === "error" ? "alert" : "status"}>{message}<button type="button" aria-label="Dismiss agent message" onClick={() => setMessage("")}>×</button></div> : null}
              <footer className="repository-agent-publish"><div><strong>{effectiveGroup === "objects" ? "Publish to Object Repository" : effectiveGroup === "knowledge" ? "Publish to Knowledge Repo" : effectiveGroup === "components" ? "Component discovery evidence" : "Create draft test cases"}</strong><p>{effectiveGroup === "components" ? "Use these discoveries to review the generated contracts and downloadable specs." : !canPublish ? "Your role can inspect these findings. Publishing requires permission to create the target assets." : !canPublishInScope ? "Select an application before generating an analysis to publish test cases into it." : "Select the findings you have reviewed. Publishing creates assets in the current project and application."}</p></div>{canPublishInScope ? <div className="repository-agent-publish-controls">{effectiveGroup === "test_cases" && hasPermission(session, "testcase.update", projectId) ? <label>Module<select aria-label="Module" value={moduleId} disabled={busy || modules.isLoading} onChange={(event) => setModuleId(event.target.value)}><option value="">No module</option>{asArray(modules.data).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : null}<button type="button" className="primary-button" disabled={!selectedIds.length || busy || active} onClick={() => publish.mutate()}><IconCheck size={16} aria-hidden="true" />{publish.isPending ? "Publishing…" : `Publish selected${selectedIds.length ? ` (${selectedIds.length})` : ""}`}</button></div> : null}</footer>
            </> : <div className="repository-agent-empty-filter"><h3>No publishable findings were produced</h3><p>Review the analysis workflow and warnings for unsupported frameworks, missing routes or insufficient source evidence. You can try a different repository revision.</p></div>}
          </section> : !active ? <div className="repository-agent-empty-filter">{run.status === "cancelled" ? "This analysis was cancelled. Retry when you are ready." : "No generated findings are available for this analysis."}</div> : null}
          {run.result?.llm_review && <section className="repository-agent-artifacts"><h3>LLM source review</h3><div aria-label="Complete source review" className="repository-agent-model-output" role="region" tabIndex={0}><FormattedText text={run.result.llm_review.response} /></div>{run.result.llm_review.model_execution && <small>{run.result.llm_review.model_execution.effective_model} · {run.result.llm_review.model_execution.model_calls} model calls</small>}</section>}
          {asArray(run.result?.artifacts).length ? <section className="repository-agent-artifacts"><header><div><h3>Analysis artifacts</h3><p>Download generated contracts and source reports. Test scaffolds require application setup and review before execution.</p></div></header><div>{asArray(run.result?.artifacts).map((artifact) => <button type="button" className="repository-agent-artifact" key={artifact.name} disabled={Boolean(downloading)} onClick={() => void download(artifact.name)}><IconFileCode size={18} aria-hidden="true" /><span>{artifact.name}{typeof artifact.size_bytes === "number" ? <small>{artifact.size_bytes < 1024 ? `${artifact.size_bytes} B` : `${Math.ceil(artifact.size_bytes / 1024)} KB`}</small> : null}</span>{downloading === artifact.name ? <LoadingState label={`Downloading ${artifact.name}`} /> : <IconDownload size={16} aria-hidden="true" />}</button>)}</div></section> : null}
        </>}
      </section>
    </div>
  </div>;
}
