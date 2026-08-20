import {
  IconAlertTriangle,
  IconArrowRight,
  IconBuildingCommunity,
  IconCheck,
  IconCircleCheck,
  IconDatabase,
  IconExternalLink,
  IconLayoutDashboard,
  IconLoader2,
  IconRefresh,
  IconSearch,
  IconShieldCheck,
  IconSparkles
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ProjectActivationBatchResult,
  ProjectActivationProject,
  ProjectActivationResourceKind,
  ProjectActivationResourceResolutions,
  ProjectActivationSiteConflict,
  ProjectActivationSiteConflictCandidate,
  ProjectActivationSiteSnapshot
} from "../types";
import { BrandWordmark } from "./BrandWordmark";
import { LoadingState } from "./LoadingState";
import {
  durableActivationProgress,
  isFieldContextReviewRequired,
  isGlobalFieldContextReconciliationSignal,
  isInstallationScopeUpgradeRequired,
  isScreenFieldReconciliationSignal
} from "../lib/projectActivationPresentation";
import "./ProjectActivationScreen.css";
import "./ProjectActivationAdminScreen.css";

type ProjectActivationAdminScreenProps = {
  projects: ProjectActivationProject[];
  site?: ProjectActivationSiteSnapshot;
  bulkResult?: ProjectActivationBatchResult;
  isLoadingProjects: boolean;
  isLoadingSite: boolean;
  isRefreshing: boolean;
  isPreparing: boolean;
  isBulkSubmitting: boolean;
  projectsError?: unknown;
  siteError?: unknown;
  prepareError?: unknown;
  bulkError?: unknown;
  onPrepare: (resourceResolutions?: ProjectActivationResourceResolutions) => void;
  onBulkEnable: (projectIds: string[]) => void;
  onRefresh: () => void;
  onOpenProject: (projectId: string) => void;
};

type ProjectRowStatus =
  | "ready"
  | "queued"
  | "provisioning"
  | "failed"
  | "reconcilable"
  | "global-context-reconcilable"
  | "context-review"
  | "installation-upgrade"
  | "mapping"
  | "unsupported"
  | "inactive";

type NormalizedSiteConflict = ProjectActivationSiteConflict & {
  identity: string;
  resourceKind: ProjectActivationResourceKind | null;
  candidates: ProjectActivationSiteConflictCandidate[];
};

const resourceKinds: ProjectActivationResourceKind[] = ["issueTypes", "linkTypes", "fields", "screenSchemes"];

const emptyResourceResolutions = (): ProjectActivationResourceResolutions => ({
  issueTypes: {},
  linkTypes: {},
  fields: {},
  screenSchemes: {}
});

const normalizeResourceKind = (value: string): ProjectActivationResourceKind | null => {
  const normalized = String(value || "").replace(/[^a-z]/gi, "").toLowerCase();
  if (["issuetype", "issuetypes"].includes(normalized)) return "issueTypes";
  if (["linktype", "linktypes"].includes(normalized)) return "linkTypes";
  if (["field", "fields", "customfield", "customfields"].includes(normalized)) return "fields";
  if (["screen", "screens", "screenscheme", "screenschemes"].includes(normalized)) return "screenSchemes";
  return null;
};

const resourceKindLabel = (kind: ProjectActivationResourceKind | null) => {
  switch (kind) {
    case "issueTypes": return "Work type";
    case "linkTypes": return "Link type";
    case "fields": return "Custom field";
    case "screenSchemes": return "Screen resource";
    default: return "work-tracker resource";
  }
};

const humanizeLogicalKey = (value: string) => String(value || "Unknown resource")
  .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
  .replace(/[_-]+/g, " ")
  .replace(/\b\w/g, (character) => character.toUpperCase());

const normalizeSiteConflicts = (values: ProjectActivationSiteConflict[] = []): NormalizedSiteConflict[] => {
  const conflicts = new Map<string, NormalizedSiteConflict>();
  values.forEach((conflict, index) => {
    const resourceKind = normalizeResourceKind(conflict.resource_type);
    const logicalKey = String(conflict.logical_key || "").trim();
    const identity = resourceKind && logicalKey
      ? `${resourceKind}:${logicalKey}`
      : `unresolved:${conflict.resource_type || "unknown"}:${logicalKey || index}`;
    const candidatesById = new Map<string, ProjectActivationSiteConflictCandidate>();
    (conflict.candidates || []).forEach((candidate) => {
      const id = String(candidate?.id || "").trim();
      if (id) candidatesById.set(id, { ...candidate, id });
    });
    (conflict.candidate_ids || []).forEach((candidateId) => {
      const id = String(candidateId || "").trim();
      if (id && !candidatesById.has(id)) candidatesById.set(id, { id });
    });

    const existing = conflicts.get(identity);
    if (existing) {
      for (const candidate of candidatesById.values()) {
        const previous = existing.candidates.find((item) => item.id === candidate.id);
        if (previous) Object.assign(previous, candidate);
        else existing.candidates.push(candidate);
      }
      if (conflict.message) existing.message = conflict.message;
      return;
    }
    conflicts.set(identity, {
      ...conflict,
      logical_key: logicalKey,
      identity,
      resourceKind,
      candidates: [...candidatesById.values()]
    });
  });
  return [...conflicts.values()];
};

const errorMessage = (error: unknown) => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error.trim();
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message || "").trim();
  }
  return "";
};

const siteErrorMessage = (site?: ProjectActivationSiteSnapshot) => {
  if (!site?.error) return "";
  return typeof site.error === "string" ? site.error : site.error.message;
};

const projectErrorMessage = (project: ProjectActivationProject) => {
  if (!project.activation_error) return "";
  return typeof project.activation_error === "string"
    ? project.activation_error
    : String(project.activation_error.message || "");
};

const normalizedProjectStatus = (project: ProjectActivationProject): ProjectRowStatus => {
  const status = String(project.activation_status || "").toLowerCase();
  if (project.is_configured || status === "active" || status === "ready") return "ready";
  if (status === "queued") return "queued";
  if (status === "provisioning") return "provisioning";
  if (project.mapping_required || status === "needs-mapping" || status === "mapping-required") return "mapping";
  if ((status === "failed" || status === "blocked" || status === "needs-review")
    && isInstallationScopeUpgradeRequired(project.activation_error)) return "installation-upgrade";
  if ((status === "failed" || status === "blocked" || status === "needs-review")
    && isGlobalFieldContextReconciliationSignal(project.activation_error)) return "global-context-reconcilable";
  if ((status === "failed" || status === "blocked" || status === "needs-review")
    && isFieldContextReviewRequired(project.activation_error)) return "context-review";
  if ((status === "failed" || status === "blocked" || status === "needs-review")
    && isScreenFieldReconciliationSignal(project.activation_error)) return "reconcilable";
  if (status === "failed" || status === "blocked" || status === "needs-review") return "failed";
  if (
    project.archived
    || project.activation_supported === false
    || project.configuration_model === "team-managed"
    || project.simplified === true
  ) return "unsupported";
  return "inactive";
};

const canEnrollProject = (project: ProjectActivationProject) => {
  const status = normalizedProjectStatus(project);
  if (["ready", "queued", "provisioning", "mapping", "context-review", "installation-upgrade", "unsupported"].includes(status)) return false;
  if (project.can_bulk_enable === false) return false;
  return project.activation_supported === true
    && project.configuration_model !== "team-managed"
    && project.simplified !== true
    && !project.archived;
};

const siteStatusLabel = (site?: ProjectActivationSiteSnapshot, isReconciliationRecovery = false, isInstallationUpgrade = false) => {
  if (isInstallationUpgrade) return "App update required";
  if (isReconciliationRecovery) return "Ready to reconcile";
  switch (site?.status) {
    case "ready": return "Ready";
    case "queued": return "Queued";
    case "provisioning": return "Preparing";
    case "failed": return "Needs attention";
    case "needs-review": return "Review needed";
    case "not-prepared": return "Not prepared";
    default: return "Checking";
  }
};

const sitePhaseLabel = (phase?: string | null) => {
  const labels: Record<string, string> = {
    "issue-types": "Reconciling HelloTest work types",
    "link-types": "Reconciling traceability links",
    fields: "Reconciling canonical custom fields",
    screens: "Preparing shared screen resources",
    validation: "Validating the site schema",
    registry: "Saving the canonical schema registry",
    complete: "Finalizing site readiness"
  };
  return labels[String(phase || "")] || String(phase || "Preparing the connected site")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
};

const projectStatusCopy = (project: ProjectActivationProject) => {
  const status = normalizedProjectStatus(project);
  switch (status) {
    case "ready": return { label: "Enabled", detail: "Using the shared HelloTest schema" };
    case "queued": return { label: "Queued", detail: "Waiting for project setup" };
    case "provisioning": return { label: "Setting up", detail: "Project setup is continuing in the connected workspace" };
    case "reconcilable": return { label: "Safe to resume", detail: "Existing screen fields will be verified and reused" };
    case "global-context-reconcilable": return { label: "Safe to recheck", detail: "Compatible global context fallback will be reused read-only" };
    case "context-review": return { label: "workspace review", detail: "Field context ownership or scope must be reviewed before retrying" };
    case "installation-upgrade": return { label: "App update required", detail: "Approve HelloTest’s requested connected workspace access before resuming this project" };
    case "failed": return { label: "Needs attention", detail: projectErrorMessage(project) || "Safe to retry after reviewing the error" };
    case "mapping": return { label: "Mapping required", detail: "Choose the Story and Bug sources in this project" };
    case "unsupported": return {
      label: project.archived ? "Archived" : project.configuration_model === "team-managed" || project.simplified ? "Team-managed" : "Unavailable",
      detail: project.archived
        ? "Archived projects cannot be enrolled"
        : project.configuration_model === "team-managed" || project.simplified
          ? "Full connected workspace setup currently requires company-managed projects"
          : "This project type could not be safely verified"
    };
    default: return { label: "Not enabled", detail: "Ready for bulk enrollment" };
  }
};

export function ProjectActivationAdminScreen({
  projects,
  site,
  bulkResult,
  isLoadingProjects,
  isLoadingSite,
  isRefreshing,
  isPreparing,
  isBulkSubmitting,
  projectsError,
  siteError,
  prepareError,
  bulkError,
  onPrepare,
  onBulkEnable,
  onRefresh,
  onOpenProject
}: ProjectActivationAdminScreenProps) {
  const [search, setSearch] = useState("");
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(() => new Set());
  const [conflictSelections, setConflictSelections] = useState<Record<string, string>>({});
  const selectAllRef = useRef<HTMLInputElement>(null);
  const lastBulkResultRef = useRef<ProjectActivationBatchResult>();
  const siteReady = Boolean(site?.is_ready || site?.status === "ready");
  const siteInProgress = site?.status === "queued" || site?.status === "provisioning";
  // Reserve 100% for the durable site-ready state. Older stored progress and
  // delayed queue deliveries must never make setup look complete while Jira is
  // still being verified.
  const progress = durableActivationProgress(site?.progress?.percent, siteReady);
  const conflicts = useMemo(
    () => normalizeSiteConflicts(site?.conflicts || []),
    [site?.conflicts]
  );
  const siteScopeUpgradeRequired = Boolean(
    isInstallationScopeUpgradeRequired(site?.error)
    || isInstallationScopeUpgradeRequired(errorMessage(prepareError))
  );

  useEffect(() => {
    const validCandidates = new Map(conflicts.map((conflict) => [
      conflict.identity,
      new Set(conflict.candidates.map((candidate) => candidate.id))
    ]));
    setConflictSelections((current) => {
      const next = Object.fromEntries(Object.entries(current).filter(([identity, candidateId]) =>
        validCandidates.get(identity)?.has(candidateId)
      ));
      if (
        Object.keys(next).length === Object.keys(current).length
        && Object.entries(next).every(([key, value]) => current[key] === value)
      ) return current;
      return next;
    });
  }, [conflicts]);

  const conflictResolutionsComplete = conflicts.length > 0 && conflicts.every((conflict) =>
    Boolean(
      conflict.resourceKind
      && conflict.logical_key
      && conflict.candidates.some((candidate) => candidate.id === conflictSelections[conflict.identity])
    )
  );
  const unresolvedConflictCount = conflicts.filter((conflict) =>
    !conflictSelections[conflict.identity]
  ).length;
  const resourceResolutions = useMemo(() => {
    const resolutions = emptyResourceResolutions();
    for (const kind of resourceKinds) resolutions[kind] = {};
    for (const conflict of conflicts) {
      const candidateId = conflictSelections[conflict.identity];
      if (conflict.resourceKind && conflict.logical_key && candidateId) {
        resolutions[conflict.resourceKind][conflict.logical_key] = candidateId;
      }
    }
    return resolutions;
  }, [conflictSelections, conflicts]);

  const visibleProjects = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return projects;
    return projects.filter((project) =>
      project.name.toLowerCase().includes(query)
      || project.key.toLowerCase().includes(query)
    );
  }, [projects, search]);

  const eligibleProjects = useMemo(
    () => siteScopeUpgradeRequired ? [] : projects.filter(canEnrollProject),
    [projects, siteScopeUpgradeRequired]
  );
  const visibleEligibleProjects = useMemo(
    () => visibleProjects.filter(canEnrollProject),
    [visibleProjects]
  );
  const failedProjects = useMemo(
    () => projects.filter((project) => ["failed", "reconcilable", "global-context-reconcilable"].includes(normalizedProjectStatus(project)) && canEnrollProject(project)),
    [projects]
  );
  const summary = useMemo(() => projects.reduce((counts, project) => {
    const status = normalizedProjectStatus(project);
    if (status === "ready") counts.ready += 1;
    else if (status === "queued" || status === "provisioning") counts.inProgress += 1;
    else if (status === "failed" || status === "reconcilable" || status === "global-context-reconcilable" || status === "context-review" || status === "installation-upgrade" || status === "mapping") counts.attention += 1;
    else if (status === "unsupported") counts.unavailable += 1;
    return counts;
  }, { ready: 0, inProgress: 0, attention: 0, unavailable: 0 }), [projects]);

  useEffect(() => {
    const eligibleIds = new Set(eligibleProjects.map((project) => project.id));
    setSelectedProjectIds((current) => {
      const next = new Set([...current].filter((id) => eligibleIds.has(id)));
      if (next.size === current.size && [...next].every((id) => current.has(id))) return current;
      return next;
    });
  }, [eligibleProjects]);

  useEffect(() => {
    if (!bulkResult || lastBulkResultRef.current === bulkResult) return;
    lastBulkResultRef.current = bulkResult;
    setSelectedProjectIds(new Set());
  }, [bulkResult]);

  const allVisibleEligibleSelected = visibleEligibleProjects.length > 0
    && visibleEligibleProjects.every((project) => selectedProjectIds.has(project.id));
  const someVisibleEligibleSelected = visibleEligibleProjects.some((project) => selectedProjectIds.has(project.id));
  const allEligibleSelected = eligibleProjects.length > 0
    && eligibleProjects.every((project) => selectedProjectIds.has(project.id));

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someVisibleEligibleSelected && !allVisibleEligibleSelected;
    }
  }, [allVisibleEligibleSelected, someVisibleEligibleSelected]);

  const toggleProject = (projectId: string) => {
    setSelectedProjectIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelectedProjectIds((current) => {
      const next = new Set(current);
      if (allVisibleEligibleSelected) {
        visibleEligibleProjects.forEach((project) => next.delete(project.id));
      } else {
        visibleEligibleProjects.forEach((project) => next.add(project.id));
      }
      return next;
    });
  };

  const toggleAllEligible = () => {
    setSelectedProjectIds(allEligibleSelected
      ? new Set()
      : new Set(eligibleProjects.map((project) => project.id)));
  };

  const runBulkEnrollment = (projectIds: string[]) => {
    if (!projectIds.length || isBulkSubmitting || siteScopeUpgradeRequired) return;
    onBulkEnable(projectIds);
  };

  const applyConflictResolutions = () => {
    if (!conflictResolutionsComplete || isPreparing) return;
    onPrepare(resourceResolutions);
  };

  const siteVisibleError = errorMessage(prepareError) || siteErrorMessage(site) || errorMessage(siteError);
  const siteReconciliationRecovery = Boolean(
    !siteReady
    && site?.error
    && (typeof site.error === "string" || site.error.retryable !== false)
    && isScreenFieldReconciliationSignal(site.error)
  );
  const siteReconciliationEvidence = (site?.warnings || []).filter(isScreenFieldReconciliationSignal);
  const bulkVisibleError = errorMessage(bulkError);
  const resourceCounts = site?.resource_counts;
  const batchExceptions = bulkResult?.items.filter((item) =>
    ["rejected", "failed", "needs-mapping", "mapping-required"].includes(item.status)
  ) || [];
  const batchResultTitle = bulkResult
    ? bulkResult.accepted > 0
      ? `${bulkResult.accepted} project${bulkResult.accepted === 1 ? "" : "s"} accepted for setup`
      : bulkResult.already_ready > 0 && bulkResult.rejected === 0 && bulkResult.needs_mapping === 0
        ? `Selected project${bulkResult.already_ready === 1 ? " was" : "s were"} already ready`
        : "Project enrollment reviewed"
    : "";
  const enrollmentPendingLabel = siteReady
    ? "Starting projects…"
    : site?.status === "needs-review"
      ? "Review site choices above"
      : site?.status === "failed" && !isPreparing
        ? siteReconciliationRecovery ? "Ready to reconcile above" : "Repair site setup above"
        : "Preparing site…";

  return (
    <div className="project-activation-shell">
      <header className="project-activation-topbar">
        <BrandWordmark className="project-activation-brand" subtitle="Workspace administration" />
        <div className="project-activation-topbar-meta">
          <IconShieldCheck aria-hidden="true" size={16} stroke={1.9} />
          <span>Site schema once · projects enabled in safe batches</span>
        </div>
      </header>

      <main className="project-activation-main is-admin">
        <aside className="project-activation-intro" aria-labelledby="project-activation-admin-title">
          <span className="project-activation-intro-icon" aria-hidden="true">
            <IconBuildingCommunity size={46} stroke={1.65} />
          </span>
          <div>
            <p className="project-activation-kicker">HelloTest administration</p>
            <h1 id="project-activation-admin-title">Prepare once. Enable every project.</h1>
            <p>
              HelloTest reconciles one canonical work-item schema for this site, then enrolls selected company-managed projects without recreating fields.
            </p>
          </div>
        </aside>

        <div className="project-activation-admin-content">
          <section className="project-activation-card activation-site-card" aria-labelledby="activation-site-title">
            <div className="project-activation-card-head">
              <div>
                <span className="project-activation-card-label">Site foundation · automatic</span>
                <h2 id="activation-site-title">HelloTest shared schema</h2>
                <p>Canonical resources are prepared once and safely reused by every enrolled project.</p>
              </div>
              <span className={`project-activation-status is-${siteScopeUpgradeRequired ? "failed" : siteReconciliationRecovery ? "recovery" : site?.status || "checking"}`}>
                {siteStatusLabel(site, siteReconciliationRecovery, siteScopeUpgradeRequired)}
              </span>
            </div>

            {isLoadingSite && !site ? (
              <div className="activation-site-state">
                <LoadingState label="Checking the connected site" description="Looking for the HelloTest schema registry and managed resources." />
              </div>
            ) : siteError && !site ? (
              <div className="activation-site-state is-error" role="alert">
                <IconAlertTriangle aria-hidden="true" size={25} stroke={1.9} />
                <div>
                  <h3>Site readiness could not be checked</h3>
                  <p>{siteVisibleError || "HelloTest could not read the shared schema state."}</p>
                </div>
                <button className="ghost-button" disabled={isRefreshing} onClick={onRefresh} type="button">
                  <IconRefresh aria-hidden="true" size={16} />
                  Try again
                </button>
              </div>
            ) : isPreparing && !siteInProgress ? (
              <div className="activation-site-state is-requesting" aria-live="polite" role="status">
                <span className="project-activation-state-icon is-spinning" aria-hidden="true">
                  <IconLoader2 size={22} stroke={1.9} />
                </span>
                <div>
                  <h3>Starting safe schema reconciliation</h3>
                  <p>HelloTest is asking connected workspace to verify existing resources before background preparation begins.</p>
                </div>
              </div>
            ) : siteInProgress ? (
              <div className="activation-site-state is-progress" aria-live="polite" role="status">
                <div className="activation-site-progress-title">
                  <span className="project-activation-state-icon is-spinning" aria-hidden="true">
                    <IconLoader2 size={22} stroke={1.9} />
                  </span>
                  <div>
                    <h3>Preparing the shared HelloTest schema</h3>
                    <p>
                      {sitePhaseLabel(site?.phase)}. Existing fields and screen placements are verified and reused; this continues safely if you leave the page.
                    </p>
                  </div>
                  <strong>{progress}%</strong>
                </div>
                <div
                  aria-label={`Site schema preparation ${progress}% complete`}
                  aria-valuemax={100}
                  aria-valuemin={0}
                  aria-valuenow={progress}
                  className="project-activation-progress"
                  role="progressbar"
                >
                  <span style={{ width: `${progress}%` }} />
                </div>
              </div>
            ) : siteReady && !siteScopeUpgradeRequired ? (
              <div className="activation-site-state is-ready" role="status">
                <IconCircleCheck aria-hidden="true" size={28} stroke={1.9} />
                <div>
                  <h3>{siteReconciliationEvidence.length ? "Shared schema reconciled and ready" : "Shared schema is ready"}</h3>
                  <p>
                    {siteReconciliationEvidence.length
                      ? "Existing work-tracker resources and screen placements were adopted after exact-ID verification; no duplicate field was created."
                      : "Project enrollment now links verified HelloTest resources instead of finding or creating fields by name."}
                  </p>
                </div>
                <button className="ghost-button" disabled={isPreparing} onClick={() => onPrepare()} type="button">
                  <IconRefresh aria-hidden="true" size={16} />
                  {isPreparing ? "Checking…" : "Check for drift"}
                </button>
              </div>
            ) : (
              <div className={`activation-site-state ${siteReconciliationRecovery ? "is-recovery" : "is-warning"}`} role={siteVisibleError && !siteReconciliationRecovery ? "alert" : "status"}>
                {siteReconciliationRecovery
                  ? <IconRefresh aria-hidden="true" size={27} stroke={1.9} />
                  : site?.status === "failed" || site?.status === "needs-review"
                  ? <IconAlertTriangle aria-hidden="true" size={27} stroke={1.9} />
                  : <IconDatabase aria-hidden="true" size={27} stroke={1.8} />}
                <div>
                  <h3>
                    {siteScopeUpgradeRequired
                      ? "Approve HelloTest’s updated connected workspace access"
                      : siteReconciliationRecovery
                      ? "Existing work-item screen assignment found"
                      : site?.status === "needs-review"
                      ? "Schema reconciliation needs review"
                      : site?.status === "failed"
                        ? "Schema preparation needs attention"
                        : "Prepare the HelloTest schema for this site"}
                  </h3>
                  <p>
                    {siteScopeUpgradeRequired
                      ? "Connected workspace rejected a configuration write because this installation has not been granted the access requested by the current deployment. Repeated setup retries cannot grant app access."
                      : siteReconciliationRecovery
                      ? "HelloTest can verify and adopt the existing field placement, then continue from the saved checkpoint without adding the field again."
                      : siteVisibleError || "HelloTest will create or adopt verified resources, record their canonical IDs, and leave ambiguous customer-owned resources unchanged."}
                  </p>
                </div>
                {!siteScopeUpgradeRequired && site?.status === "needs-review" && conflicts.length ? (
                  <span className="activation-resolution-required">
                    Choose canonical IDs below
                    <IconArrowRight aria-hidden="true" size={16} />
                  </span>
                ) : (
                  <button className="primary-button" disabled={isPreparing} onClick={() => onPrepare()} type="button">
                    <IconShieldCheck aria-hidden="true" size={17} />
                    {isPreparing
                      ? "Starting…"
                      : siteScopeUpgradeRequired
                        ? "Resume after access update"
                      : site?.status === "failed" || site?.status === "needs-review"
                        ? siteReconciliationRecovery ? "Reconcile & continue" : "Repair site schema"
                        : "Prepare site schema"}
                  </button>
                )}
              </div>
            )}

            {conflicts.length ? (
              <section className="activation-conflict-panel" aria-labelledby="activation-conflict-title">
                <div className="activation-conflict-head">
                  <div>
                    <span className="project-activation-card-label">Canonical resource resolution</span>
                    <h3 id="activation-conflict-title">Choose the work item ID HelloTest should keep using</h3>
                    <p>
                      Existing HelloTest records reference different resources. Select one canonical ID for each item; unselected work-tracker resources are not changed or deleted.
                    </p>
                  </div>
                  <span>{conflicts.length} conflict{conflicts.length === 1 ? "" : "s"}</span>
                </div>

                <div className="activation-conflict-list">
                  {conflicts.map((conflict) => {
                    const selectedId = conflictSelections[conflict.identity] || "";
                    const selectedCandidate = conflict.candidates.find((candidate) => candidate.id === selectedId);
                    const canResolve = Boolean(conflict.resourceKind && conflict.logical_key && conflict.candidates.length);
                    return (
                      <div className={`activation-conflict-row${canResolve ? "" : " is-invalid"}`} key={conflict.identity}>
                        <div className="activation-conflict-copy">
                          <span>{resourceKindLabel(conflict.resourceKind)}</span>
                          <strong>{humanizeLogicalKey(conflict.logical_key)}</strong>
                          <p>{conflict.message}</p>
                        </div>
                        <label>
                          <span>Canonical work item ID</span>
                          <select
                            aria-label={`Canonical work item ID for ${humanizeLogicalKey(conflict.logical_key)}`}
                            disabled={!canResolve || isPreparing}
                            onChange={(event) => setConflictSelections((current) => ({
                              ...current,
                              [conflict.identity]: event.target.value
                            }))}
                            value={selectedId}
                          >
                            <option value="">Select a verified resource</option>
                            {conflict.candidates.map((candidate) => (
                              <option key={candidate.id} value={candidate.id}>
                                {candidate.name ? `${candidate.name} — ` : ""}{candidate.id}
                              </option>
                            ))}
                          </select>
                        </label>
                        {selectedCandidate ? (
                          <div className="activation-conflict-evidence" role="note">
                            <code>{selectedCandidate.id}</code>
                            {selectedCandidate.type ? <span>Type: {selectedCandidate.type}</span> : null}
                            {selectedCandidate.references ? <span>Referenced by {selectedCandidate.references} HelloTest registries</span> : null}
                            {selectedCandidate.description ? <p>{selectedCandidate.description}</p> : null}
                          </div>
                        ) : !canResolve ? (
                          <div className="activation-conflict-evidence is-error" role="alert">
                            <span>HelloTest did not receive enough candidate data to resolve this item. Refresh the site check before continuing.</span>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>

                <div className="activation-conflict-actions">
                  <div>
                    <IconShieldCheck aria-hidden="true" size={18} />
                    <span>
                      {conflictResolutionsComplete
                        ? "All canonical IDs selected. HelloTest can safely continue schema preparation."
                        : `${unresolvedConflictCount} selection${unresolvedConflictCount === 1 ? "" : "s"} remaining.`}
                    </span>
                  </div>
                  <button
                    className="primary-button"
                    disabled={!conflictResolutionsComplete || isPreparing}
                    onClick={applyConflictResolutions}
                    type="button"
                  >
                    {isPreparing
                      ? <IconLoader2 aria-hidden="true" className="is-spinning" size={17} />
                      : <IconCheck aria-hidden="true" size={17} />}
                    {isPreparing ? "Applying selections…" : "Apply selections & continue"}
                  </button>
                </div>
              </section>
            ) : null}

            {resourceCounts ? (
              <div className="activation-resource-strip" aria-label="Shared schema resources">
                <span><strong>{resourceCounts.issue_types}</strong> work types</span>
                <span><strong>{resourceCounts.link_types}</strong> link types</span>
                <span><strong>{resourceCounts.fields}</strong> canonical fields</span>
                <span><strong>{resourceCounts.screen_schemes}</strong> screen resources</span>
                {site?.warning_count ? <span className="is-warning"><strong>{site.warning_count}</strong> warnings</span> : null}
              </div>
            ) : null}
          </section>

          <section className="project-activation-card activation-projects-card" aria-labelledby="activation-projects-title">
            <div className="project-activation-card-head activation-projects-head">
              <div>
                <span className="project-activation-card-label">Project enrollment</span>
                <h2 id="activation-projects-title">Enable projects</h2>
                <p>Choose all eligible projects once. Already-ready projects are preserved and safe retries resume incomplete work.</p>
              </div>
              <div className="activation-project-summary" aria-label="Project activation summary">
                <span className="is-ready"><strong>{summary.ready}</strong> enabled</span>
                <span><strong>{summary.inProgress}</strong> in progress</span>
                <span className={summary.attention ? "is-attention" : ""}><strong>{summary.attention}</strong> attention</span>
              </div>
            </div>

            {!siteReady ? (
              <div className={`activation-prerequisite-note${siteScopeUpgradeRequired ? "" : " is-automatic"}`} role="note">
                {siteScopeUpgradeRequired
                  ? <IconShieldCheck aria-hidden="true" size={18} stroke={1.8} />
                  : <IconDatabase aria-hidden="true" size={18} stroke={1.8} />}
                <div>
                  <strong>{siteScopeUpgradeRequired ? "Update app access before enrolling projects" : "Site preparation is included"}</strong>
                  <span>{siteScopeUpgradeRequired
                    ? "Deployment owner: publish the current manifest. connected site admin: update HelloTest in Apps → Manage your apps and approve the requested access. Existing checkpoints are preserved."
                    : "Select projects and choose Enable. HelloTest prepares the shared foundation first, then enrolls your selection automatically."}</span>
                </div>
              </div>
            ) : null}

            {bulkResult ? (
              <div className="activation-batch-result" aria-live="polite" role="status">
                <IconSparkles aria-hidden="true" size={19} stroke={1.8} />
                <div>
                  <strong>{batchResultTitle}</strong>
                  <span>
                    {bulkResult.already_ready} already ready · {bulkResult.needs_mapping} need mapping · {bulkResult.rejected} rejected
                  </span>
                  {batchExceptions.slice(0, 3).map((item) => (
                    <em key={`${item.project_id}-${item.status}`}>{item.project_key || item.project_id}: {item.message || item.status.replace(/-/g, " ")}</em>
                  ))}
                </div>
              </div>
            ) : null}

            {bulkVisibleError ? (
              <div className="activation-inline-alert" role="alert">
                <IconAlertTriangle aria-hidden="true" size={18} />
                <span>{bulkVisibleError}</span>
              </div>
            ) : null}

            <div className="activation-project-toolbar">
              <label className="activation-project-search">
                <IconSearch aria-hidden="true" size={17} />
                <span className="sr-only">Search projects</span>
                <input
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search by project name or key"
                  type="search"
                  value={search}
                />
              </label>
              <div className="activation-project-actions">
                <button
                  className="ghost-button"
                  disabled={!eligibleProjects.length || isBulkSubmitting}
                  onClick={toggleAllEligible}
                  type="button"
                >
                  <IconCheck aria-hidden="true" size={16} />
                  {allEligibleSelected ? "Clear selection" : `Select all eligible (${eligibleProjects.length})`}
                </button>
                {failedProjects.length ? (
                  <button
                    className="ghost-button"
                    disabled={isBulkSubmitting}
                    onClick={() => runBulkEnrollment(failedProjects.map((project) => project.id))}
                    type="button"
                  >
                    <IconRefresh aria-hidden="true" size={16} />
                    Retry failed ({failedProjects.length})
                  </button>
                ) : null}
                <button
                  className="primary-button"
                  disabled={!selectedProjectIds.size || isBulkSubmitting}
                  onClick={() => runBulkEnrollment([...selectedProjectIds])}
                  type="button"
                >
                  {isBulkSubmitting
                    ? <IconLoader2 aria-hidden="true" className="is-spinning" size={17} />
                    : <IconShieldCheck aria-hidden="true" size={17} />}
                  {isBulkSubmitting
                    ? enrollmentPendingLabel
                    : `Enable selected${selectedProjectIds.size ? ` (${selectedProjectIds.size})` : ""}`}
                </button>
              </div>
            </div>

            {isLoadingProjects ? (
              <div className="activation-projects-loading">
                <LoadingState label="Loading projects" description="Checking configuration model and activation status." />
              </div>
            ) : projectsError ? (
              <div className="activation-projects-empty" role="alert">
                <IconAlertTriangle aria-hidden="true" size={25} />
                <h3>Projects could not be loaded</h3>
                <p>{errorMessage(projectsError) || "Refresh the page or verify project access."}</p>
                <button className="ghost-button" disabled={isRefreshing} onClick={onRefresh} type="button">
                  <IconRefresh aria-hidden="true" size={16} />
                  Try again
                </button>
              </div>
            ) : !projects.length ? (
              <div className="activation-projects-empty" role="status">
                <IconLayoutDashboard aria-hidden="true" size={25} />
                <h3>No accessible projects</h3>
                <p>Ask a workspace administrator to grant project access, then refresh this page.</p>
              </div>
            ) : !visibleProjects.length ? (
              <div className="activation-projects-empty" role="status">
                <IconSearch aria-hidden="true" size={25} />
                <h3>No projects match “{search}”</h3>
                <p>Try a project key or a shorter project name.</p>
                <button className="ghost-button" onClick={() => setSearch("")} type="button">Clear search</button>
              </div>
            ) : (
              <div className="activation-project-table-wrap">
                <table className="activation-project-table">
                  <thead>
                    <tr>
                      <th className="activation-checkbox-cell" scope="col">
                        <input
                          aria-label="Select all eligible visible projects"
                          checked={allVisibleEligibleSelected}
                          disabled={!visibleEligibleProjects.length || isBulkSubmitting}
                          onChange={toggleAllVisible}
                          ref={selectAllRef}
                          type="checkbox"
                        />
                      </th>
                      <th scope="col">Project</th>
                      <th scope="col">Configuration</th>
                      <th scope="col">HelloTest status</th>
                      <th scope="col">Details</th>
                      <th aria-label="Project actions" scope="col" />
                    </tr>
                  </thead>
                  <tbody>
                    {visibleProjects.map((project) => {
                      const status = normalizedProjectStatus(project);
                      const statusCopy = projectStatusCopy(project);
                      const canEnroll = !siteScopeUpgradeRequired && canEnrollProject(project);
                      const isSelected = selectedProjectIds.has(project.id);
                      return (
                        <tr className={isSelected ? "is-selected" : ""} key={project.id}>
                          <td className="activation-checkbox-cell" data-label="Select">
                            <input
                              aria-label={`Select ${project.name}`}
                              checked={isSelected}
                              disabled={!canEnroll || isBulkSubmitting}
                              onChange={() => toggleProject(project.id)}
                              type="checkbox"
                            />
                          </td>
                          <th data-label="Project" scope="row">
                            <strong>{project.name}</strong>
                            <span>{project.key}</span>
                          </th>
                          <td data-label="Configuration">
                            <span className={`activation-model-badge is-${status === "unsupported" ? "unavailable" : "company"}`}>
                              {project.configuration_model === "team-managed" || project.simplified
                                ? "Team-managed"
                                : project.archived
                                  ? "Archived"
                                  : "Company-managed"}
                            </span>
                          </td>
                          <td data-label="HelloTest status">
                            <span className={`activation-row-status is-${status}`}>
                              {status === "ready" ? <IconCheck aria-hidden="true" size={14} /> : null}
                              {status === "queued" || status === "provisioning" ? <IconLoader2 aria-hidden="true" className="is-spinning" size={14} /> : null}
                              {statusCopy.label}
                            </span>
                          </td>
                          <td className="activation-project-detail" data-label="Details" title={statusCopy.detail}>
                            {statusCopy.detail}
                          </td>
                          <td className="activation-project-row-action">
                            {status === "ready" || status === "mapping" || status === "context-review" || status === "installation-upgrade" ? (
                              <button className="activation-link-button" onClick={() => onOpenProject(project.id)} type="button">
                                {status === "ready" ? "Open" : status === "context-review" ? "Review" : status === "installation-upgrade" ? "Resolve" : "Configure"}
                                <IconExternalLink aria-hidden="true" size={14} />
                              </button>
                            ) : (status === "failed" || status === "reconcilable" || status === "global-context-reconcilable") && canEnroll ? (
                              <button
                                className="activation-link-button"
                                disabled={isBulkSubmitting}
                                onClick={() => runBulkEnrollment([project.id])}
                                type="button"
                              >
                                {status === "global-context-reconcilable" ? "Recheck" : status === "reconcilable" ? "Resume" : "Retry"}
                                <IconRefresh aria-hidden="true" size={14} />
                              </button>
                            ) : canEnroll ? (
                              <button className="activation-link-button" onClick={() => toggleProject(project.id)} type="button">
                                {isSelected ? "Selected" : "Select"}
                                {isSelected ? <IconCheck aria-hidden="true" size={14} /> : <IconArrowRight aria-hidden="true" size={14} />}
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="activation-project-table-footer">
              <span>
                {eligibleProjects.length} eligible · {summary.unavailable} unavailable
                {search ? ` · ${visibleProjects.length} shown` : ""}
              </span>
              <button className="activation-link-button" disabled={isRefreshing} onClick={onRefresh} type="button">
                <IconRefresh aria-hidden="true" size={14} />
                {isRefreshing ? "Refreshing…" : "Refresh status"}
              </button>
            </div>
          </section>

          <div className="activation-admin-safety-note" role="note">
            <IconShieldCheck aria-hidden="true" size={20} stroke={1.8} />
            <div>
              <strong>Safe by default</strong>
              <span>HelloTest reuses verified resources and already-enabled projects, resumes partial setup, and stops for review instead of modifying ambiguous or customer-owned work-tracker resources.</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
