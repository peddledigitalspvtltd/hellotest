import { useMemo, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useDomainMetadata } from "../hooks/useDomainMetadata";
import { setCurrentScope } from "../hooks/useCurrentProject";
import { api } from "../lib/api";
import { hasPermission } from "../lib/permissions";
import {
  ConfigurationForm,
  DataSetForm,
  EnvironmentForm,
  ResourceModalShell,
  configurationToDraft,
  dataSetToDraft,
  environmentToDraft
} from "../pages/TestEnvironmentPage";
import type {
  ExecutionConfigurationSnapshot,
  ExecutionDataSetSnapshot,
  ExecutionEnvironmentSnapshot,
  TestConfiguration,
  TestDataSet,
  TestEnvironment
} from "../types";
import { OpenIcon } from "./AppIcons";
import "./RunConfigurationDialog.css";

export type RunConfigurationResource = "environment" | "configuration" | "data";
export type RunConfigurationSnapshot = ExecutionEnvironmentSnapshot | ExecutionConfigurationSnapshot | ExecutionDataSetSnapshot;

export type RunConfigurationDialogProps = {
  resource: RunConfigurationResource;
  projectId: string;
  appTypeId?: string | null;
  resourceId?: string | null;
  snapshot?: RunConfigurationSnapshot | null;
  onClose: () => void;
};

const resourceDetails = {
  environment: { label: "Environment", permission: "environment.view", path: "/test-environments", parameter: "environment" },
  configuration: { label: "Configuration", permission: "configuration.view", path: "/test-configurations", parameter: "configuration" },
  data: { label: "Test data", permission: "data.view", path: "/test-data", parameter: "dataSet" }
} as const;

const ignoreChange = () => {};
const preventSubmit = (event: FormEvent<HTMLFormElement>) => event.preventDefault();
const includeSavedOptions = (options: Array<{ value: string; label: string }>, values: string[]) => {
  const saved = [...new Set(values.filter(Boolean))].filter(value => !options.some(option => option.value === value));
  return [...options, ...saved.map(value => ({ value, label: value }))];
};

/** Uses the same fields as the resource screens, with the values frozen for this run. */
export function RunConfigurationDialog({ resource, projectId, appTypeId, resourceId, snapshot, onClose }: RunConfigurationDialogProps) {
  const { session } = useAuth();
  const metadata = useDomainMetadata();
  const details = resourceDetails[resource];
  const canViewCurrent = hasPermission(session, details.permission, projectId);
  const canViewSnapshot = hasPermission(session, "run.view", projectId);
  const savedSnapshot = canViewSnapshot ? snapshot : null;
  const id = savedSnapshot?.id || resourceId || "";
  const current = useQuery<TestEnvironment | TestConfiguration | TestDataSet | null>({
    queryKey: ["run-configuration-resource", resource, projectId, appTypeId || "", id],
    queryFn: async () => {
      const query = { project_id: projectId, app_type_id: appTypeId || undefined };
      const resources = resource === "environment"
        ? await api.testEnvironments.list(query)
        : resource === "configuration"
          ? await api.testConfigurations.list(query)
          : await api.testDataSets.list(query);
      return resources.find(item => item.id === id && item.project_id === projectId) || null;
    },
    // A deleted or changed source must never replace an available run snapshot.
    enabled: Boolean(!snapshot && id && projectId && canViewCurrent),
    retry: 1,
    staleTime: 60_000
  });
  const record = savedSnapshot || (!snapshot && canViewCurrent ? current.data : null);
  const configurationDraft = useMemo(() => resource === "configuration" && record
    ? configurationToDraft(record as ExecutionConfigurationSnapshot) : null, [resource, record]);
  const browserOptions = includeSavedOptions(metadata.data?.test_environments?.browsers || [], configurationDraft?.targets.map(target => target.browser) || []);
  const mobileOptions = includeSavedOptions(metadata.data?.test_environments?.mobile_os || [], configurationDraft?.targets.map(target => target.mobile_os) || []);
  const modes = includeSavedOptions(metadata.data?.test_data_sets?.modes?.length
    ? metadata.data.test_data_sets.modes
    : [{ value: "table", label: "Table" }, { value: "key_value", label: "Key/value pairs" }],
  resource === "data" && record ? [(record as ExecutionDataSetSnapshot).mode] : []);
  const sharedProps = { readOnly: true, onChange: ignoreChange, onSubmit: preventSubmit, submitLabel: "Save", isSubmitting: false };
  const hasAccess = snapshot ? canViewSnapshot : canViewCurrent;

  const dialog = (
    <ResourceModalShell title={details.label} className={`run-configuration-dialog run-configuration-dialog--${resource}`} onClose={onClose}>
      <div className="run-configuration-dialog-context" role="note">
        <span className="run-configuration-dialog-badge">{savedSnapshot ? "Saved with this run" : "Run configuration"}</span>
        <p>{savedSnapshot
          ? "These values were saved when the run was created. Changes to the current resource do not change this run."
          : record
            ? "This run has no saved snapshot. These are the current resource values and may differ from the values used by the run."
            : "Review the environment, configuration, or test data attached to this run."}</p>
      </div>

      {record && hasAccess ? (
        resource === "environment" ? <EnvironmentForm draft={environmentToDraft(record as ExecutionEnvironmentSnapshot)} {...sharedProps} />
          : resource === "configuration" && configurationDraft ? <ConfigurationForm
            draft={configurationDraft}
            browserOptions={browserOptions}
            mobileOsOptions={mobileOptions}
            showMobileMetadata={configurationDraft.targets.some(target => Boolean(target.mobile_os))}
            {...sharedProps}
          />
            : resource === "data" ? <DataSetForm draft={dataSetToDraft(record as ExecutionDataSetSnapshot)} dataSetModeOptions={modes} {...sharedProps} /> : null
      ) : <div className="run-configuration-dialog-state" role={current.isError ? "alert" : "status"}>
        {!hasAccess ? <><strong>Access is unavailable</strong><p>You do not have permission to view this {details.label.toLowerCase()}.</p></>
          : !id ? <><strong>No {details.label.toLowerCase()} attached</strong><p>This run was created without a {details.label.toLowerCase()}.</p></>
            : current.isFetching ? <><strong>Loading {details.label.toLowerCase()}…</strong><p>Checking the current resource because this run has no saved snapshot.</p></>
              : current.isError ? <><strong>Could not load {details.label.toLowerCase()}</strong><p>Try loading the resource again.</p><button className="ghost-button" onClick={() => void current.refetch()} type="button">Try again</button></>
                : <><strong>{details.label} is no longer available</strong><p>The original resource may have been removed. This run has no saved snapshot to display.</p></>}
      </div>}

      <div className="run-configuration-dialog-footer">
        {id && canViewCurrent ? <Link
          className="run-configuration-current-link"
          to={`${details.path}?${details.parameter}=${encodeURIComponent(id)}`}
          onClick={() => { setCurrentScope(projectId, appTypeId || ""); onClose(); }}
        >Open current {details.label.toLowerCase()} <OpenIcon /></Link> : <span />}
        <button className="primary-button" type="button" onClick={onClose}>Done</button>
      </div>
    </ResourceModalShell>
  );
  return typeof document !== "undefined" ? createPortal(dialog, document.body) : dialog;
}
