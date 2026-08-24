import { Fragment, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { IconBug, IconChartBar, IconCheck, IconChecklist, IconChevronDown, IconChevronRight, IconExternalLink, IconFlagCheck, IconPlayerPlay, IconTargetArrow, IconTrash } from "@tabler/icons-react";
import { useAuth } from "../auth/AuthContext";
import { AddIcon, ReleaseIcon, SearchIcon, SprintIcon, StoryIcon } from "../components/AppIcons";
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
import { TileCardFact } from "../components/TileCardPrimitives";
import { ToastMessage } from "../components/ToastMessage";
import { useCurrentProject } from "../hooks/useCurrentProject";
import { api } from "../lib/api";
import { asArray } from "../lib/collectionGuards";
import { isDeliveryStatusComplete, summarizeDeliveryCompletion } from "../lib/deliveryStatus";
import { hasPermission } from "../lib/permissions";
import type { Requirement, RequirementIteration, RequirementRelease, RequirementReleaseReadiness } from "../types";
import "./ReleasesPage.css";

type ReleaseDraft = {
  name: string;
  description: string;
  fixVersion: string;
  targetDateLabel: string;
  targetDate: string;
  externalLink: string;
  sprintIds: string[];
  requirementIds: string[];
};

const emptyDraft = (): ReleaseDraft => ({
  name: "", description: "", fixVersion: "", targetDateLabel: "Release target date",
  targetDate: "", externalLink: "", sprintIds: [], requirementIds: []
});

const formatDate = (value?: string | null) => value
  ? new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value))
  : "No target date";

const storyCompletionFor = (release: RequirementRelease) => {
  const scopedStories = asArray(release.requirements);
  const total = Math.max(release.requirement_count || 0, scopedStories.length);
  const completed = summarizeDeliveryCompletion(scopedStories).completed;
  return { completed, total, percent: total ? Math.round((completed / total) * 100) : 0 };
};

const readinessLabel = (readiness?: RequirementReleaseReadiness) => {
  if (!readiness) return "Evidence loading";
  if (!readiness.total_stories) return "Scope needed";
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
  const [draft, setDraft] = useState<ReleaseDraft>(emptyDraft);
  const [storySearch, setStorySearch] = useState("");
  const [releaseSearch, setReleaseSearch] = useState("");
  const [releaseStateFilter, setReleaseStateFilter] = useState("all");
  const [releaseViewMode, setReleaseViewMode] = useState<"tile" | "list">("tile");
  const [selectedReleaseIds, setSelectedReleaseIds] = useState<string[]>([]);
  const [completionBlockedRelease, setCompletionBlockedRelease] = useState<RequirementRelease | null>(null);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const { confirmDelete, confirmationDialog } = useDeleteConfirmation();
  const canCreate = hasPermission(session, "requirement_iteration.create");
  const canUpdate = hasPermission(session, "requirement_iteration.update");
  const canDelete = hasPermission(session, "requirement_iteration.delete");

  const releasesQuery = useQuery({
    queryKey: ["requirement-releases", projectId],
    queryFn: () => api.requirementReleases.list({ project_id: projectId }),
    enabled: Boolean(projectId)
  });
  const releases = asArray(releasesQuery.data);
  const releaseReadinessQuery = useQuery({
    queryKey: ["requirement-release-readiness", "project", projectId],
    queryFn: () => api.requirementReleases.listReadiness({ project_id: projectId }),
    enabled: Boolean(projectId),
    staleTime: 30_000
  });
  const sprintsQuery = useQuery({
    queryKey: ["requirement-iterations", projectId],
    queryFn: () => api.requirementIterations.list({ project_id: projectId }),
    enabled: Boolean(projectId)
  });
  const storiesQuery = useQuery({
    queryKey: ["release-story-picker", projectId],
    queryFn: () => api.requirements.list({ project_id: projectId, limit: 5000, projection: "summary" }),
    enabled: Boolean(projectId)
  });
  const createRelease = useMutation({ mutationFn: api.requirementReleases.create });
  const updateRelease = useMutation({ mutationFn: ({ id, state }: { id: string; state: "in_progress" | "released" }) => api.requirementReleases.update(id, { state }) });
  const deleteRelease = useMutation({ mutationFn: api.requirementReleases.delete });

  const sprints = asArray(sprintsQuery.data);
  const stories = asArray(storiesQuery.data);
  const readinessByReleaseId = useMemo(() => new Map<string, RequirementReleaseReadiness>(
    asArray(releaseReadinessQuery.data).map((readiness) => [readiness.release_id, readiness])
  ), [releaseReadinessQuery.data]);
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
  const portfolioReadiness = [...readinessByReleaseId.values()];
  const isReadinessLoading = releaseReadinessQuery.isPending;
  const releaseReadyCount = portfolioReadiness.filter((item) => item.total_stories > 0 && item.readiness_state === "ready").length;
  const atRiskCount = releases.filter((release) => {
    if (release.persisted_state === "released") return false;
    const readiness = readinessByReleaseId.get(release.id);
    return release.state === "overdue" || Boolean(readiness?.total_stories && readiness.readiness_state !== "ready");
  }).length;
  const releaseStoryCompletion = releases.reduce((summary, release) => {
    const completion = storyCompletionFor(release);
    return { completed: summary.completed + completion.completed, total: summary.total + completion.total };
  }, { completed: 0, total: 0 });
  const portfolioCompletionPercent = releaseStoryCompletion.total
    ? Math.round((releaseStoryCompletion.completed / releaseStoryCompletion.total) * 100)
    : 0;
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
  const saveRelease = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!projectId || !draft.name.trim() || !draft.fixVersion.trim()) return;
    try {
      const response = await createRelease.mutateAsync({
        project_id: projectId,
        name: draft.name.trim(),
        description: draft.description,
        fix_version: draft.fixVersion.trim(),
        target_date_label: draft.targetDateLabel.trim() || "Release target date",
        target_date: draft.targetDate ? new Date(draft.targetDate).toISOString() : undefined,
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
      setMessage(error instanceof Error ? error.message : "Unable to create release");
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
        <div className="requirement-sprint-copy">
          <div className="requirement-sprint-heading">
            <strong>{release.name}</strong>
            <span className={`requirement-sprint-status is-${releaseStateClass(release)}`}>{release.state.replace("_", " ")}</span>
          </div>
          <div className="requirement-sprint-meta">
            <span className="requirement-sprint-dates">{release.fix_version}</span>
            <span>{release.target_date_label || "Release target date"}: {formatDate(release.target_date)}</span>
            <span>{release.sprint_ids.length} {release.sprint_ids.length === 1 ? "Sprint" : "Sprints"}</span>
          </div>
          {description ? <span className="requirement-sprint-goal" title={description}>{description}</span> : null}
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
            value: readiness ? `${readiness.readiness_score}%` : "Loading…",
            tone: readiness?.readiness_state === "ready" ? "success" : readiness?.readiness_state === "at_risk" ? "warning" : "danger",
            title: readinessLabel(readiness)
          },
          {
            icon: <IconCheck aria-hidden="true" size={13} stroke={1.8} />,
            label: "Story completion",
            value: `${completion.percent}%`,
            tone: completion.percent === 100 && completion.total > 0 ? "success" : "neutral",
            title: `${completion.completed}/${completion.total} scoped Stories are QA done.`
          },
          {
            icon: <IconChecklist aria-hidden="true" size={13} stroke={1.8} />,
            label: "Test coverage",
            value: readiness ? `${readiness.test_coverage_percent ?? 0}%` : "Loading…",
            tone: (readiness?.test_coverage_percent ?? 0) >= 80 ? "success" : "warning",
            title: readiness ? `${readiness.covered_stories}/${readiness.total_stories} scoped Stories have linked test coverage.` : "Loading release test evidence."
          },
          {
            icon: <IconBug aria-hidden="true" size={13} stroke={1.8} />,
            label: "Open Bugs",
            value: readiness ? String(readiness.open_bugs) : "Loading…",
            tone: readiness?.open_bugs ? "danger" : "success",
            title: readiness ? `${readiness.open_bugs} open Bugs across ${readiness.total_bugs} total Bugs.` : "Loading release Bug evidence."
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
      <button aria-label={`Open readiness board for ${release.name}`} className="ghost-button compact release-readiness-button" onClick={() => openReleaseReadiness(release)} title="Open release readiness board" type="button"><IconChartBar size={16} /></button>
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
  const renderReleaseStoryTile = (story: Requirement) => (
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
          <StatusBadge value={story.status || "open"} />
        </div>
        <div className="tile-card-header requirement-tile-header"><div className="tile-card-title-group"><strong>{story.title}</strong></div></div>
        <CatalogCardDescription fallback="No Story description captured yet." profile="story" value={story.description} />
        <div className="tile-card-facts" aria-label={`${story.title} facts`}>
          <TileCardFact label={`P${story.priority ?? 3}`} title={`Priority P${story.priority ?? 3}`} tone={(story.priority ?? 3) <= 2 ? "danger" : "info"}><IconTargetArrow size={15} /></TileCardFact>
          <TileCardFact label={story.sprint || "No Sprint"} title={story.sprint ? `Included through Sprint ${story.sprint}` : "Direct Release scope without a Sprint"} tone={story.sprint ? "info" : "neutral"}><SprintIcon size={14} /></TileCardFact>
          <TileCardFact label={story.fix_version || "Version pending"} title={story.fix_version ? `Fix Version ${story.fix_version}` : "No Fix Version stamped"} tone={story.fix_version ? "success" : "warning"}><ReleaseIcon size={14} /></TileCardFact>
        </div>
      </div>
    </article>
  );
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
          { label: "Release ready", value: isReadinessLoading ? "Loading…" : releaseReadyCount },
          { label: "Overdue", value: releases.filter((item) => item.state === "overdue").length }
        ]}
      />
      <section aria-busy={isReadinessLoading} aria-label="Release portfolio health" className="release-portfolio-grid">
        <article className="release-portfolio-card tone-scope"><span>Total releases</span><strong>{releases.length}</strong><small>{releases.filter((item) => item.persisted_state === "planned").length} planned</small></article>
        <article className="release-portfolio-card tone-active"><span>In progress</span><strong>{releases.filter((item) => item.state === "in_progress").length}</strong><small>Actively moving toward a target</small></article>
        <article className="release-portfolio-card tone-ready"><span>Release ready</span><strong>{isReadinessLoading ? "—" : releaseReadyCount}</strong><small>{isReadinessLoading ? "Loading quality evidence…" : "Quality evidence meets the readiness policy"}</small></article>
        <article className="release-portfolio-card tone-risk"><span>At risk</span><strong>{isReadinessLoading ? "—" : atRiskCount}</strong><small>{isReadinessLoading ? "Evaluating schedule and quality…" : "Schedule or quality evidence needs action"}</small></article>
        <article className="release-portfolio-card tone-overdue"><span>Overdue</span><strong>{releases.filter((item) => item.state === "overdue").length}</strong><small>Open releases beyond their target date</small></article>
        <article className="release-portfolio-card tone-completion"><span>Story completion</span><strong>{portfolioCompletionPercent}%</strong><small>{releaseStoryCompletion.completed}/{releaseStoryCompletion.total} scoped Stories QA done</small></article>
      </section>

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
                <button className="primary-button catalog-selection-button" disabled={!canCreate} onClick={() => setIsCreateOpen(true)} type="button"><ReleaseIcon size={18} /><span>Create release</span></button>
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
        <div className="modal-backdrop sprint-create-backdrop release-create-backdrop" onClick={() => setIsCreateOpen(false)} role="presentation">
          <form aria-labelledby="create-release-title" aria-modal="true" className="modal-card requirement-create-modal-card sprint-create-dialog sprint-new-dialog release-create-dialog" onClick={(event) => event.stopPropagation()} onSubmit={saveRelease} role="dialog">
            <div className="requirement-create-modal-header sprint-create-dialog-header">
              <div className="requirement-create-modal-title"><span className="eyebrow">Release planning</span><h2 className="dialog-title" id="create-release-title">Create release</h2><p>Select Sprints to carry their complete Story scope, then add any direct Stories needed for this version.</p></div>
              <DialogCloseButton label="Close create release" onClick={() => setIsCreateOpen(false)} />
            </div>
            <div className="requirement-create-modal-body requirement-create-modal-body--stacked sprint-create-dialog-body">
              <div className="iteration-create-layout release-create-layout">
                <section className="iteration-create-details-card sprint-create-plan-card release-create-plan-card">
                  <div className="sprint-create-section-heading"><div><strong>Release plan</strong><span>Version identity, target, and delivery intent.</span></div></div>
                  <div className="release-create-grid">
                    <FormField label="Release name" required><input autoFocus data-autofocus="true" required value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Enter release name" /></FormField>
                    <FormField label="Fix Version" required><input required value={draft.fixVersion} onChange={(event) => setDraft((current) => ({ ...current, fixVersion: event.target.value }))} placeholder="For example 2026.08" /></FormField>
                    <FormField label="Target date label"><input value={draft.targetDateLabel} onChange={(event) => setDraft((current) => ({ ...current, targetDateLabel: event.target.value }))} /></FormField>
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
            <div className="action-row requirement-create-modal-actions sprint-create-dialog-footer"><button className="ghost-button sprint-create-cancel-button" disabled={createRelease.isPending} onClick={() => setIsCreateOpen(false)} type="button">Cancel</button><button className="primary-button sprint-create-submit-button" disabled={createRelease.isPending || !draft.name.trim() || !draft.fixVersion.trim()} type="submit">{createRelease.isPending ? "Creating Release…" : <><AddIcon size={16} strokeWidth={2} /><span>Create release · {selectedStoryCount} Stories</span></>}</button></div>
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
    </div>
  );
}
