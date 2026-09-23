import { formatRecordKindLabel } from "../lib/defectTerminology";
import { LoadingState } from "./LoadingState";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconAlertTriangle,
  IconBook2,
  IconChevronDown,
  IconDownload,
  IconExternalLink,
  IconLock,
  IconHistory,
  IconArrowRight,
  IconArchive,
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
import { resolveAiLlmDefault } from "../lib/aiLlmDefault";
import { api } from "../lib/api";
import { areFeatureFlagsEnabled } from "../lib/featureFlags";
import { hasPermission } from "../lib/permissions";
import type {
  KnowledgeAssistantMessage,
  KnowledgeAssistantMessageResponse,
  KnowledgeAssistantSession,
  KnowledgeAssistantIntegration,
  KnowledgeAnswerStructure,
  KnowledgeCitation,
  KnowledgeSearchFilters,
  KnowledgeRetrievalEvent
} from "../types";
import { SmartContextWorkbench, type SmartContextSelection } from "./SmartContextWorkbench";
import { KnowledgeAnswer } from "./KnowledgeAnswer";
import { KnowledgeFormattedText } from "./KnowledgeFormattedText";
import { KnowledgeProcessingTrace } from "./KnowledgeProcessingTrace";
import { KnowledgeSourceDetail } from "./KnowledgeSourceDetail";
import { knowledgeCitationHref, knowledgeCitationLocation, validateKnowledgeAnswer } from "../lib/knowledgeAnswer";
import { appendKnowledgeProgressEvent, KnowledgeStreamError, knowledgeModelFailureMessage, knowledgeTurnNotice, resumePendingKnowledgeTurn, type KnowledgeTurnNotice } from "../lib/knowledgeAssistantStream";
import { KnowledgeTurnProgress } from "./KnowledgeTurnProgress";
import "./GroundedAssistant.css";

const EMPTY_CITATIONS: KnowledgeCitation[] = [];
const DEFAULT_ASSISTANT_SOURCE_KINDS = ["requirement", "test_case", "execution", "bug", "file", "text", "chat"];
const RETRIEVAL_ONLY_INTEGRATION = "__retrieval_only__";
type AssistantRetryTurn = { clientTurnId: string; integrationId: string; prompt: string; smartContext: SmartContextSelection | null; filters: KnowledgeSearchFilters; responseMode: "answer" | "evidence"; retryProvider?: boolean };

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

  const answer: KnowledgeAssistantMessage = {
    ...rawMessage,
    id: rawMessage?.id || `assistant-${Date.now()}`,
    role: "assistant",
    content,
    citations,
    grounding_status: groundingStatus,
    retrieval: rawMessage?.retrieval || response.retrieval,
    answer_contract: rawMessage?.answer_contract || response.answer_contract || rawMessage?.retrieval?.answer_contract || response.retrieval?.answer_contract,
    context_packet: rawMessage?.context_packet || response.context_packet || rawMessage?.retrieval?.context_packet || response.retrieval?.context_packet,
    guardrails: rawMessage?.guardrails || response.guardrails || [],
    provenance: rawMessage?.provenance || response.provenance || {
      provider: rawMessage?.provider,
      model: rawMessage?.model,
      generation_mode: "retrieval_augmented"
    },
    status: "complete"
  };
  if (answer.answer_contract && !validateKnowledgeAnswer(answer)) throw new KnowledgeStreamError("This answer uses an unsupported evidence contract and could not be displayed.", "UNSUPPORTED_ANSWER_CONTRACT", false);
  return answer;
}

function citationHref(citation: KnowledgeCitation) {
  return knowledgeCitationHref(citation);
}

function groundingLabel(value?: string) {
  if (value === "grounded") return "Grounded";
  if (value === "partially_grounded") return "Partially grounded";
  if (value === "refused") return "Request blocked";
  if (value === "provider_unavailable") return "Provider unavailable";
  return "Insufficient context";
}

function contextRouteLabel(value?: string) {
  return String(value || "project question").replace(/_/g, " ");
}

function StructuredAssistantAnswer({ content, structure }: { content: string; structure?: KnowledgeAnswerStructure }) {
  if (structure?.summary || structure?.findings?.length || structure?.recommendations?.length || structure?.evidence_gaps?.length) {
    const sections = [
      { key: "findings", title: "Findings", items: structure.findings || [] },
      { key: "recommendations", title: "Recommended next steps", items: structure.recommendations || [] },
      { key: "evidence-gaps", title: "Evidence gaps", items: structure.evidence_gaps || [] }
    ].filter((section) => section.items.length);
    return (
      <div aria-label="Structured grounded answer" className="grounded-assistant-structured-answer">
        {structure.summary ? <section><h3>Summary</h3><KnowledgeFormattedText text={structure.summary} /></section> : null}
        {sections.map((section) => (
          <section key={section.key}>
            <h3>{section.title}</h3>
            <ul>{section.items.map((item, index) => <li key={`${section.key}-${index}`}><KnowledgeFormattedText text={item} /></li>)}</ul>
          </section>
        ))}
      </div>
    );
  }
  return <KnowledgeFormattedText className="grounded-assistant-structured-answer" text={content} />;
}

export function GroundedAssistant() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const [projectId] = useCurrentProject();
  const [appTypeId] = useCurrentAppType(projectId);
  const featureFlagsQuery = useFeatureFlags(Boolean(session));
  const { query: promptRegistryQuery } = useAiPromptRegistry(Boolean(session));
  const [isOpen, setIsOpen] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [messages, setMessages] = useState<KnowledgeAssistantMessage[]>([]);
  const [prompt, setPrompt] = useState("");
  const [expandedSources, setExpandedSources] = useState<Record<string, boolean>>({});
  const [retryTurns, setRetryTurns] = useState<Record<string, AssistantRetryTurn>>({});
  const [turnNotices, setTurnNotices] = useState<Record<string, KnowledgeTurnNotice>>({});
  const [progressEvents, setProgressEvents] = useState<KnowledgeRetrievalEvent[]>([]);
  const [requestStartedAt, setRequestStartedAt] = useState<number | null>(null);
  const [isRestoringSession, setIsRestoringSession] = useState(false);
  const [sessionError, setSessionError] = useState("");
  const [selectedCitation, setSelectedCitation] = useState<KnowledgeCitation | null>(null);
  const [citationDownloadError, setCitationDownloadError] = useState("");
  const [sourceKinds, setSourceKinds] = useState<string[]>(DEFAULT_ASSISTANT_SOURCE_KINDS);
  const [knowledgeAsOf, setKnowledgeAsOf] = useState("");
  const [selectedIntegrationId, setSelectedIntegrationId] = useState("");
  const userSelectedIntegration = useRef(false);
  const [smartContext, setSmartContext] = useState<SmartContextSelection | null>(null);
  const [activeRequestIntegrationId, setActiveRequestIntegrationId] = useState("");
  const conversationEndRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const requestControllerRef = useRef<AbortController | null>(null);
  const scopeGenerationRef = useRef(0);
  const dialogRef = useDialogFocus<HTMLElement>({ active: isOpen, onClose: () => setIsOpen(false) });

  const canUseAssistant = Boolean(projectId)
    && hasPermission(session, "knowledge.view", projectId)
    && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.ai.knowledge"]);
  const canReviewHistory = hasPermission(session, "knowledge.manage", projectId);

  const integrationsQuery = useQuery({
    queryKey: ["knowledge-assistant-integrations", projectId],
    queryFn: () => api.knowledgeRepo.assistant.listIntegrations(projectId),
    enabled: canUseAssistant,
    staleTime: 60_000
  });
  const sessionsQuery = useQuery({ queryKey: ["knowledge-assistant-sessions", projectId, appTypeId], queryFn: () => api.knowledgeRepo.assistant.listSessions(projectId), enabled: canUseAssistant && isOpen, staleTime: 30_000 });
  const visibleSessions = (sessionsQuery.data || []).filter((item) => item.status !== "archived" && (!appTypeId || !item.app_type_id || item.app_type_id === appTypeId));
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
  const configuredDefaultIntegrationId = resolveAiLlmDefault({ preferences: promptRegistryQuery.data?.preferences, usageKey: "ai.knowledge.assistant", projectId, integrations: assistantIntegrations });
  const activeRequestIntegration = assistantIntegrations.find((integration) => integration.id === activeRequestIntegrationId)
    || assistantIntegrations.find((integration) => integration.id === selectedIntegrationId)
    || null;
  const apiSourceKinds = useMemo(() => sourceKinds.length === DEFAULT_ASSISTANT_SOURCE_KINDS.length
    ? undefined
    : Array.from(new Set([
        ...sourceKinds,
        "product_help",
        ...(sourceKinds.includes("text") ? ["knowledge_item"] : [])
      ])), [sourceKinds]);

  const createSessionMutation = useMutation({
    mutationFn: ({ appId, integrationId, project, title, signal }: { appId: string; integrationId: string; project: string; title: string; signal: AbortSignal }) =>
      api.knowledgeRepo.assistant.createSession({
        project_id: project,
        app_type_id: appId || null,
        integration_id: integrationId,
        title
      }, { signal })
  });
  const sendMessageMutation = useMutation({
    mutationFn: ({ clientTurnId, id, integrationId, message, filters, smartContext, responseMode, retryProvider, signal, onProgress }: { clientTurnId: string; id: string; integrationId: string; message: string; filters: KnowledgeSearchFilters; smartContext?: { query?: string; source_ids?: string[]; source_kinds?: string[]; reviewed_context?: string }; responseMode: "answer" | "evidence"; retryProvider?: boolean; signal: AbortSignal; onProgress: (event: KnowledgeRetrievalEvent) => void }) =>
      api.knowledgeRepo.assistant.streamMessage(id, {
        message,
        client_turn_id: clientTurnId,
        retry_provider: retryProvider,
        integration_id: integrationId,
        filters,
        response_mode: responseMode,
        smart_context: smartContext
      }, { signal, onProgress })
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

  const isSending = requestStartedAt !== null || createSessionMutation.isPending || sendMessageMutation.isPending;

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
    setTurnNotices({});
    setRequestStartedAt(null);
    setCitationDownloadError("");
    userSelectedIntegration.current = false;
    setSelectedIntegrationId("");
    setSmartContext(null);
    setKnowledgeAsOf("");
    setActiveRequestIntegrationId("");
    setProgressEvents([]);
    setSessionError("");
    setSelectedCitation(null);
    setIsRestoringSession(false);
  }, [projectId, appTypeId, session?.user.id]);

  useEffect(() => {
    if (!integrationsQuery.isSuccess || promptRegistryQuery.isLoading) return;
    const hasIntegration = (id: string | undefined): id is string => Boolean(id && (id === RETRIEVAL_ONLY_INTEGRATION || assistantIntegrations.some((integration) => integration.id === id)));
    const nextIntegrationId = [
      configuredDefaultIntegrationId,
      assistantIntegrations.find((integration) => integration.is_default)?.id,
      assistantIntegrations.find((integration) => integration.scope === "project")?.id,
      assistantIntegrations[0]?.id
    ].find(hasIntegration) || RETRIEVAL_ONLY_INTEGRATION;
    setSelectedIntegrationId((current) => userSelectedIntegration.current ? current : nextIntegrationId);
  }, [
    assistantIntegrations,
    configuredDefaultIntegrationId,
    integrationsQuery.isSuccess,
    promptRegistryQuery.isLoading
  ]);

  useEffect(() => {
    if (isOpen) void promptRegistryQuery.refetch();
  }, [isOpen]);

  useEffect(() => () => { scopeGenerationRef.current += 1; requestControllerRef.current?.abort(); }, []);

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
    scopeGenerationRef.current += 1;
    setIsRestoringSession(false);
    setSessionId("");
    setMessages([]);
    setPrompt("");
    setExpandedSources({});
    setRetryTurns({});
    setTurnNotices({});
    setCitationDownloadError("");
    setSmartContext(null);
    setKnowledgeAsOf("");
    setProgressEvents([]);
    setSessionError("");
  };

  const openConversation = async (id: string) => {
    if (!id) { startNewChat(); return; }
    scopeGenerationRef.current += 1;
    const generation = scopeGenerationRef.current;
    requestControllerRef.current?.abort();
    setIsRestoringSession(true);
    setSessionError("");
    try {
      const restored = safeSession(await api.knowledgeRepo.assistant.getSession(id));
      if (generation !== scopeGenerationRef.current) return;
      setSessionId(restored.id);
      setMessages(restored.messages || []);
      setRetryTurns({});
      setTurnNotices({});
      setExpandedSources({});
      setPrompt("");
      setSmartContext(null);
      if (restored.filters?.source_kinds) setSourceKinds(restored.filters.source_kinds.filter((kind) => DEFAULT_ASSISTANT_SOURCE_KINDS.includes(kind)));
      if (canReviewHistory && restored.filters?.as_of) {
        const value = new Date(restored.filters.as_of);
        setKnowledgeAsOf(new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16));
      } else setKnowledgeAsOf("");
    } catch (error) {
      if (generation === scopeGenerationRef.current) setSessionError(error instanceof Error ? error.message : "Conversation could not be loaded.");
    } finally { if (generation === scopeGenerationRef.current) setIsRestoringSession(false); }
  };

  const archiveConversation = async () => {
    if (!sessionId || isSending) return;
    const generation = scopeGenerationRef.current;
    setIsRestoringSession(true);
    try {
      await api.knowledgeRepo.assistant.updateSession(sessionId, { status: "archived" });
      if (generation !== scopeGenerationRef.current) return;
      startNewChat();
      void queryClient.invalidateQueries({ queryKey: ["knowledge-assistant-sessions", projectId] });
    } catch (error) { if (generation === scopeGenerationRef.current) { setSessionError(error instanceof Error ? error.message : "Conversation could not be archived."); setIsRestoringSession(false); } }
  };

  const submitPrompt = async (event?: FormEvent, retry?: AssistantRetryTurn & { errorMessageId: string }) => {
    event?.preventDefault();
    const normalizedPrompt = (retry?.prompt || prompt).trim();
    const requestIntegrationId = retry?.integrationId || selectedIntegrationId;
    if (!normalizedPrompt || !requestIntegrationId || isSending || requestControllerRef.current || isRestoringSession || (!retry && !sourceKinds.length)) return;
    const effectiveIntegrationId = requestIntegrationId === RETRIEVAL_ONLY_INTEGRATION ? "" : requestIntegrationId;
    const requestSmartContext = retry ? retry.smartContext : smartContext;
    const requestGeneration = scopeGenerationRef.current;
    const requestProjectId = projectId;
    const requestAppTypeId = appTypeId;
    const requestSourceKinds = [...sourceKinds];
    const requestApiSourceKinds = requestSourceKinds.length === DEFAULT_ASSISTANT_SOURCE_KINDS.length
      ? undefined
      : apiSourceKinds;
    const clientTurnId = retry?.clientTurnId || createClientTurnId();
    const requestFilters = retry?.filters || { app_type_id: requestAppTypeId || null, source_kinds: requestApiSourceKinds, ...(canReviewHistory && knowledgeAsOf ? { as_of: new Date(knowledgeAsOf).toISOString() } : {}) };
    const responseMode = retry?.responseMode || (requestIntegrationId === RETRIEVAL_ONLY_INTEGRATION ? "evidence" : "answer");
    const controller = new AbortController();
    requestControllerRef.current = controller;
    setActiveRequestIntegrationId(requestIntegrationId);
    setRequestStartedAt(Date.now());
    setProgressEvents([]);
    const isStale = () => controller.signal.aborted || requestGeneration !== scopeGenerationRef.current;

    const userMessage: KnowledgeAssistantMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: normalizedPrompt,
      citations: [],
      scope: { project_id: requestProjectId, app_type_id: requestAppTypeId, filters: requestFilters },
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
      setTurnNotices((current) => { const next = { ...current }; delete next[retry.errorMessageId]; return next; });
    } else {
      setMessages((current) => [...current, userMessage]);
      setPrompt("");
    }

    try {
      let activeSessionId = sessionId;
      if (!activeSessionId) {
        const created = safeSession(await createSessionMutation.mutateAsync({
          appId: requestAppTypeId,
          integrationId: effectiveIntegrationId,
          project: requestProjectId,
          title: normalizedPrompt.slice(0, 96),
          signal: controller.signal
        }));
        if (requestGeneration !== scopeGenerationRef.current) return;
        if (controller.signal.aborted) throw new DOMException("Answer stopped", "AbortError");
        activeSessionId = created.id;
        setSessionId(created.id);
        const restoredMessages = created.messages || [];
        if (restoredMessages.length) {
          setMessages((current) => [...restoredMessages, ...current]);
        }
      }

      const response = await resumePendingKnowledgeTurn(() => sendMessageMutation.mutateAsync({
        clientTurnId,
        id: activeSessionId,
        integrationId: effectiveIntegrationId,
        message: normalizedPrompt,
        filters: requestFilters,
        responseMode,
        retryProvider: retry?.retryProvider,
        smartContext: requestSmartContext ? {
          query: requestSmartContext.query,
          source_ids: requestSmartContext.sourceIds,
          source_kinds: requestSmartContext.sourceKinds,
          reviewed_context: requestSmartContext.contextText
        } : undefined,
        signal: controller.signal,
        onProgress: (progress) => {
          if (isStale()) return;
          setProgressEvents((current) => appendKnowledgeProgressEvent(current, progress));
        }
      }), {
        signal: controller.signal,
        onPending: () => {
          if (isStale()) return;
          setProgressEvents((current) => [...current.filter((item) => item.stage !== "WAITING_FOR_TURN"), { contract_type: "RetrievalEvent", contract_version: "1.0", stage: "WAITING_FOR_TURN", status: "PENDING", message: "This turn is already being prepared. Checking for its answer without sending a duplicate question." }]);
        }
      });
      if (requestGeneration !== scopeGenerationRef.current) return;
      if (controller.signal.aborted) throw new DOMException("Answer stopped", "AbortError");
      const answer = { ...normalizeAnswer(response), scope: { project_id: requestProjectId, app_type_id: requestAppTypeId, filters: requestFilters } };
      setMessages((current) => [...current, answer]);
      if (answer.grounding_status === "provider_unavailable") {
        setRetryTurns((current) => ({ ...current, [answer.id]: {
          clientTurnId,
          integrationId: requestIntegrationId,
          prompt: normalizedPrompt,
          smartContext: requestSmartContext,
          filters: requestFilters,
          responseMode,
          retryProvider: true
        } }));
      }
      void queryClient.invalidateQueries({ queryKey: ["knowledge-assistant-sessions", requestProjectId] });
      void queryClient.invalidateQueries({ queryKey: ["settings", "workspace-preferences", "ai-prompts"] });
    } catch (error) {
      if (requestGeneration !== scopeGenerationRef.current) return;
      const cancelled = controller.signal.aborted;
      const errorMessageId = `assistant-error-${Date.now()}`;
      const notice = knowledgeTurnNotice(error, cancelled);
      setTurnNotices((current) => ({ ...current, [errorMessageId]: notice }));
      if (!(error instanceof KnowledgeStreamError) || error.retryable || cancelled) setRetryTurns((current) => ({ ...current, [errorMessageId]: { clientTurnId, integrationId: requestIntegrationId, prompt: normalizedPrompt, smartContext: requestSmartContext, filters: requestFilters, responseMode } }));
      setMessages((current) => [...current, {
        id: errorMessageId,
        role: "assistant",
        content: cancelled ? "Answer stopped. Retry this turn when you are ready." : error instanceof Error ? error.message : "The grounded assistant is temporarily unavailable.",
        citations: [],
        grounding_status: "insufficient_context",
        status: notice.kind === "pending" ? "pending" : cancelled ? "cancelled" : "failed",
        created_at: new Date().toISOString()
      }]);
    } finally {
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null;
        setActiveRequestIntegrationId("");
        setRequestStartedAt(null);
      }
    }
  };

  const prepareQuestion = (question: string, evidenceOnly = false) => {
    setPrompt(question);
    if (evidenceOnly) {
      setSelectedIntegrationId(RETRIEVAL_ONLY_INTEGRATION);
      userSelectedIntegration.current = true;
    }
    requestAnimationFrame(() => composerRef.current?.focus());
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
                  disabled={isSending || integrationsQuery.isLoading}
                  onChange={(event) => {
                    setSelectedIntegrationId(event.target.value);
                    userSelectedIntegration.current = true;
                  }}
                  value={selectedIntegrationId}
                >
                  {!selectedIntegrationId ? (
                    <option disabled value="">
                      {integrationsQuery.isLoading ? "Loading models…" : integrationsQuery.isError ? "Models unavailable" : "No LLM configured"}
                    </option>
                  ) : null}
                  {selectedIntegrationId && selectedIntegrationId !== RETRIEVAL_ONLY_INTEGRATION && !assistantIntegrations.some((item) => item.id === selectedIntegrationId) ? <option disabled value={selectedIntegrationId}>{selectedIntegrationId} (unavailable)</option> : null}
                  <option value={RETRIEVAL_ONLY_INTEGRATION}>Evidence only · no model</option>
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
            <span>{knowledgeAsOf ? `As of ${new Date(knowledgeAsOf).toLocaleString()}` : "Current searchable knowledge"}</span>
            <div className="grounded-assistant-history-controls">
              <label><IconHistory size={14} /><span className="sr-only">Conversation history</span><select aria-label="Conversation history" disabled={isSending || isRestoringSession || sessionsQuery.isLoading} onChange={(event) => void openConversation(event.target.value)} value={sessionId}>
                <option value="">New conversation</option>
                {sessionId && !visibleSessions.some((item) => item.id === sessionId) ? <option value={sessionId}>Current conversation</option> : null}
                {visibleSessions.map((item) => <option key={item.id} value={item.id}>{item.title || "Project conversation"}{item.updated_at ? ` · ${new Date(item.updated_at).toLocaleDateString()}` : ""}</option>)}
              </select></label>
              {sessionId ? <button aria-label="Archive this conversation" className="ghost-button grounded-assistant-icon-button" disabled={isSending || isRestoringSession} onClick={() => void archiveConversation()} title="Archive conversation" type="button"><IconArchive size={15} /></button> : null}
              {sessionsQuery.isError ? <button className="grounded-assistant-retry" onClick={() => void sessionsQuery.refetch()} type="button">Retry history</button> : null}
            </div>
          </div>

          <div className="grounded-assistant-conversation" role="log" aria-label="Assistant conversation" aria-live="polite" aria-relevant="additions">
            {isRestoringSession ? <LoadingState label="Loading conversation" /> : null}
            {sessionError ? <p className="grounded-assistant-download-error" role="alert">{sessionError}</p> : null}
            {!messages.length ? (
              <div className="grounded-assistant-welcome">
                <span className="grounded-assistant-welcome-icon"><IconBook2 size={26} /></span>
                <h3>Your project, with the evidence in reach.</h3>
                <p>Explore coverage, investigate failures, or find a decision in your documents. Each answer connects its findings to the sources you can review.</p>
                <div className="grounded-assistant-starters">
                  {starterPrompts.map((item) => (
                    <button key={item} onClick={() => prepareQuestion(item)} type="button">
                      <IconMessageCircle size={16} />
                      <span>{item}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {messages.map((message) => {
              const isAssistant = message.role === "assistant";
              const validatedAnswer = isAssistant ? validateKnowledgeAnswer(message) : null;
              const hasInterpretations = validatedAnswer?.claims.some((claim) => claim.classification === "INTERPRETATION");
              const citations = validatedAnswer ? Array.from(validatedAnswer.citations.values()) : message.citations || EMPTY_CITATIONS;
              const sourcesExpanded = Boolean(expandedSources[message.id]);
              const notice = turnNotices[message.id];
              const retryTurn = retryTurns[message.id];
              const modelUnavailable = message.grounding_status === "provider_unavailable";
              const effectiveGrounding = modelUnavailable ? "provider_unavailable" : validatedAnswer?.partial ? "partially_grounded" : message.grounding_status;
              return (
                <article className={`grounded-assistant-message is-${message.role}${notice ? ` is-${notice.kind}` : message.status === "failed" ? " is-error" : ""}`} key={message.id}>
                  <div className="grounded-assistant-message-label">
                    {isAssistant ? <IconSparkles size={14} /> : null}
                    <span>{isAssistant ? "HelloTest" : "You"}</span>
                    {isAssistant && !["failed", "cancelled", "pending"].includes(message.status || "") ? (
                      <span className={`grounding-chip is-${effectiveGrounding === "grounded" && hasInterpretations ? "evidence-linked" : effectiveGrounding || "insufficient_context"}`}>
                        {effectiveGrounding === "grounded" && !hasInterpretations ? <IconShieldCheck size={13} /> : <IconBook2 size={13} />}
                        {effectiveGrounding === "grounded" && hasInterpretations ? "Evidence linked" : groundingLabel(effectiveGrounding)}
                      </span>
                    ) : null}
                  </div>
                  {message.scope ? <div className="grounded-assistant-message-scope">{message.scope.filters?.source_kinds?.filter((kind) => kind !== "product_help").map((kind) => formatRecordKindLabel(kind)).join(" · ") || "All permitted project sources"}{message.scope.filters?.as_of ? ` · As of ${new Date(message.scope.filters.as_of).toLocaleString()}` : " · Current knowledge"}</div> : null}
                  <div className="grounded-assistant-message-content">
                    {notice ? <div className="grounded-assistant-turn-notice" role={notice.kind === "error" ? "alert" : "status"}><strong>{notice.title}</strong><p>{notice.message}</p>{message.content && ![notice.message, notice.title].includes(message.content) && notice.kind === "error" ? <details><summary>Service details</summary><p>{message.content}</p></details> : null}</div>
                      : <>{modelUnavailable ? <div className="grounded-assistant-evidence-notice"><strong>{citations.length ? "Sources found; answer model unavailable" : "Answer model unavailable"}</strong><span>{citations.length ? knowledgeModelFailureMessage(message.retrieval?.provider_error_code) : "The model could not finish this answer. Try evidence only to look for relevant sources."}</span></div> : null}{isAssistant ? validatedAnswer ? <KnowledgeAnswer message={message} onEvidenceOpen={(citation) => citation.source_id && !["live_project", "product_help"].includes(String(citation.source_kind)) ? setSelectedCitation(citation) : setExpandedSources((current) => ({ ...current, [message.id]: true }))} /> : message.answer_contract || message.retrieval?.answer_contract ? <p>This saved answer uses an unsupported evidence contract. Ask the question again to retrieve current evidence.</p> : <StructuredAssistantAnswer content={message.content} structure={message.retrieval?.answer_structure} /> : message.content}</>}
                  </div>
                  {retryTurn ? <div className="grounded-assistant-turn-actions">
                    {notice?.retryable !== false ? <button
                      className="grounded-assistant-retry"
                      disabled={isSending}
                      onClick={() => void submitPrompt(undefined, { ...retryTurn, errorMessageId: message.id })}
                      type="button"
                    >{notice?.kind === "pending" ? "Check for answer" : notice?.kind === "cancelled" ? "Resume this turn" : "Retry this turn"}</button> : null}
                    <button disabled={isSending} onClick={() => prepareQuestion(retryTurn.prompt)} type="button">Edit question</button>
                    {retryTurn.responseMode === "answer" ? <button disabled={isSending} onClick={() => prepareQuestion(retryTurn.prompt, true)} type="button">Try evidence only</button> : null}
                  </div> : null}
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
                                <span className="grounded-assistant-citation-index">{validatedAnswer ? index + 1 : citation.index || index + 1}</span>
                                <span>
                                  <strong>{citation.title || citation.label || "Project source"}</strong>
                                  <small>
                                    {formatRecordKindLabel(citation.source_kind, "knowledge")}
                                    {knowledgeCitationLocation(citation) ? ` · ${knowledgeCitationLocation(citation)}` : ""}
                                    {citation.freshness?.current === false ? " · Historical revision" : citation.freshness?.current ? " · Current revision" : ""}
                                    {citation.excerpt ? ` · ${citation.excerpt}` : ""}
                                  </small>
                                </span>
                                {href ? <IconExternalLink size={14} /> : canDownload ? <IconDownload size={14} /> : null}
                              </>
                            );
                            return <li key={`${citation.id}-${index}`}>{href.startsWith("/knowledge-repo?")
                              ? <button onClick={() => setSelectedCitation(citation)} type="button">{content}</button>
                              : href
                              ? <a href={href} rel="noreferrer" target={href.startsWith("/") ? undefined : "_blank"}>{content}</a>
                              : canDownload
                                ? <button disabled={downloadCitationMutation.isPending} onClick={() => downloadCitationMutation.mutate(citation)} type="button">{content}</button>
                                : <div>{content}</div>}</li>;
                          })}
                        </ol>
                      ) : null}
                    </div>
                  ) : null}
                  {isAssistant && message.retrieval ? (
                    <details className="grounded-assistant-processing">
                      <summary>
                        <IconSparkles size={14} />
                        How this answer was built
                        <span>{message.retrieval.processing_trace?.length || 0} stages</span>
                      </summary>
                      <div className="grounded-assistant-processing-trace">
                        <KnowledgeProcessingTrace items={message.retrieval.processing_trace || []} />
                        <div className="grounded-assistant-retrieval-note">
                          <span>{contextRouteLabel(message.retrieval.context_route?.query_category || message.retrieval.context_route?.input_type)}</span>
                          {message.retrieval.query_class ? <span>{contextRouteLabel(message.retrieval.query_class)} query</span> : null}
                          {message.retrieval.context_route?.answer_depth ? <span>{message.retrieval.context_route.answer_depth} answer</span> : null}
                          {message.retrieval.evidence_sufficiency ? <span>Evidence {message.retrieval.evidence_sufficiency.status}</span> : null}
                          {message.retrieval.context_packet?.coverage ? <span>{message.retrieval.context_packet.coverage.source_count || 0} authorized sources · {message.retrieval.context_packet.coverage.context_tokens_estimated || 0} context tokens</span> : null}
                          {message.retrieval.answer_contract?.grounding ? <span>{message.retrieval.answer_contract.grounding.supported_claim_count || 0} grounded claims · {message.retrieval.answer_contract.grounding.unsupported_claim_count || 0} rejected</span> : null}
                          <span>{message.retrieval.retrieval_round_count || 0} adaptive retrieval round{message.retrieval.retrieval_round_count === 1 ? "" : "s"}</span>
                          <span>{message.retrieval.live_context_count || 0} live project snapshot{message.retrieval.live_context_count === 1 ? "" : "s"}</span>
                          <span>{Math.max(0, (message.retrieval.returned_count ?? citations.length) - (message.retrieval.live_context_count || 0))} Knowledge Repository result{Math.max(0, (message.retrieval.returned_count ?? citations.length) - (message.retrieval.live_context_count || 0)) === 1 ? "" : "s"}</span>
                          {message.retrieval.embedding_batch_count ? <span>{message.retrieval.embedding_batch_count} embedding batch{message.retrieval.embedding_batch_count === 1 ? "" : "es"}</span> : null}
                          {message.retrieval.termination_reason ? <span>stopped: {contextRouteLabel(message.retrieval.termination_reason)}</span> : null}
                        </div>
                        {message.retrieval.planned_queries?.length ? (
                          <div className="grounded-assistant-query-chain">
                            <strong>Context query chain</strong>
                            <ol>{message.retrieval.planned_queries.map((query, index) => <li key={`${query}-${index}`}>{query}</li>)}</ol>
                          </div>
                        ) : null}
                        {message.retrieval.model_context_plan?.information_needs?.length ? (
                          <div className="grounded-assistant-query-chain">
                            <strong>Evidence plan</strong>
                            <ol>{message.retrieval.model_context_plan.information_needs.map((need, index) => <li key={`${need}-${index}`}>{need}</li>)}</ol>
                          </div>
                        ) : null}
                      </div>
                    </details>
                  ) : null}
                  {isAssistant && !notice && !["failed", "cancelled", "pending"].includes(message.status || "") ? <div className="grounded-assistant-follow-ups" aria-label="Continue this answer">
                    <span>{modelUnavailable ? "Continue with the sources" : "Take the next step"}</span>
                    {citations.length ? <button onClick={() => setExpandedSources((current) => ({ ...current, [message.id]: true }))} type="button"><IconBook2 size={13} />Review {citations.length} source{citations.length === 1 ? "" : "s"}</button> : null}
                    <button disabled={isSending} onClick={() => prepareQuestion(modelUnavailable ? "Show the project evidence relevant to my previous question." : validatedAnswer?.partial || !citations.length ? "What specific evidence is missing to answer my previous question?" : "What should I verify next based on this evidence?", modelUnavailable)} type="button">{modelUnavailable ? "Ask with evidence only" : validatedAnswer?.partial || !citations.length ? "Explore missing evidence" : "What should I verify next?"}<IconArrowRight size={13} /></button>
                  </div> : null}
                </article>
              );
            })}

            {isSending && requestStartedAt !== null ? <KnowledgeTurnProgress events={progressEvents} onStop={() => requestControllerRef.current?.abort()} opening={createSessionMutation.isPending} startedAt={requestStartedAt} /> : null}

            {citationDownloadError ? <div className="grounded-assistant-download-error" role="alert">{citationDownloadError}</div> : null}
            <div ref={conversationEndRef} />
          </div>

          <footer className="grounded-assistant-composer-shell">
            {integrationsQuery.isError ? <div className="grounded-assistant-model-error" role="status"><span>Answer models could not be loaded.</span><button onClick={() => void integrationsQuery.refetch()} type="button">Retry models</button><button onClick={() => { setSelectedIntegrationId(RETRIEVAL_ONLY_INTEGRATION); userSelectedIntegration.current = true; }} type="button">Use evidence only</button></div> : null}
            <div className="grounded-assistant-context-row">
              <details className="grounded-assistant-context-control">
                <summary>Context scope · {sourceKinds.length === DEFAULT_ASSISTANT_SOURCE_KINDS.length ? "live project + all Knowledge Repository sources" : `live matching records + ${sourceKinds.length} Knowledge Repository source types`}</summary>
                <div>
                  {[
                    ["requirement", "Stories"],
                    ["test_case", "Test Cases"],
                    ["execution", "Test Runs"],
                    ["bug", "Defects"],
                    ["file", "Files"],
                    ["text", "Notes"],
                    ["chat", "Chats"]
                  ].map(([value, label]) => (
                    <label key={value}>
                      <input
                        checked={sourceKinds.includes(value)}
                        disabled={isSending}
                        onChange={(event) => {
                          setSourceKinds((current) => event.target.checked ? [...current, value] : current.filter((item) => item !== value));
                        }}
                        type="checkbox"
                      />
                      {label}
                    </label>
                  ))}
                  {canReviewHistory ? <label className="grounded-assistant-history-date">Knowledge as of<input aria-label="Knowledge as of; leave empty for current" disabled={isSending} onChange={(event) => setKnowledgeAsOf(event.target.value)} type="datetime-local" value={knowledgeAsOf} />{knowledgeAsOf ? <button disabled={isSending} onClick={() => setKnowledgeAsOf("")} type="button">Use current</button> : null}</label> : null}
                </div>
              </details>
              <SmartContextWorkbench
                appTypeId={appTypeId}
                buttonClassName="ghost-button compact grounded-assistant-smart-context"
                buttonLabel={smartContext ? `Smart Context · ${smartContext.resultCount}` : "Smart Context"}
                disabled={isSending || isRestoringSession}
                initialQuery={prompt}
                onApply={setSmartContext}
                preferredSourceKinds={apiSourceKinds}
                projectId={projectId}
              />
              {smartContext ? <button className="grounded-assistant-clear-context" onClick={() => setSmartContext(null)} type="button">Clear</button> : null}
            </div>
            <form className="grounded-assistant-composer" onSubmit={(event) => void submitPrompt(event)}>
              <label className="sr-only" htmlFor="grounded-assistant-input">Ask about this HelloTest project</label>
              <textarea
                data-autofocus="true"
                disabled={isRestoringSession}
                id="grounded-assistant-input"
                maxLength={4_000}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && !isSending) {
                    event.preventDefault();
                    void submitPrompt();
                  }
                }}
                placeholder={isSending ? "Draft your next question while the answer is prepared…" : messages.length ? "Ask a follow-up about this evidence…" : "Ask about your project, its tests, runs, defects, or HelloTest usage…"}
                ref={composerRef}
                rows={2}
                value={prompt}
              />
              <button aria-label="Send message" disabled={!prompt.trim() || !selectedIntegrationId || isSending || isRestoringSession || !sourceKinds.length} type="submit">
                <IconSend size={18} />
              </button>
            </form>
            <div className="grounded-assistant-composer-hint"><span>{isSending ? "Your next draft stays here while this answer is prepared." : "Enter to send · Shift + Enter for a new line"}</span>{prompt.length > 3500 ? <span>{prompt.length}/4,000</span> : null}</div>
            <p className="grounded-assistant-privacy"><IconShieldCheck size={13} /> Answers use sources you can access in this project.</p>
          </footer>
        </aside>
      ) : null}
      {isOpen && selectedCitation?.source_id ? <KnowledgeSourceDetail canManage={canReviewHistory} initialRevisionId={selectedCitation.freshness?.current === false ? selectedCitation.knowledge_id : undefined} key={selectedCitation.evidence_id || selectedCitation.id} onChanged={() => undefined} onClose={() => setSelectedCitation(null)} projectId={projectId} sourceId={selectedCitation.source_id} /> : null}
    </>
  );
}
