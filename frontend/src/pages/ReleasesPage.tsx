import { Fragment, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { IconBug, IconCheck, IconChecklist, IconChevronDown, IconChevronRight, IconCopy, IconExternalLink, IconFlagCheck, IconPlayerPlay, IconSparkles, IconTargetArrow, IconTrash } from "@tabler/icons-react";
import { useAuth } from "../auth/AuthContext";
import { AddIcon, PencilIcon, ReleaseIcon, ReleaseNotesIcon, ReleaseReadinessIcon, SearchIcon, SprintIcon, StoryIcon } from "../components/AppIcons";
import { AppErrorState } from "../components/AppErrorBoundary";
import { CatalogCardDescription } from "../components/CatalogCardDescription";
import { CatalogSearchFilter } from "../components/CatalogSearchFilter";
import { CatalogSelectionControls } from "../components/CatalogSelectionControls";
import { CatalogViewToggle } from "../components/CatalogViewToggle";
import { DataTable, type DataTableColumn, type DataTableRowGroup } from "../components/DataTable";
import { DeliveryCompletionGuardDialog } from "../components/DeliveryCompletionGuardDialog";
import { DialogCloseButton } from "../components/DialogCloseButton";
import { DisplayIdBadge } from "../components/DisplayIdBadge";
import { FormField } from "../components/FormField";
import { HierarchyQuickInsights } from "../components/HierarchyQuickInsights";
import { useDeleteConfirmation } from "../components/DeleteConfirmationDialog";
import { LoadingState } from "../components/LoadingState";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { RichTextEditor, richTextToPlainText } from "../components/RichTextEditor";
import { StatusBadge } from "../components/StatusBadge";
import { TileBrowserPane } from "../components/TileBrowserPane";
import { TileCardFact, TileCardMetric, TileCardProgress } from "../components/TileCardPrimitives";
import { ToastMessage } from "../components/ToastMessage";
import { useCurrentProject } from "../hooks/useCurrentProject";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { api } from "../lib/api";
import { asArray } from "../lib/collectionGuards";
import { isDeliveryStatusComplete } from "../lib/deliveryStatus";
import { releasePortfolioCompletion, releaseStoryCompletion as storyCompletionFor, type ReleaseCatalogReadiness } from "../lib/releaseCatalogMetrics";
import { hasPermission } from "../lib/permissions";
import type { Requirement, RequirementIteration, RequirementRelease, RequirementReleaseNotes } from "../types";
import "./ReleasesPage.css";

type ReleaseDraft = {
  name: string;
  description: string;
  fixVersion: string;
  planDate: string;
  targetDate: string;
  externalLink: string;
  sprintIds: string[];
  requirementIds: string[];
};

const emptyDraft = (): ReleaseDraft => ({
  name: "", description: "", fixVersion: "", planDate: "",
  targetDate: "", externalLink: "", sprintIds: [], requirementIds: []
});

const formatDate = (value?: string | null) => value
  ? new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value))
  : "No target date";

const formatReleaseShortDate = (value?: string | null) => {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[2]}/${match[3]}` : "—";
};

const releaseDateRangeLabel = (start?: string | null, end?: string | null) => {
  if (!start && !end) return "Dates not set";
  return `${formatReleaseShortDate(start)} – ${formatReleaseShortDate(end)}`;
};

const releaseVersionLabel = (value?: string | null) => {
  const normalized = String(value || "")
    .trim()
    .replace(/^version\b[\s:._-]*/i, "")
    .replace(/^v(?=[\s:._-]*\d)[\s:._-]*/i, "");
  return `v${normalized || "—"}`;
};

const releaseDateInputValue = (value?: string | null) =>
  String(value || "").match(/^\d{4}-\d{2}-\d{2}/)?.[0] || "";

const dateOnlyToMidnightIso = (value: string) => {
  const date = value.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  return date ? `${date}T00:00:00.000Z` : undefined;
};

const readinessLabel = (readiness?: ReleaseCatalogReadiness) => {
  if (!readiness) return "Evidence loading";
  if (!readiness.total_stories) return "Scope needed";
  if (readiness.readiness_score === null) return "No finalized runs";
  if (readiness.readiness_state === "ready") return "Release ready";
  if (readiness.readiness_state === "at_risk") return "At risk";
  return "Not ready";
};

function ReleaseHierarchyToggle({ isExpanded }: { isExpanded: boolean }) {
  return (
    <span aria-hidden="true" className="hierarchy-toggle-glyph" data-state={isExpanded ? "expanded" : "collapsed"}>
      {isExpanded ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
    </span>
  );
}

export function ReleasesPage() {
  const { session } = useAuth();
  const [projectId] = useCurrentProject();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedReleaseId = searchParams.get("release") || "";
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingRelease, setEditingRelease] = useState<RequirementRelease | null>(null);
  const [draft, setDraft] = useState<ReleaseDraft>(emptyDraft);
  const [storySearch, setStorySearch] = useState("");
  const [releaseSearch, setReleaseSearch] = useState("");
  const [releaseStateFilter, setReleaseStateFilter] = useState("all");
  const [releaseViewMode, setReleaseViewMode] = useState<"tile" | "list">("tile");
  const [selectedReleaseIds, setSelectedReleaseIds] = useState<string[]>([]);
  const [completionBlockedRelease, setCompletionBlockedRelease] = useState<RequirementRelease | null>(null);
  const [releaseNotesRelease, setReleaseNotesRelease] = useState<RequirementRelease | null>(null);
  const [releaseNotes, setReleaseNotes] = useState<RequirementReleaseNotes | null>(null);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const { confirmDelete, confirmationDialog } = useDeleteConfirmation();
  const canCreate = hasPermission(session, "requirement_iteration.create", projectId);
  const canUpdate = hasPermission(session, "requirement_iteration.update", projectId);
  const canDelete = hasPermission(session, "requirement_iteration.delete", projectId);
  const canReadReadiness = ["requirement_iteration.view", "requirement.view", "testcase.view", "run.view", "result.view", "feedback.view"]
    .every((permission) => hasPermission(session, permission, projectId));
  const readinessAccessKey = JSON.stringify([session?.user.id, session?.user.role, session?.user.status, session?.user.permissions, session?.user.workspace_permissions, session?.user.project_permissions]);

  const releasesQuery = useQuery({
    queryKey: ["requirement-releases", projectId],
    queryFn: () => api.requirementReleases.list({ project_id: projectId }),
    enabled: Boolean(projectId)
  });
  const releases = asArray(releasesQuery.data);
  const expandedRelease = releases.find((release) => release.id === selectedReleaseId);
  const releaseReadinessQuery = useQuery({
    queryKey: ["requirement-release-readiness", "project", projectId, readinessAccessKey],
    queryFn: async () => await api.requirementReleases.listReadiness({ project_id: projectId }) as ReleaseCatalogReadiness[],
    enabled: Boolean(projectId && canReadReadiness),
    staleTime: 30_000,
    retry: 1
  });
  const sprintsQuery = useQuery({
    queryKey: ["requirement-iterations", projectId],
    queryFn: () => api.requirementIterations.list({ project_id: projectId }),
    enabled: Boolean(projectId)
  });
  const storiesQuery = useQuery({
    queryKey: ["release-story-picker", projectId],
    queryFn: () => api.requirements.list({ project_id: projectId, limit: 5000, projection: "summary" }),
    enabled: Boolean(projectId && isCreateOpen)
  });
  const createRelease = useMutation({ mutationFn: api.requirementReleases.create });
  const updateRelease = useMutation({ mutationFn: ({ id, state }: { id: string; state: "in_progress" | "released" }) => api.requirementReleases.update(id, { state }) });
  const editRelease = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof api.requirementReleases.update>[1] }) =>
      api.requirementReleases.update(id, input)
  });
  const deleteRelease = useMutation({ mutationFn: api.requirementReleases.delete });
  const generateReleaseNotes = useMutation({
    mutationFn: (releaseId: string) => api.requirementReleases.generateNotes(releaseId),
    onSuccess: setReleaseNotes
  });

  const sprints = asArray(sprintsQuery.data);
  const stories = asArray(storiesQuery.data);
  const readinessByReleaseId = useMemo(() => new Map<string, ReleaseCatalogReadiness>(
    (canReadReadiness && !releaseReadinessQuery.isError ? asArray(releaseReadinessQuery.data) : []).map((readiness) => [readiness.release_id, readiness])
  ), [canReadReadiness, releaseReadinessQuery.data, releaseReadinessQuery.isError]);
  const normalizedStorySearch = storySearch.trim().toLowerCase();
  const visibleStories = useMemo(() => stories.filter((story) => !normalizedStorySearch || [story.display_id || story.id, story.title, story.status || "", story.scrum_team || ""].some((value) => value.toLowerCase().includes(normalizedStorySearch))), [normalizedStorySearch, stories]);
  const normalizedReleaseSearch = releaseSearch.trim().toLowerCase();
  const visibleReleases = releases.filter((release) => {
    const matchesState = releaseStateFilter === "all" || release.state === releaseStateFilter;
    const matchesSearch = !normalizedReleaseSearch || [release.display_id || release.id, release.name, release.fix_version, richTextToPlainText(release.description)].some((value) => value.toLowerCase().includes(normalizedReleaseSearch));
    return matchesState && matchesSearch;
  });
  const visibleReleaseIds = visibleReleases.map((release) => release.id);
  const areAllVisibleReleasesSelected = Boolean(visibleReleaseIds.length) && visibleReleaseIds.every((id) => selectedReleaseIds.includes(id));
  useEffect(() => {
    const availableIds = new Set(releases.map((release) => release.id));
    setSelectedReleaseIds((current) => current.filter((id) => availableIds.has(id)));
  }, [releases]);
  const sprintStoryIds = useMemo(() => new Set(stories.filter((story) => draft.sprintIds.includes(String(story.iteration_id || ""))).map((story) => story.id)), [draft.sprintIds, stories]);
  const selectedStoryCount = new Set([...draft.requirementIds, ...sprintStoryIds]).size;
  const portfolioReadiness = releases.map((release) => readinessByReleaseId.get(release.id)).filter((readiness): readiness is ReleaseCatalogReadiness => Boolean(readiness));
  const isReadinessLoading = canReadReadiness && releaseReadinessQuery.isLoading;
  const hasMissingReleaseEvidence = releaseReadinessQuery.isSuccess && releases.some((release) => !readinessByReleaseId.has(release.id));
  const isReadinessUnavailable = !canReadReadiness || releaseReadinessQuery.isError || hasMissingReleaseEvidence;
  const readinessUnavailableReason = !canReadReadiness
    ? "Release evidence requires access to Stories, Test Cases, Runs, Results and Bugs in this project."
    : releaseReadinessQuery.error instanceof Error ? releaseReadinessQuery.error.message : hasMissingReleaseEvidence ? "Evidence is missing for one or more Releases. Retry to refresh the complete portfolio." : "Release evidence could not be loaded.";
  const releaseReadyCount = portfolioReadiness.filter((item) => item.total_stories > 0 && item.readiness_state === "ready").length;
  const atRiskCount = releases.filter((release) => {
    if (release.persisted_state === "released") return false;
    const readiness = readinessByReleaseId.get(release.id);
    return release.state === "overdue" || Boolean(readiness?.total_stories && readiness.readiness_state !== "ready");
  }).length;
  const releaseStoryCompletion = releasePortfolioCompletion(releases);
  const portfolioCompletionPercent = releaseStoryCompletion.percent;
  const releaseStoryColumns = useMemo<Array<DataTableColumn<Requirement>>>(() => [
    {
      key: "id",
      label: "Story ID",
      width: 132,
      minWidth: 112,
      render: (story) => <span className="requirement-story-identity"><StoryIcon size={15} /><DisplayIdBadge value={story.display_id || story.id} /></span>,
      sortValue: (story) => story.display_id || story.id
    },
    {
      key: "title",
      label: "Story",
      width: 360,
      minWidth: 220,
      render: (story) => <strong className="release-list-story-title">{story.title}</strong>,
      sortValue: (story) => story.title
    },
    {
      key: "source",
      label: "Release scope",
      width: 150,
      minWidth: 125,
      render: (story) => <span className="release-story-source-badge">{story.release_membership_source === "sprint" ? "Sprint scope" : "Direct scope"}</span>,
      sortValue: (story) => story.release_membership_source || "manual"
    },
    {
      key: "sprint",
      label: "Sprint",
      width: 180,
      minWidth: 130,
      render: (story) => story.sprint || "Not assigned",
      sortValue: (story) => story.sprint || ""
    },
    {
      key: "status",
      label: "Status",
      width: 145,
      minWidth: 120,
      render: (story) => <StatusBadge value={story.status || "open"} />,
      sortValue: (story) => story.status || ""
    },
    {
      key: "priority",
      label: "Priority",
      width: 100,
      minWidth: 86,
      render: (story) => `P${story.priority ?? 3}`,
      sortValue: (story) => story.priority ?? 3
    },
    {
      key: "updated_at",
      label: "Updated",
      width: 150,
      minWidth: 126,
      render: (story) => formatDate(story.updated_at),
      sortValue: (story) => story.updated_at || ""
    }
  ], []);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["requirement-releases", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["requirement-release-readiness"] }),
      queryClient.invalidateQueries({ queryKey: ["requirements", projectId] })
    ]);
  };
  const openCreateRelease = () => {
    setEditingRelease(null);
    setDraft(emptyDraft());
    setStorySearch("");
    setIsCreateOpen(true);
  };
  const openEditRelease = (release: RequirementRelease) => {
    setEditingRelease(release);
    setDraft({
      name: release.name,
      description: release.description || "",
      fixVersion: release.fix_version,
      planDate: releaseDateInputValue(release.plan_date),
      targetDate: releaseDateInputValue(release.target_date),
      externalLink: release.external_link || "",
      sprintIds: release.sprint_ids,
      requirementIds: asArray(release.requirements)
        .filter((story) => story.release_membership_source !== "sprint")
        .map((story) => story.id)
    });
    setStorySearch("");
    setIsCreateOpen(true);
  };
  const closeReleaseDialog = () => {
    if (createRelease.isPending || editRelease.isPending) return;
    setIsCreateOpen(false);
    setEditingRelease(null);
    setDraft(emptyDraft());
    setStorySearch("");
  };
  const releaseDialogRef = useDialogFocus<HTMLFormElement>({
    active: isCreateOpen,
    closeDisabled: createRelease.isPending || editRelease.isPending,
    onClose: closeReleaseDialog
  });
  const saveRelease = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!projectId || !draft.name.trim() || !draft.fixVersion.trim()) return;
    try {
      if (editingRelease) {
        await editRelease.mutateAsync({
          id: editingRelease.id,
          input: {
            name: draft.name.trim(),
            description: draft.description,
            fix_version: draft.fixVersion.trim(),
            plan_date: draft.planDate ? dateOnlyToMidnightIso(draft.planDate) : "",
            target_date: draft.targetDate ? dateOnlyToMidnightIso(draft.targetDate) : "",
            external_link: draft.externalLink.trim(),
            sprint_ids: draft.sprintIds,
            requirement_ids: draft.requirementIds
          }
        });
        setMessageTone("success");
        setMessage("Release updated in HelloTest.");
        setIsCreateOpen(false);
        setEditingRelease(null);
        setDraft(emptyDraft());
        await refresh();
        return;
      }
      const response = await createRelease.mutateAsync({
        project_id: projectId,
        name: draft.name.trim(),
        description: draft.description,
        fix_version: draft.fixVersion.trim(),
        target_date_label: "Release target date",
        plan_date: dateOnlyToMidnightIso(draft.planDate),
        target_date: dateOnlyToMidnightIso(draft.targetDate),
        external_link: draft.externalLink.trim() || undefined,
        sprint_ids: draft.sprintIds,
        requirement_ids: draft.requirementIds
      });
      setDraft(emptyDraft());
      setIsCreateOpen(false);
      setMessageTone("success");
      setMessage(`Release created with ${response.release.requirement_count} ${response.release.requirement_count === 1 ? "Story" : "Stories"}. Fix Version ${response.release.fix_version} was stamped across the release scope.`);
      await refresh();
      setSearchParams({ release: response.id });
    } catch (error) {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : `Unable to ${editingRelease ? "update" : "create"} release`);
    }
  };
  const changeState = async (release: RequirementRelease, state: "in_progress" | "released") => {
    try {
      if (state === "released") {
        const currentRelease = await api.requirementReleases.get(release.id);
        const incompleteStories = asArray(currentRelease.requirements).filter((story) => !isDeliveryStatusComplete(story.status));
        if (incompleteStories.length) {
          setCompletionBlockedRelease(currentRelease);
          return;
        }
      }
      await updateRelease.mutateAsync({ id: release.id, state });
      setMessageTone("success");
      setMessage(state === "released" ? "Release marked released." : "Release started.");
      await refresh();
    } catch (error) {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "Unable to update release");
    }
  };
  const removeRelease = async (release: RequirementRelease) => {
    const confirmed = await confirmDelete({
      title: "Delete release?",
      confirmLabel: "Delete release",
      message: `Delete “${release.name}”? Its Stories and quality evidence will remain available.`
    });
    if (!confirmed) return;
    try {
      await deleteRelease.mutateAsync(release.id);
      setSearchParams({});
      await refresh();
    } catch (error) {
      setMessageTone("error");
      setMessage(error instanceof Error ? error.message : "Unable to delete release");
    }
  };
  const removeSelectedReleases = async () => {
    const selected = releases.filter((release) => selectedReleaseIds.includes(release.id));
    if (!selected.length || !canDelete || deleteRelease.isPending) return;
    const confirmed = await confirmDelete({
      title: `Delete ${selected.length} selected ${selected.length === 1 ? "Release" : "Releases"}?`,
      confirmLabel: selected.length === 1 ? "Delete Release" : `Delete ${selected.length} Releases`,
      message: `Delete ${selected.map((release) => `“${release.name}”`).join(", ")}? Their Stories and quality evidence will remain available.`
    });
    if (!confirmed) return;
    const results = await Promise.allSettled(selected.map((release) => deleteRelease.mutateAsync(release.id)));
    const deletedIds = selected.filter((_release, index) => results[index]?.status === "fulfilled").map((release) => release.id);
    const failedCount = selected.length - deletedIds.length;
    setSelectedReleaseIds((current) => current.filter((id) => !deletedIds.includes(id)));
    if (deletedIds.includes(selectedReleaseId)) setSearchParams({});
    setMessageTone(failedCount ? "error" : "success");
    setMessage(failedCount
      ? `${deletedIds.length} ${deletedIds.length === 1 ? "Release was" : "Releases were"} deleted; ${failedCount} could not be deleted.`
      : `${deletedIds.length} ${deletedIds.length === 1 ? "Release" : "Releases"} deleted.`);
    await refresh();
  };

  const toggleReleaseExpansion = (releaseId: string) => {
    setSearchParams(releaseId === selectedReleaseId ? {} : { release: releaseId });
  };
  const openReleaseReadiness = (release: RequirementRelease) => {
    navigate(`/?view=readiness&release=${encodeURIComponent(release.fix_version)}&release_id=${encodeURIComponent(release.id)}`);
  };
  const openReleaseNotes = (release: RequirementRelease) => {
    setReleaseNotesRelease(release);
    setReleaseNotes(null);
    generateReleaseNotes.reset();
    generateReleaseNotes.mutate(release.id);
  };
  const closeReleaseNotes = () => {
    if (generateReleaseNotes.isPending) return;
    setReleaseNotesRelease(null);
    setReleaseNotes(null);
    generateReleaseNotes.reset();
  };
  const releaseNotesPlainText = releaseNotes ? [
    `${releaseNotes.release_name} (${releaseNotes.fix_version})`,
    "",
    releaseNotes.executive_summary,
    "",
    ...releaseNotes.change_groups.flatMap((group) => [group.title, ...group.items.map((item) => `- ${item}`), ""]),
    "",
    "Known limitations",
    ...releaseNotes.known_limitations.map((item) => `- ${item}`),
    "",
    "Validation",
    releaseNotes.validation_summary,
    "",
    "Evidence by Story",
    ...releaseNotes.story_evaluations.map((story) => `- ${story.id} — ${story.title}: ${story.summary}`)
  ].join("\n") : "";
  const copyReleaseNotes = async () => {
    try {
      await navigator.clipboard.writeText(releaseNotesPlainText);
      setMessageTone("success");
      setMessage("Release notes copied to clipboard.");
    } catch {
      setMessageTone("error");
      setMessage("Release notes could not be copied. Select the text and copy it manually.");
    }
  };
  const openReleaseStory = (story: Requirement) => {
    const destination = story.iteration_id || story.sprint_id || story.sprint ? "/sprints" : "/backlog";
    navigate(`${destination}?requirement=${encodeURIComponent(story.display_id || story.id)}`);
  };
  const releaseStateClass = (release: RequirementRelease) => {
    if (release.state === "released") return "closed";
    if (release.state === "in_progress") return "active";
    return release.state === "overdue" ? "overdue" : "future";
  };
  const renderReleaseIdentity = (release: RequirementRelease) => {
    const description = richTextToPlainText(release.description).trim();
    return (
      <div className="requirement-sprint-identity release-hierarchy-identity">
        <span className="module-folder-icon release-module-icon"><ReleaseIcon size={20} /></span>
        <div className="requirement-sprint-copy release-ribbon-copy">
          <div className="requirement-sprint-heading release-ribbon-title-line">
            <span className="release-ribbon-name-version">
              <strong className="release-ribbon-name" title={release.name}>{release.name}</strong>
              <span aria-hidden="true" className="release-ribbon-version-separator">–</span>
              <span className="release-ribbon-version" title={`Version ${releaseVersionLabel(release.fix_version)}`}>{releaseVersionLabel(release.fix_version)}</span>
            </span>
            <span className={`requirement-sprint-status is-${releaseStateClass(release)}`}>{release.state.replace("_", " ")}</span>
          </div>
          <div className="requirement-sprint-meta release-ribbon-schedule">
            <span className="requirement-sprint-dates release-date-range" title={`${formatDate(release.plan_date)} – ${formatDate(release.target_date)}`}>{releaseDateRangeLabel(release.plan_date, release.target_date)}</span>
            {release.sprint_ids.length ? <span>{release.sprint_ids.length} {release.sprint_ids.length === 1 ? "Sprint" : "Sprints"}</span> : null}
          </div>
          {description ? <span className="requirement-sprint-goal release-ribbon-description" title={description}>{description}</span> : null}
        </div>
      </div>
    );
  };
  const renderReleaseMetrics = (release: RequirementRelease) => {
    const readiness = readinessByReleaseId.get(release.id);
    const completion = storyCompletionFor(release);
    return (
      <HierarchyQuickInsights
        count={completion.total}
        countLabel={completion.total === 1 ? "Story" : "Stories"}
        metrics={[
          {
            icon: <IconTargetArrow aria-hidden="true" size={13} stroke={1.8} />,
            label: "Readiness",
            value: readiness ? readiness.readiness_score === null ? "No runs" : `${readiness.readiness_score}%` : isReadinessUnavailable ? "Unavailable" : "Loading…",
            tone: !readiness || readiness.readiness_score === null ? "neutral" : readiness.readiness_state === "ready" ? "success" : readiness.readiness_state === "at_risk" ? "warning" : "danger",
            title: isReadinessUnavailable ? readinessUnavailableReason : readinessLabel(readiness)
          },
          {
            icon: <IconCheck aria-hidden="true" size={13} stroke={1.8} />,
            label: "Story completion",
            value: completion.percent === null ? "Unavailable" : `${completion.percent}%`,
            tone: completion.percent === 100 && completion.total > 0 ? "success" : "neutral",
            title: `${completion.completed}/${completion.total} scoped Stories are QA done.`
          },
          {
            icon: <IconChecklist aria-hidden="true" size={13} stroke={1.8} />,
            label: "Test coverage",
            value: readiness ? readiness.test_coverage_percent === null ? "—" : `${readiness.test_coverage_percent}%` : isReadinessUnavailable ? "Unavailable" : "Loading…",
            tone: !readiness ? "neutral" : (readiness.test_coverage_percent ?? 0) >= 80 ? "success" : "warning",
            title: readiness ? `${readiness.covered_stories}/${readiness.total_stories} scoped Stories have linked test coverage.` : isReadinessUnavailable ? readinessUnavailableReason : "Loading release test evidence."
          },
          {
            icon: <IconBug aria-hidden="true" size={13} stroke={1.8} />,
            label: "Open Bugs",
            value: readiness ? String(readiness.open_bugs) : isReadinessUnavailable ? "Unavailable" : "Loading…",
            tone: !readiness ? "neutral" : readiness.open_bugs ? "danger" : "success",
            title: readiness ? `${readiness.open_bugs} open Bugs across ${readiness.total_bugs} total Bugs.` : isReadinessUnavailable ? readinessUnavailableReason : "Loading release Bug evidence."
          }
        ]}
      />
    );
  };
  const renderReleaseActions = (release: RequirementRelease) => (
    <div className="action-row hierarchy-parent-actions release-hierarchy-actions" onClick={(event) => event.stopPropagation()}>
      {release.persisted_state === "planned" ? (
        <button aria-label={`Start release ${release.name}`} className="ghost-button compact release-start-button" disabled={!canUpdate || updateRelease.isPending} onClick={() => void changeState(release, "in_progress")} title="Start Release" type="button"><IconPlayerPlay size={16} /></button>
      ) : null}
      {release.persisted_state === "in_progress" ? (
        <button aria-label={`Complete release ${release.name}`} className="ghost-button compact release-complete-button" disabled={!canUpdate || updateRelease.isPending} onClick={() => void changeState(release, "released")} title="Complete Release" type="button"><IconFlagCheck size={16} /></button>
      ) : null}
      <button
        aria-label={`Edit ${release.name}`}
        className="ghost-button compact release-edit-button"
        disabled={!canUpdate || release.persisted_state === "released" || editRelease.isPending}
        onClick={() => openEditRelease(release)}
        title={release.persisted_state === "released" ? "Completed Releases are read-only" : "Edit Release"}
        type="button"
      >
        <PencilIcon size={16} />
      </button>
      <button aria-label={`Open readiness board for ${release.name}`} className="ghost-button compact release-readiness-button release-ribbon-action" onClick={() => openReleaseReadiness(release)} title="Open release readiness board" type="button"><ReleaseReadinessIcon size={26} /></button>
      <button aria-label={`${generateReleaseNotes.isPending && releaseNotesRelease?.id === release.id ? "Generating" : "Generate"} release notes for ${release.name}`} className="ghost-button compact release-notes-button release-ribbon-action" disabled={!canReadReadiness || generateReleaseNotes.isPending && releaseNotesRelease?.id === release.id} onClick={() => openReleaseNotes(release)} title={!canReadReadiness ? readinessUnavailableReason : "Evaluate scoped Stories and compose Release notes"} type="button"><ReleaseNotesIcon size={23} /></button>
      {release.external_link ? <a aria-label={`Open external reference for ${release.name}`} className="ghost-button compact release-external-action" href={release.external_link} rel="noreferrer" target="_blank" title="Open external Release reference"><IconExternalLink size={16} /></a> : null}
      <button aria-label={`Delete release ${release.name}`} className="ghost-button compact danger release-delete-button" disabled={!canDelete || deleteRelease.isPending} onClick={() => void removeRelease(release)} title="Delete Release" type="button"><IconTrash size={16} /></button>
    </div>
  );
  const renderReleaseHeader = (release: RequirementRelease, listView = false) => {
    const isExpanded = release.id === selectedReleaseId;
    const isSelected = selectedReleaseIds.includes(release.id);
    return (
      <div className={`test-case-module-header requirement-iteration-header release-iteration-header${listView ? " requirement-iteration-list-header" : ""}`}>
        <label className="checkbox-field release-selection-checkbox" onClick={(event) => event.stopPropagation()}>
          <input
            aria-label={`Select release ${release.name}`}
            checked={isSelected}
            onChange={(event) => setSelectedReleaseIds((current) => event.target.checked ? [...new Set([...current, release.id])] : current.filter((id) => id !== release.id))}
            type="checkbox"
          />
        </label>
        <button
          aria-expanded={isExpanded}
          aria-label={isExpanded ? `Collapse release ${release.name}` : `Expand release ${release.name}`}
          className={isExpanded ? "ghost-button compact module-toggle-button is-expanded" : "ghost-button compact module-toggle-button"}
          onClick={() => toggleReleaseExpansion(release.id)}
          type="button"
        >
          <ReleaseHierarchyToggle isExpanded={isExpanded} />
        </button>
        {renderReleaseIdentity(release)}
        {renderReleaseActions(release)}
        {renderReleaseMetrics(release)}
      </div>
    );
  };
  const renderReleaseStoryTile = (story: Requirement) => {
    const evidenceStory = story;
    const metrics = expandedRelease ? readinessByReleaseId.get(expandedRelease.id)?.story_metrics?.[story.id] : undefined;
    const linkedCaseCount = metrics?.linked_cases;
    const linkedBugCount = metrics?.total_bugs;
    const passPercent = metrics?.pass_rate_percent ?? null;
    const automationPercent = metrics?.automation_coverage_percent ?? null;
    const readinessScore = metrics?.readiness_score ?? null;
    const evidenceState = isReadinessLoading ? "Loading…" : "Unavailable";
    const passCoverageTitle = !metrics
      ? isReadinessLoading ? "Loading this Release's execution evidence" : readinessUnavailableReason
      : metrics.executed_cases
        ? `${metrics.passed_cases}/${metrics.executed_cases} linked test cases with finalized Release outcomes passed. Pending runs are excluded.`
        : "No finalized passed, failed or blocked outcomes for this Story in this Release.";
    const automationCoverageTitle = !metrics
      ? "Complete linked test case evidence is unavailable."
      : `${metrics.automated_cases}/${metrics.linked_cases} linked test cases automated`;

    return (
      <article
        className="record-card tile-card requirement-catalog-card release-story-tile"
        key={story.id}
        onClick={() => openReleaseStory(story)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openReleaseStory(story);
          }
        }}
        role="button"
        tabIndex={0}
      >
        <div className="tile-card-main">
          <div className="tile-card-select-row requirement-tile-top-row release-story-tile-top-row">
            <span className="requirement-story-identity"><StoryIcon size={16} /><DisplayIdBadge value={story.display_id || story.id} /></span>
            <span className="release-story-scope">{story.release_membership_source === "sprint" ? "Sprint scope" : "Direct scope"}</span>
            <StatusBadge value={evidenceStory.status || "open"} />
          </div>
          <div className="tile-card-header requirement-tile-header"><div className="tile-card-title-group"><strong>{evidenceStory.title}</strong></div></div>
          <CatalogCardDescription fallback="No Story description captured yet." profile="story" value={evidenceStory.description} />
          <div className="requirement-progress-stack release-story-progress-stack">
            <TileCardProgress
              displayValue={metrics ? passPercent === null ? "No runs" : `${Math.round(passPercent)}%` : "—"}
              label="Pass rate"
              title={passCoverageTitle}
              tone={passPercent === null ? "neutral" : passPercent === 100 ? "success" : passPercent ? "info" : "danger"}
              value={passPercent}
            />
            <TileCardProgress
              displayValue={automationPercent === null ? "—" : `${Math.round(automationPercent)}%`}
              label="Automation coverage"
              title={automationCoverageTitle}
              tone={automationPercent === null || !linkedCaseCount ? "neutral" : automationPercent === 100 ? "success" : automationPercent ? "info" : "danger"}
              value={automationPercent}
            />
          </div>
          <div className="tile-card-facts story-tile-metrics" aria-label={`${evidenceStory.title} health metrics`}>
            <TileCardMetric className="story-tile-metric" label="Priority" tone={(evidenceStory.priority ?? 3) <= 2 ? "danger" : "info"} value={`P${evidenceStory.priority ?? 3}`} />
            <TileCardMetric className="story-tile-metric" label="Linked cases" tone={linkedCaseCount ? "success" : "neutral"} value={linkedCaseCount === undefined ? "—" : String(linkedCaseCount)} />
            <TileCardMetric className="story-tile-metric" label="Defect density" tone={linkedBugCount === undefined ? "neutral" : linkedBugCount ? "danger" : "success"} value={linkedBugCount === undefined ? "—" : linkedBugCount.toFixed(2)} />
            <TileCardMetric className="story-tile-metric" label="Release readiness" tone={readinessScore === null ? "neutral" : readinessScore >= 80 ? "success" : readinessScore >= 50 ? "info" : "danger"} value={metrics ? readinessScore === null ? "No runs" : `${readinessScore}%` : evidenceState} />
          </div>
          <div className="tile-card-facts release-story-context-facts" aria-label={`${evidenceStory.title} delivery context`}>
            <TileCardFact label={evidenceStory.sprint || "No Sprint"} title={evidenceStory.sprint ? `Included through Sprint ${evidenceStory.sprint}` : "Direct Release scope without a Sprint"} tone={evidenceStory.sprint ? "info" : "neutral"}><SprintIcon size={14} /></TileCardFact>
            <TileCardFact label={evidenceStory.fix_version || "Version pending"} title={evidenceStory.fix_version ? `Fix Version ${evidenceStory.fix_version}` : "No Fix Version stamped"} tone={evidenceStory.fix_version ? "success" : "warning"}><ReleaseIcon size={14} /></TileCardFact>
          </div>
        </div>
      </article>
    );
  };
  const releaseRowGroups: Array<DataTableRowGroup<Requirement>> = visibleReleases.map((release) => {
    const isExpanded = release.id === selectedReleaseId;
    return {
      key: `release:${release.id}`,
      isCollapsed: !isExpanded,
      rows: isExpanded ? asArray(release.requirements) : [],
      header: renderReleaseHeader(release, true),
      content: isExpanded && !asArray(release.requirements).length
        ? <div className="hierarchy-children-state hierarchy-children-state--list">No Stories are scoped to this Release yet.</div>
        : null
    };
  });

  if (!projectId) return <div className="page-content"><div className="empty-state compact">Select a project to plan releases.</div></div>;

  if (releasesQuery.isLoading) {
    return <div className="page-content page-content--library-full releases-page"><LoadingState label="Loading Releases" /></div>;
  }

  if (releasesQuery.isError) {
    return (
      <div className="page-content page-content--library-full releases-page">
        <AppErrorState
          error={releasesQuery.error}
          fallbackMessage="Release plans could not be loaded. Your current filters and selections have been preserved."
          onRetry={() => void releasesQuery.refetch()}
          title="Unable to load releases"
        />
      </div>
    );
  }

  return (
    <div className="page-content page-content--library-full releases-page">
      <ToastMessage message={message} onDismiss={() => setMessage("")} tone={messageTone} />
      {confirmationDialog}
      <PageHeader
        eyebrow="Product Management"
        title="Releases"
        description="Plan versioned delivery scope from Stories and Sprints, then review evidence-backed readiness from the exact release context."
        meta={[
          { label: "Releases", value: releases.length },
          { label: "Release ready", value: isReadinessUnavailable ? "Unavailable" : isReadinessLoading ? "Loading…" : releaseReadyCount },
          { label: "Overdue", value: releases.filter((item) => item.state === "overdue").length }
        ]}
      />
      <section aria-busy={isReadinessLoading} aria-label="Release portfolio health" className="release-portfolio-grid">
        <article className="release-portfolio-card tone-scope"><span>Total releases</span><strong>{releases.length}</strong><small>{releases.filter((item) => item.persisted_state === "planned").length} planned</small></article>
        <article className="release-portfolio-card tone-active"><span>In progress</span><strong>{releases.filter((item) => item.state === "in_progress").length}</strong><small>Actively moving toward a target</small></article>
        <article className="release-portfolio-card tone-ready"><span>Release ready</span><strong>{isReadinessLoading || isReadinessUnavailable ? "—" : releaseReadyCount}</strong><small>{isReadinessUnavailable ? "Quality evidence unavailable" : isReadinessLoading ? "Loading quality evidence…" : "Quality evidence meets the readiness policy"}</small></article>
        <article className="release-portfolio-card tone-risk"><span>At risk</span><strong>{isReadinessLoading || isReadinessUnavailable ? "—" : atRiskCount}</strong><small>{isReadinessUnavailable ? "Quality evidence unavailable" : isReadinessLoading ? "Evaluating schedule and quality…" : "Schedule or quality evidence needs action"}</small></article>
        <article className="release-portfolio-card tone-overdue"><span>Overdue</span><strong>{releases.filter((item) => item.state === "overdue").length}</strong><small>Open releases beyond their target date</small></article>
        <article className="release-portfolio-card tone-completion"><span>Story completion</span><strong>{portfolioCompletionPercent === null ? "—" : `${portfolioCompletionPercent}%`}</strong><small>{portfolioCompletionPercent === null ? "Complete Story scope unavailable" : `${releaseStoryCompletion.completed}/${releaseStoryCompletion.total} unique scoped Stories QA done`}</small></article>
      </section>

      {isReadinessUnavailable ? <div className="notice" role="status"><strong>Release evidence unavailable. </strong>{readinessUnavailableReason}{canReadReadiness ? <button className="ghost-button compact" type="button" onClick={() => void releaseReadinessQuery.refetch()}>Retry evidence</button> : null}</div> : null}

      {releasesQuery.isLoading ? <LoadingState label="Loading releases" /> : (
        <div className="release-workspace">
          <Panel className="release-plan-panel" title="Release plan" subtitle="Open a release to inspect its exact delivery and quality evidence.">
            <div className="design-list-toolbar catalog-command-toolbar requirement-catalog-toolbar release-toolbar">
              <div className="catalog-toolbar-discovery release-toolbar-discovery" aria-label="Release views and search">
                <CatalogViewToggle onChange={setReleaseViewMode} value={releaseViewMode} />
                <CatalogSearchFilter
                  activeFilterCount={Number(releaseStateFilter !== "all")}
                  ariaLabel="Search releases"
                  onChange={setReleaseSearch}
                  placeholder="Search releases or Fix Version"
                  subtitle="Filter releases by version, identity, description, and lifecycle state."
                  title="Filter releases"
                  value={releaseSearch}
                >
                  <div className="catalog-filter-grid">
                    <label className="catalog-filter-field"><span>Status</span><select aria-label="Filter releases by status" onChange={(event) => setReleaseStateFilter(event.target.value)} value={releaseStateFilter}><option value="all">All statuses</option><option value="planned">Planned</option><option value="in_progress">In progress</option><option value="overdue">Overdue</option><option value="released">Released</option></select></label>
                    <div className="catalog-filter-actions"><button className="ghost-button" disabled={releaseStateFilter === "all"} onClick={() => setReleaseStateFilter("all")} type="button">Clear filters</button></div>
                  </div>
                </CatalogSearchFilter>
                <span className="release-toolbar-count">{visibleReleases.length} of {releases.length}</span>
                <CatalogSelectionControls
                  allSelected={areAllVisibleReleasesSelected}
                  canSelectAll={Boolean(visibleReleaseIds.length)}
                  onClear={() => setSelectedReleaseIds([])}
                  onSelectAll={() => setSelectedReleaseIds((current) => [...new Set([...current, ...visibleReleaseIds])])}
                  selectedCount={selectedReleaseIds.length}
                />
              </div>
              <div className="catalog-toolbar-actions release-toolbar-actions">
                <button className="ghost-button danger catalog-selection-button" disabled={!selectedReleaseIds.length || !canDelete || deleteRelease.isPending} onClick={() => void removeSelectedReleases()} type="button"><IconTrash size={17} /><span>{deleteRelease.isPending ? "Deleting…" : selectedReleaseIds.length ? `Delete selected (${selectedReleaseIds.length})` : "Delete selected"}</span></button>
                <button className="primary-button catalog-selection-button" disabled={!canCreate} onClick={openCreateRelease} type="button"><ReleaseIcon size={18} /><span>Create release</span></button>
              </div>
            </div>

            {releaseViewMode === "tile" ? (
              <TileBrowserPane className="release-tile-browser-pane" scrollKey={`releases:${projectId}:${releaseViewMode}`}>
                <div className="tile-browser-grid release-tile-browser-grid">
                  {visibleReleases.map((release) => {
                    const isExpanded = release.id === selectedReleaseId;
                    return (
                      <Fragment key={release.id}>
                        {renderReleaseHeader(release)}
                        {isExpanded ? asArray(release.requirements).map(renderReleaseStoryTile) : null}
                        {isExpanded && !asArray(release.requirements).length ? <div className="hierarchy-children-state hierarchy-children-state--tile">No Stories are scoped to this Release yet.</div> : null}
                      </Fragment>
                    );
                  })}
                  {!visibleReleases.length ? <div className="empty-state compact release-empty-state">{releases.length ? "No Releases match the current search and status filter." : "No Releases yet. Create a versioned Release plan from Backlog Stories or complete Sprints."}</div> : null}
                </div>
              </TileBrowserPane>
            ) : (
              <DataTable
                columns={releaseStoryColumns}
                enableColumnResize
                enableHeaderColumnReorder
                emptyMessage={releases.length ? "No Releases match the current search and status filter." : "No Releases yet. Create a versioned Release plan from Backlog Stories or complete Sprints."}
                getRowKey={(story) => story.id}
                onRowClick={openReleaseStory}
                rowGroups={releaseRowGroups}
                rows={[]}
                storageKey="hellotest:releases:list-columns:v1"
              />
            )}
          </Panel>
        </div>
      )}

      {isCreateOpen ? (
        <div className={`modal-backdrop sprint-create-backdrop release-create-backdrop${editingRelease ? " release-edit-backdrop" : ""}`} onClick={closeReleaseDialog} role="presentation">
          <form aria-labelledby="release-dialog-title" aria-modal="true" className={`modal-card requirement-create-modal-card sprint-create-dialog sprint-new-dialog release-create-dialog${editingRelease ? " sprint-edit-dialog release-edit-dialog" : ""}`} onClick={(event) => event.stopPropagation()} onSubmit={saveRelease} ref={releaseDialogRef} role="dialog" tabIndex={-1}>
            <div className="requirement-create-modal-header sprint-create-dialog-header">
              <div className="requirement-create-modal-title"><span className="eyebrow">Release planning</span><h2 className="dialog-title" id="release-dialog-title">{editingRelease ? `Edit release: ${editingRelease.name}` : "Create release"}</h2><p>{editingRelease ? "Update the version identity, delivery window, release intent, and scoped Sprints or Stories." : "Select Sprints to carry their complete Story scope, then add any direct Stories needed for this version."}</p></div>
              <DialogCloseButton disabled={createRelease.isPending || editRelease.isPending} label={`Close ${editingRelease ? "edit" : "create"} release`} onClick={closeReleaseDialog} />
            </div>
            <div className="requirement-create-modal-body requirement-create-modal-body--stacked sprint-create-dialog-body">
              <div className="iteration-create-layout release-create-layout">
                <section className="iteration-create-details-card sprint-create-plan-card release-create-plan-card">
                  <div className="sprint-create-section-heading"><div><strong>Release plan</strong><span>Version identity, target, and delivery intent.</span></div></div>
                  <div className="release-create-grid">
                    <FormField label="Release name" required><input autoFocus data-autofocus="true" required value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Enter release name" /></FormField>
                    <FormField label="Fix Version" required><input required value={draft.fixVersion} onChange={(event) => setDraft((current) => ({ ...current, fixVersion: event.target.value }))} placeholder="For example 2026.08" /></FormField>
                    <FormField label="Release plan date"><input type="date" value={draft.planDate} onChange={(event) => setDraft((current) => ({ ...current, planDate: event.target.value }))} /></FormField>
                    <FormField label="Release target date"><input type="date" value={draft.targetDate} onChange={(event) => setDraft((current) => ({ ...current, targetDate: event.target.value }))} /></FormField>
                    <FormField className="is-wide" label="External link"><input placeholder="https://…" type="url" value={draft.externalLink} onChange={(event) => setDraft((current) => ({ ...current, externalLink: event.target.value }))} /></FormField>
                    <FormField className="is-wide release-description-field" label="Release description"><RichTextEditor aria-label="Release description" className="sprint-goal-editor" rows={7} toolbarPreset="sprint-goal" value={draft.description} onChange={(description) => setDraft((current) => ({ ...current, description }))} placeholder="Describe the release outcome and go-live intent..." /></FormField>
                  </div>
                </section>
                <section className="iteration-requirement-picker sprint-story-picker release-scope-picker">
                  <div className="sprint-create-section-heading sprint-story-picker-heading"><h3>Release scope</h3><span>{selectedStoryCount} Stories selected</span></div>
                  <div className="release-scope-picker-stack">
                    <div className="sprint-story-picker-panel release-sprint-picker-panel">
                      <div className="release-picker-head"><div><strong>Sprints</strong><small>Selecting a Sprint keeps all of its current and future Stories in scope.</small></div><span>{draft.sprintIds.length} selected</span></div>
                      <div className="sprint-story-picker-list release-picker-list" role="group" aria-label="Sprints for this Release">
                        {sprints.map((sprint: RequirementIteration) => { const checked = draft.sprintIds.includes(sprint.id); return <label className={`iteration-requirement-option${checked ? " is-selected" : ""}`} key={sprint.id}><input aria-label={`${checked ? "Remove" : "Add"} Sprint ${sprint.name} ${checked ? "from" : "to"} this Release`} checked={checked} className="sprint-story-checkbox-input" onChange={(event) => setDraft((current) => ({ ...current, sprintIds: event.target.checked ? [...current.sprintIds, sprint.id] : current.sprintIds.filter((id) => id !== sprint.id) }))} type="checkbox" /><span aria-hidden="true" className={`sprint-story-checkbox-indicator${checked ? " is-checked" : ""}`}>{checked ? <IconCheck size={12} stroke={3} /> : null}</span><span className="sprint-story-option-content"><small className="sprint-story-id"><SprintIcon size={14} /><span>{sprint.state || "planned"} · {sprint.requirement_count || 0} Stories</span></small><strong>{sprint.name}</strong></span></label>; })}
                        {!sprints.length ? <div className="empty-state compact">No Sprints are available in this project.</div> : null}
                      </div>
                    </div>
                    <div className="sprint-story-picker-panel release-story-picker-panel">
                      <div className="iteration-requirement-picker-toolbar"><FormField className="sprint-story-search-field" composite inputId="release-story-search" label="Add direct Stories"><div className="search-input-with-icon"><SearchIcon size={18} /><input id="release-story-search" placeholder="Search Stories" type="search" value={storySearch} onChange={(event) => setStorySearch(event.target.value)} /></div></FormField></div>
                      <div className="sprint-story-picker-list release-picker-list" role="group" aria-label="Direct Stories for this Release">
                        {visibleStories.map((story: Requirement) => { const inherited = sprintStoryIds.has(story.id); const checked = inherited || draft.requirementIds.includes(story.id); return <label aria-disabled={inherited} className={`iteration-requirement-option${checked ? " is-selected" : ""}${inherited ? " is-disabled is-inherited" : ""}`} key={story.id}><input aria-label={`${checked ? "Remove" : "Add"} ${story.display_id || story.id}: ${story.title} ${checked ? "from" : "to"} this Release`} checked={checked} className="sprint-story-checkbox-input" disabled={inherited} onChange={(event) => setDraft((current) => ({ ...current, requirementIds: event.target.checked ? [...current.requirementIds, story.id] : current.requirementIds.filter((id) => id !== story.id) }))} type="checkbox" /><span aria-hidden="true" className={`sprint-story-checkbox-indicator${checked ? " is-checked" : ""}`}>{checked ? <IconCheck size={12} stroke={3} /> : null}</span><span className="sprint-story-option-content"><small className="sprint-story-id"><StoryIcon size={14} /><span>{story.display_id || story.id}{inherited ? " · included by Sprint" : ""}</span></small><strong>{story.title}</strong></span></label>; })}
                        {!visibleStories.length ? <div className="empty-state compact">No Stories match this search.</div> : null}
                      </div>
                      <p className="sprint-story-selection-summary">{selectedStoryCount} {selectedStoryCount === 1 ? "Story" : "Stories"} selected. Sprint-inherited Stories remain synchronized with their selected Sprint.</p>
                    </div>
                  </div>
                </section>
              </div>
            </div>
            <div className="action-row requirement-create-modal-actions sprint-create-dialog-footer"><button className="ghost-button sprint-create-cancel-button" disabled={createRelease.isPending || editRelease.isPending} onClick={closeReleaseDialog} type="button">Cancel</button><button className="primary-button sprint-create-submit-button" disabled={createRelease.isPending || editRelease.isPending || !draft.name.trim() || !draft.fixVersion.trim()} type="submit">{createRelease.isPending || editRelease.isPending ? `${editingRelease ? "Updating" : "Creating"} Release…` : editingRelease ? "Update Release" : <><AddIcon size={16} strokeWidth={2} /><span>Create release · {selectedStoryCount} Stories</span></>}</button></div>
          </form>
        </div>
      ) : null}
      {completionBlockedRelease ? (
        <DeliveryCompletionGuardDialog
          entityLabel="Release"
          entityName={completionBlockedRelease.name}
          incompleteStories={asArray(completionBlockedRelease.requirements).filter((story) => !isDeliveryStatusComplete(story.status)).map((story) => ({ id: story.id, displayId: story.display_id, title: story.title, status: story.status }))}
          onClose={() => setCompletionBlockedRelease(null)}
          totalStories={completionBlockedRelease.requirement_count || asArray(completionBlockedRelease.requirements).length}
        />
      ) : null}
      {releaseNotesRelease ? (
        <div className="modal-backdrop release-notes-backdrop" onClick={closeReleaseNotes} role="presentation">
          <section aria-labelledby="release-notes-title" aria-modal="true" className="modal-card release-notes-dialog" onClick={(event) => event.stopPropagation()} role="dialog">
            <header className="release-notes-dialog-header">
              <div>
                <span className="eyebrow">Audience-ready release communication</span>
                <h2 className="dialog-title" id="release-notes-title">{releaseNotesRelease.name} release notes</h2>
                <p>Delivered product changes are grouped into a readable narrative; validation evidence and known limitations remain explicit.</p>
              </div>
              <DialogCloseButton disabled={generateReleaseNotes.isPending} label="Close release notes" onClick={closeReleaseNotes} />
            </header>
            <div className="release-notes-dialog-body" aria-busy={generateReleaseNotes.isPending}>
              {generateReleaseNotes.isPending ? (
                <LoadingState label="Evaluating Release Stories and composing notes" />
              ) : generateReleaseNotes.isError ? (
                <div className="release-notes-error" role="alert">
                  <strong>Release notes could not be generated.</strong>
                  <span>{generateReleaseNotes.error instanceof Error ? generateReleaseNotes.error.message : "Try again after refreshing Release evidence."}</span>
                  <button className="primary-button" onClick={() => generateReleaseNotes.mutate(releaseNotesRelease.id)} type="button"><IconSparkles size={16} /><span>Try again</span></button>
                </div>
              ) : releaseNotes ? (
                <>
                  <section className="release-notes-hero">
                    <div><span>Version</span><strong>{releaseNotes.fix_version}</strong></div>
                    <div><span>Delivered changes</span><strong>{releaseNotes.scope_summary.delivered_changes}</strong></div>
                    <div><span>Change categories</span><strong>{releaseNotes.scope_summary.change_categories}</strong></div>
                    <div><span>Validation signal</span><strong>{releaseNotes.quality_summary.readiness_score === null ? "No runs" : `${releaseNotes.quality_summary.readiness_score}%`}</strong></div>
                  </section>
                  <section className="release-notes-summary-card"><span>What’s in this release</span><p>{releaseNotes.executive_summary}</p></section>
                  <div className="release-notes-change-grid">
                    {releaseNotes.change_groups.map((group) => <section className="release-notes-section tone-highlight" key={group.title}><h3>{group.title}</h3><ul>{group.items.map((item) => <li key={item}>{item}</li>)}</ul></section>)}
                  </div>
                  <div className="release-notes-columns">
                    <section className="release-notes-section tone-risk"><h3>Known limitations</h3><ul>{releaseNotes.known_limitations.map((item) => <li key={item}>{item}</li>)}</ul></section>
                    <section className="release-notes-section tone-validation"><h3>Validation summary</h3><p>{releaseNotes.validation_summary}</p></section>
                  </div>
                  <details className="release-notes-story-section">
                    <summary><div><h3>Traceable scope evidence</h3><span>{releaseNotes.story_evaluations.length} scoped Stories</span></div><span className="release-notes-generation-mode">{releaseNotes.generation_mode === "llm" ? "AI composed · evidence bounded" : "Evidence composed"}</span></summary>
                    <div className="release-notes-story-list">
                      {releaseNotes.story_evaluations.map((story) => <article className={`release-notes-story is-${story.health}`} key={story.id}><div><DisplayIdBadge value={story.id} /><strong>{story.title}</strong><StatusBadge value={story.status} /></div>{story.outcome ? <p className="release-notes-story-outcome">{story.outcome}</p> : null}<p>{story.summary}</p></article>)}
                    </div>
                  </details>
                </>
              ) : null}
            </div>
            <footer className="release-notes-dialog-footer">
              <span>{releaseNotes ? `Generated ${new Date(releaseNotes.generated_at).toLocaleString()}` : "Current linked evidence is evaluated at generation time."}</span>
              <div>
                {releaseNotes ? <button className="ghost-button" onClick={() => void copyReleaseNotes()} type="button"><IconCopy size={16} /><span>Copy notes</span></button> : null}
                <button className="primary-button" disabled={generateReleaseNotes.isPending} onClick={() => { setReleaseNotes(null); generateReleaseNotes.reset(); generateReleaseNotes.mutate(releaseNotesRelease.id); }} type="button"><IconSparkles size={16} /><span>Regenerate</span></button>
              </div>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}
