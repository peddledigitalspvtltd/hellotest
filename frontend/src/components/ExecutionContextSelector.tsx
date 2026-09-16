import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { FormField } from "./FormField";
import { TestDataIcon } from "./AppIcons";
import { api } from "../lib/api";
import { useCapabilityAccess } from "../hooks/useCapabilityAccess";
import { optionalQueryView } from "../lib/optionalQueryView";
import type { TestConfiguration, TestDataSet, TestEnvironment } from "../types";

type ExecutionContextSelectorProps = {
  projectId: string;
  appTypeId: string;
  selectedEnvironmentId: string;
  selectedConfigurationId: string;
  selectedDataSetId: string;
  onEnvironmentChange: (value: string) => void;
  onConfigurationChange: (value: string) => void;
  onDataSetChange: (value: string) => void;
  prefillFirstAvailable?: boolean;
  preserveMissingSelection?: boolean;
};

function filterScopedResources<T extends { app_type_id: string | null }>(items: T[], appTypeId: string) {
  if (!appTypeId) {
    return items.filter((item) => !item.app_type_id);
  }

  return items;
}

export function ExecutionContextSelector({
  projectId,
  appTypeId,
  selectedEnvironmentId,
  selectedConfigurationId,
  selectedDataSetId,
  onEnvironmentChange,
  onConfigurationChange,
  onDataSetChange,
  prefillFirstAvailable = false,
  preserveMissingSelection = false
}: ExecutionContextSelectorProps) {
  const { can } = useCapabilityAccess(projectId);
  const canViewEnvironments = can("environment.view");
  const canViewConfigurations = can("configuration.view");
  const canViewTestData = can("data.view");
  const environmentPrefillScopeRef = useRef("");
  const configurationPrefillScopeRef = useRef("");
  const dataSetPrefillScopeRef = useRef("");
  const environmentsQuery = optionalQueryView(useQuery({
    queryKey: ["test-environments", projectId, appTypeId],
    queryFn: () => api.testEnvironments.list({ project_id: projectId, app_type_id: appTypeId || undefined }),
    enabled: Boolean(projectId && canViewEnvironments)
  }), canViewEnvironments);
  const configurationsQuery = optionalQueryView(useQuery({
    queryKey: ["test-configurations", projectId, appTypeId],
    queryFn: () => api.testConfigurations.list({ project_id: projectId, app_type_id: appTypeId || undefined }),
    enabled: Boolean(projectId && canViewConfigurations)
  }), canViewConfigurations);
  const dataSetsQuery = optionalQueryView(useQuery({
    queryKey: ["test-data-sets", projectId, appTypeId],
    queryFn: () => api.testDataSets.list({ project_id: projectId, app_type_id: appTypeId || undefined }),
    enabled: Boolean(projectId && canViewTestData)
  }), canViewTestData);

  const environments = useMemo(
    () => filterScopedResources(environmentsQuery.data || [], appTypeId),
    [appTypeId, environmentsQuery.data]
  );
  const configurations = useMemo(
    () => filterScopedResources(configurationsQuery.data || [], appTypeId),
    [appTypeId, configurationsQuery.data]
  );
  const dataSets = useMemo(
    () => filterScopedResources(dataSetsQuery.data || [], appTypeId),
    [appTypeId, dataSetsQuery.data]
  );
  const environmentPrefillScopeKey = useMemo(
    () => `${projectId}:${appTypeId}:${environments.map((item) => item.id).join(",")}`,
    [appTypeId, environments, projectId]
  );
  const configurationPrefillScopeKey = useMemo(
    () => `${projectId}:${appTypeId}:${configurations.map((item) => item.id).join(",")}`,
    [appTypeId, configurations, projectId]
  );
  const dataSetPrefillScopeKey = useMemo(
    () => `${projectId}:${appTypeId}:${dataSets.map((item) => item.id).join(",")}`,
    [appTypeId, dataSets, projectId]
  );

  const isLoading = environmentsQuery.isLoading || configurationsQuery.isLoading || dataSetsQuery.isLoading;
  const hasAnyContext = Boolean(environments.length || configurations.length || dataSets.length);

  useEffect(() => {
    if (canViewEnvironments && !preserveMissingSelection && environmentsQuery.isSuccess && selectedEnvironmentId && !environments.some((item) => item.id === selectedEnvironmentId)) {
      onEnvironmentChange("");
    }
  }, [canViewEnvironments, environments, environmentsQuery.isSuccess, onEnvironmentChange, preserveMissingSelection, selectedEnvironmentId]);

  useEffect(() => {
    if (canViewConfigurations && !preserveMissingSelection && configurationsQuery.isSuccess && selectedConfigurationId && !configurations.some((item) => item.id === selectedConfigurationId)) {
      onConfigurationChange("");
    }
  }, [canViewConfigurations, configurations, configurationsQuery.isSuccess, onConfigurationChange, preserveMissingSelection, selectedConfigurationId]);

  useEffect(() => {
    if (canViewTestData && !preserveMissingSelection && dataSetsQuery.isSuccess && selectedDataSetId && !dataSets.some((item) => item.id === selectedDataSetId)) {
      onDataSetChange("");
    }
  }, [canViewTestData, dataSets, dataSetsQuery.isSuccess, onDataSetChange, preserveMissingSelection, selectedDataSetId]);

  useEffect(() => {
    if (!prefillFirstAvailable || selectedEnvironmentId || !environments.length) {
      return;
    }

    if (environmentPrefillScopeRef.current === environmentPrefillScopeKey) {
      return;
    }

    environmentPrefillScopeRef.current = environmentPrefillScopeKey;
    onEnvironmentChange(environments[0].id);
  }, [environmentPrefillScopeKey, environments, onEnvironmentChange, prefillFirstAvailable, selectedEnvironmentId]);

  useEffect(() => {
    if (!prefillFirstAvailable || selectedConfigurationId || !configurations.length) {
      return;
    }

    if (configurationPrefillScopeRef.current === configurationPrefillScopeKey) {
      return;
    }

    configurationPrefillScopeRef.current = configurationPrefillScopeKey;
    onConfigurationChange(configurations[0].id);
  }, [configurationPrefillScopeKey, configurations, onConfigurationChange, prefillFirstAvailable, selectedConfigurationId]);

  useEffect(() => {
    if (!prefillFirstAvailable || selectedDataSetId || !dataSets.length) {
      return;
    }

    if (dataSetPrefillScopeRef.current === dataSetPrefillScopeKey) {
      return;
    }

    dataSetPrefillScopeRef.current = dataSetPrefillScopeKey;
    onDataSetChange(dataSets[0].id);
  }, [dataSetPrefillScopeKey, dataSets, onDataSetChange, prefillFirstAvailable, selectedDataSetId]);

  if (!canViewEnvironments && !canViewConfigurations && !canViewTestData) return null;

  return (
    <div className="execution-context-block">
      <div className="execution-context-grid">
        {canViewEnvironments ? <ExecutionContextField
          disabled={!canViewEnvironments}
          items={environments}
          label="Test environment"
          onChange={onEnvironmentChange}
          placeholder="No test environment"
          selectedId={selectedEnvironmentId}
        /> : null}
        {canViewConfigurations ? <ExecutionContextField
          disabled={!canViewConfigurations}
          items={configurations}
          label="Test configuration"
          onChange={onConfigurationChange}
          placeholder="No test configuration"
          selectedId={selectedConfigurationId}
        /> : null}
        {canViewTestData ? <ExecutionContextField
          disabled={!canViewTestData}
          labelIcon={<TestDataIcon size={16} />}
          items={dataSets}
          label="Test data"
          onChange={onDataSetChange}
          placeholder="No test data"
          selectedId={selectedDataSetId}
        /> : null}
      </div>

      {projectId && !isLoading && !hasAnyContext ? (
        <div className="empty-state compact">No environment, configuration, or test data resources are available for this scope yet.</div>
      ) : null}
    </div>
  );
}

function ExecutionContextField<T extends TestEnvironment | TestConfiguration | TestDataSet>({
  disabled,
  label,
  labelIcon,
  items,
  selectedId,
  placeholder,
  onChange
}: {
  disabled?: boolean;
  label: string;
  labelIcon?: ReactNode;
  items: T[];
  selectedId: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <FormField label={label} labelIcon={labelIcon}>
      <select disabled={disabled} value={selectedId} onChange={(event) => onChange(event.target.value)}>
        <option value="">{placeholder}</option>
        {selectedId && !items.some((item) => item.id === selectedId) ? <option value={selectedId}>Current attachment · unavailable in this list</option> : null}
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name} {item.app_type_id ? "· Scoped" : "· Shared"}
          </option>
        ))}
      </select>
    </FormField>
  );
}
