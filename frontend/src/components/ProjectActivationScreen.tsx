import {
  IconAlertTriangle,
  IconArrowRight,
  IconCircle,
  IconCircleCheck,
  IconDatabase,
  IconLayoutDashboard,
  IconLink,
  IconLoader2,
  IconRefresh,
  IconShieldCheck,
  IconSparkles
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { BrandWordmark } from "./BrandWordmark";
import { LoadingState } from "./LoadingState";
import {
  durableActivationProgress,
  isFieldContextReviewRequired,
  isGlobalFieldContextReconciliationSignal,
  isInstallationScopeUpgradeRequired,
  isScreenFieldReconciliationSignal
} from "../lib/projectActivationPresentation";
import type {
  ProjectActivationProject,
  ProjectActivationSnapshot,
  ProjectActivationSourceMapping
} from "../types";
import "./ProjectActivationScreen.css";

type ProjectActivationScreenProps = {
  projects: ProjectActivationProject[];
  projectId: string;
  snapshot?: ProjectActivationSnapshot;
  isAdminConfig: boolean;
  isLoadingProjects: boolean;
  isLoadingStatus: boolean;
  isRefreshing: boolean;
  isSubmitting: boolean;
  projectsError?: unknown;
  statusError?: unknown;
  submitError?: unknown;
  showReadyConfirmation: boolean;
  onProjectChange: (projectId: string) => void;
  onEnable: (sourceMapping?: ProjectActivationSourceMapping) => void;
  onRefresh: () => void;
  onOpenWorkspace: () => void;
};

const activationSteps = [
  { label: "Verify connected workspace eligibility", icon: IconShieldCheck },
  { label: "Apply default features", icon: IconSparkles },
  { label: "Prepare HelloTest schema", icon: IconDatabase },
  { label: "Connect project screens", icon: IconLayoutDashboard },
  { label: "Validate the workspace", icon: IconLink }
] as const;

type ActivationStepState = "complete" | "current" | "waiting";

const activationStepStates = (snapshot?: ProjectActivationSnapshot): ActivationStepState[] => {
  if (snapshot?.status === "active") return activationSteps.map(() => "complete");
  if (snapshot?.status !== "queued" && snapshot?.status !== "provisioning") {
    return activationSteps.map(() => "waiting");
  }

  const phase = String(snapshot.phase || "issue-types");
  if (["validation", "registry", "complete"].includes(phase)) {
    return ["complete", "complete", "complete", "complete", "current"];
  }
  if (["screens", "project-schemes", "project-properties"].includes(phase)) {
    return ["complete", "complete", "complete", "current", "waiting"];
  }
  return ["complete", "complete", "current", "waiting", "waiting"];
};

const featurePolicyMessage = /feature[\s_-]+(?:policy|availability)|deployment[-_ ]managed|qaira\.data\.feature-flags\.v1/i;
const errorMessage = (error: unknown) => error instanceof Error
  ? error.message
  : String(error || "").trim();

const phaseLabels: Record<string, string> = {
  "issue-types": "Creating HelloTest work types",
  "link-types": "Connecting traceability links",
  fields: "Preparing HelloTest fields",
  screens: "Building project screens",
  "project-schemes": "Connecting work-item schemes",
  "project-properties": "Initializing workspace data",
  validation: "Validating work-item create forms",
  registry: "Finalizing the workspace",
  complete: "Finalizing the ready state"
};

const humanizePhase = (value?: string | null) => phaseLabels[String(value || "")]
  || String(value || "Preparing project")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());

const statusLabel = (snapshot?: ProjectActivationSnapshot) => {
  switch (snapshot?.status) {
    case "active": return "Ready";
    case "queued": return "Queued";
    case "provisioning": return snapshot.error?.automatic_retry ? "Retrying" : "Setting up";
    case "failed": return "Needs attention";
    case "blocked": return "Blocked";
    case "inactive": return "Not enabled";
    default: return "Checking";
  }
};

const nextActionMessage = (value?: string | null) => {
  switch (String(value || "").trim()) {
    case "resolve-blockers": return "Resolve the listed prerequisites, then check the project again.";
    case "retry": return "Review the issue below, then retry setup safely.";
    case "configure-feature-policy":
    case "resolve-feature-policy": return "HelloTest will restore the default feature set when you enable the project.";
    case "upgrade-installation": return "Update and approve the HelloTest app access before resuming setup.";
    default: return String(value || "").replace(/[_-]+/g, " ").replace(/^./, (character) => character.toUpperCase());
  }
};

const fieldContextReviewMessage = (code?: string | null) => {
  switch (String(code || "").toUpperCase()) {
    case "GLOBAL_FIELD_CONTEXT_INCOMPATIBLE":
    case "UNVERIFIED_GLOBAL_FIELD_CONTEXT":
      return "HelloTest found a global work-item field context whose ownership or issue-type scope cannot be changed safely. It was left unchanged.";
    case "FIELD_CONTEXT_COHORT_CONFLICT":
      return "The existing shared HelloTest context uses a different issue-type scope. HelloTest preserved it instead of changing other projects.";
    default:
      return "A field context assigned to this project could not be verified as HelloTest-managed. HelloTest left its scope and options unchanged.";
  }
};

export function ProjectActivationScreen({
  projects,
  projectId,
  snapshot,
  isAdminConfig,
  isLoadingProjects,
  isLoadingStatus,
  isRefreshing,
  isSubmitting,
  projectsError,
  statusError,
  submitError,
  showReadyConfirmation,
  onProjectChange,
  onEnable,
  onRefresh,
  onOpenWorkspace
}: ProjectActivationScreenProps) {
  const selectedProject = projects.find((project) => String(project.id) === String(projectId))
    || snapshot?.project
    || null;
  const isInProgress = snapshot?.status === "queued" || snapshot?.status === "provisioning";
  const isReady = snapshot?.status === "active";
  const isBlocked = snapshot?.status === "blocked";
  const isFailed = snapshot?.status === "failed";
  const submitErrorMessage = errorMessage(submitError);
  const isInstallationScopeUpgrade = Boolean(
    isInstallationScopeUpgradeRequired(snapshot?.error)
    || isInstallationScopeUpgradeRequired(submitErrorMessage)
  );
  // A percentage is an estimate until the durable ready marker is committed.
  // Never present an in-flight project as 100% complete.
  const progress = durableActivationProgress(snapshot?.progress?.percent, isReady);
  const stepStates = activationStepStates(snapshot);
  const isAutomaticallyRetrying = Boolean(isInProgress && snapshot?.error?.automatic_retry);
  const isScreenAssignmentRecovery = Boolean(
    (isBlocked || isFailed)
    && snapshot?.error?.retryable !== false
    && isScreenFieldReconciliationSignal(snapshot?.error)
  );
  const isGlobalContextRecovery = Boolean(
    (isBlocked || isFailed)
    && snapshot?.error?.retryable !== false
    && isGlobalFieldContextReconciliationSignal(snapshot?.error)
  );
  const isFieldContextReview = Boolean(
    (isBlocked || isFailed)
    && !isGlobalContextRecovery
    && isFieldContextReviewRequired(snapshot?.error)
  );
  const isSafeReconciliation = isScreenAssignmentRecovery || isGlobalContextRecovery;
  const visibleError = submitErrorMessage || errorMessage(statusError);
  const blockers = snapshot?.eligibility?.blockers || [];
  const warnings = snapshot?.eligibility?.warnings || [];
  const actionableBlockers = blockers.filter((blocker) => !featurePolicyMessage.test(blocker));
  const visibleWarnings = warnings.filter((warning) => !featurePolicyMessage.test(warning));
  const policyFailureOnly = Boolean(
    !snapshot?.feature_policy.valid
    && (isBlocked || isFailed || snapshot?.status === "inactive")
    && actionableBlockers.length === 0
    && snapshot?.eligibility.global_admin
    && !selectedProject?.archived
    && selectedProject?.activation_supported !== false
    && (!snapshot?.error || featurePolicyMessage.test(`${snapshot.error.code} ${snapshot.error.message}`))
  );
  const isDefaultFeatureRecovery = Boolean((isBlocked || isFailed) && policyFailureOnly);
  const isEnableState = snapshot?.status === "inactive" || isDefaultFeatureRecovery;
  const nativeIssueTypes = snapshot?.native_issue_types;
  const suggestedRequirements = nativeIssueTypes?.selected.requirement_issue_type_ids.length
    ? nativeIssueTypes.selected.requirement_issue_type_ids
    : nativeIssueTypes?.recommended.requirement_issue_type_ids || [];
  const suggestedDefects = nativeIssueTypes?.selected.defect_issue_type_ids.length
    ? nativeIssueTypes.selected.defect_issue_type_ids
    : nativeIssueTypes?.recommended.defect_issue_type_ids || [];
  const [requirementIssueTypeId, setRequirementIssueTypeId] = useState("");
  const [defectIssueTypeId, setDefectIssueTypeId] = useState("");

  useEffect(() => {
    setRequirementIssueTypeId(suggestedRequirements[0] || "");
    setDefectIssueTypeId(suggestedDefects[0] || "");
  }, [projectId, suggestedRequirements.join(","), suggestedDefects.join(",")]);

  const availableIssueTypes = useMemo(
    () => (nativeIssueTypes?.available || []).filter((issueType) => !issueType.subtask),
    [nativeIssueTypes?.available]
  );
  const mappingRequired = Boolean(nativeIssueTypes?.mapping_required);
  const isProjectTypeBlocked = Boolean(
    selectedProject?.activation_supported === false
    || selectedProject?.configuration_model === "team-managed"
    || selectedProject?.simplified === true
    || actionableBlockers.some((blocker) => /team-managed|company-managed|configuration model/i.test(blocker))
  );
  const supportedProjects = useMemo(
    () => projects.filter((project) => project.activation_supported === true),
    [projects]
  );
  const unavailableProjects = useMemo(
    () => projects.filter((project) => project.activation_supported !== true),
    [projects]
  );
  const projectSelectRef = useRef<HTMLSelectElement>(null);
  const mappingReady = !mappingRequired || Boolean(
    requirementIssueTypeId
    && defectIssueTypeId
    && requirementIssueTypeId !== defectIssueTypeId
  );
  const selectedSourceMapping: ProjectActivationSourceMapping | undefined = mappingRequired
    ? {
        requirement_issue_type_ids: requirementIssueTypeId ? [requirementIssueTypeId] : [],
        defect_issue_type_ids: defectIssueTypeId ? [defectIssueTypeId] : []
      }
    : undefined;
  const activationPermissionReady = Boolean(snapshot?.can_enable || policyFailureOnly);
  const canStart = isEnableState
    && activationPermissionReady
    && (snapshot?.eligibility.eligible || policyFailureOnly)
    && mappingReady
    && !isSubmitting;
  const canRetry = (isFailed || isBlocked) && !isDefaultFeatureRecovery
    && snapshot?.can_retry
    && snapshot.can_enable
    && mappingReady
    && !isSubmitting;
  const canResumeAfterAccessUpdate = isInstallationScopeUpgrade
    && Boolean(snapshot?.eligibility.global_admin)
    && mappingReady
    && !isSubmitting;
  const featurePolicyLabel = snapshot?.feature_policy.configured
    ? snapshot.feature_policy.valid ? "Feature availability ready" : "Default features will be restored"
    : "Default features included";
  const featurePolicyDescription = snapshot?.feature_policy.configured
    ? snapshot.feature_policy.valid
      ? "Current feature settings are ready. API overrides remain optional whenever you want to customize them."
      : "Enable HelloTest to replace incomplete API settings with current defaults. You can add a valid override later."
    : "Current HelloTest features will be enabled automatically with this project. API overrides are optional after activation.";
  const readyOutcome = snapshot?.legacy_adopted
    ? {
        title: "Existing HelloTest setup adopted",
        description: "The existing HelloTest registry was adopted after verification; the project’s current data and work-tracker configuration were preserved."
      }
    : Number(snapshot?.job?.attempt || 0) > 1
      ? {
          title: "Setup repaired and ready",
          description: "HelloTest resumed the previous setup, reused verified work-tracker resources, and completed the remaining checks."
        }
      : {
          title: showReadyConfirmation ? "HelloTest is ready" : `${selectedProject?.name || "This project"} is enabled`,
          description: "The project passed schema, screen, feature availability, storage, and permission checks."
        };
  const mappingControls = mappingRequired ? (
    <fieldset className="project-activation-mapping">
      <legend>Connected workspace source mapping</legend>
      <p>Choose the native work item types HelloTest should use for product stories and defects.</p>
      <div className="project-activation-mapping-grid">
        <label>
          <span>Story source</span>
          <select
            disabled={isSubmitting}
            onChange={(event) => setRequirementIssueTypeId(event.target.value)}
            value={requirementIssueTypeId}
          >
            <option value="">Select an issue type</option>
            {availableIssueTypes.map((issueType) => (
              <option disabled={issueType.id === defectIssueTypeId} key={issueType.id} value={issueType.id}>
                {issueType.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Bug source</span>
          <select
            disabled={isSubmitting}
            onChange={(event) => setDefectIssueTypeId(event.target.value)}
            value={defectIssueTypeId}
          >
            <option value="">Select an issue type</option>
            {availableIssueTypes.map((issueType) => (
              <option disabled={issueType.id === requirementIssueTypeId} key={issueType.id} value={issueType.id}>
                {issueType.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!mappingReady ? <span>Select a different issue type for each source.</span> : null}
    </fieldset>
  ) : null;

  return (
    <div className="project-activation-shell">
      <header className="project-activation-topbar">
        <BrandWordmark className="project-activation-brand" subtitle="Quality workspace" />
        <div className="project-activation-topbar-meta">
          <IconCircleCheck aria-hidden="true" size={16} stroke={1.9} />
          <span>Default features included · API overrides optional</span>
        </div>
      </header>

      <main className="project-activation-main">
        <aside className="project-activation-intro" aria-labelledby="project-activation-page-title">
          <span className="project-activation-intro-icon" aria-hidden="true">
            <IconShieldCheck size={46} stroke={1.65} />
          </span>
          <div>
            <p className="project-activation-kicker">Project activation</p>
            <h1 id="project-activation-page-title">
              {isAdminConfig ? "Enable HelloTest for projects" : "Enable HelloTest for this project"}
            </h1>
            <p>
              Choose Enable once. HelloTest accepts the setup in the connected workspace, finishes it in the background, and shows Continue when the workspace is ready.
            </p>
          </div>
        </aside>

        <section className="project-activation-card" aria-labelledby="project-activation-card-title">
          <div className="project-activation-card-head">
            <div>
              <span className="project-activation-card-label">Selected project</span>
              <h2 id="project-activation-card-title">{selectedProject?.name || "Choose a project"}</h2>
              {selectedProject?.key ? <p>{selectedProject.key} · {selectedProject.archived ? "Archived " : ""}project</p> : null}
            </div>
            <span className={`project-activation-status is-${isSafeReconciliation ? "recovery" : isInstallationScopeUpgrade ? "blocked" : isDefaultFeatureRecovery ? "inactive" : snapshot?.status || "checking"}`}>
              {isInstallationScopeUpgrade ? "App update required" : isGlobalContextRecovery ? "Ready to recheck" : isScreenAssignmentRecovery ? "Ready to reconcile" : isFieldContextReview ? "workspace admin review" : isDefaultFeatureRecovery ? "Not enabled" : statusLabel(snapshot)}
            </span>
          </div>

          <div className="project-activation-project-field">
            <label htmlFor="project-activation-project-select">Project</label>
            <select
              disabled={isLoadingProjects || isSubmitting || !projects.length}
              id="project-activation-project-select"
              onChange={(event) => onProjectChange(event.target.value)}
              ref={projectSelectRef}
              value={selectedProject?.id || ""}
            >
              {!selectedProject ? <option value="">Select a project</option> : null}
              {supportedProjects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.key} — {project.name}
                </option>
              ))}
              {unavailableProjects.length ? (
                <optgroup label="Unavailable for full connected workspace setup">
                  {unavailableProjects.map((project) => (
                    <option disabled key={project.id} value={project.id}>
                      {project.key} — {project.name}{project.archived ? " (archived)" : project.configuration_model === "team-managed" || project.simplified ? " (team-managed)" : " (project type unverified)"}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
            <span>
              {supportedProjects.length} company-managed project{supportedProjects.length === 1 ? "" : "s"} available
              {unavailableProjects.length ? ` · ${unavailableProjects.length} unavailable` : ""}
            </span>
          </div>

          {isLoadingProjects ? (
            <div className="project-activation-state">
              <LoadingState label="Loading projects" description="Finding projects you can access." />
            </div>
          ) : projectsError ? (
            <div className="project-activation-state is-error" role="alert">
              <IconAlertTriangle aria-hidden="true" size={24} stroke={1.9} />
              <div>
                <h3>Projects could not be loaded</h3>
                <p>{errorMessage(projectsError) || "Refresh the page or ask a workspace administrator to verify project access."}</p>
              </div>
              <button className="ghost-button compact" disabled={isRefreshing} onClick={onRefresh} type="button">
                <IconRefresh aria-hidden="true" size={16} />
                {isRefreshing ? "Loading…" : "Try again"}
              </button>
            </div>
          ) : !projects.length ? (
            <div className="project-activation-state is-empty" role="status">
              <IconAlertTriangle aria-hidden="true" size={24} stroke={1.9} />
              <div>
                <h3>No accessible projects</h3>
                <p>Ask a workspace administrator to create a project or grant you Browse Projects access.</p>
              </div>
            </div>
          ) : isLoadingStatus || (!snapshot && !statusError) ? (
            <div className="project-activation-state">
              <LoadingState label="Checking project readiness" description={`Reviewing ${selectedProject?.name || "the selected project"}.`} />
            </div>
          ) : statusError && !snapshot ? (
            <div className="project-activation-state is-error" role="alert">
              <IconAlertTriangle aria-hidden="true" size={24} stroke={1.9} />
              <div>
                <h3>Project readiness could not be checked</h3>
                <p>{visibleError || "HelloTest could not read the activation status for this project."}</p>
              </div>
              <button className="ghost-button compact" disabled={isRefreshing} onClick={onRefresh} type="button">
                <IconRefresh aria-hidden="true" size={16} />
                {isRefreshing ? "Checking…" : "Try again"}
              </button>
            </div>
          ) : isSubmitting && !isInProgress ? (
            <div className="project-activation-state is-requesting" aria-live="polite" role="status">
              <span className="project-activation-state-icon is-spinning" aria-hidden="true">
                <IconLoader2 size={22} stroke={1.9} />
              </span>
              <div>
                <h3>Sending your enable request</h3>
                <p>HelloTest is checking connected workspace access. Keep this page open until the setup request is accepted.</p>
              </div>
            </div>
          ) : isInProgress ? (
            <div className="project-activation-state is-progress" aria-live="polite" role="status">
              <div className="project-activation-state-title">
                <span className="project-activation-state-icon is-spinning" aria-hidden="true">
                  <IconLoader2 size={22} stroke={1.9} />
                </span>
                <div>
                  <h3>{isAutomaticallyRetrying ? `Retrying setup for ${selectedProject?.name}` : "Setup accepted"}</h3>
                  <p>
                    {isAutomaticallyRetrying && snapshot?.error?.message
                      ? `${snapshot.error.message} HelloTest will retry automatically.`
                      : `${humanizePhase(snapshot?.phase)}. It is safe to leave this page; setup will continue in the connected workspace.`}
                  </p>
                </div>
                <strong>{progress}%</strong>
              </div>
              <div
                aria-label={`Project activation ${progress}% complete`}
                aria-valuemax={100}
                aria-valuemin={0}
                aria-valuenow={progress}
                className="project-activation-progress"
                role="progressbar"
              >
                <span style={{ width: `${progress}%` }} />
              </div>
              <ol className="project-activation-steps" aria-label="Activation progress">
                {activationSteps.map((step, index) => {
                  const isComplete = stepStates[index] === "complete";
                  const isCurrent = stepStates[index] === "current";
                  const StepIcon = isComplete ? IconCircleCheck : isCurrent ? IconLoader2 : IconCircle;
                  return (
                    <li className={isComplete ? "is-complete" : isCurrent ? "is-current" : ""} key={step.label}>
                      <StepIcon aria-hidden="true" size={17} stroke={1.9} />
                      <span>{step.label}</span>
                      <em>{isComplete ? "Complete" : isCurrent ? "In progress" : "Waiting"}</em>
                    </li>
                  );
                })}
              </ol>
              {statusError ? (
                <div className="project-activation-poll-note" role="note">
                  <span>The latest status check was interrupted. Setup continues in the connected workspace.</span>
                  <button className="activation-link-button" disabled={isRefreshing} onClick={onRefresh} type="button">
                    <IconRefresh aria-hidden="true" size={14} />
                    {isRefreshing ? "Checking…" : "Check status"}
                  </button>
                </div>
              ) : null}
            </div>
          ) : isReady ? (
            <div className="project-activation-state is-success" aria-live="polite" role="status">
              <IconCircleCheck aria-hidden="true" size={28} stroke={1.9} />
              <div>
                <h3>{readyOutcome.title}</h3>
                <p>{readyOutcome.description}</p>
                <div className="project-activation-ready-meta" aria-label="Activation details">
                  <span>Registry {snapshot.registry.version || "current"}</span>
                  <span>{featurePolicyLabel}</span>
                </div>
              </div>
              <button className="primary-button" onClick={onOpenWorkspace} type="button">
                {isAdminConfig ? "Open project workspace" : "Continue to HelloTest"}
                <IconArrowRight aria-hidden="true" size={16} />
              </button>
            </div>
          ) : ((isFailed || isBlocked) && !isDefaultFeatureRecovery) || isInstallationScopeUpgrade ? (
            <div
              className={`project-activation-state ${isSafeReconciliation ? "is-recovery" : "is-error"}${mappingRequired ? " has-mapping" : ""}`}
              role={isSafeReconciliation ? "status" : "alert"}
            >
              {isGlobalContextRecovery
                ? <IconRefresh aria-hidden="true" size={26} stroke={1.9} />
                : <IconAlertTriangle aria-hidden="true" size={26} stroke={1.9} />}
              <div>
                <h3>{isInstallationScopeUpgrade ? "Approve HelloTest’s updated connected workspace access" : isGlobalContextRecovery ? "Global work-item field context found" : isScreenAssignmentRecovery ? "Existing work-item screen field found" : isFieldContextReview ? "work-item field context needs review" : isProjectTypeBlocked ? "Choose a company-managed project" : isBlocked ? "This project cannot be enabled yet" : "Setup needs attention"}</h3>
                <p>
                  {isInstallationScopeUpgrade
                    ? "Connected workspace rejected the configuration write because this installation has not been granted the access requested by the current HelloTest deployment. Retrying setup before the app update cannot resolve it."
                    : isGlobalContextRecovery
                    ? "HelloTest will re-read the effective connected-workspace context and reuse a compatible global fallback read-only. It will not change the global context."
                    : isScreenAssignmentRecovery
                    ? "HelloTest can verify and reuse the existing field placement, then continue without creating a duplicate."
                    : isFieldContextReview
                      ? fieldContextReviewMessage(snapshot?.error?.code)
                    : isProjectTypeBlocked
                    ? "HelloTest’s connected workspace screens and schemes require a company-managed project. Use the project selector above to continue with a supported project."
                    : snapshot?.error?.message || nextActionMessage(snapshot?.next_action) || visibleError || "Resolve the item below, then retry safely."}
                </p>
                {isFieldContextReview ? (
                  <div className="project-activation-context-review" role="note">
                    <strong>Review in the connected workspace before retrying</strong>
                    <span>Confirm the context owner and its project and issue-type scope. Keep contexts used by other projects intact.</span>
                    <code>{snapshot?.error?.code}</code>
                  </div>
                ) : null}
                {isInstallationScopeUpgrade ? (
                  <div className="project-activation-context-review is-installation-upgrade" role="note">
                    <strong>One installation update is required</strong>
                    <span>Deployment owner: publish the current HelloTest manifest. connected site admin: open Apps → Manage your apps → HelloTest and approve the requested access.</span>
                    <span>Your completed schema checkpoints are preserved. The approved Forge upgrade resumes eligible failed projects automatically; this button is a safe fallback if lifecycle delivery is delayed.</span>
                  </div>
                ) : null}
                {actionableBlockers.length ? (
                  <ul className="project-activation-message-list">
                    {actionableBlockers.slice(0, 3).map((blocker) => <li key={blocker}>{blocker}</li>)}
                  </ul>
                ) : null}
              </div>
              {mappingControls}
              <div className="project-activation-state-actions">
                {isInstallationScopeUpgrade && canResumeAfterAccessUpdate ? (
                  <button className="primary-button" disabled={isSubmitting} onClick={() => onEnable(selectedSourceMapping)} type="button">
                    <IconShieldCheck aria-hidden="true" size={16} />
                    {isSubmitting ? "Resuming…" : "Resume after access update"}
                  </button>
                ) : canRetry ? (
                  <button className="primary-button" disabled={isSubmitting} onClick={() => onEnable(selectedSourceMapping)} type="button">
                    <IconRefresh aria-hidden="true" size={16} />
                    {isSubmitting
                      ? isGlobalContextRecovery ? "Rechecking…" : isScreenAssignmentRecovery ? "Reconciling…" : "Retrying…"
                      : isGlobalContextRecovery ? "Recheck & continue" : isScreenAssignmentRecovery ? "Reconcile & continue" : isFieldContextReview ? "Retry after workspace review" : "Retry setup"}
                  </button>
                ) : null}
                {isProjectTypeBlocked ? (
                  <button className="ghost-button" onClick={() => projectSelectRef.current?.focus()} type="button">
                    Choose another project
                  </button>
                ) : (
                  <button className="ghost-button" disabled={isRefreshing} onClick={onRefresh} type="button">
                    {isRefreshing ? "Checking…" : isInstallationScopeUpgrade ? "Check after app update" : "Check again"}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className={`project-activation-state is-inactive${mappingRequired ? " has-mapping" : ""}`}>
              <div>
                <h3>Enable HelloTest for {selectedProject?.name}</h3>
                <p>One click prepares the work-item schema, connects project screens, and enables the current HelloTest feature set. Use the API only if you want to override feature availability later.</p>
                {isDefaultFeatureRecovery ? (
                  <p className="project-activation-default-note">
                    HelloTest will safely restore the current default feature set during activation.
                  </p>
                ) : null}
                {visibleWarnings.length ? <p className="project-activation-warning">{visibleWarnings[0]}</p> : null}
                {visibleError ? <p className="project-activation-inline-error" role="alert">{visibleError}</p> : null}
              </div>
              {mappingControls}
              <div className="project-activation-state-actions">
                <button
                  aria-describedby={!canStart ? "project-activation-permission-note" : undefined}
                  className="primary-button"
                  disabled={!canStart}
                  onClick={() => onEnable(selectedSourceMapping)}
                  type="button"
                >
                  <IconShieldCheck aria-hidden="true" size={17} />
                  {isSubmitting ? "Starting…" : activationPermissionReady ? mappingReady ? "Enable HelloTest" : "Complete mapping" : "workspace admin required"}
                </button>
                <button className="ghost-button" disabled={isRefreshing} onClick={onRefresh} type="button">
                  {isRefreshing ? "Checking…" : "Check eligibility"}
                </button>
              </div>
              {!canStart ? (
                <p className="project-activation-permission-note" id="project-activation-permission-note">
                  {!mappingReady
                    ? "Select a Story source and Bug source before enabling HelloTest."
                    : actionableBlockers[0]
                      || nextActionMessage(snapshot?.next_action)
                      || "A workspace administrator must complete this activation."}
                </p>
              ) : null}
            </div>
          )}

          {snapshot ? (
            <div className={`project-activation-policy${snapshot.feature_policy.valid && snapshot.feature_policy.configured ? " is-custom" : " is-default"}`} role="note">
              {snapshot.feature_policy.valid && snapshot.feature_policy.configured
                  ? <IconSparkles aria-hidden="true" size={16} stroke={1.9} />
                  : <IconCircleCheck aria-hidden="true" size={16} stroke={1.9} />}
              <div>
                <strong>{featurePolicyLabel}</strong>
                <span>{featurePolicyDescription}</span>
              </div>
            </div>
          ) : null}
        </section>

        <section className="project-activation-scope" aria-labelledby="project-activation-scope-title">
          <div>
            <h2 id="project-activation-scope-title">One click handles the setup</h2>
            <p>Schema and default feature availability are prepared automatically. Valid retries reuse work-tracker resources instead of duplicating them.</p>
          </div>
          <ul>
            {activationSteps.slice(1).map((item) => {
              const StepIcon = item.icon;
              return (
                <li key={item.label}>
                  <StepIcon aria-hidden="true" size={19} stroke={1.8} />
                  <span>{item.label}</span>
                </li>
              );
            })}
          </ul>
        </section>
      </main>
    </div>
  );
}
