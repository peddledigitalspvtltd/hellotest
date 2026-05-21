import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActivityIcon, AddIcon, CopyIcon, LayersIcon, MousePointerIcon, OpenIcon, PauseIcon, PlayIcon, SparkIcon, TrashIcon } from "../components/AppIcons";
import { DisplayIdBadge } from "../components/DisplayIdBadge";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { RecorderSessionInsights } from "../components/RecorderSessionInsights";
import { RecorderStartControls, type RecorderStartOptions } from "../components/RecorderStartControls";
import { StatusBadge } from "../components/StatusBadge";
import { SubnavTabs } from "../components/SubnavTabs";
import {
  TileCardCaseIcon,
  TileCardFact,
  TileCardIconFrame,
  TileCardRunsIcon,
  TileCardStepsIcon,
  formatTileCardLabel,
  getTileCardTone
} from "../components/TileCardPrimitives";
import { TileBrowserPane } from "../components/TileBrowserPane";
import { TileCardSkeletonGrid } from "../components/TileCardSkeletonGrid";
import { WorkspaceScopeBar } from "../components/WorkspaceScopeBar";
import { useAuth } from "../auth/AuthContext";
import { useCurrentAppType, useCurrentProject } from "../hooks/useCurrentProject";
import { api } from "../lib/api";
import type { AutomationLearningCacheEntry, ExecutionResult, Integration, RecorderSessionResponse, TestCase, TestStep } from "../types";

type AutomationView = "cases" | "repository" | "local-playwright";
type CaseDetailTab = "description" | "steps" | "history";
const AUTOMATION_MANUAL_LINKS_STORAGE_KEY = "qaira.automationManualLinks.v1";

type AutomationCaseDraft = {
  title: string;
  description: string;
  status: string;
  priority: string;
  parameterText: string;
};

type AutomationStepDraft = {
  keyword: string;
  objectRef: string;
  value: string;
  expected_result: string;
};

const createDefaultAutomationDraft = () => ({
  title: "",
  description: "",
  start_url: "",
  keyword_step: "",
  expected_result: ""
});

const formatRunDate = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit"
});

function isAutomatedCase(testCase: TestCase) {
  return testCase.automated === "yes";
}

function isManualCase(testCase: TestCase) {
  return testCase.automated !== "yes";
}

function normalizeMetadataValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function getScreenName(entry: AutomationLearningCacheEntry) {
  return normalizeMetadataValue(entry.metadata?.screen_name) || entry.page_key || "Unassigned screen";
}

function getObjectName(entry: AutomationLearningCacheEntry) {
  return normalizeMetadataValue(entry.metadata?.object_name) || entry.locator_intent || "Unnamed object";
}

function getObjectRole(entry: AutomationLearningCacheEntry) {
  return normalizeMetadataValue(entry.metadata?.object_role) || entry.locator_kind || entry.source || "field";
}

function extractQuotedTargets(code?: string | null) {
  if (!code) {
    return [];
  }

  const targets = new Set<string>();
  const callPattern = /web\.(?:click|fill|select|check|uncheck|hover|press|expect(?:Text|Visible|Hidden)?)\(\s*(['"`])([\s\S]*?)\1/g;
  let match = callPattern.exec(code);

  while (match) {
    if (match[2]?.trim()) {
      targets.add(match[2].trim());
    }
    match = callPattern.exec(code);
  }

  return Array.from(targets);
}

function extractVariables(step: TestStep) {
  const values = `${step.action || ""} ${step.expected_result || ""} ${step.automation_code || ""}`;
  const variables = new Set<string>();
  const pattern = /\{\{\s*([^}]+?)\s*\}\}/g;
  let match = pattern.exec(values);

  while (match) {
    if (match[1]?.trim()) {
      variables.add(match[1].trim());
    }
    match = pattern.exec(values);
  }

  return Array.from(variables);
}

function formatRecorderDisplayMode(value?: string | null) {
  return value === "browser-live-view" ? "Live view" : value === "local-browser-with-live-view" ? "Local browser + live view" : "Recorder";
}

function getRepositoryScreenUrl(entries: AutomationLearningCacheEntry[]) {
  return entries.find((entry) => entry.page_url)?.page_url || entries[0]?.page_key || "No URL captured";
}

function isLikelyImageUrl(value: string) {
  return /^https?:\/\//i.test(value) || value.startsWith("/") || value.startsWith("data:image/");
}

function buildSuggestedFieldName(entry: AutomationLearningCacheEntry) {
  const role = getObjectRole(entry).toLowerCase();
  const name = getObjectName(entry).toLowerCase();

  if (name.includes("password") || role.includes("password")) {
    return "password";
  }

  if (name.includes("user") || name.includes("email") || role.includes("textbox")) {
    return name.includes("email") ? "email" : "username";
  }

  if (name.includes("forgot")) {
    return "forgot_password";
  }

  if (name.includes("remember")) {
    return "remember_me";
  }

  if (name.includes("sign") || name.includes("login") || role.includes("button")) {
    return "sign_in";
  }

  return getObjectName(entry).replace(/\s+/g, "_").toLowerCase();
}

function formatAutomationCaseId(sequence: number) {
  return `AT-${String(sequence + 1).padStart(3, "0")}`;
}

function toFriendlyElementName(value: string, fallback = "Element") {
  const normalized = value
    .replace(/^text=/i, "")
    .replace(/^[#.]+/, "")
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/\b(click|input|element|field|button|link|label|aria|text|at)\b/gi, " ")
    .replace(/\b\d{3,}\b/g, " ")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim();
  const tokens = normalized ? normalized.split(/\s+/).slice(0, 4) : [fallback];
  return tokens.map((token) => token.charAt(0).toUpperCase() + token.slice(1)).join(" ");
}

function isNoisyRepositoryName(value?: string | null) {
  const normalized = normalizeMetadataValue(value).trim();
  if (!normalized) return true;
  return /\b(click\s*at|scroll|viewport|location|browser|document|window)\b/i.test(normalized) || /\d{3,}/.test(normalized);
}

function isNonElementRepositoryEntry(entry: AutomationLearningCacheEntry) {
  const locator = String(entry.locator || "").trim().toLowerCase();
  const intent = String(entry.locator_intent || "").trim().toLowerCase();
  const role = getObjectRole(entry).toLowerCase();
  const blockedLocators = new Set(["viewport", "location", "browser.tab", "keyboard", "window", "document", "page"]);
  const blockedIntents = new Set(["scroll", "navigation", "navigate", "goto", "tab", "press"]);
  return blockedLocators.has(locator) || blockedIntents.has(intent) || role === "viewport" || role === "page";
}

function getRepositoryMemberName(entry: AutomationLearningCacheEntry) {
  const metadata = entry.metadata || {};
  const locator = String(entry.locator || "");
  const locatorLabel =
    locator.match(/\[(?:aria-label|placeholder|name|data-testid|id)=["']?([^"'\]]+)["']?\]/i)?.[1] ||
    locator.match(/^#([\w-]+)/)?.[1] ||
    locator.match(/^text=(.+)$/i)?.[1] ||
    "";
  const explicit =
    normalizeMetadataValue(metadata.field_name) ||
    normalizeMetadataValue(metadata.member_name) ||
    normalizeMetadataValue(metadata.object_label);
  const objectName = normalizeMetadataValue(metadata.object_name);
  const objectNameValue = isNoisyRepositoryName(objectName) ? "" : objectName;
  const intent = /^(click|fill|change|input|element|field|object|scroll|viewport)$/i.test(entry.locator_intent || "") ? "" : entry.locator_intent;
  const tail = explicit.includes(".") ? explicit.split(".").filter(Boolean).pop() || explicit : explicit;
  const candidates = [locatorLabel, isNoisyRepositoryName(tail) ? "" : tail, objectNameValue, isNoisyRepositoryName(intent) ? "" : intent, locator];
  return toFriendlyElementName(candidates.find((candidate) => candidate && !isNoisyRepositoryName(toFriendlyElementName(candidate))) || "Element");
}

function getRepositoryHtmlTag(entry: AutomationLearningCacheEntry) {
  const metadata = entry.metadata || {};
  const explicit =
    normalizeMetadataValue(metadata.html_tag) ||
    normalizeMetadataValue(metadata.tag_name) ||
    normalizeMetadataValue(metadata.tag) ||
    normalizeMetadataValue(metadata.element_tag);
  const dom = normalizeMetadataValue(metadata.dom_structure) || normalizeMetadataValue(metadata.dom_path) || normalizeMetadataValue(metadata.html);
  const domTag = dom.match(/<\s*([a-z][a-z0-9-]*)/i)?.[1] || "";
  const locatorTag = String(entry.locator || "").match(/^([a-z][a-z0-9-]*)[#.[\s]/i)?.[1] || "";
  const role = getObjectRole(entry).toLowerCase();

  if (explicit) return explicit.toLowerCase();
  if (domTag) return domTag.toLowerCase();
  if (locatorTag) return locatorTag.toLowerCase();
  if (role.includes("button")) return "button";
  if (role.includes("link")) return "a";
  if (role.includes("select") || role.includes("dropdown")) return "select";
  if (role.includes("textarea")) return "textarea";
  if (role.includes("checkbox") || role.includes("toggle")) return "input";
  if (role.includes("field") || role.includes("textbox") || role.includes("input")) return "input";
  return "element";
}

function formatParameterText(values?: Record<string, string> | null) {
  return Object.entries(values || {}).map(([key, value]) => `${key}=${value}`).join("\n");
}

function parseParameterText(value: string) {
  return value.split(/\n+/).reduce<Record<string, string>>((accumulator, line) => {
    const [rawKey, ...rest] = line.split("=");
    const key = rawKey?.trim();
    if (key) {
      accumulator[key] = rest.join("=").trim();
    }
    return accumulator;
  }, {});
}

function parseAutomationStepDraft(step: TestStep): AutomationStepDraft {
  const code = step.automation_code || "";
  const match = code.match(/web\.(\w+)\(([\s\S]*)\)/);
  const keyword = match?.[1] ? `web.${match[1]}` : "web.click";
  const args = match?.[2] || "";
  const quoted = Array.from(args.matchAll(/(['"`])([\s\S]*?)\1/g)).map((item) => item[2]);

  return {
    keyword,
    objectRef: quoted[0] || "",
    value: quoted[1] || "",
    expected_result: step.expected_result || ""
  };
}

function buildAutomationCodeFromDraft(draft: AutomationStepDraft) {
  const objectRef = draft.objectRef || "Page.element";
  const value = draft.value.trim();
  if (["web.fill", "web.select", "web.press", "web.expectText"].includes(draft.keyword)) {
    return `${draft.keyword}("${objectRef}", "${value}")`;
  }
  return `${draft.keyword}("${objectRef}")`;
}

export function AutomationPage() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useCurrentProject();
  const [appTypeId, setAppTypeId] = useCurrentAppType(projectId);
  const [view, setView] = useState<AutomationView>("cases");
  const [selectedAutomatedCaseId, setSelectedAutomatedCaseId] = useState("");
  const [selectedManualCaseId, setSelectedManualCaseId] = useState("");
  const [selectedCaseId, setSelectedCaseId] = useState("");
  const [caseDetailTab, setCaseDetailTab] = useState<CaseDetailTab>("steps");
  const [expandedAutomationStepIds, setExpandedAutomationStepIds] = useState<string[]>([]);
  const [caseDraft, setCaseDraft] = useState<AutomationCaseDraft>({
    title: "",
    description: "",
    status: "active",
    priority: "3",
    parameterText: ""
  });
  const [stepDrafts, setStepDrafts] = useState<Record<string, AutomationStepDraft>>({});
  const [newStepDraft, setNewStepDraft] = useState<AutomationStepDraft>({
    keyword: "web.click",
    objectRef: "",
    value: "",
    expected_result: ""
  });
  const [manualCaseLinks, setManualCaseLinks] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(window.localStorage.getItem(AUTOMATION_MANUAL_LINKS_STORAGE_KEY) || "{}") as Record<string, string>;
    } catch {
      return {};
    }
  });
  const [isCreatingAutomationCase, setIsCreatingAutomationCase] = useState(false);
  const [automationDraft, setAutomationDraft] = useState(createDefaultAutomationDraft);
  const [startUrl, setStartUrl] = useState("");
  const [builderContext, setBuilderContext] = useState("");
  const [message, setMessage] = useState("");
  const [recorderSession, setRecorderSession] = useState<RecorderSessionResponse | null>(null);
  const [recorderStartOptions, setRecorderStartOptions] = useState<RecorderStartOptions | null>(null);
  const [selectedRepositoryId, setSelectedRepositoryId] = useState("");
  const [selectedScreenName, setSelectedScreenName] = useState("");
  const [isInspectOpen, setIsInspectOpen] = useState(false);
  const [screenDomDraft, setScreenDomDraft] = useState("");
  const [repositoryDraft, setRepositoryDraft] = useState({
    screen_name: "",
    object_name: "",
    object_role: "",
    locator: "",
    locator_kind: "",
    target_criteria: "",
    dom_structure: "",
    screenshot_url: "",
    fallback_strategy: ""
  });

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: api.projects.list,
    enabled: Boolean(session)
  });
  const appTypesQuery = useQuery({
    queryKey: ["app-types", projectId],
    queryFn: () => api.appTypes.list({ project_id: projectId }),
    enabled: Boolean(projectId && session)
  });
  const testCasesQuery = useQuery({
    queryKey: ["test-cases", "automation-workspace", appTypeId],
    queryFn: () => api.testCases.list({ app_type_id: appTypeId }),
    enabled: Boolean(appTypeId && session)
  });
  const learningCacheQuery = useQuery({
    queryKey: ["automation-learning-cache", "automation-workspace", projectId, appTypeId],
    queryFn: () => api.testCases.learningCache({
      project_id: projectId || undefined,
      app_type_id: appTypeId || undefined,
      limit: 200
    }),
    enabled: Boolean((projectId || appTypeId) && session)
  });
  const automatedStepsQuery = useQuery({
    queryKey: ["test-steps", "automation-workspace", selectedCaseId],
    queryFn: () => api.testSteps.list({ test_case_id: selectedCaseId }),
    enabled: Boolean(selectedCaseId && session)
  });
  const executionResultsQuery = useQuery({
    queryKey: ["execution-results", "automation-workspace", appTypeId],
    queryFn: () => api.executionResults.list({ app_type_id: appTypeId }),
    enabled: Boolean(appTypeId && session)
  });
  const integrationsQuery = useQuery({
    queryKey: ["integrations", "automation-workspace"],
    queryFn: () => api.integrations.list({ is_active: true }),
    enabled: Boolean(session)
  });

  const projects = projectsQuery.data || [];
  const appTypes = appTypesQuery.data || [];
  const testCases = testCasesQuery.data || [];
  const learningCache = learningCacheQuery.data || [];
  const integrations = integrationsQuery.data || [];
  const llmIntegration = useMemo(() => {
    const active = integrations.filter((integration: Integration) => integration.type === "llm" && integration.is_active);
    return active.find((integration) => String(integration.config?.project_id || "") === projectId) || active[0] || null;
  }, [integrations, projectId]);
  const automatedCases = useMemo(() => testCases.filter(isAutomatedCase), [testCases]);
  const automationDisplayIdByCaseId = useMemo(
    () => automatedCases.reduce<Record<string, string>>((accumulator, testCase, index) => {
      accumulator[testCase.id] = formatAutomationCaseId(index);
      return accumulator;
    }, {}),
    [automatedCases]
  );
  const manualCases = useMemo(() => testCases.filter(isManualCase), [testCases]);
  const activeAutomatedCase = automatedCases.find((testCase) => testCase.id === selectedAutomatedCaseId) || automatedCases[0] || null;
  const activeCase = testCases.find((testCase) => testCase.id === selectedCaseId) || testCases[0] || null;
  const activeManualCase = manualCases.find((testCase) => testCase.id === selectedManualCaseId) || manualCases[0] || null;
  const automatedSteps = automatedStepsQuery.data || [];
  const executionResults = executionResultsQuery.data || [];
  const historyByCaseId = useMemo(() => {
    const map: Record<string, ExecutionResult[]> = {};

    executionResults.forEach((result) => {
      map[result.test_case_id] = map[result.test_case_id] || [];
      map[result.test_case_id].push(result);
    });

    Object.values(map).forEach((items) => {
      items.sort((left, right) => String(right.created_at || "").localeCompare(String(left.created_at || "")));
    });

    return map;
  }, [executionResults]);
  const activeCaseHistory = activeCase ? historyByCaseId[activeCase.id] || [] : [];
  const linkedManualCase = activeCase ? manualCases.find((testCase) => testCase.id === manualCaseLinks[activeCase.id]) || null : null;
  const selectedRepositoryEntry = learningCache.find((entry) => entry.id === selectedRepositoryId) || learningCache[0] || null;
  const groupedRepository = useMemo(() => {
    const grouped = new Map<string, AutomationLearningCacheEntry[]>();

    learningCache.forEach((entry) => {
      const screenName = getScreenName(entry);
      grouped.set(screenName, [...(grouped.get(screenName) || []), entry]);
    });

    return Array.from(grouped.entries()).sort(([left], [right]) => left.localeCompare(right));
  }, [learningCache]);
  const activeScreenEntries = useMemo(() => {
    const selected = groupedRepository.find(([screenName]) => screenName === selectedScreenName);
    return selected?.[1] || groupedRepository[0]?.[1] || [];
  }, [groupedRepository, selectedScreenName]);
  const activeScreenName = groupedRepository.find(([screenName]) => screenName === selectedScreenName)?.[0] || groupedRepository[0]?.[0] || "";
  const pageObjectModels = useMemo(() => {
    return groupedRepository.map(([screenName, entries]) => {
      const members = entries.filter((entry) => !isNonElementRepositoryEntry(entry)).map((entry) => ({
        entry,
        pageName: screenName,
        memberName: getRepositoryMemberName(entry),
        htmlTag: getRepositoryHtmlTag(entry),
        role: getObjectRole(entry),
        ref: `${screenName}.${getRepositoryMemberName(entry)}`
      }));

      return {
        screenName,
        pageName: screenName,
        url: getRepositoryScreenUrl(entries),
        members
      };
    });
  }, [groupedRepository]);
  const activePageObject = pageObjectModels.find((page) => page.screenName === selectedScreenName) || pageObjectModels[0] || null;
  const allObjectMembers = useMemo(() => pageObjectModels.flatMap((page) => page.members), [pageObjectModels]);
  const recorderLiveUrl = recorderSession?.live_view_url || "";

  useEffect(() => {
    if (appTypesQuery.isPending) {
      return;
    }

    const scopedAppTypes = projectId ? appTypes.filter((appType) => String(appType.project_id) === String(projectId)) : appTypes;

    if (!scopedAppTypes.length) {
      setAppTypeId("");
      return;
    }

    if (!scopedAppTypes.some((appType) => appType.id === appTypeId)) {
      setAppTypeId(scopedAppTypes[0].id);
      setSelectedAutomatedCaseId("");
      setSelectedCaseId("");
      setSelectedManualCaseId("");
      setRecorderSession(null);
    }
  }, [appTypeId, appTypes, appTypesQuery.isPending, projectId, setAppTypeId]);

  useEffect(() => {
    if (activeCase && selectedCaseId !== activeCase.id) {
      setSelectedCaseId(activeCase.id);
    }
  }, [activeCase, selectedCaseId]);

  useEffect(() => {
    if (activeAutomatedCase && selectedAutomatedCaseId !== activeAutomatedCase.id) {
      setSelectedAutomatedCaseId(activeAutomatedCase.id);
    }
  }, [activeAutomatedCase, selectedAutomatedCaseId]);

  useEffect(() => {
    if (activeManualCase && selectedManualCaseId !== activeManualCase.id) {
      setSelectedManualCaseId(activeManualCase.id);
    }
  }, [activeManualCase, selectedManualCaseId]);

  useEffect(() => {
    if (selectedRepositoryEntry && selectedRepositoryId !== selectedRepositoryEntry.id) {
      setSelectedRepositoryId(selectedRepositoryEntry.id);
    }
  }, [selectedRepositoryEntry, selectedRepositoryId]);

  useEffect(() => {
    if (activeScreenName && selectedScreenName !== activeScreenName) {
      setSelectedScreenName(activeScreenName);
    }
  }, [activeScreenName, selectedScreenName]);

  useEffect(() => {
    if (!selectedRepositoryEntry) {
      return;
    }

    const metadata = selectedRepositoryEntry.metadata || {};
    setRepositoryDraft({
      screen_name: normalizeMetadataValue(metadata.screen_name),
      object_name: getRepositoryMemberName(selectedRepositoryEntry),
      object_role: `${getRepositoryHtmlTag(selectedRepositoryEntry)} / ${getObjectRole(selectedRepositoryEntry)}`,
      locator: selectedRepositoryEntry.locator || "",
      locator_kind: selectedRepositoryEntry.locator_kind || "",
      target_criteria: Array.isArray(metadata.target_criteria) ? metadata.target_criteria.join("\n") : normalizeMetadataValue(metadata.target_criteria),
      dom_structure: normalizeMetadataValue(metadata.dom_structure) || normalizeMetadataValue(metadata.dom_path) || normalizeMetadataValue(metadata.html),
      screenshot_url: normalizeMetadataValue(metadata.screenshot_url) || normalizeMetadataValue(metadata.screenshot_path),
      fallback_strategy: normalizeMetadataValue(metadata.fallback_strategy)
    });
  }, [selectedRepositoryEntry?.id]);

  useEffect(() => {
    if (!activeCase) {
      return;
    }

    setCaseDraft({
      title: activeCase.title || "",
      description: activeCase.description || "",
      status: activeCase.status || "active",
      priority: String(activeCase.priority || 3),
      parameterText: formatParameterText(activeCase.parameter_values)
    });
  }, [activeCase?.id]);

  useEffect(() => {
    setStepDrafts((current) => {
      const next = { ...current };
      automatedSteps.forEach((step) => {
        if (!next[step.id]) {
          next[step.id] = parseAutomationStepDraft(step);
        }
      });
      Object.keys(next).forEach((stepId) => {
        if (!automatedSteps.some((step) => step.id === stepId)) {
          delete next[stepId];
        }
      });
      return next;
    });
  }, [automatedSteps]);

  useEffect(() => {
    if (!recorderSession?.status_url || recorderSession.status !== "running") {
      return undefined;
    }

    let cancelled = false;
    const refreshRecorderSession = async () => {
      try {
        const response = await fetch(recorderSession.status_url as string, { cache: "no-store" });

        if (!response.ok) {
          return;
        }

        const next = await response.json() as Partial<RecorderSessionResponse>;

        if (!cancelled) {
          setRecorderSession((current) => current?.id === recorderSession.id ? { ...current, ...next } : current);
        }
      } catch {
        // Recorder counters are non-critical; the backend finish call is authoritative.
      }
    };
    const timer = window.setInterval(() => void refreshRecorderSession(), 1000);

    void refreshRecorderSession();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [recorderSession?.id, recorderSession?.status, recorderSession?.status_url]);

  const invalidateAutomationData = () => {
    void queryClient.invalidateQueries({ queryKey: ["test-cases"] });
    void queryClient.invalidateQueries({ queryKey: ["test-steps"] });
    void queryClient.invalidateQueries({ queryKey: ["automation-learning-cache"] });
    void queryClient.invalidateQueries({ queryKey: ["workspace-transactions"] });
  };

  const setManualCaseLink = (automationCaseId: string, manualCaseId: string) => {
    setManualCaseLinks((current) => {
      const next = { ...current };
      if (manualCaseId) {
        next[automationCaseId] = manualCaseId;
      } else {
        delete next[automationCaseId];
      }
      window.localStorage.setItem(AUTOMATION_MANUAL_LINKS_STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  };

  const toggleAutomationStep = (stepId: string) => {
    setExpandedAutomationStepIds((current) => current.includes(stepId) ? current.filter((id) => id !== stepId) : [...current, stepId]);
  };

  const buildSingleAutomation = useMutation({
    mutationFn: () => {
      if (!activeManualCase) {
        throw new Error("Select a manual case first.");
      }

      return api.testCases.queueAutomationGenerator(activeManualCase.id, {
        start_url: startUrl || undefined,
        additional_context: builderContext || undefined
      });
    },
    onSuccess: (response) => {
      setMessage(`Automation build queued as ${response.transaction_id}.`);
      invalidateAutomationData();
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to queue automation.")
  });

  const createAutomationCase = useMutation({
    mutationFn: async () => {
      if (!appTypeId) {
        throw new Error("Select an app type before creating an automation case.");
      }

      if (!automationDraft.title.trim()) {
        throw new Error("Add a case title first.");
      }

      const created = await api.testCases.create({
        app_type_id: appTypeId,
        title: automationDraft.title.trim(),
        description: automationDraft.description.trim(),
        automated: "yes",
        status: "active",
        priority: 3,
        steps: automationDraft.keyword_step.trim()
          ? [{
            step_order: 1,
            step_type: "web",
            action: automationDraft.keyword_step.trim(),
            expected_result: automationDraft.expected_result.trim(),
            automation_code: automationDraft.keyword_step.trim()
          }]
          : []
      });

      if (automationDraft.start_url.trim()) {
        await api.testCases.queueAutomationGenerator(created.id, {
          start_url: automationDraft.start_url.trim(),
          additional_context: builderContext || undefined
        }).catch(() => null);
      }

      return created;
    },
    onSuccess: (created) => {
      setMessage("Automation case created. It is ready for keyword steps and repository learning.");
      setSelectedCaseId(created.id);
      setSelectedAutomatedCaseId(created.id);
      setIsCreatingAutomationCase(false);
      setAutomationDraft(createDefaultAutomationDraft());
      invalidateAutomationData();
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to create automation case.")
  });

  const updateAutomationCase = useMutation({
    mutationFn: () => {
      if (!activeCase) {
        throw new Error("Select an automation case first.");
      }

      return api.testCases.update(activeCase.id, {
        title: caseDraft.title.trim(),
        description: caseDraft.description.trim(),
        status: caseDraft.status.trim() || "active",
        priority: Number(caseDraft.priority) || 3,
        parameter_values: parseParameterText(caseDraft.parameterText),
        automated: "yes"
      });
    },
    onSuccess: () => {
      setMessage("Automation case updated.");
      void queryClient.invalidateQueries({ queryKey: ["test-cases"] });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to update automation case.")
  });

  const createAutomationStep = useMutation({
    mutationFn: () => {
      if (!activeCase) {
        throw new Error("Select an automation case first.");
      }
      const automation_code = buildAutomationCodeFromDraft(newStepDraft);

      return api.testSteps.create({
        test_case_id: activeCase.id,
        step_order: automatedSteps.length + 1,
        action: automation_code,
        expected_result: newStepDraft.expected_result,
        step_type: "web",
        automation_code
      });
    },
    onSuccess: () => {
      setMessage("Automation step added.");
      setNewStepDraft({ keyword: "web.click", objectRef: "", value: "", expected_result: "" });
      void queryClient.invalidateQueries({ queryKey: ["test-steps"] });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to add automation step.")
  });

  const updateAutomationStep = useMutation({
    mutationFn: (step: TestStep) => {
      const draft = stepDrafts[step.id] || parseAutomationStepDraft(step);
      const automation_code = buildAutomationCodeFromDraft(draft);

      return api.testSteps.update(step.id, {
        action: automation_code,
        expected_result: draft.expected_result,
        step_type: "web",
        automation_code
      });
    },
    onSuccess: () => {
      setMessage("Automation step updated.");
      void queryClient.invalidateQueries({ queryKey: ["test-steps"] });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to update automation step.")
  });

  const reorderAutomationStep = useMutation({
    mutationFn: ({ stepId, direction }: { stepId: string; direction: "up" | "down" }) => {
      const index = automatedSteps.findIndex((step) => step.id === stepId);
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (index < 0 || targetIndex < 0 || targetIndex >= automatedSteps.length || !activeCase) {
        throw new Error("Step cannot move further.");
      }
      const ids = automatedSteps.map((step) => step.id);
      [ids[index], ids[targetIndex]] = [ids[targetIndex], ids[index]];
      return api.testSteps.reorder(activeCase.id, ids);
    },
    onSuccess: () => {
      setMessage("Automation steps reordered.");
      void queryClient.invalidateQueries({ queryKey: ["test-steps"] });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to reorder automation step.")
  });

  const deleteAutomationStep = useMutation({
    mutationFn: (stepId: string) => api.testSteps.delete(stepId),
    onSuccess: () => {
      setMessage("Automation step deleted.");
      void queryClient.invalidateQueries({ queryKey: ["test-steps"] });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to delete automation step.")
  });

  const runCase = useMutation({
    mutationFn: async ({ testCase, mode }: { testCase: TestCase; mode: "local" | "manual" }) => {
      if (!projectId || !appTypeId || !session?.user.id) {
        throw new Error("Select project and app type before running a case.");
      }

      if (mode === "local") {
        return api.executions.createLocalRun({
          project_id: projectId,
          app_type_id: appTypeId,
          test_case_ids: [testCase.id],
          name: `Automation run - ${testCase.title}`,
          created_by: session.user.id,
          engine_base_url: "http://host.docker.internal:4311"
        });
      }

      const execution = await api.executions.create({
        project_id: projectId,
        app_type_id: appTypeId,
        test_case_ids: [testCase.id],
        name: `Manual run - ${testCase.title}`,
        created_by: session.user.id
      });
      await api.executions.start(execution.id, { execution_mode: "remote" });
      return { id: execution.id, started: true };
    },
    onSuccess: (response, input) => {
      setMessage(`${input.mode === "local" ? "Local Test Engine" : "Manual"} run started as ${response.id}.`);
      void queryClient.invalidateQueries({ queryKey: ["executions"] });
      void queryClient.invalidateQueries({ queryKey: ["workspace-transactions"] });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to run case.")
  });

  const saveRepositoryEntry = useMutation({
    mutationFn: () => {
      if (!selectedRepositoryEntry) {
        throw new Error("Select an object repository field first.");
      }

      return api.testCases.updateLearningCacheEntry(selectedRepositoryEntry.id, {
        screen_name: repositoryDraft.screen_name,
        object_name: repositoryDraft.object_name,
        object_role: repositoryDraft.object_role,
        locator: repositoryDraft.locator,
        locator_kind: repositoryDraft.locator_kind,
        target_criteria: repositoryDraft.target_criteria.split(/\n+/).map((line) => line.trim()).filter(Boolean),
        dom_structure: repositoryDraft.dom_structure,
        screenshot_url: repositoryDraft.screenshot_url,
        fallback_strategy: repositoryDraft.fallback_strategy,
        platform: appTypes.find((appType) => appType.id === appTypeId)?.type || "web"
      });
    },
    onSuccess: () => {
      setMessage("Object repository field saved for execution-time locator resolution.");
      void queryClient.invalidateQueries({ queryKey: ["automation-learning-cache"] });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to save repository field.")
  });

  const improveRepositoryEntry = useMutation({
    mutationFn: () => {
      if (!selectedRepositoryEntry) {
        throw new Error("Select an object repository field first.");
      }

      return api.testCases.improveLearningCacheEntry(selectedRepositoryEntry.id, {
        integration_id: llmIntegration?.id,
        guidance: repositoryDraft.target_criteria || builderContext || undefined
      });
    },
    onSuccess: (response) => {
      setMessage(response.fallback_used ? `Repository improved with deterministic fallback: ${response.fallback_reason || "AI unavailable"}` : "AI improved the object repository field.");
      void queryClient.invalidateQueries({ queryKey: ["automation-learning-cache"] });
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to improve repository field.")
  });

  const startRecorder = useMutation({
    mutationFn: (options: RecorderStartOptions) => {
      if (!activeManualCase) {
        throw new Error("Select a manual case first.");
      }

      return api.testCases.startRecorderSession(activeManualCase.id, {
        start_url: startUrl || undefined,
        recorder_mode: options.recorder_mode,
        recorder_target: options.recorder_target,
        engine_base_url: options.engine_base_url,
        recorder_public_base_url: options.recorder_public_base_url
      });
    },
    onSuccess: (response, options) => {
      setRecorderSession(response);
      setRecorderStartOptions(options);
      setMessage(response.live_view_url ? "Local Playwright recorder is active and learning repository objects." : "Recorder started.");
      invalidateAutomationData();
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to start local Playwright recorder.")
  });

  const finishRecorder = useMutation({
    mutationFn: () => {
      if (!activeManualCase || !recorderSession?.id) {
        throw new Error("Start a recorder session before finishing it.");
      }

      return api.testCases.finishRecorderSession(activeManualCase.id, recorderSession.id, {
        transaction_id: recorderSession.transaction_id,
        additional_context: builderContext || undefined,
        recorder_mode: recorderStartOptions?.recorder_mode,
        recorder_target: recorderStartOptions?.recorder_target,
        engine_base_url: recorderStartOptions?.engine_base_url
      });
    },
    onSuccess: (response) => {
      setMessage(
        response.generated_step_count
          ? `Captured ${response.learned_locator_count} repository object${response.learned_locator_count === 1 ? "" : "s"} and updated ${response.generated_step_count} automation step${response.generated_step_count === 1 ? "" : "s"}.`
          : "Recorder stopped. No supported interactions were captured."
      );
      setRecorderSession(null);
      setRecorderStartOptions(null);
      invalidateAutomationData();
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : "Unable to finish recorder session.")
  });

  return (
    <div className="page-content page-content--automation">
      <PageHeader
        eyebrow="Automation"
        title="Automation workspace"
        description="Maintain automated cases, keyword steps, object repository learning, and local Playwright capture in one governed workspace."
        meta={[
          { label: "Cases", value: testCases.length },
          { label: "Manual link candidates", value: manualCases.length },
          { label: "Repository objects", value: learningCache.length }
        ]}
      />

      <SubnavTabs
        ariaLabel="Automation views"
        items={[
          { value: "cases", label: "Automation Cases", meta: `${testCases.length}`, icon: <SparkIcon /> },
          { value: "repository", label: "Object Repository", meta: `${groupedRepository.length} screens`, icon: <LayersIcon /> },
          { value: "local-playwright", label: "Local Playwright", meta: recorderSession ? "recording" : "capture", icon: <MousePointerIcon /> }
        ]}
        onChange={setView}
        value={view}
      />

      <WorkspaceScopeBar
        appTypeId={appTypeId}
        appTypes={appTypes}
        onAppTypeChange={(value) => {
          setAppTypeId(value);
          setSelectedAutomatedCaseId("");
          setSelectedCaseId("");
          setSelectedManualCaseId("");
          setRecorderSession(null);
        }}
        onProjectChange={(value) => {
          setProjectId(value);
          setSelectedAutomatedCaseId("");
          setSelectedCaseId("");
          setSelectedManualCaseId("");
          setRecorderSession(null);
        }}
        projectId={projectId}
        projects={projects}
      />

      {message ? <div className="empty-state compact">{message}</div> : null}

      {view === "cases" ? (
        <div className="automation-workspace-grid automation-workspace-grid--cases">
          <Panel
            title="Automation cases"
            subtitle="Every case appears as a tile. Open a tile to review description, keyword steps, and run history in the same rhythm as Test Cases."
            actions={(
              <button className="primary-button" onClick={() => setIsCreatingAutomationCase(true)} type="button">
                <AddIcon />
                <span>New automation case</span>
              </button>
            )}
          >
            {isCreatingAutomationCase ? (
              <form
                className="automation-create-card"
                onSubmit={(event) => {
                  event.preventDefault();
                  createAutomationCase.mutate();
                }}
              >
                <label className="form-field">
                  <span>Case title</span>
                  <input autoFocus value={automationDraft.title} onChange={(event) => setAutomationDraft((current) => ({ ...current, title: event.target.value }))} />
                </label>
                <label className="form-field">
                  <span>Description</span>
                  <textarea rows={3} value={automationDraft.description} onChange={(event) => setAutomationDraft((current) => ({ ...current, description: event.target.value }))} />
                </label>
                <label className="form-field">
                  <span>Start URL</span>
                  <input placeholder="https://app.example.com/login" value={automationDraft.start_url} onChange={(event) => setAutomationDraft((current) => ({ ...current, start_url: event.target.value }))} />
                </label>
                <label className="form-field">
                  <span>First keyword step</span>
                  <textarea placeholder="web.fill('username', '{{user.email}}')" rows={3} value={automationDraft.keyword_step} onChange={(event) => setAutomationDraft((current) => ({ ...current, keyword_step: event.target.value }))} />
                </label>
                <label className="form-field">
                  <span>Expected result</span>
                  <input value={automationDraft.expected_result} onChange={(event) => setAutomationDraft((current) => ({ ...current, expected_result: event.target.value }))} />
                </label>
                <div className="testops-action-row">
                  <button className="primary-button" disabled={createAutomationCase.isPending} type="submit">
                    <AddIcon />
                    <span>{createAutomationCase.isPending ? "Creating..." : "Create case"}</span>
                  </button>
                  <button className="ghost-button" onClick={() => setIsCreatingAutomationCase(false)} type="button">Cancel</button>
                </div>
              </form>
            ) : null}

            {testCasesQuery.isLoading || executionResultsQuery.isLoading ? <TileCardSkeletonGrid /> : null}
            {!testCasesQuery.isLoading && !testCases.length ? (
              <div className="empty-state compact">No cases yet. Create a new automation case or generate automation from a manual case.</div>
            ) : null}
            {!testCasesQuery.isLoading && testCases.length ? (
              <TileBrowserPane className="automation-case-tile-browser">
                <div className="tile-browser-grid">
                  {testCases.map((testCase) => {
                    const history = (historyByCaseId[testCase.id] || []).slice(0, 10);
                    const latest = history[0];
                    const passedRuns = history.filter((result) => result.status === "passed").length;
                    const passRate = history.length ? Math.round((passedRuns / history.length) * 100) : 0;
                    const isActive = activeCase?.id === testCase.id;
                    const isAutomated = testCase.automated === "yes";

                    return (
                      <div
                        aria-pressed={isActive}
                        className={["record-card tile-card test-case-card test-case-catalog-card automation-case-tile", isActive ? "is-active" : ""].filter(Boolean).join(" ")}
                        key={testCase.id}
                        onClick={() => {
                          setSelectedCaseId(testCase.id);
                          setSelectedAutomatedCaseId(testCase.id);
                          setCaseDetailTab("steps");
                        }}
                        role="button"
                        tabIndex={0}
                      >
                        <div className="tile-card-main">
                          <div className="tile-card-select-row test-case-card-header">
                            <DisplayIdBadge value={automationDisplayIdByCaseId[testCase.id] || testCase.display_id || testCase.id} />
                            <div className="catalog-inline-actions test-case-top-actions">
                              <StatusBadge value={isAutomated ? "automated" : "manual source"} />
                              <StatusBadge value={latest?.status || testCase.status || "ready"} />
                            </div>
                          </div>
                          <div className="tile-card-header">
                            <TileCardIconFrame tone={getTileCardTone(latest?.status || testCase.status)}>
                              <TileCardCaseIcon />
                            </TileCardIconFrame>
                            <div className="tile-card-title-group test-case-card-title-group">
                              <span className="tile-card-kicker">{isAutomated ? `${automationDisplayIdByCaseId[testCase.id] || "AT"} · Keyword automation` : "Manual case candidate"}</span>
                              <strong>{testCase.title}</strong>
                            </div>
                          </div>
                          <p className="tile-card-description">{testCase.description || "No description yet for this test case."}</p>
                          <div className="tile-card-facts">
                            <TileCardFact label={isAutomated ? "Automated" : "Manual"} title="Automation state" tone={isAutomated ? "success" : "neutral"}><SparkIcon /></TileCardFact>
                            <TileCardFact label={`${history.length} runs`} title="Recent run history" tone={history.length ? "info" : "neutral"}><TileCardRunsIcon /></TileCardFact>
                            <TileCardFact label={`P${testCase.priority || 3}`} title="Priority"><TileCardStepsIcon /></TileCardFact>
                          </div>
                          <div className="tile-card-footer">
                            <div className="test-case-card-progress-row" aria-label={history.length ? `${passRate}% recent pass rate` : "No recent run coverage"}>
                              <div className="test-case-card-progress-track"><span style={{ width: `${passRate}%` }} /></div>
                              <small>{history.length ? `${passRate}% passed` : "No runs"}</small>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </TileBrowserPane>
            ) : null}
          </Panel>

          <Panel
            className="automation-detail-panel"
            title={activeCase?.title || "Case detail"}
            subtitle="Case description, keyword test steps, and run history stay together after selecting a tile."
            actions={activeCase ? (
              <div className="testops-action-row">
                <button className="primary-button" disabled={runCase.isPending || activeCase.automated !== "yes"} onClick={() => runCase.mutate({ testCase: activeCase, mode: "local" })} type="button">
                  <PlayIcon />
                  <span>{runCase.isPending ? "Starting..." : "Run automated"}</span>
                </button>
                <button className="ghost-button" disabled={runCase.isPending} onClick={() => runCase.mutate({ testCase: activeCase, mode: "manual" })} type="button">
                  <ActivityIcon />
                  <span>Run manually</span>
                </button>
              </div>
            ) : undefined}
          >
            {!activeCase ? (
              <div className="empty-state compact">Select a case tile to inspect its automation detail.</div>
            ) : automatedStepsQuery.isLoading ? (
              <TileCardSkeletonGrid />
            ) : (
              <div className="automation-case-detail">
                <div className="automation-detail-tabs" role="tablist" aria-label="Automation case detail">
                  {(["description", "steps", "history"] as CaseDetailTab[]).map((tab) => (
                    <button className={caseDetailTab === tab ? "is-active" : ""} key={tab} onClick={() => setCaseDetailTab(tab)} type="button">
                      {formatTileCardLabel(tab, tab)}
                    </button>
                  ))}
                </div>

                {caseDetailTab === "description" ? (
                  <div className="automation-description-panel">
                    <div className="automation-case-editor-grid">
                      <label className="form-field">
                        <span>Automation case name</span>
                        <input value={caseDraft.title} onChange={(event) => setCaseDraft((current) => ({ ...current, title: event.target.value }))} />
                      </label>
                      <label className="form-field">
                        <span>Status</span>
                        <input value={caseDraft.status} onChange={(event) => setCaseDraft((current) => ({ ...current, status: event.target.value }))} />
                      </label>
                      <label className="form-field">
                        <span>Priority</span>
                        <input min={1} max={5} type="number" value={caseDraft.priority} onChange={(event) => setCaseDraft((current) => ({ ...current, priority: event.target.value }))} />
                      </label>
                    </div>
                    {activeCase.automated === "yes" ? (
                      <div className="automation-manual-link-panel">
                        <label className="form-field">
                          <span>Linked manual case</span>
                          <select value={manualCaseLinks[activeCase.id] || ""} onChange={(event) => setManualCaseLink(activeCase.id, event.target.value)}>
                            <option value="">No manual case linked</option>
                            {manualCases.map((testCase) => (
                              <option key={testCase.id} value={testCase.id}>{testCase.display_id || testCase.title} · {testCase.title}</option>
                            ))}
                          </select>
                        </label>
                        {linkedManualCase ? (
                          <div className="automation-linked-manual-card">
                            <strong>{linkedManualCase.title}</strong>
                            <span>{linkedManualCase.display_id || "Manual case"} · {linkedManualCase.status || "ready"}</span>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    <label className="form-field">
                      <span>Description</span>
                      <textarea rows={4} value={caseDraft.description} onChange={(event) => setCaseDraft((current) => ({ ...current, description: event.target.value }))} />
                    </label>
                    <label className="form-field">
                      <span>Parameters</span>
                      <textarea rows={4} value={caseDraft.parameterText} onChange={(event) => setCaseDraft((current) => ({ ...current, parameterText: event.target.value }))} placeholder={"username={{user.email}}\npassword={{user.password}}"} />
                    </label>
                    <div className="testops-action-row">
                      <button className="primary-button" disabled={updateAutomationCase.isPending} onClick={() => updateAutomationCase.mutate()} type="button">
                        <span>{updateAutomationCase.isPending ? "Saving..." : "Save automation case"}</span>
                      </button>
                    </div>
                  </div>
                ) : null}

                {caseDetailTab === "steps" ? (
                  <div className="automation-keyword-step-list">
                    {!automatedSteps.length ? <div className="empty-state compact">No keyword steps yet. Add them from Test Cases, recorder capture, or AI automation generation.</div> : null}
                    {automatedSteps.map((step) => {
                      const draft = stepDrafts[step.id] || parseAutomationStepDraft(step);
                      const variables = extractVariables(step);
                      const isExpanded = expandedAutomationStepIds.includes(step.id);

                      return (
                        <article className={["automation-keyword-step", isExpanded ? "is-expanded" : ""].filter(Boolean).join(" ")} key={step.id}>
                          <button className="automation-keyword-step-summary" onClick={() => toggleAutomationStep(step.id)} type="button">
                            <span className="count-pill">Step {step.step_order}</span>
                            <strong>{step.action || "No manual action recorded"}</strong>
                            <StatusBadge value={step.automation_code ? "keyword-ready" : "manual-only"} />
                          </button>
                          {isExpanded ? (
                            <div className="automation-keyword-step-body">
                              <div className="automation-step-editor-grid">
                                <label className="form-field">
                                  <span>Keyword</span>
                                  <select value={draft.keyword} onChange={(event) => setStepDrafts((current) => ({ ...current, [step.id]: { ...draft, keyword: event.target.value } }))}>
                                    {["web.click", "web.fill", "web.select", "web.check", "web.uncheck", "web.press", "web.expectVisible", "web.expectText"].map((keyword) => (
                                      <option key={keyword} value={keyword}>{keyword}</option>
                                    ))}
                                  </select>
                                </label>
                                <label className="form-field">
                                  <span>Repository member</span>
                                  <select value={draft.objectRef} onChange={(event) => setStepDrafts((current) => ({ ...current, [step.id]: { ...draft, objectRef: event.target.value } }))}>
                                    <option value="">Select repository member</option>
                                    {allObjectMembers.map((member) => (
                                      <option key={member.entry.id} value={member.ref}>{member.ref} · {member.htmlTag}</option>
                                    ))}
                                  </select>
                                </label>
                                <label className="form-field">
                                  <span>Value / parameter</span>
                                  <input value={draft.value} onChange={(event) => setStepDrafts((current) => ({ ...current, [step.id]: { ...draft, value: event.target.value } }))} placeholder="{{username}}" />
                                </label>
                                <label className="form-field automation-step-expected-field">
                                  <span>Expected result</span>
                                  <textarea rows={3} value={draft.expected_result} onChange={(event) => setStepDrafts((current) => ({ ...current, [step.id]: { ...draft, expected_result: event.target.value } }))} />
                                </label>
                              </div>
                              <div className="automation-step-action-row">
                                <button className="ghost-button compact" disabled={reorderAutomationStep.isPending || step.step_order <= 1} onClick={() => reorderAutomationStep.mutate({ stepId: step.id, direction: "up" })} type="button">
                                  <span>Move up</span>
                                </button>
                                <button className="ghost-button compact" disabled={reorderAutomationStep.isPending || step.step_order >= automatedSteps.length} onClick={() => reorderAutomationStep.mutate({ stepId: step.id, direction: "down" })} type="button">
                                  <span>Move down</span>
                                </button>
                                <button className="primary-button compact" disabled={updateAutomationStep.isPending} onClick={() => updateAutomationStep.mutate(step)} type="button">
                                  <span>{updateAutomationStep.isPending ? "Saving..." : "Save step"}</span>
                                </button>
                                <button className="ghost-button compact" onClick={() => navigator.clipboard?.writeText(step.automation_code || step.action || "")} type="button">
                                  <CopyIcon size={16} />
                                  <span>Copy keyword</span>
                                </button>
                                {linkedManualCase ? (
                                  <button className="ghost-button compact" onClick={() => setSelectedCaseId(linkedManualCase.id)} type="button">
                                    <OpenIcon size={16} />
                                    <span>Open manual case</span>
                                  </button>
                                ) : null}
                                <button className="ghost-button compact" disabled={deleteAutomationStep.isPending} onClick={() => deleteAutomationStep.mutate(step.id)} type="button">
                                  <TrashIcon size={16} />
                                  <span>{deleteAutomationStep.isPending ? "Deleting..." : "Delete"}</span>
                                </button>
                              </div>
                              <code className="automation-code-block automation-code-block--compact">{buildAutomationCodeFromDraft(draft)}</code>
                              <div className="automation-step-meta-grid">
                                <div>
                                  <span>Object binding</span>
                                  {draft.objectRef ? <code>{draft.objectRef}</code> : <small>Select a repository member.</small>}
                                </div>
                                <div>
                                  <span>Variables</span>
                                  {variables.length ? variables.map((variable) => <code key={variable}>{`{{${variable}}}`}</code>) : <small>No variables used.</small>}
                                </div>
                              </div>
                            </div>
                          ) : null}
                        </article>
                      );
                    })}
                    <article className="automation-keyword-step is-expanded">
                      <div className="automation-keyword-step-summary">
                        <span className="count-pill">New</span>
                        <strong>Add automation step</strong>
                        <StatusBadge value="draft" />
                      </div>
                      <div className="automation-keyword-step-body">
                        <div className="automation-step-editor-grid">
                          <label className="form-field">
                            <span>Keyword</span>
                            <select value={newStepDraft.keyword} onChange={(event) => setNewStepDraft((current) => ({ ...current, keyword: event.target.value }))}>
                              {["web.click", "web.fill", "web.select", "web.check", "web.uncheck", "web.press", "web.expectVisible", "web.expectText"].map((keyword) => (
                                <option key={keyword} value={keyword}>{keyword}</option>
                              ))}
                            </select>
                          </label>
                          <label className="form-field">
                            <span>Repository member</span>
                            <select value={newStepDraft.objectRef} onChange={(event) => setNewStepDraft((current) => ({ ...current, objectRef: event.target.value }))}>
                              <option value="">Select repository member</option>
                              {allObjectMembers.map((member) => (
                                <option key={member.entry.id} value={member.ref}>{member.ref} · {member.htmlTag}</option>
                              ))}
                            </select>
                          </label>
                          <label className="form-field">
                            <span>Value / parameter</span>
                            <input value={newStepDraft.value} onChange={(event) => setNewStepDraft((current) => ({ ...current, value: event.target.value }))} placeholder="{{username}}" />
                          </label>
                          <label className="form-field automation-step-expected-field">
                            <span>Expected result</span>
                            <textarea rows={3} value={newStepDraft.expected_result} onChange={(event) => setNewStepDraft((current) => ({ ...current, expected_result: event.target.value }))} />
                          </label>
                        </div>
                        <div className="testops-action-row">
                          <button className="primary-button" disabled={createAutomationStep.isPending || !newStepDraft.objectRef} onClick={() => createAutomationStep.mutate()} type="button">
                            <AddIcon />
                            <span>{createAutomationStep.isPending ? "Adding..." : "Add step"}</span>
                          </button>
                        </div>
                      </div>
                    </article>
                  </div>
                ) : null}

                {caseDetailTab === "history" ? (
                  <div className="automation-run-history">
                    {!activeCaseHistory.length ? <div className="empty-state compact">No run history yet.</div> : null}
                    {activeCaseHistory.map((result) => (
                      <article className="automation-history-row" key={result.id}>
                        <div>
                          <strong>{result.test_case_title || activeCase.title}</strong>
                          <span>{result.created_at ? formatRunDate.format(new Date(result.created_at)) : "Run timestamp unavailable"} · {result.duration_ms ? `${Math.round(result.duration_ms / 1000)}s` : "duration pending"}</span>
                          {result.error ? <p>{result.error}</p> : null}
                        </div>
                        <StatusBadge value={result.status} />
                      </article>
                    ))}
                  </div>
                ) : null}
              </div>
            )}
          </Panel>
        </div>
      ) : null}

      {view === "repository" ? (
        <div className="automation-workspace-grid automation-workspace-grid--repository">
          <Panel
            title="Object repository"
            subtitle="Screen-level fields grouped by page, with friendly member names, HTML tag details, locator, DOM, image, and fallback intelligence."
            actions={(
              <button className="ghost-button" onClick={() => setIsInspectOpen(true)} type="button">
                <MousePointerIcon />
                <span>Inspect</span>
              </button>
            )}
          >
            {learningCacheQuery.isLoading ? <TileCardSkeletonGrid /> : null}
            {!learningCacheQuery.isLoading && !groupedRepository.length ? (
              <div className="empty-state compact">No repository objects have been learned for this scope yet.</div>
            ) : null}
            <div className="pom-workspace">
              <aside className="pom-page-list" aria-label="Repository pages">
                {pageObjectModels.map((page) => (
                  <button className={activePageObject?.screenName === page.screenName ? "is-active" : ""} key={page.screenName} onClick={() => setSelectedScreenName(page.screenName)} type="button">
                    <strong>{page.pageName}</strong>
                    <span>{page.members.length} members · {page.url}</span>
                  </button>
                ))}
              </aside>

              {activePageObject ? (
                <section className="pom-class-panel" aria-label={`${activePageObject.pageName} repository page`}>
                  <div className="pom-class-header">
                    <div>
                      <span>Page</span>
                      <strong>{activePageObject.pageName}</strong>
                      <small>{activePageObject.url}</small>
                    </div>
                    <StatusBadge value={`${activePageObject.members.length} members`} />
                  </div>
                  <div className="pom-member-table">
                    <div className="pom-member-row is-head">
                      <span>Member</span>
                      <span>Tag / role</span>
                      <span>Primary locator</span>
                    </div>
                    {activePageObject.members.map((member) => (
                      <button className={selectedRepositoryEntry?.id === member.entry.id ? "pom-member-row is-active" : "pom-member-row"} key={member.entry.id} onClick={() => setSelectedRepositoryId(member.entry.id)} type="button">
                        <code>{member.memberName}</code>
                        <span>{member.htmlTag} · {member.role}</span>
                        <small>{member.entry.locator}</small>
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}
            </div>
          </Panel>

          <Panel
            className="automation-detail-panel"
            title="Member inspector"
            subtitle="Curate the selected repository member. Keywords should bind to this member name, not raw locators."
            actions={selectedRepositoryEntry ? (
              <div className="testops-action-row">
                <button className="ghost-button" disabled={improveRepositoryEntry.isPending} onClick={() => improveRepositoryEntry.mutate()} type="button">
                  <SparkIcon />
                  <span>{improveRepositoryEntry.isPending ? "Improving..." : "AI improve"}</span>
                </button>
                <button className="primary-button" disabled={saveRepositoryEntry.isPending} onClick={() => saveRepositoryEntry.mutate()} type="button">
                  <PlayIcon />
                  <span>{saveRepositoryEntry.isPending ? "Saving..." : "Save field"}</span>
                </button>
              </div>
            ) : undefined}
          >
            {!selectedRepositoryEntry ? (
              <div className="empty-state compact">Select a repository field to curate execution criteria.</div>
            ) : (
              <div className="record-grid testops-builder-form">
                <label className="form-field">
                  <span>Screen name</span>
                  <input value={repositoryDraft.screen_name} onChange={(event) => setRepositoryDraft((current) => ({ ...current, screen_name: event.target.value }))} />
                </label>
                <label className="form-field">
                  <span>Member name</span>
                  <input value={repositoryDraft.object_name} onChange={(event) => setRepositoryDraft((current) => ({ ...current, object_name: event.target.value }))} />
                </label>
                <label className="form-field">
                  <span>HTML tag / role</span>
                  <input value={repositoryDraft.object_role} onChange={(event) => setRepositoryDraft((current) => ({ ...current, object_role: event.target.value }))} />
                </label>
                <label className="form-field">
                  <span>Target locator</span>
                  <input value={repositoryDraft.locator} onChange={(event) => setRepositoryDraft((current) => ({ ...current, locator: event.target.value }))} />
                </label>
                <label className="form-field">
                  <span>Additional locator detail</span>
                  <textarea rows={3} value={repositoryDraft.target_criteria} onChange={(event) => setRepositoryDraft((current) => ({ ...current, target_criteria: event.target.value }))} />
                </label>
                <label className="form-field">
                  <span>Locator kind</span>
                  <input value={repositoryDraft.locator_kind} onChange={(event) => setRepositoryDraft((current) => ({ ...current, locator_kind: event.target.value }))} />
                </label>
                <label className="form-field">
                  <span>Screenshot URL</span>
                  <input value={repositoryDraft.screenshot_url} onChange={(event) => setRepositoryDraft((current) => ({ ...current, screenshot_url: event.target.value }))} />
                </label>
                {repositoryDraft.screenshot_url && isLikelyImageUrl(repositoryDraft.screenshot_url) ? (
                  <div className="object-repository-snapshot">
                    <img alt={`${repositoryDraft.object_name || "Repository field"} snapshot`} src={repositoryDraft.screenshot_url} />
                  </div>
                ) : null}
                <label className="form-field">
                  <span>DOM or accessibility structure</span>
                  <textarea rows={5} value={repositoryDraft.dom_structure} onChange={(event) => setRepositoryDraft((current) => ({ ...current, dom_structure: event.target.value }))} />
                </label>
                <label className="form-field">
                  <span>Visual fallback strategy</span>
                  <textarea rows={3} value={repositoryDraft.fallback_strategy} onChange={(event) => setRepositoryDraft((current) => ({ ...current, fallback_strategy: event.target.value }))} />
                </label>
                {repositoryDraft.screenshot_url ? (
                  <a className="ghost-button compact" href={repositoryDraft.screenshot_url} rel="noreferrer" target="_blank">
                    <OpenIcon size={16} />
                    <span>Open screenshot</span>
                  </a>
                ) : null}
              </div>
            )}
          </Panel>

          {isInspectOpen ? (
            <div className="modal-backdrop" role="presentation">
              <div className="dialog object-repository-inspector" role="dialog" aria-modal="true" aria-label="Object repository inspector">
                <div className="dialog-header">
                  <div>
                    <h2>Inspect screen</h2>
                    <p>Paste DOM or accessibility markup from the current page to preview fields and add relevant structure to the selected repository object.</p>
                  </div>
                  <button className="ghost-button compact" onClick={() => setIsInspectOpen(false)} type="button">Close</button>
                </div>
                <div className="record-grid testops-builder-form">
                  <label className="form-field">
                    <span>Screen DOM</span>
                    <textarea rows={10} value={screenDomDraft} onChange={(event) => setScreenDomDraft(event.target.value)} placeholder="<input name='username' aria-label='Username' />" />
                  </label>
                  <div className="object-repository-inspector-preview">
                    <strong>Relevant fields</strong>
                    {["username", "password", "sign_in", "forgot_password", "remember_me"].map((field) => (
                      <button key={field} onClick={() => setRepositoryDraft((current) => ({ ...current, object_name: field, dom_structure: screenDomDraft || current.dom_structure }))} type="button">
                        <span>{field}</span>
                        <small>{screenDomDraft ? "DOM ready to attach" : "Waiting for DOM"}</small>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="testops-action-row">
                  <button className="primary-button" onClick={() => {
                    setRepositoryDraft((current) => ({ ...current, dom_structure: screenDomDraft || current.dom_structure }));
                    setIsInspectOpen(false);
                  }} type="button">
                    <MousePointerIcon />
                    <span>Add inspected DOM</span>
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {view === "local-playwright" ? (
        <div className="automation-workspace-grid automation-workspace-grid--capture">
          <Panel title="Build repository with local Playwright" subtitle="Pick a manual case, open a local browser, and QAira will map captured actions back to keyword steps and repository objects.">
            <div className="record-grid testops-builder-form">
              <label className="form-field">
                <span>Manual case link</span>
                <select value={activeManualCase?.id || ""} onChange={(event) => setSelectedManualCaseId(event.target.value)}>
                  {manualCases.map((testCase) => (
                    <option key={testCase.id} value={testCase.id}>{testCase.title}</option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span>Start URL</span>
                <input onChange={(event) => setStartUrl(event.target.value)} placeholder="https://app.example.com/login" value={startUrl} />
              </label>
              <label className="form-field">
                <span>Variables and locator guidance</span>
                <textarea onChange={(event) => setBuilderContext(event.target.value)} placeholder="Example: use {{user.email}}, prefer data-testid locators, keep checkout screen names stable." rows={4} value={builderContext} />
              </label>
            </div>
            <div className="testops-action-row">
              <button className="ghost-button" disabled={!activeManualCase || buildSingleAutomation.isPending} onClick={() => buildSingleAutomation.mutate()} type="button">
                <SparkIcon />
                <span>{buildSingleAutomation.isPending ? "Queueing..." : "Queue AI automation"}</span>
              </button>
              <button className="ghost-button" disabled={!activeManualCase || runCase.isPending} onClick={() => activeManualCase ? runCase.mutate({ testCase: activeManualCase, mode: "manual" }) : undefined} type="button">
                <ActivityIcon />
                <span>{runCase.isPending ? "Starting..." : "Run manual case"}</span>
              </button>
              <button className="primary-button" disabled={!activeManualCase || runCase.isPending} onClick={() => activeManualCase ? runCase.mutate({ testCase: activeManualCase, mode: "local" }) : undefined} type="button">
                <PlayIcon />
                <span>{runCase.isPending ? "Starting..." : "Run automation"}</span>
              </button>
            </div>
            <RecorderStartControls
              disabled={!activeManualCase}
              hasSession={Boolean(recorderSession)}
              isStarting={startRecorder.isPending}
              localLabel="Build with Local Playwright"
              onStart={(options) => startRecorder.mutate(options)}
              primaryAction={(
                <button className="primary-button recorder-stop-button" disabled={!recorderSession || finishRecorder.isPending} onClick={() => finishRecorder.mutate()} type="button">
                  <PauseIcon />
                  <span>{finishRecorder.isPending ? "Saving..." : "Stop and save repository"}</span>
                </button>
              )}
            />
          </Panel>

          <Panel className="automation-detail-panel" title="Capture monitor" subtitle={recorderSession ? `Session ${recorderSession.id.slice(0, 8)} · ${formatRecorderDisplayMode(recorderSession.display_mode)}` : "Start local Playwright to see captured actions, network calls, and live view."}>
            {recorderSession ? (
              <div className="stack-list">
                <div className="stack-item">
                  <div>
                    <strong>{recorderSession.action_count || 0} actions · {recorderSession.network_count || 0} API candidates</strong>
                    <span>{recorderSession.start_url || startUrl || "No start URL supplied."}</span>
                  </div>
                  <StatusBadge value={recorderSession.status} />
                </div>
              </div>
            ) : null}
            {recorderLiveUrl ? <iframe allow="clipboard-read; clipboard-write" className="recorder-live-frame" src={recorderLiveUrl} title="QAira local Playwright live view" /> : null}
            <RecorderSessionInsights session={recorderSession} />
          </Panel>
        </div>
      ) : null}
    </div>
  );
}
