import { useKnowledgeCatalog } from "../hooks/useKnowledgeCatalog";
import { KnowledgeRefreshControl } from "./KnowledgeRefreshControl";
import { formatRecordKindLabel } from "@hellotest/testing/frontend/lib/defectTerminology";
import { LoadingState } from "@hellotest/platform/frontend/src/shared/components/LoadingState";
import { DragEvent, FormEvent, lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconPlus,
  IconAdjustmentsHorizontal,
  IconAlertTriangle,
  IconArrowRight,
  IconBook2,
  IconBug,
  IconCheck,
  IconChevronRight,
  IconClock,
  IconDatabase,
  IconFileDescription,
  IconFileText,
  IconFolders,
  IconInfoCircle,
  IconMessageCircle,
  IconPlayerPlay,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconShieldCheck,
  IconSparkles,
  IconStack2,
  IconTrash,
  IconUpload,
  IconX
} from "@tabler/icons-react";
import { api } from "@hellotest/platform/frontend/src/lib/api";
import { useAuth } from "@hellotest/platform/frontend/src/auth/AuthContext";
import { useFeatureFlags } from "@hellotest/platform/frontend/src/platform/hooks/useFeatureFlags";
import { hasCapability } from "@hellotest/platform/frontend/src/platform/lib/capabilityAccess";
import { SelectionToggleIcon } from "@hellotest/platform/frontend/src/platform/components/AppIcons";
import { KnowledgeSourceDetail } from "./KnowledgeSourceDetail";
import { KnowledgeCollectionDialog } from "./KnowledgeCollectionDialog";
import { knowledgeApi } from "../api.client";
import { asArray } from "@hellotest/platform/frontend/src/shared/lib/collectionGuards";
import type {
  Execution,
  Issue,
  KnowledgeChunkingConfig,
  KnowledgeCollection,
  KnowledgeIngestionInput,
  KnowledgeIngestionResponse,
  KnowledgeOverview,
  KnowledgeSearchHit,
  KnowledgeSearchMode,
  KnowledgeSelectedRecords,
  KnowledgeSource,
  Requirement,
  TestCase
} from "@hellotest/platform/frontend/src/types";
import "./KnowledgeContextStudio.css";

const KnowledgeGraphPanel = lazy(() => import("./KnowledgeGraphPanel"));
type StudioTab = "build" | "search" | "sources" | "collections" | "activity" | "graph";
type RecordKind = keyof KnowledgeSelectedRecords;
type PasteKind = "text" | "chat" | "url";
type BuildKind = "records" | "files" | "notes";
type SearchRequest = { project_id: string; query: string; mode: KnowledgeSearchMode; limit: number; filters: { app_type_id: string | null; collection_ids: string[]; source_kinds: string[]; as_of?: string } };
type StagedFileStatus = "extractable" | "needs_caption" | "needs_transcript" | "needs_text" | "unsupported" | "too_large";

type StagedFile = {
  id: string;
  file: File;
  status: StagedFileStatus;
  helper: string;
  extractedText: string;
};

type KnowledgeContextStudioProps = {
  appTypeId: string;
  canManage: boolean;
  onError: (error: unknown, fallback: string) => void;
  onSuccess: (message: string) => void;
  projectId: string;
  initialSourceId?: string;
  initialRevisionId?: string;
};

const emptySelectedRecords = (): KnowledgeSelectedRecords => ({
  requirements: [],
  test_cases: [],
  executions: [],
  bugs: []
});

const recordKinds: Array<{
  key: RecordKind;
  label: string;
  singular: string;
  description: string;
  icon: typeof IconBook2;
}> = [
  { key: "requirements", label: "Stories", singular: "Story", description: "Intent, acceptance criteria, labels, and release scope", icon: IconBook2 },
  { key: "test_cases", label: "Test Cases", singular: "Test Case", description: "Steps, expected results, parameters, and traceability", icon: IconFileDescription },
  { key: "executions", label: "Test Runs", singular: "Test Run", description: "Execution scope, outcomes, failures, and environment evidence", icon: IconPlayerPlay },
  { key: "bugs", label: "Defects", singular: "Defect", description: "Symptoms, reproduction evidence, severity, and root cause", icon: IconBug }
];

const defaultChunking: KnowledgeChunkingConfig = {
  strategy: "semantic",
  chunk_size: 800,
  chunk_overlap: 120
};

const fallbackTextMimeTypes = [
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/html",
  "application/json",
  "application/xml",
  "text/xml"
];

const fallbackSupportedMimeTypes = [
  ...fallbackTextMimeTypes,
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/png",
  "image/jpeg",
  "image/webp",
  "audio/mpeg",
  "audio/wav",
  "video/mp4",
  "video/webm"
];

const fallbackExtensions = [".txt", ".md", ".csv", ".json", ".xml", ".html", ".pdf", ".docx", ".pptx", ".xlsx", ".png", ".jpg", ".jpeg", ".webp", ".mp3", ".wav", ".mp4", ".webm"];

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / (1024 ** index)).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function humanize(value: string | null | undefined) {
  return String(value || "unknown").replace(/_/g, " ").replace(/\b\w/g, (letter: string) => letter.toUpperCase());
}

function processingNoticeText(notice: unknown) {
  if (typeof notice === "string") return notice.trim() || "Processing notice";
  if (!notice || typeof notice !== "object") return "Processing notice";

  const value = notice as { code?: unknown; error_fingerprint?: unknown; input_index?: unknown; message?: unknown; source_id?: unknown; stage?: unknown };
  const message = typeof value.message === "string" && value.message.trim() ? value.message.trim() : "Processing notice";
  const details: string[] = [];
  if (typeof value.code === "string" && value.code.trim()) details.push(`Code ${value.code.trim()}`);
  if (typeof value.stage === "string" && value.stage.trim()) details.push(`Stage ${humanize(value.stage.trim())}`);
  if (typeof value.source_id === "string" && value.source_id.trim()) details.push(`Source ${value.source_id.trim()}`);
  if (typeof value.input_index === "number" && Number.isFinite(value.input_index)) details.push(`Input index ${value.input_index}`);
  if (typeof value.error_fingerprint === "string" && value.error_fingerprint.trim()) details.push(`Ref ${value.error_fingerprint.trim().slice(0, 12)}`);
  return details.length ? `${message} · ${details.join(" · ")}` : message;
}

function recordIdentity(item: Requirement | TestCase | Execution | Issue) {
  return item.display_id || item.id;
}

function recordTitle(item: Requirement | TestCase | Execution | Issue): string {
  if ("title" in item && typeof item.title === "string" && item.title) return item.title;
  if ("name" in item && typeof item.name === "string" && item.name) return item.name;
  return `${recordIdentity(item)} · Untitled record`;
}

function recordStatus(item: Requirement | TestCase | Execution | Issue) {
  return item.status || "unknown";
}

function fileExtension(name: string) {
  const match = name.toLowerCase().match(/\.[a-z0-9]+$/);
  return match?.[0] || "";
}

function classifyFile(
  file: File,
  overview: KnowledgeOverview | undefined
): Pick<StagedFile, "status" | "helper"> {
  const extraction = overview?.capabilities?.extraction;
  const maxBytes = extraction?.max_file_bytes || overview?.capabilities?.max_file_bytes || 50 * 1024 * 1024;
  if (file.size > maxBytes) {
    return { status: "too_large", helper: `Exceeds the ${formatBytes(maxBytes)} ingestion limit.` };
  }

  const mime = file.type.toLowerCase();
  const extension = fileExtension(file.name);
  const supportedMimes = extraction?.supported_mime_types || overview?.capabilities?.supported_mime_types || fallbackSupportedMimeTypes;
  const supportedExtensions = extraction?.supported_extensions || overview?.capabilities?.supported_extensions || fallbackExtensions;
  const isSupported = supportedMimes.includes(mime) || supportedExtensions.includes(extension);
  if (!isSupported) {
    return { status: "unsupported", helper: "This file type can be stored only after it is converted to a supported format." };
  }

  const nativeText = extraction?.native_text_mime_types || fallbackTextMimeTypes;
  if (nativeText.includes(mime) || [".txt", ".md", ".csv", ".json", ".xml", ".html"].includes(extension)) {
    return { status: "extractable", helper: "Text can be extracted, chunked, and indexed." };
  }
  if (mime.startsWith("image/") || [".png", ".jpg", ".jpeg", ".webp"].includes(extension)) {
    return { status: "needs_caption", helper: "Add a factual caption or OCR text before this image can be indexed." };
  }
  if (mime.startsWith("video/") || [".mp4", ".webm"].includes(extension)) {
    return { status: "needs_transcript", helper: "Add a transcript before this video can be indexed." };
  }
  if (mime.startsWith("audio/") || [".mp3", ".wav"].includes(extension)) {
    return { status: "needs_transcript", helper: "Add a transcript before this audio can be indexed." };
  }
  const maxExtractableBytes = extraction?.max_extractable_bytes || extraction?.extraction_max_bytes;
  if (extraction?.tika_configured && maxExtractableBytes && file.size > maxExtractableBytes) {
    return {
      status: "needs_text",
      helper: `This document can be stored, but server extraction is limited to ${formatBytes(maxExtractableBytes)}. Add extracted text to index it.`
    };
  }
  if (extraction?.tika_configured || extraction?.binary_requires_extracted_text === false) {
    return { status: "extractable", helper: "Server extraction is available; the extracted text will be chunked and indexed." };
  }
  return { status: "needs_text", helper: "The file can be stored, but extracted text is required before it can be indexed." };
}

function ingestionJob(response: KnowledgeIngestionResponse) {
  return response.job;
}

function searchResults(response: { results?: KnowledgeSearchHit[]; hits?: KnowledgeSearchHit[] } | undefined) {
  return response?.results || response?.hits || [];
}

function normalizedScore(value: number | null | undefined) {
  if (!Number.isFinite(Number(value))) return null;
  const numeric = Number(value);
  return Math.max(0, Math.min(100, Math.round((numeric <= 1 ? numeric * 100 : numeric))));
}

function clientFingerprint(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function idempotencyPrefix() {
  const randomId = globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `knowledge-build:${randomId}`;
}

export function KnowledgeContextStudio({ appTypeId, canManage, onError, onSuccess, projectId, initialSourceId = "", initialRevisionId = "" }: KnowledgeContextStudioProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const buildAttemptRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const [requestedTab, setActiveTab] = useState<StudioTab>("sources");
  const [buildKind, setBuildKind] = useState<BuildKind>("files");
  const [showSearchFilters, setShowSearchFilters] = useState(false);
  const [showSourceFilters, setShowSourceFilters] = useState(false);
  const [showHealth, setShowHealth] = useState(false);
  const [collectionDialogId, setCollectionDialogId] = useState<string | null>(null);
  const [sourceCollectionId, setSourceCollectionId] = useState("");
  const [sourceSort, setSourceSort] = useState("updated");
  const [submittedSearch, setSubmittedSearch] = useState<SearchRequest | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  useEffect(() => () => searchAbortRef.current?.abort(), []);
  const activeTab = requestedTab === "build" && !canManage ? "search" : requestedTab;
  const { session } = useAuth();
  const featureFlags = useFeatureFlags(Boolean(session));
  const readableRecords: Record<RecordKind, boolean> = {
    requirements: hasCapability(session, featureFlags.data, "requirement.view", projectId),
    test_cases: hasCapability(session, featureFlags.data, "testcase.view", projectId),
    executions: hasCapability(session, featureFlags.data, "run.view", projectId),
    bugs: hasCapability(session, featureFlags.data, "feedback.view", projectId)
  };
  const availableRecordKinds = recordKinds.filter(({ key }) => readableRecords[key]);
  const [requestedRecordKind, setActiveRecordKind] = useState<RecordKind>("requirements");
  const activeRecordKind = readableRecords[requestedRecordKind] ? requestedRecordKind : availableRecordKinds[0]?.key || "requirements";
  const [recordSearch, setRecordSearch] = useState("");
  const [selectedRecordDraft, setSelectedRecords] = useState<KnowledgeSelectedRecords>(emptySelectedRecords);
  // A revoked source grant cannot leave stale selections in the ingestion request.
  const selectedRecords = Object.fromEntries(recordKinds.map(({ key }) => [key, readableRecords[key] ? selectedRecordDraft[key] : []])) as KnowledgeSelectedRecords;
  const [files, setFiles] = useState<StagedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [pasteKind, setPasteKind] = useState<PasteKind>("text");
  const [pasteTitle, setPasteTitle] = useState("");
  const [pasteContent, setPasteContent] = useState("");
  const [collectionId, setCollectionId] = useState("");
  const [batchTitle, setBatchTitle] = useState("");
  const [chunking, setChunking] = useState<KnowledgeChunkingConfig>(defaultChunking);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [recentSubmittedJobs, setRecentSubmittedJobs] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMode, setSearchMode] = useState<KnowledgeSearchMode>("hybrid");
  const [searchAsOf, setSearchAsOf] = useState("");
  const [selectedDetailSourceId, setSelectedDetailSourceId] = useState(initialSourceId);
  const [selectedDetailRevisionId, setSelectedDetailRevisionId] = useState(initialRevisionId);
  useEffect(() => { if (initialSourceId) { setSelectedDetailSourceId(initialSourceId); setSelectedDetailRevisionId(initialRevisionId); setActiveTab("sources"); } }, [initialSourceId, initialRevisionId]);
  const [searchSourceKinds, setSearchSourceKinds] = useState<string[]>([]);
  const [searchCollectionId, setSearchCollectionId] = useState("");
  const [selectedSearchSources, setSelectedSearchSources] = useState<string[]>([]);
  const [sourceSearch, setSourceSearch] = useState("");
  const [sourceStatus, setSourceStatus] = useState("");
  const [armedCollectionDeleteId, setArmedCollectionDeleteId] = useState("");
  const [armedSourceDeleteId, setArmedSourceDeleteId] = useState("");

  const { overviewQuery, collectionsQuery, sourcesQuery } = useKnowledgeCatalog(projectId, canManage);
  const requirementsQuery = useQuery({
    queryKey: ["knowledge-builder-requirements", projectId],
    queryFn: () => api.requirements.list({ project_id: projectId, projection: "summary", limit: 250 }),
    enabled: Boolean(projectId && canManage && activeTab === "build" && buildKind === "records" && activeRecordKind === "requirements" && readableRecords.requirements)
  });
  const testCasesQuery = useQuery({
    queryKey: ["knowledge-builder-test-cases", projectId, appTypeId],
    queryFn: () => api.testCases.list({ project_id: projectId, app_type_id: appTypeId || undefined, projection: "summary", limit: 250 }),
    enabled: Boolean(projectId && canManage && activeTab === "build" && buildKind === "records" && activeRecordKind === "test_cases" && readableRecords.test_cases)
  });
  const executionsQuery = useQuery({
    queryKey: ["knowledge-builder-executions", projectId, appTypeId],
    queryFn: () => api.executions.list({ project_id: projectId, app_type_id: appTypeId || undefined, page_size: 250 }),
    enabled: Boolean(projectId && canManage && activeTab === "build" && buildKind === "records" && activeRecordKind === "executions" && readableRecords.executions)
  });
  const bugsQuery = useQuery({
    queryKey: ["knowledge-builder-bugs", projectId],
    queryFn: () => api.issues.list({ project_id: projectId, projection: "summary", page_size: 250 }),
    enabled: Boolean(projectId && canManage && activeTab === "build" && buildKind === "records" && activeRecordKind === "bugs" && readableRecords.bugs)
  });
  const collections = asArray(collectionsQuery.data);
  const overview = overviewQuery.data;
  const counts = overview?.counts || {
    collections: overview?.totals?.collections,
    sources: overview?.totals?.sources,
    documents: overview?.totals?.documents,
    chunks: overview?.totals?.chunks,
    ready_sources: overview?.totals?.ready,
    processing_sources: overview?.totals?.processing,
    failed_sources: overview?.totals?.failed
  };

  const recordsByKind: Record<RecordKind, Array<Requirement | TestCase | Execution | Issue>> = {
    requirements: asArray(requirementsQuery.data),
    test_cases: asArray(testCasesQuery.data),
    executions: asArray(executionsQuery.data),
    bugs: asArray(bugsQuery.data)
  };
  const visibleRecords = useMemo(() => {
    const query = recordSearch.trim().toLowerCase();
    const records = readableRecords[activeRecordKind] ? recordsByKind[activeRecordKind] : [];
    if (!query) return records;
    return records.filter((item) => [recordIdentity(item), recordTitle(item), recordStatus(item)]
      .join(" ").toLowerCase().includes(query));
  }, [activeRecordKind, readableRecords[activeRecordKind], recordSearch, requirementsQuery.data, testCasesQuery.data, executionsQuery.data, bugsQuery.data]);

  const selectedRecordCount = Object.values(selectedRecords).reduce((total, ids) => total + ids.length, 0);
  const acceptableFiles = files.filter((item) => item.status === "extractable" || (item.status !== "unsupported" && item.status !== "too_large" && item.extractedText.trim()));
  const hasPastedInput = Boolean(pasteContent.trim()) && (pasteKind !== "url" || /^https?:\/\//i.test(pasteContent.trim()));
  const sourceCount = selectedRecordCount + acceptableFiles.length + (hasPastedInput ? 1 : 0);
  const processingJobs = overview?.recent_jobs || overview?.recent_ingestions || [];
  const embeddingFallbackJobs = processingJobs.filter((job) => (job.warnings || []).some((notice) => (
    typeof notice === "object" && notice !== null && "code" in notice && notice.code === "embedding_fallback"
  ))).length;
  const indexedSourceCount = Number(counts?.ready_sources || 0);
  const embeddingConfigured = overview?.capabilities?.embedding?.configured === true;
  const vectorStore = overview?.capabilities?.vector_store;
  const vectorSearchUnavailable = typeof vectorStore === "object" && vectorStore?.circuit_open === true;
  const allSources = asArray<KnowledgeSource>(sourcesQuery.data);
  const visibleSources = useMemo(() => {
    const query = sourceSearch.trim().toLowerCase();
    const filtered = asArray<KnowledgeSource>(sourcesQuery.data).filter((source) => {
      if (sourceStatus === "attention" && !["needs_extraction", "failed"].includes(source.extraction_status)) return false;
      if (sourceStatus && sourceStatus !== "attention" && source.extraction_status !== sourceStatus) return false;
      if (!sourceStatus && source.extraction_status === "archived") return false;
      if (sourceCollectionId && !source.collection_ids?.includes(sourceCollectionId)) return false;
      return !query || [source.title, source.file_name, source.source_kind, source.source_ref_id, source.extraction_status]
        .filter(Boolean).join(" ").toLowerCase().includes(query);
    });
    return filtered.sort((a, b) => sourceSort === "title"
      ? a.title.localeCompare(b.title)
      : (new Date(b.updated_at || b.created_at || 0).getTime() || 0) - (new Date(a.updated_at || a.created_at || 0).getTime() || 0));
  }, [sourceSearch, sourceStatus, sourceCollectionId, sourceSort, sourcesQuery.data]);
  const recordQuery = ({ requirements: requirementsQuery, test_cases: testCasesQuery, executions: executionsQuery, bugs: bugsQuery })[activeRecordKind];
  const sourceFilterCount = Number(Boolean(sourceSearch.trim())) + Number(Boolean(sourceStatus)) + Number(Boolean(sourceCollectionId));
  const searchFilterCount = searchSourceKinds.length + Number(Boolean(searchCollectionId)) + Number(Boolean(searchAsOf)) + Number(searchMode !== "hybrid");
  const invalidChunking = !Number.isFinite(chunking.chunk_size) || chunking.chunk_size < 100 || chunking.chunk_size > 1000 || !Number.isFinite(chunking.chunk_overlap) || chunking.chunk_overlap < 0 || chunking.chunk_overlap >= chunking.chunk_size;
  const searchChanged = Boolean(submittedSearch && (
    submittedSearch.query !== searchQuery.trim() || submittedSearch.mode !== searchMode ||
    submittedSearch.filters.collection_ids[0] !== (searchCollectionId || undefined) ||
    submittedSearch.filters.source_kinds.join(",") !== searchSourceKinds.join(",") ||
    (submittedSearch.filters.as_of || "") !== (canManage && searchAsOf ? new Date(searchAsOf).toISOString() : "")
  ));

  const buildMutation = useMutation({
    mutationFn: async () => {
      if (!canManage) throw new Error("Knowledge management permission is required.");
      if (invalidChunking) throw new Error("Choose 100–1,000 target tokens and overlap below the target.");
      if (!projectId || !sourceCount) throw new Error("Choose at least one source to index.");
      const inputs: KnowledgeIngestionInput[] = hasPastedInput ? [{
        kind: pasteKind,
        title: pasteTitle.trim() || (pasteKind === "chat" ? "Conversation context" : pasteKind === "url" ? "Web reference" : "Context note"),
        content: pasteContent.trim(),
        source_uri: pasteKind === "url" ? pasteContent.trim() : null,
        metadata: { submitted_from: "knowledge-context-studio" }
      }] : [];
      const baseInput = {
        project_id: projectId,
        app_type_id: appTypeId || null,
        collection_id: collectionId || null,
        title: batchTitle.trim() || `Context build ${new Date().toLocaleDateString()}`,
        chunking
      };
      const requestFingerprint = clientFingerprint(JSON.stringify({
        ...baseInput,
        inputs,
        selected_records: selectedRecords,
        files: acceptableFiles.map((item) => ({
          name: item.file.name,
          size: item.file.size,
          type: item.file.type,
          last_modified: item.file.lastModified,
          extracted_text: item.extractedText
        }))
      }));
      if (!buildAttemptRef.current || buildAttemptRef.current.fingerprint !== requestFingerprint) {
        buildAttemptRef.current = { fingerprint: requestFingerprint, key: idempotencyPrefix() };
      }
      const requestKey = buildAttemptRef.current.key;
      const responses: KnowledgeIngestionResponse[] = [];

      if (selectedRecordCount || inputs.length) {
        responses.push(await api.knowledgeRepo.ingestions.create({
          ...baseInput,
          inputs,
          selected_records: selectedRecords
        }, { idempotencyKey: `${requestKey}:records` }));
      }

      for (let index = 0; index < acceptableFiles.length; index += 1) {
        const staged = acceptableFiles[index];
        responses.push(await api.knowledgeRepo.ingestions.upload({
          ...baseInput,
          title: staged.file.name,
          selected_records: emptySelectedRecords()
        }, staged.file, staged.extractedText, { idempotencyKey: `${requestKey}:file:${index}` }));
      }
      return responses;
    },
    onSuccess: (responses) => {
      buildAttemptRef.current = null;
      const jobs = responses.map(ingestionJob).filter(Boolean);
      setRecentSubmittedJobs(jobs.map((job) => job.id));
      setSelectedRecords(emptySelectedRecords());
      setFiles([]);
      setPasteTitle("");
      setPasteContent("");
      setBatchTitle("");
      setActiveTab("activity");
      void queryClient.invalidateQueries({ queryKey: ["knowledge-overview", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["knowledge-collections", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["knowledge-sources", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["knowledge", projectId] });
      const completed = jobs.filter((job) => job.status === "completed").length;
      const warningCount = jobs.filter((job) => job.status === "completed_with_warnings").length;
      const failed = jobs.filter((job) => job.status === "failed").length;
      const queued = jobs.filter((job) => ["queued", "running"].includes(String(job.status))).length;
      onSuccess(`${jobs.length} context processing job${jobs.length === 1 ? "" : "s"} accepted${queued ? `: ${queued} queued or running` : `: ${completed} completed`}${warningCount ? `, ${warningCount} with warnings` : ""}${failed ? `, ${failed} failed` : ""}. Only successfully indexed sources are searchable.`);
    },
    onError: (error) => onError(error, "Unable to start context processing.")
  });

  const searchMutation = useMutation({
    mutationFn: ({ request, signal }: { request: SearchRequest; signal: AbortSignal }) => knowledgeApi.knowledgeRepo.search(request, { signal }),
    onError: (error) => {
      if (!(error instanceof Error && error.name === "AbortError")) onError(error, "Knowledge search failed.");
    }
  });
  const results = searchResults(searchMutation.data);

  const deleteCollectionMutation = useMutation({
    mutationFn: (id: string) => api.knowledgeRepo.collections.delete(id),
    onSuccess: () => {
      setArmedCollectionDeleteId("");
      if (deleteCollectionMutation.variables === searchCollectionId) setSearchCollectionId("");
      if (deleteCollectionMutation.variables === sourceCollectionId) setSourceCollectionId("");
      void queryClient.invalidateQueries({ queryKey: ["knowledge-collections", projectId] });
      onSuccess("Collection deleted. Indexed sources remain available unless separately removed.");
    },
    onError: (error) => onError(error, "Unable to delete collection.")
  });

  const deleteSourceMutation = useMutation({
    mutationFn: (id: string) => api.knowledgeRepo.deleteSource(id),
    onSuccess: () => {
      setArmedSourceDeleteId("");
      void queryClient.invalidateQueries({ queryKey: ["knowledge-sources", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["knowledge-overview", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["knowledge-collections", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["knowledge", projectId] });
      onSuccess("Source archived from current retrieval. Its revision history is retained.");
    },
    onError: (error) => {
      setArmedSourceDeleteId("");
      onError(error, "Unable to remove this knowledge source.");
    }
  });

  const retryIngestionMutation = useMutation({
    mutationFn: (id: string) => api.knowledgeRepo.ingestions.retry(id),
    onSuccess: (response) => {
      setRecentSubmittedJobs((current) => [...new Set([...current, response.job.id])]);
      void queryClient.invalidateQueries({ queryKey: ["knowledge-overview", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["knowledge-sources", projectId] });
      onSuccess(`Retry ${response.job.config?.retry_count || 1} queued for ${response.job.config?.title || "the Knowledge source"}.`);
    },
    onError: (error) => onError(error, "Unable to retry this Knowledge ingestion.")
  });

  const addSearchSourcesMutation = useMutation({
    mutationFn: () => api.knowledgeRepo.collections.addSources(searchCollectionId, selectedSearchSources),
    onSuccess: () => {
      setSelectedSearchSources([]);
      void queryClient.invalidateQueries({ queryKey: ["knowledge-collections", projectId] });
      onSuccess("Search results added to the selected collection.");
    },
    onError: (error) => onError(error, "Unable to save search results to the collection.")
  });

  const addFiles = (candidateFiles: File[]) => {
    const maximum = overview?.capabilities?.max_files_per_ingestion || 20;
    const identity = (file: File) => `${file.name}:${file.size}:${file.lastModified}`;
    const known = new Set(files.map((item) => identity(item.file)));
    const unique = candidateFiles.filter((file) => {
      const key = identity(file);
      if (known.has(key)) return false;
      known.add(key);
      return true;
    });
    const available = Math.max(0, maximum - files.length);
    const next = unique.slice(0, available).map((file) => ({
      id: identity(file), file, ...classifyFile(file, overview), extractedText: ""
    }));
    setFiles((current) => [...current, ...next]);
    if (unique.length > available) onError(null, `A context build accepts up to ${maximum} files.`);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    if (!canManage) return;
    addFiles(Array.from(event.dataTransfer.files));
  };

  const toggleRecord = (kind: RecordKind, id: string) => {
    setSelectedRecords((current) => ({
      ...current,
      [kind]: current[kind].includes(id) ? current[kind].filter((item) => item !== id) : [...current[kind], id]
    }));
  };

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    if (!searchQuery.trim() || !projectId) return;
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    const request: SearchRequest = {
      project_id: projectId, query: searchQuery.trim(), mode: searchMode, limit: 20,
      filters: { app_type_id: appTypeId || null, collection_ids: searchCollectionId ? [searchCollectionId] : [], source_kinds: [...searchSourceKinds], ...(canManage && searchAsOf ? { as_of: new Date(searchAsOf).toISOString() } : {}) }
    };
    setSubmittedSearch(request);
    setSelectedSearchSources([]);
    searchMutation.mutate({ request, signal: controller.signal });
  };

  return (
    <section className="knowledge-studio" aria-label="Knowledge context studio">
      <div className="knowledge-repo-commandbar">
        <div className="knowledge-repo-status" role="status">
          <span className={`knowledge-status-dot ${indexedSourceCount ? "is-ready" : ""}`} />
          {overviewQuery.isPending ? "Checking sources…" : overviewQuery.isError ? "Status unavailable" : <span>{indexedSourceCount.toLocaleString()} searchable<span className="knowledge-status-long-label"> sources</span></span>}
          {Number(counts?.processing_sources || 0) > 0 ? <button type="button" onClick={() => setActiveTab("activity")}>{counts?.processing_sources} processing</button> : null}
          {Number(counts?.failed_sources || 0) > 0 ? <button type="button" onClick={() => { setSourceStatus("attention"); setActiveTab("sources"); }}>{counts?.failed_sources} need attention</button> : null}
        </div>
        <div className="knowledge-command-actions">
          <button aria-expanded={showHealth} aria-controls="knowledge-health-details" aria-label="Repository health and retrieval details" className="ghost-button compact" onClick={() => setShowHealth(!showHealth)} type="button"><IconInfoCircle size={17} /><span>Health</span></button>
          {canManage ? <button className="primary-button" disabled={!projectId} onClick={() => setActiveTab("build")} type="button"><IconPlus size={17} />Add sources</button> : null}
        </div>
      </div>
      {showHealth ? <div className="knowledge-health-details" id="knowledge-health-details">
        <div className="knowledge-health-metrics"><span><strong>{counts?.sources ?? "—"}</strong> sources</span><span><strong>{counts?.documents ?? "—"}</strong> documents</span><span><strong>{counts?.chunks ?? "—"}</strong> passages</span><span><strong>{collections.length}</strong> collections</span></div>
        <p><IconShieldCheck size={16} />Only permitted, indexed revisions are used by AI.</p>
        <p>{embeddingConfigured ? "Embedding provider configured" : "Local search fallback"} · {vectorSearchUnavailable ? "Vector search temporarily unavailable" : overview?.capabilities?.hybrid_search ? "Hybrid search enabled" : "Keyword search enabled"}</p>
        {overview?.capabilities?.context_processing?.refresh_recommended ? <p>Context refresh recommended.</p> : null}
      </div> : null}
      {overviewQuery.isError || embeddingFallbackJobs || vectorSearchUnavailable ? <div className="knowledge-indexing-notice is-warning" role="status"><IconInfoCircle size={17} /><div><strong>{overviewQuery.isError ? "Index status unavailable" : embeddingFallbackJobs ? "Some sources used local search" : "Semantic search is recovering"}</strong><span>{overviewQuery.isError ? "Retry to check the latest processing state." : "Keyword retrieval remains available. Review processing for details."}</span></div><button className="ghost-button compact" onClick={() => overviewQuery.isError ? void overviewQuery.refetch() : setActiveTab("activity")} type="button">{overviewQuery.isError ? "Retry" : "Review"}</button></div> : null}

      <KnowledgeRefreshControl key={projectId} projectId={projectId} canManage={canManage} />

      <div hidden={activeTab === "build"} className="knowledge-studio-tabs" role="tablist" aria-label="Knowledge workflows">
        {([
          ["sources", "Sources", IconFileText],
          ["search", "Search", IconSearch],
          ["graph", "Graphs", IconStack2],
          ["collections", "Collections", IconFolders],
          ["activity", "Activity", IconClock]
        ] as Array<[StudioTab, string, typeof IconStack2]>).filter(([tab]) => tab !== "build" || canManage).map(([tab, label, Icon]) => (
          <button
            aria-controls={`knowledge-panel-${tab}`}
            aria-selected={activeTab === tab}
            className={activeTab === tab ? "is-active" : ""}
            id={`knowledge-tab-${tab}`}
            key={tab}
            onClick={() => setActiveTab(tab)}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
              const tabs = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]') || []);
              const currentIndex = tabs.indexOf(event.currentTarget);
              const nextIndex = event.key === "Home"
                ? 0
                : event.key === "End"
                  ? tabs.length - 1
                  : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
              event.preventDefault();
              tabs[nextIndex]?.focus();
              tabs[nextIndex]?.click();
            }}
            role="tab"
            tabIndex={activeTab === tab ? 0 : -1}
            type="button"
          >
            <Icon size={17} />
            {label}
            {tab === "activity" && (counts?.processing_sources || 0) ? <span>{counts?.processing_sources}</span> : null}
          </button>
        ))}
      </div>

      {activeTab === "graph" ? <Suspense fallback={<LoadingState label="Loading knowledge and context graphs" />}><KnowledgeGraphPanel key={projectId} projectId={projectId} appTypeId={appTypeId} canManage={canManage} sources={allSources} onOpenSource={(sourceId, revisionId) => { setSelectedDetailSourceId(sourceId); setSelectedDetailRevisionId(revisionId || ""); }} /></Suspense> : null}

      {activeTab === "build" && canManage ? (
        <div aria-labelledby="knowledge-add-sources-title" className="knowledge-builder" id="knowledge-panel-build" role="tabpanel">
          {!canManage ? (
            <div className="knowledge-studio-readonly" role="status"><IconInfoCircle size={18} /> You can search and use project knowledge, but your role cannot ingest or organize sources.</div>
          ) : null}
          <div className="knowledge-builder-heading">
            <div>
              <h3 id="knowledge-add-sources-title">Add sources</h3>
              <p>Choose evidence for your project assistant.</p>
            </div>
            <div className="knowledge-command-actions"><span className="knowledge-selection-total">{sourceCount} selected</span><button className="ghost-button compact" disabled={buildMutation.isPending} onClick={() => setActiveTab("sources")} type="button"><IconX size={16} />Close</button></div>
          </div>

          <div className="knowledge-builder-grid">
            <nav className="knowledge-source-nav" aria-label="Choose source type">
              {([ ["files", "Files & media", "Documents, screenshots, transcripts", IconUpload], ["notes", "Notes & conversations", "Rules, decisions or URL references", IconMessageCircle], ["records", "Project records", "Stories, cases, runs and defects", IconDatabase] ] as Array<[BuildKind, string, string, typeof IconUpload]>).filter(([kind]) => kind !== "records" || availableRecordKinds.length).map(([kind, title, description, Icon]) => <button aria-pressed={buildKind === kind} className={buildKind === kind ? "is-active" : ""} key={kind} onClick={() => setBuildKind(kind)} type="button"><span className="knowledge-source-icon"><Icon size={19} /></span><span><strong>{title}</strong><small>{description}</small></span><IconChevronRight className="knowledge-source-chevron" size={15} /></button>)}
              {buildKind === "records" ? <div className="knowledge-record-kind-tabs">{availableRecordKinds.map(({ key, label, icon: Icon }) => <button aria-pressed={activeRecordKind === key} className={activeRecordKind === key ? "is-active" : ""} key={key} onClick={() => { setActiveRecordKind(key); setRecordSearch(""); }} type="button"><Icon size={16} />{label}{selectedRecords[key].length ? <span>{selectedRecords[key].length}</span> : null}</button>)}</div> : null}
            </nav>

            <div className="knowledge-source-workspace">
              {buildKind === "records" && availableRecordKinds.length ? <section className="knowledge-record-picker">
                <div className="knowledge-picker-header">
                  <div>
                    <span className="knowledge-builder-section-label">{recordKinds.find((item) => item.key === activeRecordKind)?.label}</span>
                    <strong>Select records to index</strong>
                  </div>
                  <button
                    className="ghost-button"
                    disabled={!visibleRecords.length || !canManage}
                    onClick={() => setSelectedRecords((current) => ({
                      ...current,
                      [activeRecordKind]: visibleRecords.every((item) => current[activeRecordKind].includes(item.id))
                        ? current[activeRecordKind].filter((id) => !visibleRecords.some((item) => item.id === id))
                        : Array.from(new Set([...current[activeRecordKind], ...visibleRecords.map((item) => item.id)]))
                    }))}
                    type="button"
                  >
                    <SelectionToggleIcon checked={!(visibleRecords.every((item) => selectedRecords[activeRecordKind].includes(item.id)) && visibleRecords.length > 0)} />
                    {visibleRecords.every((item) => selectedRecords[activeRecordKind].includes(item.id)) && visibleRecords.length ? "Clear visible" : "Select visible"}
                  </button>
                </div>
                <label className="knowledge-record-search">
                  <IconSearch size={16} />
                  <span className="sr-only">Search {formatRecordKindLabel(activeRecordKind)}</span>
                  <input onChange={(event) => setRecordSearch(event.target.value)} placeholder="Search by ID, title, or status" type="search" value={recordSearch} />
                  {recordSearch ? <button aria-label="Clear record search" onClick={() => setRecordSearch("")} type="button"><IconX size={15} /></button> : null}
                </label>
                <div className="knowledge-record-list">
                  {visibleRecords.slice(0, 200).map((item) => {
                    const selected = selectedRecords[activeRecordKind].includes(item.id);
                    return (
                      <label className={selected ? "knowledge-record-row is-selected" : "knowledge-record-row"} key={item.id}>
                        <input checked={selected} disabled={!canManage} onChange={() => toggleRecord(activeRecordKind, item.id)} type="checkbox" />
                        <span className="knowledge-record-check"><IconCheck size={13} /></span>
                        <span className="knowledge-record-copy">
                          <strong>{recordTitle(item)}</strong>
                          <small>{recordIdentity(item)} · {humanize(recordStatus(item))}</small>
                        </span>
                      </label>
                    );
                  })}
                  {recordQuery.isPending ? <LoadingState label="Loading project records" /> : recordQuery.isError ? <div className="knowledge-inline-error" role="alert">Could not load records.<button className="ghost-button compact" onClick={() => void recordQuery.refetch()} type="button">Retry</button></div> : !visibleRecords.length ? <div className="knowledge-picker-empty">{recordSearch ? "No records match your search." : "No records in this project scope."}</div> : null}
                  {visibleRecords.length > 200 ? <p className="knowledge-picker-limit">Showing 200 of {visibleRecords.length} loaded records. Refine your search to find a specific record.</p> : null}
                </div>
              </section> : null}

              {buildKind === "notes" ? <section className="knowledge-paste-section">
                <div className="knowledge-section-title">
                  <div><span className="knowledge-builder-section-label">Unstructured input</span><strong>{pasteKind === "chat" ? "Add a conversation" : pasteKind === "url" ? "Add a URL reference" : "Add a note"}</strong></div>
                  <div className="knowledge-mini-tabs" aria-label="Pasted input type" role="group">
                    {(["text", "chat", "url"] as PasteKind[]).map((kind) => <button aria-pressed={pasteKind === kind} className={pasteKind === kind ? "is-active" : ""} key={kind} onClick={() => setPasteKind(kind)} type="button">{kind === "text" ? "Text" : kind === "chat" ? "Chat" : "URL"}</button>)}
                  </div>
                </div>
                <input aria-label="Source title" disabled={!canManage} onChange={(event) => setPasteTitle(event.target.value)} placeholder={pasteKind === "chat" ? "Conversation title" : pasteKind === "url" ? "Reference title" : "Note title"} type="text" value={pasteTitle} />
                <textarea
                  aria-label={pasteKind === "chat" ? "Conversation text" : pasteKind === "url" ? "Reference URL" : "Note content"}
                  disabled={!canManage}
                  onChange={(event) => setPasteContent(event.target.value)}
                  placeholder={pasteKind === "chat" ? "Paste the relevant conversation. Remove secrets and unrelated personal information first…" : pasteKind === "url" ? "https://docs.example.com/relevant-page" : "Paste product rules, decisions, glossary terms, or other durable context…"}
                  rows={5}
                  value={pasteContent}
                />
                <small>{pasteContent.length.toLocaleString()} characters{pasteKind === "url" ? " · Stores the reference only; page content is not fetched." : " · Include facts relevant to this project."}</small>
                {pasteKind === "url" && pasteContent.trim() && !hasPastedInput ? <p className="knowledge-inline-error" role="alert">Enter a URL beginning with https:// or http://.</p> : null}
              </section> : null}

              {buildKind === "files" ? <section className="knowledge-file-section">
                <div className="knowledge-section-title">
                  <div><span className="knowledge-builder-section-label">Documents & media</span><strong>Upload project files</strong></div>
                  <span>{files.length}/{overview?.capabilities?.max_files_per_ingestion || 20}</span>
                </div>
                <div
                  className={`knowledge-drop-zone${isDragging ? " is-dragging" : ""}${!canManage ? " is-disabled" : ""}`}
                  onDragEnter={(event) => { event.preventDefault(); if (canManage) setIsDragging(true); }}
                  onDragLeave={(event) => { event.preventDefault(); if (!event.currentTarget.contains(event.relatedTarget as Node)) setIsDragging(false); }}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={handleDrop}
                >
                  <IconUpload size={24} />
                  <div><strong>Drop project files here</strong><span>or choose files from your device</span></div>
                  <button className="ghost-button" disabled={!canManage} onClick={() => fileInputRef.current?.click()} type="button">Choose files</button>
                  <input
                    accept={[
                      ...(overview?.capabilities?.extraction?.supported_mime_types || fallbackSupportedMimeTypes),
                      ...(overview?.capabilities?.extraction?.supported_extensions || fallbackExtensions)
                    ].join(",")}
                    hidden
                    multiple
                    onChange={(event) => { addFiles(Array.from(event.target.files || [])); event.currentTarget.value = ""; }}
                    ref={fileInputRef}
                    type="file"
                  />
                </div>
                <p className="knowledge-file-support">Maximum {formatBytes(overview?.capabilities?.extraction?.max_file_bytes || overview?.capabilities?.max_file_bytes || 50 * 1024 * 1024)} each. Images need a caption; audio and video need a transcript.</p>
                {files.length ? (
                  <div className="knowledge-file-queue">
                    {files.map((item) => {
                      const needsUserText = ["needs_caption", "needs_transcript", "needs_text"].includes(item.status);
                      return (
                        <article className={`knowledge-file-row is-${item.status}`} key={item.id}>
                          <div className="knowledge-file-icon"><IconFileText size={19} /></div>
                          <div className="knowledge-file-copy">
                            <strong>{item.file.name}</strong>
                            <span>{formatBytes(item.file.size)} · {item.file.type || fileExtension(item.file.name) || "Unknown type"}</span>
                            <small><span className="knowledge-file-status-dot" /> {item.helper}</small>
                            {needsUserText ? (
                              <textarea
                                aria-label={`${item.status === "needs_caption" ? "Caption" : item.status === "needs_transcript" ? "Transcript" : "Extracted text"} for ${item.file.name}`}
                                onChange={(event) => setFiles((current) => current.map((file) => file.id === item.id ? { ...file, extractedText: event.target.value } : file))}
                                placeholder={item.status === "needs_caption" ? "Describe visible facts and include any readable text…" : item.status === "needs_transcript" ? "Paste a transcript with relevant speakers or timestamps…" : "Paste extracted text from this document…"}
                                rows={3}
                                value={item.extractedText}
                              />
                            ) : null}
                          </div>
                          <button aria-label={`Remove ${item.file.name}`} onClick={() => setFiles((current) => current.filter((file) => file.id !== item.id))} type="button"><IconX size={16} /></button>
                        </article>
                      );
                    })}
                  </div>
                ) : null}
              </section> : null}
            </div>

            <aside className="knowledge-build-summary">
              <h3>Ready to index</h3>
              <p>Sources become searchable when processing completes.</p>
              <label>
                <span>Build name</span>
                <input disabled={!canManage} onChange={(event) => setBatchTitle(event.target.value)} placeholder="e.g. Checkout release context" type="text" value={batchTitle} />
              </label>
              <label>
                <span>Save to collection</span>
                <select disabled={!canManage} onChange={(event) => setCollectionId(event.target.value)} value={collectionId}>
                  <option value="">No collection</option>
                  {collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.name}</option>)}
                </select>
              </label>
              <div className="knowledge-build-counts">
                <span><strong>{selectedRecordCount}</strong> HelloTest records</span>
                <span><strong>{acceptableFiles.length}</strong> indexable files</span>
                <span><strong>{hasPastedInput ? 1 : 0}</strong> pasted inputs</span>
              </div>
              <button className="knowledge-advanced-toggle" onClick={() => setShowAdvanced((current) => !current)} type="button">
                <IconSettings size={16} /> Chunking controls <IconChevronRight className={showAdvanced ? "is-expanded" : ""} size={15} />
              </button>
              {showAdvanced ? (
                <div className="knowledge-chunking-controls">
                  <label><span>Strategy</span><select onChange={(event) => setChunking((current) => ({ ...current, strategy: event.target.value as KnowledgeChunkingConfig["strategy"] }))} value={chunking.strategy}><option value="semantic">Structure-aware · recommended</option><option value="recursive">Recursive sections</option><option value="fixed">Fixed window</option></select></label>
                  <label><span>Target tokens</span><input max={1000} min={100} onChange={(event) => setChunking((current) => ({ ...current, chunk_size: Number(event.target.value) }))} step={50} type="number" value={chunking.chunk_size} /></label>
                  <label><span>Overlap tokens</span><input max={333} min={0} onChange={(event) => setChunking((current) => ({ ...current, chunk_overlap: Number(event.target.value) }))} step={10} type="number" value={chunking.chunk_overlap} /></label>
                </div>
              ) : null}
              <details className="knowledge-pipeline-disclosure"><summary>How processing works</summary><div className="knowledge-pipeline-preview" aria-label="Context processing pipeline">
                {[["Extract", "Parse usable text"], ["Protect", "Scope and redact"], ["Chunk", "Preserve meaning"], ["Embed", "Create vectors"], ["Index", "Enable retrieval"]].map(([label, helper], index) => (
                  <div key={label}><span>{index + 1}</span><div><strong>{label}</strong><small>{helper}</small></div>{index < 4 ? <IconArrowRight size={13} /> : null}</div>
                ))}
              </div></details>
              {invalidChunking ? <p className="knowledge-inline-error" role="alert">Use 100–1,000 target tokens and an overlap below the target.</p> : null}
              <button className="primary-button knowledge-build-submit" disabled={!canManage || !sourceCount || invalidChunking || buildMutation.isPending} onClick={() => buildMutation.mutate()} type="button">
                {buildMutation.isPending ? <LoadingState label="Starting context processing" /> : <IconSparkles size={17} />}
                {buildMutation.isPending ? "Starting processing…" : "Index sources"}
              </button>
              {!sourceCount ? <small className="knowledge-build-empty-note">Select at least one record, valid pasted input, or file with an extraction path.</small> : null}
            </aside>
          </div>
        </div>
      ) : null}

      {activeTab === "search" ? (
        <div aria-labelledby="knowledge-tab-search" className="knowledge-search-workspace" id="knowledge-panel-search" role="tabpanel">
          <div className="knowledge-search-heading">
            <div><h3>Search your knowledge</h3><p>Find evidence the assistant can use.</p></div>
          </div>
          <form className="knowledge-search-form" onSubmit={submitSearch}>
            <div className="knowledge-search-input"><IconSearch size={20} /><input aria-label="Search indexed project context" placeholder="Ask a project question or search for an exact term…" onChange={(event) => setSearchQuery(event.target.value)} value={searchQuery} /><button className="primary-button" disabled={!searchQuery.trim() || searchMutation.isPending} type="submit">{searchMutation.isPending ? "Searching…" : "Search"}</button></div>
            <div className="knowledge-search-options"><button className="ghost-button compact" aria-controls="knowledge-search-filters" aria-expanded={showSearchFilters} onClick={() => setShowSearchFilters(!showSearchFilters)} type="button"><IconAdjustmentsHorizontal size={16} />Filters{searchFilterCount ? <span className="badge badge-neutral">{searchFilterCount}</span> : null}</button><span>{searchCollectionId ? collections.find((item) => item.id === searchCollectionId)?.name : "All sources"} · {humanize(searchMode)}</span>{searchFilterCount ? <button className="ghost-button compact" onClick={() => { setSearchCollectionId(""); setSearchSourceKinds([]); setSearchAsOf(""); setSearchMode("hybrid"); }} type="button">Reset</button> : null}</div>
            {showSearchFilters ? <div className="knowledge-search-filters" id="knowledge-search-filters">
              <label><span>Retrieval</span><select onChange={(event) => setSearchMode(event.target.value as KnowledgeSearchMode)} value={searchMode}><option value="hybrid">Hybrid · recommended</option><option value="semantic">Semantic</option><option value="keyword">Exact keyword</option></select></label>
              <label><span>Collection</span><select onChange={(event) => setSearchCollectionId(event.target.value)} value={searchCollectionId}><option value="">All collections</option>{collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.name}</option>)}</select></label>
              {canManage ? <label><span>Knowledge as of</span><input aria-label="Historical knowledge date; leave empty for current" onChange={(event) => setSearchAsOf(event.target.value)} type="datetime-local" value={searchAsOf} />{searchAsOf ? <button className="ghost-button compact" onClick={() => setSearchAsOf("")} type="button">Use current</button> : null}</label> : null}
              <fieldset><legend>Source types</legend>{[["requirement", "Stories"], ["test_case", "Cases"], ["execution", "Runs"], ["bug", "Defects"], ["file", "Files"], ["text", "Notes"]].map(([value, label]) => <label className={searchSourceKinds.includes(value) ? "is-active" : ""} key={value}><input checked={searchSourceKinds.includes(value)} onChange={(event) => setSearchSourceKinds((current) => event.target.checked ? [...current, value] : current.filter((kind) => kind !== value))} type="checkbox" />{label}</label>)}</fieldset>
            </div> : null}
          </form>
          {searchChanged && searchMutation.data ? <p className="knowledge-search-stale" role="status">Results for “{submittedSearch?.query}”. Search again to apply your changes.</p> : null}
          {searchMutation.isPending ? <LoadingState label="Searching project knowledge" /> : null}
          {searchMutation.isError ? <div className="knowledge-inline-error" role="alert">Search could not complete. Try again or use keyword search.</div> : null}
          {searchMutation.data ? (
            <div className="knowledge-search-summary">
              <span><strong>{results.length}</strong> matching passages</span>
              <span>{submittedSearch?.filters.as_of ? `Historical · ${new Date(submittedSearch.filters.as_of).toLocaleString()}` : "Current searchable revisions"}</span>
              <span>{searchMutation.data.retrieval?.candidate_count || results.length} candidates evaluated</span>
              <span>{searchMutation.data.retrieval?.vector_mode || submittedSearch?.mode} retrieval</span>
              {canManage && searchCollectionId && selectedSearchSources.length && !searchChanged ? <button className="ghost-button" disabled={addSearchSourcesMutation.isPending} onClick={() => addSearchSourcesMutation.mutate()} type="button">Save {selectedSearchSources.length} source{selectedSearchSources.length === 1 ? "" : "s"} to collection</button> : null}
            </div>
          ) : null}
          <div className="knowledge-search-results">
            {results.map((result, index) => {
              const score = normalizedScore(result.score);
              const sourceId = result.source_id || result.source_ref_id || result.id;
              const canSaveSource = result.source_kind !== "product_help" && Boolean(result.source_id);
              return (
                <article className="knowledge-search-result" key={`${result.id}-${index}`}>
                  <div className="knowledge-search-result-rank">{index + 1}</div>
                  <div className="knowledge-search-result-body">
                    <div className="knowledge-search-result-header">
                      <div><span className="badge badge-neutral">{humanize(formatRecordKindLabel(result.source_kind))}</span><h4>{result.title || result.citation?.label || result.label || "Project context"}</h4></div>
                      {canManage && canSaveSource ? <label className="knowledge-result-select"><input checked={selectedSearchSources.includes(sourceId)} onChange={(event) => setSelectedSearchSources((current) => event.target.checked ? Array.from(new Set([...current, sourceId])) : current.filter((id) => id !== sourceId))} type="checkbox" />Save</label> : null}
                    </div>
                    <p>{result.excerpt || result.content || "No preview text returned."}</p>
                    <div className="knowledge-search-result-meta">
                      {result.source_id ? <button className="ghost-button compact" onClick={() => { setSelectedDetailRevisionId(submittedSearch?.filters.as_of ? result.knowledge_id || result.document_id || "" : ""); setSelectedDetailSourceId(String(result.source_id)); }} type="button">Inspect source<IconChevronRight size={13} /></button> : null}
                      <span><IconShieldCheck size={14} /> Citable source</span>
                      {score !== null ? <span><strong>{score}%</strong> relevance</span> : null}
                      <details className="knowledge-result-signals"><summary>Match details</summary><div>{normalizedScore(result.semantic_score) !== null ? <span>{normalizedScore(result.semantic_score)}% semantic</span> : null}
                      {normalizedScore(result.lexical_score ?? result.keyword_score) !== null ? <span>{normalizedScore(result.lexical_score ?? result.keyword_score)}% lexical</span> : null}
                      {result.citation?.location?.page ? <span>Page {result.citation.location.page}</span> : result.citation?.location?.heading ? <span>{result.citation.location.heading}</span> : result.citation?.location?.chunk_index !== undefined && result.citation?.location?.chunk_index !== null ? <span>Chunk {result.citation.location.chunk_index + 1}</span> : null}
                      <code>{result.chunk_id || result.id}</code></div></details>
                    </div>
                  </div>
                </article>
              );
            })}
            {searchMutation.data && !results.length ? <div className="knowledge-no-results"><IconAlertTriangle size={24} /><strong>No matching evidence</strong><p>Try a specific term or broaden your filters.</p>{canManage ? <button className="ghost-button" onClick={() => setActiveTab("build")} type="button"><IconPlus size={16} />Add a source</button> : null}</div> : null}
            {!searchMutation.data && !searchMutation.isPending ? <div className="knowledge-search-placeholder"><IconSearch size={28} /><strong>What would you like to find?</strong><p>Search a project question, product rule or exact phrase.</p><div className="knowledge-search-suggestions">{["Acceptance criteria", "Release sign-off", "Known defects"].map((query) => <button className="ghost-button compact" key={query} onClick={() => setSearchQuery(query)} type="button">{query}<IconArrowRight size={14} /></button>)}</div></div> : null}
          </div>
        </div>
      ) : null}

      {activeTab === "sources" ? (
        <div aria-labelledby="knowledge-tab-sources" className="knowledge-sources-workspace" id="knowledge-panel-sources" role="tabpanel">
          <div className="knowledge-sources-heading">
            <div><h3>Sources</h3><p>Your evidence, ready for AI.</p></div>
            <button className="ghost-button" disabled={sourcesQuery.isFetching} onClick={() => sourcesQuery.refetch()} type="button">Refresh</button>
          </div>
          <div className="knowledge-source-toolbar">
            <label className="knowledge-record-search">
              <IconSearch size={16} />
              <span className="sr-only">Search indexed sources</span>
              <input onChange={(event) => setSourceSearch(event.target.value)} placeholder="Search source, file, record ID, or kind" type="search" value={sourceSearch} />
              {sourceSearch ? <button aria-label="Clear source search" onClick={() => setSourceSearch("")} type="button"><IconX size={15} /></button> : null}
            </label>
            <button aria-controls="knowledge-source-filter-panel" aria-expanded={showSourceFilters} aria-label="Source filters" className="ghost-button compact" onClick={() => setShowSourceFilters(!showSourceFilters)} type="button"><IconAdjustmentsHorizontal size={16} />Filters{sourceFilterCount ? <span className="badge badge-neutral">{sourceFilterCount}</span> : null}</button>
            <label><span className="sr-only">Sort</span><select aria-label="Source sort order" onChange={(event) => setSourceSort(event.target.value)} value={sourceSort}><option value="updated">Recently updated</option><option value="title">Name A–Z</option></select></label>
            <span>{visibleSources.length} source{visibleSources.length === 1 ? "" : "s"}</span>
          </div>
          {showSourceFilters ? <div className="knowledge-source-filter-panel" id="knowledge-source-filter-panel" role="group" aria-label="Source filter options">
            <label><span>Status</span><select aria-label="Source status" onChange={(event) => setSourceStatus(event.target.value)} value={sourceStatus}><option value="">Current sources</option><option value="attention">Needs attention</option><option value="ready">Ready</option><option value="processing">Processing</option><option value="needs_extraction">Needs text</option><option value="failed">Failed</option><option value="archived">Archived</option></select></label>
            <label><span>Collection</span><select aria-label="Source collection" onChange={(event) => setSourceCollectionId(event.target.value)} value={sourceCollectionId}><option value="">All collections</option>{collections.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            {sourceFilterCount ? <button className="ghost-button compact" onClick={() => { setSourceSearch(""); setSourceStatus(""); setSourceCollectionId(""); }} type="button">Reset</button> : null}
          </div> : null}
          {sourcesQuery.isPending ? <LoadingState label="Loading knowledge sources" /> : null}
          {sourcesQuery.isError ? <div className="knowledge-inline-error" role="alert">Sources could not be loaded.<button className="ghost-button compact" onClick={() => void sourcesQuery.refetch()} type="button">Retry</button></div> : null}
          <div className="knowledge-source-inventory">
            {visibleSources.map((source) => {
              const indexed = source.extraction_status === "ready" && Number(source.chunk_count || 0) > 0;
              const extracted = source.extraction_status === "ready" && !indexed && Number(source.document_count || 0) > 0;
              const needsText = source.extraction_status === "needs_extraction";
              const readiness = source.extraction_status === "archived" ? "Archived" : indexed ? "Indexed & searchable" : extracted ? "Text extracted" : needsText ? (String(source.mime_type || "").startsWith("image/") ? "Caption required" : String(source.mime_type || "").match(/^(audio|video)\//) ? "Transcript required" : "Extracted text required") : source.extraction_status === "failed" ? "Processing failed" : source.extraction_status === "processing" ? "Processing" : "Stored only";
              const collectionNames = (source.collection_ids || []).map((id) => collections.find((collection) => collection.id === id)?.name || id).slice(0, 3);
              return (
                <article className={`knowledge-source-inventory-row is-${source.extraction_status}`} key={source.id}>
                  <div className="knowledge-inventory-kind"><IconFileText size={19} /></div>
                  <div className="knowledge-inventory-copy">
                    <div><span className="badge badge-neutral">{humanize(formatRecordKindLabel(source.source_kind))}</span><button className="knowledge-source-title-button" onClick={() => { setSelectedDetailRevisionId(""); setSelectedDetailSourceId(source.id); }} type="button">{source.title}</button></div>
                    <small>{source.file_name || source.source_ref_id || source.id}{source.mime_type ? ` · ${source.mime_type}` : ""}{source.size_bytes ? ` · ${formatBytes(source.size_bytes)}` : ""}</small>
                    {collectionNames.length ? <span className="knowledge-inventory-collections">{collectionNames.map((name) => <i key={name}>{name}</i>)}</span> : null}
                  </div>
                  <div className="knowledge-inventory-readiness">
                    <span className={`is-${indexed ? "indexed" : extracted ? "extracted" : needsText ? "action" : source.extraction_status === "failed" ? "failed" : "stored"}`}><i /> {readiness}</span>
                    <small>{source.document_count || 0} document{source.document_count === 1 ? "" : "s"} · {source.chunk_count || 0} chunk{source.chunk_count === 1 ? "" : "s"}</small>
                  </div>
                  <button className="ghost-button compact knowledge-source-inspect" onClick={() => { setSelectedDetailRevisionId(""); setSelectedDetailSourceId(source.id); }} type="button">Details<IconChevronRight size={14} /></button>
                  {canManage && source.extraction_status !== "archived" ? <button
                    aria-label={armedSourceDeleteId === source.id ? `Confirm archive of ${source.title}` : `Archive ${source.title}`}
                    className={`knowledge-source-remove${armedSourceDeleteId === source.id ? " is-armed" : ""}`}
                    disabled={deleteSourceMutation.isPending}
                    onBlur={() => { if (armedSourceDeleteId === source.id) setArmedSourceDeleteId(""); }}
                    onClick={() => {
                      if (armedSourceDeleteId === source.id) deleteSourceMutation.mutate(source.id);
                      else setArmedSourceDeleteId(source.id);
                    }}
                    type="button"
                  ><IconTrash size={15} /><span>{armedSourceDeleteId === source.id ? "Confirm" : "Archive"}</span></button> : null}
                </article>
              );
            })}
            {!visibleSources.length && !sourcesQuery.isPending && !sourcesQuery.isError ? <div className="knowledge-source-inventory-empty"><IconFileText size={28} /><strong>{sourceFilterCount ? "No matching sources" : "Give your assistant project context"}</strong><p>{sourceFilterCount ? "Try another search or reset your filters." : "Add documents, notes or project records to get started."}</p>{sourceFilterCount ? <button className="ghost-button" onClick={() => { setSourceSearch(""); setSourceStatus(""); setSourceCollectionId(""); }} type="button">Reset filters</button> : canManage ? <button className="primary-button" onClick={() => setActiveTab("build")} type="button"><IconPlus size={16} />Add sources</button> : null}</div> : null}
          </div>
        </div>
      ) : null}

      {activeTab === "collections" ? (
        <div aria-labelledby="knowledge-tab-collections" className="knowledge-collections-workspace" id="knowledge-panel-collections" role="tabpanel">
          <div className="knowledge-collections-heading"><div><h3>Collections</h3><p>Keep related sources together.</p></div>{canManage ? <button className="ghost-button" onClick={() => setCollectionDialogId("new")} type="button"><IconPlus size={16} />New collection</button> : null}</div>
          {collectionsQuery.isPending ? <LoadingState label="Loading collections" /> : null}
          {collectionsQuery.isError ? <div className="knowledge-inline-error" role="alert">Collections could not be loaded.<button className="ghost-button compact" onClick={() => void collectionsQuery.refetch()} type="button">Retry</button></div> : null}
          <div className="knowledge-collections-grid">
            <div className="knowledge-collection-list">
              {collections.map((collection: KnowledgeCollection) => (
                <article className="knowledge-collection-card" key={collection.id}>
                  <span className="knowledge-collection-accent" style={{ backgroundColor: collection.color || "#0d9488" }} />
                  <div className="knowledge-collection-card-head"><div><span className="badge badge-neutral">{collection.status || (collection.is_active === false ? "inactive" : "active")}</span><h4>{collection.name}</h4></div>{canManage ? <button aria-label={`Delete ${collection.name}`} className={armedCollectionDeleteId === collection.id ? "is-armed" : ""} disabled={deleteCollectionMutation.isPending} onBlur={() => { if (armedCollectionDeleteId === collection.id) setArmedCollectionDeleteId(""); }} onClick={() => { if (armedCollectionDeleteId === collection.id) deleteCollectionMutation.mutate(collection.id); else setArmedCollectionDeleteId(collection.id); }} title={armedCollectionDeleteId === collection.id ? "Click again to delete collection" : "Delete collection"} type="button"><IconTrash size={16} /></button> : null}</div>
                  {collection.description ? <p>{collection.description}</p> : null}
                  <div className="knowledge-collection-metrics"><span><strong>{collection.source_count || 0}</strong> sources</span><span><strong>{collection.document_count || 0}</strong> documents</span><span><strong>{collection.chunk_count || 0}</strong> chunks</span></div>
                  {canManage ? <button className="ghost-button compact" onClick={() => setCollectionDialogId(collection.id)} type="button">Manage sources</button> : null}
                  <button className="ghost-button" onClick={() => { setSearchCollectionId(collection.id); setActiveTab("search"); }} type="button">Search collection <IconArrowRight size={15} /></button>
                </article>
              ))}
              {!collections.length && !collectionsQuery.isPending && !collectionsQuery.isError ? <div className="knowledge-collection-empty"><IconFolders size={28} /><strong>Keep related context together</strong><p>Create a collection for a feature, release or workflow.</p>{canManage ? <button className="ghost-button" onClick={() => setCollectionDialogId("new")} type="button">New collection</button> : null}</div> : null}
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === "activity" ? (
        <div aria-labelledby="knowledge-tab-activity" className="knowledge-activity-workspace" id="knowledge-panel-activity" role="tabpanel">
          <div className="knowledge-activity-heading"><div><h3>Activity</h3><p>Track indexing and retry interrupted sources.</p></div><button className="ghost-button" disabled={overviewQuery.isFetching} onClick={() => overviewQuery.refetch()} type="button">Refresh</button></div>
          {overviewQuery.isPending ? <LoadingState label="Loading processing activity" /> : null}
          {overviewQuery.isError ? <div className="knowledge-inline-error" role="alert">Activity could not be loaded.<button className="ghost-button compact" onClick={() => void overviewQuery.refetch()} type="button">Retry</button></div> : null}
          <div className="knowledge-activity-list">
            {processingJobs.map((job) => {
              const status = String(job.status || job.stage || "queued");
              const terminal = ["completed", "completed_with_warnings", "failed"].includes(status);
              const progress = Number.isFinite(Number(job.progress)) ? Math.max(0, Math.min(100, Number(job.progress))) : terminal ? 100 : status === "running" ? 55 : 15;
              const submittedHere = recentSubmittedJobs.includes(job.id);
              const warningMessages = (job.warnings || []).map(processingNoticeText);
              const errorMessages = (job.errors || []).map(processingNoticeText);
              return (
                <article className={`knowledge-job-card is-${status}`} key={job.id}>
                  {status === "completed" || status === "completed_with_warnings" || status === "failed" ? <div className="knowledge-job-status-icon">{status === "completed" ? <IconCheck size={18} /> : <IconAlertTriangle size={18} />}</div> : <LoadingState label="Processing project context" />}
                  <div className="knowledge-job-body">
                    <div className="knowledge-job-head"><div><span>{submittedHere ? "Just submitted" : humanize(status)}</span><h4>{job.config?.title || `Context build ${job.id.slice(0, 8)}`}</h4></div><code>{job.id.slice(0, 12)}</code></div>
                    <div className="knowledge-job-progress" aria-label={`${progress}% complete`} role="progressbar" aria-valuemax={100} aria-valuemin={0} aria-valuenow={progress}><span style={{ width: `${progress}%` }} /></div>
                    <div className="knowledge-job-meta"><span>{job.processed_count ?? job.processed_sources ?? 0}/{job.input_count ?? job.total_sources ?? job.sources?.length ?? 0} inputs</span><span>{job.failed_count || 0} failed</span><span>{job.chunk_count || 0} chunks</span><span>{humanize(job.stage || status)}</span></div>
                    {warningMessages.length ? <div className="knowledge-job-warnings">{warningMessages.map((warning, index) => <span key={`warning-${index}-${warning}`}>{warning}</span>)}</div> : null}
                    {errorMessages.length ? <div className="knowledge-job-error">{errorMessages.map((error, index) => <span key={`error-${index}-${error}`}>{error}</span>)}</div> : null}
                    {status === "failed" && job.can_retry !== false && canManage ? (
                      <div className="knowledge-job-actions">
                        <button
                          className="ghost-button compact"
                          disabled={retryIngestionMutation.isPending}
                          onClick={() => retryIngestionMutation.mutate(job.id)}
                          type="button"
                        >
                          {retryIngestionMutation.isPending && retryIngestionMutation.variables === job.id ? <LoadingState label="Retrying context ingestion" /> : <IconRefresh size={14} />}
                          Retry retained source
                        </button>
                      </div>
                    ) : null}
                  </div>
                </article>
              );
            })}
            {!processingJobs.length && !overviewQuery.isPending && !overviewQuery.isError ? <div className="knowledge-activity-empty"><IconClock size={27} /><strong>No recent processing jobs</strong><p>New context builds appear here with extraction and indexing status.</p></div> : null}
          </div>
          <div className="knowledge-processing-legend">
            <strong>Readiness states</strong>
            <span><i className="is-stored" /> Stored only</span>
            <span><i className="is-extracted" /> Text extracted</span>
            <span><i className="is-indexed" /> Indexed and searchable</span>
            <span><i className="is-action" /> Caption/transcript required</span>
          </div>
        </div>
      ) : null}
      {collectionDialogId && canManage ? <KnowledgeCollectionDialog appTypeId={appTypeId} collectionId={collectionDialogId} onClose={() => setCollectionDialogId(null)} onSaved={() => { void queryClient.invalidateQueries({ queryKey: ["knowledge-collections", projectId] }); void queryClient.invalidateQueries({ queryKey: ["knowledge-sources", projectId] }); }} projectId={projectId} sources={allSources} /> : null}
      {selectedDetailSourceId ? <KnowledgeSourceDetail canManage={canManage} initialRevisionId={selectedDetailRevisionId} key={`${selectedDetailSourceId}:${selectedDetailRevisionId}`} onChanged={() => { void sourcesQuery.refetch(); void overviewQuery.refetch(); }} onClose={() => { setSelectedDetailSourceId(""); setSelectedDetailRevisionId(""); }} projectId={projectId} sourceId={selectedDetailSourceId} /> : null}
    </section>
  );
}
