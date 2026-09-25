import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { IconCircleCheck } from "@tabler/icons-react";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/hanken-grotesk/400.css";
import "@fontsource/hanken-grotesk/500.css";
import "@fontsource/hanken-grotesk/600.css";
import "@fontsource/hanken-grotesk/700.css";
import { ProjectActivationScreen } from "./activation/ProjectActivationScreen";
import type {
  ProjectActivationProject,
  ProjectActivationSnapshot,
  ProjectActivationSourceMapping,
  ProjectActivationStatus
} from "../../../src/types";
import "../../../src/styles.css";
import "../../../src/dark-theme.css";
import "./activation-preview.css";

const projects: ProjectActivationProject[] = [
  {
    id: "10001",
    key: "NOVA",
    name: "Nova Commerce",
    description: "Customer checkout and order-management platform",
    project_type: "software",
    simplified: false,
    configuration_model: "company-managed",
    activation_supported: true
  },
  {
    id: "10002",
    key: "PAY",
    name: "Payments Platform",
    description: "Payment orchestration and settlement services",
    project_type: "software",
    simplified: false,
    configuration_model: "company-managed",
    activation_supported: true
  },
  {
    id: "10003",
    key: "MOB",
    name: "Mobile Experience",
    description: "Customer-facing iOS and Android applications",
    project_type: "software",
    simplified: false,
    configuration_model: "company-managed",
    activation_supported: true
  },
  {
    id: "10004",
    key: "LAB",
    name: "Growth Lab",
    description: "Team-managed experimentation project",
    project_type: "software",
    simplified: true,
    configuration_model: "team-managed",
    activation_supported: false,
    activation_unavailable_reason: "team-managed"
  }
];

const standardIssueTypes = {
  available: [
    { id: "10010", name: "Story", subtask: false },
    { id: "10011", name: "Bug", subtask: false },
    { id: "10012", name: "Task", subtask: false },
    { id: "10013", name: "Sub-task", subtask: true }
  ],
  recommended: {
    requirement_issue_type_ids: ["10010"],
    defect_issue_type_ids: ["10011"]
  },
  selected: {
    requirement_issue_type_ids: ["10010"],
    defect_issue_type_ids: ["10011"]
  },
  mapping_required: false
} satisfies NonNullable<ProjectActivationSnapshot["native_issue_types"]>;

const nonstandardIssueTypes = {
  available: [
    { id: "10110", name: "Customer Need", subtask: false },
    { id: "10111", name: "Production Incident", subtask: false },
    { id: "10112", name: "Engineering Task", subtask: false },
    { id: "10113", name: "Implementation Step", subtask: true }
  ],
  recommended: {
    requirement_issue_type_ids: ["10110"],
    defect_issue_type_ids: ["10111"]
  },
  selected: {
    requirement_issue_type_ids: [],
    defect_issue_type_ids: []
  },
  mapping_required: true
} satisfies NonNullable<ProjectActivationSnapshot["native_issue_types"]>;

const progressFor = (status: ProjectActivationStatus) => {
  if (status === "queued") return { completed: 0, total: 8, percent: 6 };
  if (status === "provisioning") return { completed: 5, total: 8, percent: 62 };
  if (status === "active") return { completed: 8, total: 8, percent: 100 };
  if (status === "blocked") return { completed: 0, total: 8, percent: 0 };
  if (status === "failed") return { completed: 4, total: 8, percent: 50 };
  return { completed: 0, total: 8, percent: 0 };
};

const phaseFor = (status: ProjectActivationStatus) => {
  if (status === "queued") return "issue-types";
  if (status === "provisioning") return "screens";
  if (status === "active") return "complete";
  if (status === "blocked") return "jira_eligibility_validation";
  if (status === "failed") return "validation";
  return null;
};

type ActivationPreviewState = ProjectActivationStatus | "malformed";

const makeSnapshot = (
  project: ProjectActivationProject,
  previewState: ActivationPreviewState = "inactive"
): ProjectActivationSnapshot => {
  const isMalformedPolicyRecovery = previewState === "malformed";
  const projectUnsupported = project.activation_supported !== true;
  const status: ProjectActivationStatus = isMalformedPolicyRecovery || projectUnsupported ? "blocked" : previewState;
  const isUnsupportedProject = projectUnsupported || (status === "blocked" && !isMalformedPolicyRecovery);
  const ready = status === "active";
  const featurePolicyReady = ["queued", "provisioning", "active", "failed"].includes(status)
    && !isMalformedPolicyRecovery;
  const schemaReady = ready || isMalformedPolicyRecovery;
  const issueTypes = status === "failed" ? nonstandardIssueTypes : standardIssueTypes;
  return {
    schema: "hellotest.projectActivation.v1",
    project,
    status,
    schema_ready: schemaReady,
    feature_ready: featurePolicyReady,
    native_mapping_ready: !issueTypes.mapping_required,
    is_configured: ready,
    legacy_adopted: project.id === "10003" && ready,
    can_enable: status === "inactive" || status === "failed",
    can_retry: status === "failed",
    phase: phaseFor(status),
    progress: progressFor(status),
    eligibility: {
      eligible: !isUnsupportedProject,
      global_admin: true,
      project_admin: true,
      project_type: "software",
      blockers: isUnsupportedProject
        ? ["Full HelloTest activation requires a company-managed project; team-managed projects use a different configuration model."]
        : isMalformedPolicyRecovery
          ? ["Feature availability override is incomplete and will be replaced with HelloTest defaults during activation."]
          : [],
      warnings: status === "failed"
        ? ["HelloTest found custom work item types. Confirm the suggested source mapping before setup starts."]
        : []
    },
    feature_policy: {
      configured: isMalformedPolicyRecovery || featurePolicyReady,
      valid: featurePolicyReady,
      revision: isMalformedPolicyRecovery ? 3 : featurePolicyReady ? 1 : null,
      updated_at: isMalformedPolicyRecovery || featurePolicyReady ? "2026-08-02T09:45:00.000Z" : null,
      missing_keys: featurePolicyReady ? [] : ["hellotest.manual.requirements", "hellotest.manual.test_cases"],
      unknown_keys: []
    },
    registry: {
      present: schemaReady,
      version: schemaReady ? "3.0" : null,
      mode: schemaReady ? "jira-native" : null,
      property_model_version: schemaReady ? "1.0" : null
    },
    native_issue_types: issueTypes,
    job: status === "inactive" || isMalformedPolicyRecovery ? null : {
      id: `activation-${project.id}`,
      attempt: 1,
      requested_at: "2026-08-02T09:48:00.000Z",
      started_at: status === "queued" ? null : "2026-08-02T09:48:02.000Z",
      completed_at: ready ? "2026-08-02T09:48:19.000Z" : null
    },
    error: status === "failed" ? {
      code: "NATIVE_ISSUE_TYPE_MAPPING_INVALID",
      message: "The saved Story or Defect mapping is no longer available. Choose current work item types, then retry setup.",
      retryable: true,
      phase: "validation"
    } : null,
    next_action: status === "inactive"
      ? "Enable HelloTest to apply the work-item schema and default features."
      : isMalformedPolicyRecovery ? "resolve-feature-policy" : status === "blocked" ? "resolve-blockers" : status === "failed" ? "retry" : null
  };
};

const requestedStatus = () => {
  const value = new URLSearchParams(window.location.search).get("state");
  if (value === "ready") return "active";
  return (["inactive", "queued", "provisioning", "active", "blocked", "failed", "malformed"] as const).find((status) => status === value)
    || "inactive";
};

const requestedProjectId = () => {
  const value = new URLSearchParams(window.location.search).get("project");
  return projects.some((project) => project.id === value) ? value! : projects[0].id;
};

type ActivationStage = Pick<ProjectActivationSnapshot, "status" | "phase" | "progress">;

const activationStages: Array<ActivationStage & { delay: number }> = [
  {
    delay: 650,
    status: "provisioning",
    phase: "issue-types",
    progress: { completed: 2, total: 8, percent: 28 }
  },
  {
    delay: 1500,
    status: "provisioning",
    phase: "screens",
    progress: { completed: 5, total: 8, percent: 62 }
  },
  {
    delay: 2400,
    status: "provisioning",
    phase: "registry",
    progress: { completed: 7, total: 8, percent: 99 }
  },
  {
    delay: 3400,
    status: "active",
    phase: "complete",
    progress: { completed: 8, total: 8, percent: 100 }
  }
];

function ActivationPreview() {
  const initialProjectId = useMemo(requestedProjectId, []);
  const initialStatus = useMemo(requestedStatus, []);
  const [projectId, setProjectId] = useState(initialProjectId);
  const [snapshots, setSnapshots] = useState<Record<string, ProjectActivationSnapshot>>(() => Object.fromEntries(
    projects.map((project) => [
      project.id,
      makeSnapshot(project, project.id === initialProjectId ? initialStatus : project.id === "10003" ? "active" : "inactive")
    ])
  ));
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [completedProjectId, setCompletedProjectId] = useState<string | null>(
    initialStatus === "active" ? initialProjectId : null
  );
  const [openedProjectId, setOpenedProjectId] = useState<string | null>(null);
  const timers = useRef<number[]>([]);
  const snapshot = snapshots[projectId];

  useEffect(() => () => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const updateSnapshot = (
    targetProjectId: string,
    updater: (current: ProjectActivationSnapshot) => ProjectActivationSnapshot
  ) => {
    setSnapshots((current) => ({
      ...current,
      [targetProjectId]: updater(current[targetProjectId])
    }));
  };

  const handleProjectChange = (nextProjectId: string) => {
    setProjectId(nextProjectId);
    setOpenedProjectId(null);
  };

  const handleEnable = (sourceMapping?: ProjectActivationSourceMapping) => {
    const targetProjectId = projectId;
    setIsSubmitting(true);
    setCompletedProjectId(null);
    setOpenedProjectId(null);
    updateSnapshot(targetProjectId, (current) => ({
      ...current,
      status: "queued",
      can_enable: false,
      phase: "issue-types",
      progress: { completed: 0, total: 8, percent: 6 },
      feature_policy: {
        configured: true,
        valid: true,
        revision: 1,
        updated_at: new Date().toISOString(),
        missing_keys: [],
        unknown_keys: []
      },
      native_issue_types: current.native_issue_types && sourceMapping
        ? { ...current.native_issue_types, selected: sourceMapping }
        : current.native_issue_types,
      job: {
        id: `activation-${targetProjectId}`,
        attempt: 1,
        requested_at: new Date().toISOString(),
        started_at: null,
        completed_at: null
      },
      next_action: null
    }));

    timers.current.push(window.setTimeout(() => setIsSubmitting(false), 180));
    activationStages.forEach((stage) => {
      timers.current.push(window.setTimeout(() => {
        updateSnapshot(targetProjectId, (current) => {
          const ready = stage.status === "active";
          return {
            ...current,
            status: stage.status,
            phase: stage.phase,
            progress: stage.progress,
            is_configured: ready,
            schema_ready: ready || current.schema_ready,
            feature_ready: ready,
            native_mapping_ready: ready,
            registry: ready ? {
              present: true,
              version: "3.0",
              mode: "jira-native",
              property_model_version: "1.0"
            } : current.registry,
            job: current.job ? {
              ...current.job,
              started_at: current.job.started_at || new Date().toISOString(),
              completed_at: ready ? new Date().toISOString() : null
            } : null
          };
        });
        if (stage.status === "active") setCompletedProjectId(targetProjectId);
      }, stage.delay));
    });
  };

  const handleRefresh = () => {
    setIsRefreshing(true);
    timers.current.push(window.setTimeout(() => setIsRefreshing(false), 500));
  };

  return (
    <div
      data-qa-preview="project-activation"
      data-qa-preview-state={initialStatus}
      data-qa-project-id={projectId}
      data-qa-state={snapshot.status}
      data-qa-workspace-opened={openedProjectId === projectId ? "true" : "false"}
    >
      <ProjectActivationScreen
        projects={projects}
        projectId={projectId}
        snapshot={snapshot}
        isAdminConfig
        isLoadingProjects={false}
        isLoadingStatus={false}
        isRefreshing={isRefreshing}
        isSubmitting={isSubmitting}
        showReadyConfirmation={completedProjectId === projectId}
        onProjectChange={handleProjectChange}
        onEnable={handleEnable}
        onRefresh={handleRefresh}
        onOpenWorkspace={() => setOpenedProjectId(projectId)}
      />
      {openedProjectId === projectId ? (
        <div className="activation-preview-toast" role="status">
          <IconCircleCheck aria-hidden="true" size={20} stroke={1.9} />
          <div>
            <strong>Workspace handoff confirmed</strong>
            <span>{snapshot.project.name} would now open in the full HelloTest workspace.</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ActivationPreview />
  </React.StrictMode>
);
