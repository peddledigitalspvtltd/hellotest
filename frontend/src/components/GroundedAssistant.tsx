import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  IconAlertTriangle,
  IconBook2,
  IconChevronDown,
  IconDownload,
  IconExternalLink,
  IconLock,
  IconMessageCircle,
  IconPlus,
  IconRobot,
  IconSend,
  IconShieldCheck,
  IconSparkles,
  IconX
} from "@tabler/icons-react";
import { useAuth } from "../auth/AuthContext";
import { useCurrentAppType, useCurrentProject } from "../hooks/useCurrentProject";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { useFeatureFlags } from "../hooks/useFeatureFlags";
import { useAiPromptRegistry } from "../hooks/useAiPromptRegistry";
import { api } from "../lib/api";
import { areFeatureFlagsEnabled } from "../lib/featureFlags";
import { hasPermission } from "../lib/permissions";
import type {
  KnowledgeAssistantMessage,
  KnowledgeAssistantMessageResponse,
  KnowledgeAssistantSession,
  KnowledgeAssistantIntegration,
  KnowledgeCitation,
  KnowledgeSearchFilters
} from "../types";
import "./GroundedAssistant.css";

const EMPTY_CITATIONS: KnowledgeCitation[] = [];
const DEFAULT_ASSISTANT_SOURCE_KINDS = ["requirement", "test_case", "execution", "bug", "file", "text", "chat"];
const ASSISTANT_LLM_SELECTION_STORAGE_PREFIX = "hellotest:knowledge-assistant:llm";

const starterPrompts = [
  "Summarize the current project and its main quality risks.",
  "Which Stories do not have enough test coverage?",
  "What failed recently and what evidence supports the answer?"
];

function createClientTurnId() {
  const randomId = globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `assistant-turn-${randomId}`;
}

function assistantLlmSelectionStorageKey(userId: string, projectId: string) {
  return `${ASSISTANT_LLM_SELECTION_STORAGE_PREFIX}:${userId}:${projectId}`;
}

function readStoredLlmSelection(key: string) {
  try {
    return window.localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function persistLlmSelection(key: string, integrationId: string) {
  try {
    if (integrationId) window.localStorage.setItem(key, integrationId);
    else window.localStorage.removeItem(key);
  } catch {
    // A browser may block local storage; the in-memory selection still works.
  }
}

function integrationOptionLabel(integration: KnowledgeAssistantIntegration) {
  const model = integration.model?.trim();
  return `${integration.name}${model ? ` · ${model}` : ""} · ${integration.scope === "project" ? "Project" : "Workspace"}`;
}

function safeSession(value: KnowledgeAssistantSession | { session?: KnowledgeAssistantSession }) {
  return "session" in value && value.session ? value.session : value as KnowledgeAssistantSession;
}

function normalizeAnswer(response: KnowledgeAssistantMessageResponse): KnowledgeAssistantMessage {
  const rawMessage = response.assistant_message || response.message;
  const citations = rawMessage?.citations?.length
    ? rawMessage.citations
    : response.citations || EMPTY_CITATIONS;
  const content = rawMessage?.content?.trim() || "I could not produce a grounded answer from the available project context.";
  const safetyStatus = String(rawMessage?.safety?.status || rawMessage?.status || "").toLowerCase();
  const groundingStatus = rawMessage?.grounding_status
    || (safetyStatus.includes("provider_unavailable") ? "provider_unavailable" : safetyStatus.includes("outside") || safetyStatus.includes("refus") ? "refused" : citations.length ? "grounded" : "insufficient_context");

  return {
    ...rawMessage,
    id: rawMessage?.id || `assistant-${Date.now()}`,
    role: "assistant",
    content,
    citations,
    grounding_status: groundingStatus,
    retrieval: rawMessage?.retrieval || response.retrieval,
    guardrails: rawMessage?.guardrails || response.guardrails || [],
    provenance: rawMessage?.provenance || response.provenance || {
      provider: rawMessage?.provider,
      model: rawMessage?.model,
      generation_mode: "retrieval_augmented"
    },
    status: "complete"
  };
}

function citationHref(citation: KnowledgeCitation) {
  const uri = String(citation.uri || citation.source_uri || "").trim();
  return /^https?:\/\//i.test(uri) ? uri : "";
}

function groundingLabel(value?: string) {
  if (value === "grounded") return "Grounded";
  if (value === "partially_grounded") return "Partially grounded";
  if (value === "refused") return "Request blocked";
  if (value === "provider_unavailable") return "Provider unavailable";
  return "Insufficient context";
}

export function GroundedAssistant() {
  const { session } = useAuth();
  const [projectId] = useCurrentProject();
  const [appTypeId] = useCurrentAppType(projectId);
  const featureFlagsQuery = useFeatureFlags(Boolean(session));
  const { getLlmIntegrationId, query: promptRegistryQuery } = useAiPromptRegistry(Boolean(session));
  const [isOpen, setIsOpen] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [messages, setMessages] = useState<KnowledgeAssistantMessage[]>([]);
  const [prompt, setPrompt] = useState("");
  const [expandedSources, setExpandedSources] = useState<Record<string, boolean>>({});
  const [retryTurns, setRetryTurns] = useState<Record<string, { clientTurnId: string; integrationId: string; prompt: string }>>({});
  const [citationDownloadError, setCitationDownloadError] = useState("");
  const [sourceKinds, setSourceKinds] = useState<string[]>(DEFAULT_ASSISTANT_SOURCE_KINDS);
  const [selectedIntegrationId, setSelectedIntegrationId] = useState("");
  const [activeRequestIntegrationId, setActiveRequestIntegrationId] = useState("");
  const conversationEndRef = useRef<HTMLDivElement | null>(null);
  const requestControllerRef = useRef<AbortController | null>(null);
  const scopeGenerationRef = useRef(0);
  const dialogRef = useDialogFocus<HTMLElement>({ active: isOpen, onClose: () => setIsOpen(false) });

  const canUseAssistant = Boolean(projectId)
    && hasPermission(session, "knowledge.view", projectId)
    && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.ai.knowledge"]);

  const integrationsQuery = useQuery({
    queryKey: ["knowledge-assistant-integrations", projectId],
    queryFn: () => api.knowledgeRepo.assistant.listIntegrations(projectId),
    enabled: canUseAssistant,
    staleTime: 60_000
  });
  const assistantIntegrations = useMemo(() => {
    const seen = new Set<string>();
    return (integrationsQuery.data || []).filter((integration) => {
      const isInScope = integration.scope === "workspace"
        || (integration.scope === "project" && integration.project_id === projectId);
      if (!isInScope || seen.has(integration.id)) return false;
      seen.add(integration.id);
      return true;
    });
  }, [integrationsQuery.data, projectId]);
  const configuredDefaultIntegrationId = getLlmIntegrationId("ai.knowledge.assistant");
  const integrationSelectionStorageKey = assistantLlmSelectionStorageKey(session?.user.id || "anonymous", projectId || "none");
  const activeRequestIntegration = assistantIntegrations.find((integration) => integration.id === activeRequestIntegrationId)
    || assistantIntegrations.find((integration) => integration.id === selectedIntegrationId)
    || null;

  const createSessionMutation = useMutation({
    mutationFn: ({ appId, integrationId, project, signal }: { appId: string; integrationId: string; project: string; signal: AbortSignal }) =>
      api.knowledgeRepo.assistant.createSession({
        project_id: project,
        app_type_id: appId || null,
        integration_id: integrationId,
        title: "HelloTest project assistant"
      }, { signal })
  });
  const sendMessageMutation = useMutation({
    mutationFn: ({ clientTurnId, id, integrationId, message, filters, signal }: { clientTurnId: string; id: string; integrationId: string; message: string; filters: KnowledgeSearchFilters; signal: AbortSignal }) =>
      api.knowledgeRepo.assistant.sendMessage(id, {
        message,
        client_turn_id: clientTurnId,
        integration_id: integrationId,
        filters
      }, { signal })
  });
  const downloadCitationMutation = useMutation({
    mutationFn: async (citation: KnowledgeCitation) => ({
      blob: await api.knowledgeRepo.downloadSource(String(citation.source_id)),
      citation
    }),
    onMutate: () => setCitationDownloadError(""),
    onSuccess: ({ blob, citation }) => {
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = String(citation.title || citation.label || "knowledge-source").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 180);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    },
    onError: (error) => setCitationDownloadError(error instanceof Error ? error.message : "This source file could not be downloaded.")
  });

  const isSending = createSessionMutation.isPending || sendMessageMutation.isPending;

  useEffect(() => {
    scopeGenerationRef.current += 1;
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    createSessionMutation.reset();
    sendMessageMutation.reset();
    setSessionId("");
    setMessages([]);
    setPrompt("");
    setExpandedSources({});
    setRetryTurns({});
    setCitationDownloadError("");
    setSelectedIntegrationId("");
    setActiveRequestIntegrationId("");
  }, [projectId, appTypeId, session?.user.id]);

  useEffect(() => {
    if (!integrationsQuery.isSuccess || promptRegistryQuery.isLoading) return;
    const storedIntegrationId = readStoredLlmSelection(integrationSelectionStorageKey);
    const hasIntegration = (id: string | undefined): id is string => Boolean(id && assistantIntegrations.some((integration) => integration.id === id));
    if (storedIntegrationId && !hasIntegration(storedIntegrationId)) {
      persistLlmSelection(integrationSelectionStorageKey, "");
    }
    const nextIntegrationId = [
      storedIntegrationId,
      assistantIntegrations.find((integration) => integration.is_default)?.id,
      configuredDefaultIntegrationId,
      assistantIntegrations.find((integration) => integration.scope === "project")?.id,
      assistantIntegrations[0]?.id
    ].find(hasIntegration) || "";
    setSelectedIntegrationId(nextIntegrationId);
  }, [
    assistantIntegrations,
    configuredDefaultIntegrationId,
    integrationSelectionStorageKey,
    integrationsQuery.isSuccess,
    promptRegistryQuery.isLoading
  ]);

  useEffect(() => () => requestControllerRef.current?.abort(), []);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!canUseAssistant || !(event.ctrlKey || event.metaKey) || !event.shiftKey || event.key.toLowerCase() !== "h") return;
      event.preventDefault();
      setIsOpen((current) => !current);
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [canUseAssistant]);

  useEffect(() => {
    conversationEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages, isSending]);

  if (!canUseAssistant) return null;

  const startNewChat = () => {
    if (isSending) return;
    setSessionId("");
    setMessages([]);
    setPrompt("");
    setExpandedSources({});
    setRetryTurns({});
    setCitationDownloadError("");
  };

  const submitPrompt = async (event?: FormEvent, retry?: { clientTurnId: string; errorMessageId: string; integrationId: string; prompt: string }) => {
    event?.preventDefault();
    const normalizedPrompt = (retry?.prompt || prompt).trim();
    const requestIntegrationId = retry?.integrationId || selectedIntegrationId;
    if (!normalizedPrompt || !requestIntegrationId || isSending) return;
    const requestGeneration = scopeGenerationRef.current;
    const requestProjectId = projectId;
    const requestAppTypeId = appTypeId;
    const requestSourceKinds = [...sourceKinds];
    const apiSourceKinds = requestSourceKinds.length === DEFAULT_ASSISTANT_SOURCE_KINDS.length
      ? undefined
      : Array.from(new Set([
          ...requestSourceKinds,
          "product_help",
          ...(requestSourceKinds.includes("text") ? ["knowledge_item"] : [])
        ]));
    const clientTurnId = retry?.clientTurnId || createClientTurnId();
    const controller = new AbortController();
    requestControllerRef.current?.abort();
    requestControllerRef.current = controller;
    setActiveRequestIntegrationId(requestIntegrationId);
    const isStale = () => controller.signal.aborted || requestGeneration !== scopeGenerationRef.current;

    const userMessage: KnowledgeAssistantMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: normalizedPrompt,
      citations: [],
      status: "complete",
      created_at: new Date().toISOString()
    };
    if (retry) {
      setMessages((current) => current.filter((message) => message.id !== retry.errorMessageId));
      setRetryTurns((current) => {
        const next = { ...current };
        delete next[retry.errorMessageId];
        return next;
      });
    } else {
      setMessages((current) => [...current, userMessage]);
      setPrompt("");
    }

    try {
      let activeSessionId = sessionId;
      if (!activeSessionId) {
        const created = safeSession(await createSessionMutation.mutateAsync({
          appId: requestAppTypeId,
          integrationId: requestIntegrationId,
          project: requestProjectId,
          signal: controller.signal
        }));
        if (isStale()) return;
        activeSessionId = created.id;
        setSessionId(created.id);
        const restoredMessages = created.messages || [];
        if (restoredMessages.length) {
          setMessages((current) => [...restoredMessages, ...current]);
        }
      }

      const response = await sendMessageMutation.mutateAsync({
        clientTurnId,
        id: activeSessionId,
        integrationId: requestIntegrationId,
        message: normalizedPrompt,
        filters: {
          app_type_id: requestAppTypeId || null,
          source_kinds: apiSourceKinds
        },
        signal: controller.signal
      });
      if (isStale()) return;
      if (response.pending) {
        throw new Error(`This grounded answer is still processing. Retry in ${response.retry_after_seconds || 3} seconds; the same turn will be resumed without duplicate model work.`);
      }
      setMessages((current) => [...current, normalizeAnswer(response)]);
    } catch (error) {
      if (isStale()) return;
      const errorMessageId = `assistant-error-${Date.now()}`;
      setRetryTurns((current) => ({ ...current, [errorMessageId]: { clientTurnId, integrationId: requestIntegrationId, prompt: normalizedPrompt } }));
      setMessages((current) => [...current, {
        id: errorMessageId,
        role: "assistant",
        content: error instanceof Error ? error.message : "The grounded assistant is temporarily unavailable.",
        citations: [],
        grounding_status: "insufficient_context",
        status: "failed",
        created_at: new Date().toISOString()
      }]);
    } finally {
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null;
        setActiveRequestIntegrationId("");
      }
    }
  };

  return (
    <>
      <button
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label="Open HelloTest grounded assistant"
        className="grounded-assistant-trigger"
        onClick={() => setIsOpen(true)}
        title="Ask HelloTest · Ctrl/⌘ + Shift + H"
        type="button"
      >
        <span className="grounded-assistant-trigger-icon"><IconSparkles size={22} stroke={1.9} /></span>
        <span className="grounded-assistant-trigger-label">Ask HelloTest</span>
      </button>

      {isOpen ? (
        <aside
          aria-label="HelloTest grounded project assistant"
          aria-modal="true"
          className="grounded-assistant-panel"
          ref={dialogRef}
          role="dialog"
          tabIndex={-1}
        >
          <header className="grounded-assistant-header">
            <div className="grounded-assistant-identity">
              <span aria-hidden="true" className="grounded-assistant-avatar"><IconRobot size={22} /></span>
              <div>
                <span className="eyebrow">Project-grounded AI</span>
                <h2>Ask HelloTest</h2>
              </div>
            </div>
            <div className="grounded-assistant-header-actions">
              <label className="grounded-assistant-model-select" title={activeRequestIntegration ? integrationOptionLabel(activeRequestIntegration) : "Select a configured LLM"}>
                <IconSparkles aria-hidden="true" size={14} stroke={1.9} />
                <span className="sr-only">Answer model</span>
                <select
                  aria-label="Answer model"
                  disabled={isSending || integrationsQuery.isLoading || !assistantIntegrations.length}
                  onChange={(event) => {
                    setSelectedIntegrationId(event.target.value);
                    persistLlmSelection(integrationSelectionStorageKey, event.target.value);
                  }}
                  value={selectedIntegrationId}
                >
                  {!selectedIntegrationId ? (
                    <option disabled value="">
                      {integrationsQuery.isLoading ? "Loading models…" : integrationsQuery.isError ? "Models unavailable" : "No LLM configured"}
                    </option>
                  ) : null}
                  {assistantIntegrations.map((integration) => (
                    <option key={integration.id} value={integration.id}>{integrationOptionLabel(integration)}</option>
                  ))}
                </select>
                <IconChevronDown aria-hidden="true" className="grounded-assistant-model-chevron" size={13} stroke={2} />
              </label>
              <button aria-label="Start a new assistant chat" className="ghost-button grounded-assistant-icon-button" disabled={isSending} onClick={startNewChat} title="New chat" type="button">
                <IconPlus size={18} />
              </button>
              <button aria-label="Close grounded assistant" className="ghost-button grounded-assistant-icon-button" onClick={() => setIsOpen(false)} type="button">
                <IconX size={19} />
              </button>
            </div>
          </header>

          <div className="grounded-assistant-scope-bar">
            <span><IconLock size={14} /> Current project only</span>
            <span>{appTypeId ? "Current application" : "All applications"}</span>
          </div>

          <div aria-live="polite" className="grounded-assistant-conversation">
            {isSending ? (
              <div className="grounded-assistant-agent-status" role="status">
                <span aria-hidden="true" className="grounded-assistant-agent-status-icon"><IconSparkles size={13} stroke={2} /></span>
                <strong>{createSessionMutation.isPending ? "Preparing grounded session" : "Grounding answer"}</strong>
                <small>{activeRequestIntegration?.model || activeRequestIntegration?.name || "Selected model"}</small>
                <span aria-hidden="true" className="grounded-assistant-agent-status-dots"><i /><i /><i /></span>
              </div>
            ) : null}
            {!messages.length ? (
              <div className="grounded-assistant-welcome">
                <span className="grounded-assistant-welcome-icon"><IconBook2 size={26} /></span>
                <h3>Answers backed by your project evidence</h3>
                <p>I search indexed Stories, Test Cases, Runs, Bugs, conversations, and files. If the evidence is missing, I will say so instead of inventing an answer.</p>
                <div className="grounded-assistant-starters">
                  {starterPrompts.map((item) => (
                    <button key={item} onClick={() => setPrompt(item)} type="button">
                      <IconMessageCircle size={16} />
                      <span>{item}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {messages.map((message) => {
              const isAssistant = message.role === "assistant";
              const citations = message.citations || EMPTY_CITATIONS;
              const sourcesExpanded = Boolean(expandedSources[message.id]);
              return (
                <article className={`grounded-assistant-message is-${message.role}${message.status === "failed" ? " is-error" : ""}`} key={message.id}>
                  <div className="grounded-assistant-message-label">
                    {isAssistant ? <IconSparkles size={14} /> : null}
                    <span>{isAssistant ? "HelloTest" : "You"}</span>
                    {isAssistant ? (
                      <span className={`grounding-chip is-${message.grounding_status || "insufficient_context"}`}>
                        {message.grounding_status === "grounded" ? <IconShieldCheck size={13} /> : <IconAlertTriangle size={13} />}
                        {groundingLabel(message.grounding_status)}
                      </span>
                    ) : null}
                  </div>
                  <div className="grounded-assistant-message-content">{message.content}</div>
                  {message.status === "failed" && retryTurns[message.id] ? (
                    <button
                      className="grounded-assistant-retry"
                      disabled={isSending}
                      onClick={() => void submitPrompt(undefined, { ...retryTurns[message.id], errorMessageId: message.id })}
                      type="button"
                    >Retry this turn</button>
                  ) : null}
                  {isAssistant && citations.length ? (
                    <div className="grounded-assistant-sources">
                      <button
                        aria-expanded={sourcesExpanded}
                        className="grounded-assistant-sources-toggle"
                        onClick={() => setExpandedSources((current) => ({ ...current, [message.id]: !current[message.id] }))}
                        type="button"
                      >
                        <IconBook2 size={15} />
                        {citations.length} source{citations.length === 1 ? "" : "s"}
                        <IconChevronDown className={sourcesExpanded ? "is-expanded" : ""} size={15} />
                      </button>
                      {sourcesExpanded ? (
                        <ol className="grounded-assistant-citation-list">
                          {citations.map((citation, index) => {
                            const href = citationHref(citation);
                            const canDownload = citation.source_kind === "file" && Boolean(citation.source_id);
                            const content = (
                              <>
                                <span className="grounded-assistant-citation-index">{citation.index || index + 1}</span>
                                <span>
                                  <strong>{citation.title || citation.label || "Project source"}</strong>
                                  <small>
                                    {citation.source_kind?.replace(/_/g, " ") || "knowledge"}
                                    {citation.location?.page ? ` · page ${citation.location.page}` : citation.location?.heading ? ` · ${citation.location.heading}` : citation.location?.chunk_index !== undefined && citation.location?.chunk_index !== null ? ` · chunk ${citation.location.chunk_index + 1}` : ""}
                                    {citation.excerpt ? ` · ${citation.excerpt}` : ""}
                                  </small>
                                </span>
                                {href ? <IconExternalLink size={14} /> : canDownload ? <IconDownload size={14} /> : null}
                              </>
                            );
                            return <li key={`${citation.id}-${index}`}>{href
                              ? <a href={href} rel="noreferrer" target="_blank">{content}</a>
                              : canDownload
                                ? <button disabled={downloadCitationMutation.isPending} onClick={() => downloadCitationMutation.mutate(citation)} type="button">{content}</button>
                                : <div>{content}</div>}</li>;
                          })}
                        </ol>
                      ) : null}
                    </div>
                  ) : null}
                  {isAssistant && message.retrieval ? (
                    <div className="grounded-assistant-retrieval-note">
                      {message.retrieval.returned_count ?? citations.length} retrieved · {message.retrieval.mode || "hybrid"} search
                    </div>
                  ) : null}
                </article>
              );
            })}

            {citationDownloadError ? <div className="grounded-assistant-download-error" role="alert">{citationDownloadError}</div> : null}
            <div ref={conversationEndRef} />
          </div>

          <footer className="grounded-assistant-composer-shell">
            <details className="grounded-assistant-context-control">
              <summary>Search scope · {sourceKinds.length === DEFAULT_ASSISTANT_SOURCE_KINDS.length ? "all project sources + HelloTest help" : `${sourceKinds.length} project source types + HelloTest help`}</summary>
              <div>
                {[
                  ["requirement", "Stories"],
                  ["test_case", "Test Cases"],
                  ["execution", "Test Runs"],
                  ["bug", "Bugs"],
                  ["file", "Files"],
                  ["text", "Notes"],
                  ["chat", "Chats"]
                ].map(([value, label]) => (
                  <label key={value}>
                    <input
                      checked={sourceKinds.includes(value)}
                      onChange={(event) => setSourceKinds((current) => event.target.checked ? [...current, value] : current.filter((item) => item !== value))}
                      type="checkbox"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </details>
            <form className="grounded-assistant-composer" onSubmit={(event) => void submitPrompt(event)}>
              <label className="sr-only" htmlFor="grounded-assistant-input">Ask about this HelloTest project</label>
              <textarea
                data-autofocus="true"
                disabled={isSending}
                id="grounded-assistant-input"
                maxLength={4_000}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void submitPrompt();
                  }
                }}
                placeholder="Ask about this project, its tests, runs, bugs, or HelloTest usage…"
                rows={2}
                value={prompt}
              />
              <button aria-label="Send message" disabled={!prompt.trim() || !selectedIntegrationId || isSending || !sourceKinds.length} type="submit">
                <IconSend size={18} />
              </button>
            </form>
            <p className="grounded-assistant-privacy"><IconShieldCheck size={13} /> Project sources are used only for grounded answers. Do not enter passwords, access tokens, or unrelated personal information.</p>
          </footer>
        </aside>
      ) : null}
    </>
  );
}
