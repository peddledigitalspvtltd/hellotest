import { FormEvent, useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AddIcon } from "../components/AppIcons";
import { FormField } from "../components/FormField";
import { InfoTooltip } from "../components/InfoTooltip";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { TileBrowserPane } from "../components/TileBrowserPane";
import { TileCardSkeletonGrid } from "../components/TileCardSkeletonGrid";
import { ToastMessage } from "../components/ToastMessage";
import { TileCardStatusIndicator } from "../components/TileCardPrimitives";
import { WorkspaceSectionTabs } from "../components/WorkspaceSectionTabs";
import { WorkspaceBackButton, WorkspaceMasterDetail } from "../components/WorkspaceMasterDetail";
import { WorkspaceScopeBar } from "../components/WorkspaceScopeBar";
import { useDeleteConfirmation } from "../components/DeleteConfirmationDialog";
import { useCurrentAppType, useCurrentProject } from "../hooks/useCurrentProject";
import { useDomainMetadata } from "../hooks/useDomainMetadata";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { api } from "../lib/api";
import { parseTestDataFile, toKeyValueRows } from "../lib/testDataImport";
import { countGeneratedTestDataFields, hasTestDataGeneratorTemplate, materializeTestDataRows, TEST_DATA_GENERATOR_TEMPLATES } from "../lib/testDataGenerators";
import { TEST_ENVIRONMENT_SECTION_ITEMS } from "../lib/workspaceSections";
import type { KeyValueEntry, TestConfiguration, TestDataSet, TestDataSetMode, TestDataSetRow, TestEnvironment } from "../types";

type TestEnvironmentPageView = "environments" | "data" | "configurations";

type TestDataUtilityOption = {
  id: string;
  key: string;
  label: string;
  template: string;
  group: "Data utility" | "Saved template";
  source?: string;
};

const DEFAULT_TEST_DATA_UTILS: TestDataUtilityOption[] = [
  { id: "default-yopmail", key: "email", label: "Yopmail email", template: TEST_DATA_GENERATOR_TEMPLATES.yopmail, group: "Data utility" },
  { id: "default-date", key: "run_date", label: "Today's date", template: TEST_DATA_GENERATOR_TEMPLATES.date, group: "Data utility" },
  { id: "default-tomorrow", key: "future_date", label: "Tomorrow", template: TEST_DATA_GENERATOR_TEMPLATES.tomorrow, group: "Data utility" },
  { id: "default-random-string", key: "unique_id", label: "Random text", template: TEST_DATA_GENERATOR_TEMPLATES.randomString, group: "Data utility" },
  { id: "default-random-number", key: "random_number", label: "Random number", template: TEST_DATA_GENERATOR_TEMPLATES.randomNumber, group: "Data utility" },
  { id: "default-timestamp", key: "timestamp", label: "Timestamp", template: TEST_DATA_GENERATOR_TEMPLATES.timestamp, group: "Data utility" },
  { id: "default-ai-data", key: "ai_data", label: "AI data", template: TEST_DATA_GENERATOR_TEMPLATES.aiData, group: "Data utility" }
];

type EnvironmentDraft = {
  name: string;
  description: string;
  base_url: string;
  variables: KeyValueEntry[];
};

type ConfigurationDraft = {
  name: string;
  description: string;
  browser: string;
  mobile_os: string;
  platform_version: string;
  variables: KeyValueEntry[];
};

type DataSetDraft = {
  name: string;
  description: string;
  mode: TestDataSetMode;
  columns: string[];
  rows: TestDataSetRow[];
};

type DataSetBuildResult = {
  payload: {
    project_id: string;
    app_type_id?: string;
    name: string;
    description?: string;
    mode: TestDataSetMode;
    columns: string[];
    rows: TestDataSetRow[];
  };
  didSanitizeInvalidChars: boolean;
};

function TestDataUtilityIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="22" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" viewBox="0 0 24 24" width="22">
      <ellipse cx="10" cy="5" rx="7" ry="3" fill="currentColor" opacity="0.16" />
      <path d="M3 5v8c0 1.7 3.1 3 7 3 1.1 0 2.1-.1 3-.4" />
      <path d="M17 5v4.5" />
      <path d="M3 9c0 1.7 3.1 3 7 3 1.1 0 2.1-.1 3-.4" />
      <path d="M3 13c0 1.7 3.1 3 7 3" />
      <circle cx="17" cy="16" r="2.3" />
      <path d="M17 11.5v1.2" />
      <path d="M17 19.3v1.2" />
      <path d="m13.1 13.7.9.8" />
      <path d="m20 17.5.9.8" />
      <path d="M12.5 16h1.2" />
      <path d="M20.3 16h1.2" />
      <path d="m13.1 18.3.9-.8" />
      <path d="m20 14.5.9-.8" />
    </svg>
  );
}

function TableExpandIcon({ isExpanded }: { isExpanded: boolean }) {
  return (
    <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" viewBox="0 0 24 24" width="16">
      {isExpanded ? (
        <>
          <path d="M8 3v5H3" />
          <path d="M16 3v5h5" />
          <path d="M8 21v-5H3" />
          <path d="M16 21v-5h5" />
        </>
      ) : (
        <>
          <path d="M8 3H3v5" />
          <path d="M16 3h5v5" />
          <path d="M8 21H3v-5" />
          <path d="M16 21h5v-5" />
        </>
      )}
    </svg>
  );
}

const INVALID_DATA_SET_CHAR_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const INVALID_DATA_SET_CHAR_CHECK = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

const createKeyValueEntry = (): KeyValueEntry => ({
  id: globalThis.crypto?.randomUUID?.() || `kv-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  key: "",
  value: "",
  is_secret: false,
  has_stored_value: false
});

const buildEmptyEnvironmentDraft = (): EnvironmentDraft => ({
  name: "",
  description: "",
  base_url: "",
  variables: []
});

const buildEmptyConfigurationDraft = (): ConfigurationDraft => ({
  name: "",
  description: "",
  browser: "",
  mobile_os: "",
  platform_version: "",
  variables: []
});

const buildEmptyDataSetDraft = (defaultMode: TestDataSetMode = "table"): DataSetDraft => ({
  name: "",
  description: "",
  mode: defaultMode,
  columns: [],
  rows: []
});

const sanitizeDataSetText = (value: unknown) =>
  String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(INVALID_DATA_SET_CHAR_PATTERN, "");

const hasInvalidDataSetChars = (value: unknown) => INVALID_DATA_SET_CHAR_CHECK.test(String(value ?? ""));

const normalizeDataSetName = (value: unknown) => sanitizeDataSetText(value).trim();

const normalizeDataSetDescription = (value: unknown) => sanitizeDataSetText(value);

const normalizeVariableRows = (rows: KeyValueEntry[]) =>
  rows
    .map((row) => ({
      id: row.id,
      key: row.key.trim(),
      value: row.value ?? "",
      is_secret: Boolean(row.is_secret),
      has_stored_value: Boolean(row.has_stored_value)
    }))
    .filter((row) => row.key);

const normalizeDataSetKeyValueRows = (rows: TestDataSetRow[]) =>
  rows
    .map((row) => ({
      key: normalizeDataSetName(row.key ?? ""),
      value: sanitizeDataSetText(row.value ?? "")
    }))
    .filter((row) => row.key);

const normalizeTableColumns = (columns: string[]) =>
  [...new Set(columns.map((column) => normalizeDataSetName(column)).filter(Boolean))];

const normalizeTableRows = (rows: TestDataSetRow[], columns: string[]) =>
  rows
    .map((row) =>
      columns.reduce<TestDataSetRow>((accumulator, column) => {
        accumulator[column] = sanitizeDataSetText(row[column] ?? "");
        return accumulator;
      }, {})
    )
    .filter((row) => Object.values(row).some((value) => value.trim()));

const environmentToDraft = (environment: TestEnvironment): EnvironmentDraft => ({
  name: environment.name,
  description: environment.description || "",
  base_url: environment.base_url || "",
  variables: environment.variables
});

const configurationToDraft = (configuration: TestConfiguration): ConfigurationDraft => ({
  name: configuration.name,
  description: configuration.description || "",
  browser: configuration.browser || "",
  mobile_os: configuration.mobile_os || "",
  platform_version: configuration.platform_version || "",
  variables: configuration.variables
});

const dataSetToDraft = (dataSet: TestDataSet): DataSetDraft => ({
  name: dataSet.name,
  description: dataSet.description || "",
  mode: dataSet.mode,
  columns: dataSet.mode === "table" ? dataSet.columns : ["key", "value"],
  rows: dataSet.rows
});

const createTemplateKey = (value: unknown) =>
  String(value || "template")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "template";

const collectTemplateUtilitiesFromRows = ({
  rows,
  source,
  columns = []
}: {
  rows: TestDataSetRow[];
  source: string;
  columns?: string[];
}) => {
  const seen = new Set<string>();

  return rows.flatMap((row, rowIndex) =>
    Object.entries(row).flatMap(([field, value]) => {
      const template = String(value ?? "").trim();

      if (!template || !hasTestDataGeneratorTemplate(template) || seen.has(template)) {
        return [];
      }

      seen.add(template);
      const fieldLabel = field === "value" && row.key ? String(row.key) : field;
      const columnLabel = columns.includes(field) ? field : fieldLabel;

      return [{
        id: `saved-${createTemplateKey(source)}-${createTemplateKey(columnLabel)}-${rowIndex}`,
        key: createTemplateKey(columnLabel),
        label: columnLabel || "Saved template",
        template,
        group: "Saved template" as const,
        source
      }];
    })
  );
};

const buildDataUtilityOptions = (draft: DataSetDraft, dataSets: TestDataSet[] = []): TestDataUtilityOption[] => {
  const defaultTemplateValues = new Set(DEFAULT_TEST_DATA_UTILS.map((item) => item.template));
  const seenTemplates = new Set(defaultTemplateValues);
  const savedOptions = [
    ...collectTemplateUtilitiesFromRows({
      rows: draft.rows,
      columns: draft.columns,
      source: draft.name.trim() || "Current draft"
    }),
    ...dataSets.flatMap((dataSet) =>
      collectTemplateUtilitiesFromRows({
        rows: dataSet.rows,
        columns: dataSet.columns,
        source: dataSet.name
      })
    )
  ].filter((item) => {
    if (seenTemplates.has(item.template)) {
      return false;
    }

    seenTemplates.add(item.template);
    return true;
  });

  return [...DEFAULT_TEST_DATA_UTILS, ...savedOptions];
};

const convertDraftToKeyValueRows = (draft: DataSetDraft) => {
  if (draft.mode === "key_value") {
    return draft.rows.map((row) => ({
      key: String(row.key ?? ""),
      value: String(row.value ?? "")
    }));
  }

  return toKeyValueRows(draft.columns, draft.rows);
};

const switchDataSetDraftMode = (draft: DataSetDraft, nextMode: TestDataSetMode): DataSetDraft => {
  if (nextMode === draft.mode) {
    return draft;
  }

  if (nextMode === "key_value") {
    return {
      ...draft,
      mode: "key_value",
      columns: ["key", "value"],
      rows: convertDraftToKeyValueRows(draft)
    };
  }

  const nextRows = draft.mode === "key_value"
    ? draft.rows
        .map((row) => ({
          key: String(row.key ?? ""),
          value: String(row.value ?? "")
        }))
        .filter((row) => row.key || row.value)
    : draft.rows;

  return {
    ...draft,
    mode: "table",
    columns: nextRows.length ? ["key", "value"] : [],
    rows: nextRows
  };
};

const moveArrayItem = <T,>(items: T[], fromIndex: number, toIndex: number) => {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= items.length || toIndex >= items.length) {
    return items;
  }

  const nextItems = [...items];
  const [movedItem] = nextItems.splice(fromIndex, 1);
  nextItems.splice(toIndex, 0, movedItem);
  return nextItems;
};

const getSpreadsheetColumnLabel = (index: number) => {
  let label = "";
  let value = index + 1;

  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }

  return label;
};

const draftHasInvalidDataSetChars = (draft: DataSetDraft) => {
  if (hasInvalidDataSetChars(draft.name) || hasInvalidDataSetChars(draft.description)) {
    return true;
  }

  if (draft.columns.some((column) => hasInvalidDataSetChars(column))) {
    return true;
  }

  return draft.rows.some((row) => Object.values(row).some((value) => hasInvalidDataSetChars(value)));
};

const formatConfigurationTarget = (configuration: Pick<TestConfiguration, "browser" | "mobile_os" | "platform_version">) =>
  [configuration.browser, configuration.mobile_os, configuration.platform_version].filter(Boolean).join(" · ");

export function TestEnvironmentPage({ view }: { view: TestEnvironmentPageView }) {
  const queryClient = useQueryClient();
  const domainMetadataQuery = useDomainMetadata();
  const { confirmDelete, confirmationDialog } = useDeleteConfirmation();
  const [projectId, setProjectId] = useCurrentProject();
  const [appTypeId, setAppTypeId] = useCurrentAppType(projectId);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState("");
  const [selectedConfigurationId, setSelectedConfigurationId] = useState("");
  const [selectedDataSetId, setSelectedDataSetId] = useState("");
  const browserOptions = domainMetadataQuery.data?.test_environments.browsers || [];
  const mobileOsOptions = domainMetadataQuery.data?.test_environments.mobile_os || [];
  const dataSetModeOptions = domainMetadataQuery.data?.test_data_sets.modes || [];
  const defaultDataSetMode = (domainMetadataQuery.data?.test_data_sets.default_mode || "table") as TestDataSetMode;
  const emptyDataSetDraft = useMemo(() => buildEmptyDataSetDraft(defaultDataSetMode), [defaultDataSetMode]);
  const [environmentDraft, setEnvironmentDraft] = useState<EnvironmentDraft>(buildEmptyEnvironmentDraft());
  const [configurationDraft, setConfigurationDraft] = useState<ConfigurationDraft>(buildEmptyConfigurationDraft());
  const [dataSetDraft, setDataSetDraft] = useState<DataSetDraft>(() => buildEmptyDataSetDraft());
  const [createEnvironmentDraft, setCreateEnvironmentDraft] = useState<EnvironmentDraft>(buildEmptyEnvironmentDraft());
  const [createConfigurationDraft, setCreateConfigurationDraft] = useState<ConfigurationDraft>(buildEmptyConfigurationDraft());
  const [createDataSetDraft, setCreateDataSetDraft] = useState<DataSetDraft>(() => buildEmptyDataSetDraft());
  const [isCreateEnvironmentModalOpen, setIsCreateEnvironmentModalOpen] = useState(false);
  const [isCreateConfigurationModalOpen, setIsCreateConfigurationModalOpen] = useState(false);
  const [isCreateDataSetModalOpen, setIsCreateDataSetModalOpen] = useState(false);

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: api.projects.list
  });
  const appTypesQuery = useQuery({
    queryKey: ["app-types", projectId],
    queryFn: () => api.appTypes.list({ project_id: projectId }),
    enabled: Boolean(projectId)
  });
  const environmentsQuery = useQuery({
    queryKey: ["test-environments", projectId, appTypeId],
    queryFn: () => api.testEnvironments.list({ project_id: projectId, app_type_id: appTypeId || undefined }),
    enabled: Boolean(projectId)
  });
  const configurationsQuery = useQuery({
    queryKey: ["test-configurations", projectId, appTypeId],
    queryFn: () => api.testConfigurations.list({ project_id: projectId, app_type_id: appTypeId || undefined }),
    enabled: Boolean(projectId)
  });
  const dataSetsQuery = useQuery({
    queryKey: ["test-data-sets", projectId, appTypeId],
    queryFn: () => api.testDataSets.list({ project_id: projectId, app_type_id: appTypeId || undefined }),
    enabled: Boolean(projectId)
  });

  const createEnvironment = useMutation({ mutationFn: api.testEnvironments.create });
  const updateEnvironment = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof api.testEnvironments.update>[1] }) =>
      api.testEnvironments.update(id, input)
  });
  const deleteEnvironment = useMutation({ mutationFn: api.testEnvironments.delete });
  const createConfiguration = useMutation({ mutationFn: api.testConfigurations.create });
  const updateConfiguration = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof api.testConfigurations.update>[1] }) =>
      api.testConfigurations.update(id, input)
  });
  const deleteConfiguration = useMutation({ mutationFn: api.testConfigurations.delete });
  const createDataSet = useMutation({ mutationFn: api.testDataSets.create });
  const updateDataSet = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof api.testDataSets.update>[1] }) =>
      api.testDataSets.update(id, input)
  });
  const deleteDataSet = useMutation({ mutationFn: api.testDataSets.delete });

  const projects = projectsQuery.data || [];
  const appTypes = appTypesQuery.data || [];
  const environments = environmentsQuery.data || [];
  const configurations = configurationsQuery.data || [];
  const dataSets = dataSetsQuery.data || [];
  const selectedEnvironment = environments.find((item) => item.id === selectedEnvironmentId) || null;
  const selectedConfiguration = configurations.find((item) => item.id === selectedConfigurationId) || null;
  const selectedDataSet = dataSets.find((item) => item.id === selectedDataSetId) || null;
  const selectedProjectName = projects.find((project) => String(project.id) === String(projectId))?.name || "No project selected";
  const selectedAppTypeName = appTypes.find((item) => item.id === appTypeId)?.name || "All app types";
  const currentCreateLabel =
    view === "environments" ? "Create test environment" : view === "configurations" ? "Create configuration" : "Create test data";
  const currentViewDescription =
    view === "environments"
      ? "Keep run targets, URLs, and reusable environment variables organized by project and app type."
      : view === "configurations"
        ? "Maintain reusable browser, device, and platform combinations so runs stay consistent."
        : "Store JSON, spreadsheet-style data, and key/value sets that can be attached to runs on demand.";
  const currentViewCount = view === "environments" ? environments.length : view === "configurations" ? configurations.length : dataSets.length;

  const showSuccess = (text: string) => {
    setMessageTone("success");
    setMessage(text);
  };

  const showError = (error: unknown, fallback: string) => {
    setMessageTone("error");
    setMessage(error instanceof Error ? error.message : fallback);
  };

  useEffect(() => {
    if (appTypesQuery.isPending) {
      return;
    }

    const scopedAppTypes = projectId
      ? appTypes.filter((item) => String(item.project_id) === String(projectId))
      : appTypes;

    if (projectId && appTypes.length && !scopedAppTypes.length) {
      return;
    }

    if (!scopedAppTypes.length) {
      setAppTypeId("");
      return;
    }

    if (!scopedAppTypes.some((item) => item.id === appTypeId)) {
      setAppTypeId(scopedAppTypes[0].id);
    }
  }, [appTypeId, appTypes, appTypesQuery.isPending, projectId, setAppTypeId]);

  useEffect(() => {
    setSelectedEnvironmentId((current) => (current && environments.some((item) => item.id === current) ? current : ""));
  }, [environments]);

  useEffect(() => {
    setSelectedConfigurationId((current) =>
      current && configurations.some((item) => item.id === current) ? current : ""
    );
  }, [configurations]);

  useEffect(() => {
    setSelectedDataSetId((current) => (current && dataSets.some((item) => item.id === current) ? current : ""));
  }, [dataSets]);

  useEffect(() => {
    if (selectedEnvironment) {
      setEnvironmentDraft(environmentToDraft(selectedEnvironment));
    } else {
      setEnvironmentDraft(buildEmptyEnvironmentDraft());
    }
  }, [selectedEnvironment]);

  useEffect(() => {
    if (selectedConfiguration) {
      setConfigurationDraft(configurationToDraft(selectedConfiguration));
    } else {
      setConfigurationDraft(buildEmptyConfigurationDraft());
    }
  }, [selectedConfiguration]);

  useEffect(() => {
    if (selectedDataSet) {
      setDataSetDraft(dataSetToDraft(selectedDataSet));
    } else {
      setDataSetDraft(emptyDataSetDraft);
    }
  }, [selectedDataSet]);

  const refreshResources = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["test-environments", projectId, appTypeId] }),
      queryClient.invalidateQueries({ queryKey: ["test-configurations", projectId, appTypeId] }),
      queryClient.invalidateQueries({ queryKey: ["test-data-sets", projectId, appTypeId] })
    ]);
  };

  const openCreateModal = () => {
    if (view === "environments") {
      setCreateEnvironmentDraft(buildEmptyEnvironmentDraft());
      setIsCreateEnvironmentModalOpen(true);
      return;
    }

    if (view === "configurations") {
      setCreateConfigurationDraft(buildEmptyConfigurationDraft());
      setIsCreateConfigurationModalOpen(true);
      return;
    }

    setCreateDataSetDraft(emptyDataSetDraft);
    setIsCreateDataSetModalOpen(true);
  };

  const closeResourceWorkspace = () => {
    if (view === "environments") {
      setSelectedEnvironmentId("");
      return;
    }

    if (view === "configurations") {
      setSelectedConfigurationId("");
      return;
    }

    setSelectedDataSetId("");
  };

  const handleCreateEnvironment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    try {
      const response = await createEnvironment.mutateAsync({
        project_id: projectId,
        app_type_id: appTypeId || undefined,
        name: createEnvironmentDraft.name,
        description: createEnvironmentDraft.description || undefined,
        base_url: createEnvironmentDraft.base_url || undefined,
        variables: normalizeVariableRows(createEnvironmentDraft.variables)
      });
      setIsCreateEnvironmentModalOpen(false);
      setSelectedEnvironmentId(response.id);
      showSuccess("Test environment created.");
      await refreshResources();
    } catch (error) {
      showError(error, "Unable to create test environment");
    }
  };

  const handleUpdateEnvironment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedEnvironment) {
      return;
    }

    try {
      await updateEnvironment.mutateAsync({
        id: selectedEnvironment.id,
        input: {
          project_id: projectId,
          app_type_id: selectedEnvironment.app_type_id || "",
          name: environmentDraft.name,
          description: environmentDraft.description,
          base_url: environmentDraft.base_url,
          variables: normalizeVariableRows(environmentDraft.variables)
        }
      });
      showSuccess("Test environment updated.");
      await refreshResources();
    } catch (error) {
      showError(error, "Unable to update test environment");
    }
  };

  const handleDeleteEnvironment = async () => {
    if (!selectedEnvironment || !(await confirmDelete({ message: `Delete test environment "${selectedEnvironment.name}"?` }))) {
      return;
    }

    try {
      await deleteEnvironment.mutateAsync(selectedEnvironment.id);
      setSelectedEnvironmentId("");
      showSuccess("Test environment deleted.");
      await refreshResources();
    } catch (error) {
      showError(error, "Unable to delete test environment");
    }
  };

  const handleCreateConfiguration = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    try {
      const response = await createConfiguration.mutateAsync({
        project_id: projectId,
        app_type_id: appTypeId || undefined,
        name: createConfigurationDraft.name,
        description: createConfigurationDraft.description || undefined,
        browser: createConfigurationDraft.browser || undefined,
        mobile_os: createConfigurationDraft.mobile_os || undefined,
        platform_version: createConfigurationDraft.platform_version || undefined,
        variables: normalizeVariableRows(createConfigurationDraft.variables)
      });
      setIsCreateConfigurationModalOpen(false);
      setSelectedConfigurationId(response.id);
      showSuccess("Test configuration created.");
      await refreshResources();
    } catch (error) {
      showError(error, "Unable to create test configuration");
    }
  };

  const handleUpdateConfiguration = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedConfiguration) {
      return;
    }

    try {
      await updateConfiguration.mutateAsync({
        id: selectedConfiguration.id,
        input: {
          project_id: projectId,
          app_type_id: selectedConfiguration.app_type_id || "",
          name: configurationDraft.name,
          description: configurationDraft.description,
          browser: configurationDraft.browser,
          mobile_os: configurationDraft.mobile_os,
          platform_version: configurationDraft.platform_version,
          variables: normalizeVariableRows(configurationDraft.variables)
        }
      });
      showSuccess("Test configuration updated.");
      await refreshResources();
    } catch (error) {
      showError(error, "Unable to update test configuration");
    }
  };

  const handleDeleteConfiguration = async () => {
    if (!selectedConfiguration || !(await confirmDelete({ message: `Delete test configuration "${selectedConfiguration.name}"?` }))) {
      return;
    }

    try {
      await deleteConfiguration.mutateAsync(selectedConfiguration.id);
      setSelectedConfigurationId("");
      showSuccess("Test configuration deleted.");
      await refreshResources();
    } catch (error) {
      showError(error, "Unable to delete test configuration");
    }
  };

  const handleCreateDataSet = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    try {
      const { payload, didSanitizeInvalidChars } = buildDataSetPayload(projectId, appTypeId || undefined, createDataSetDraft);
      const response = await createDataSet.mutateAsync(payload);
      setIsCreateDataSetModalOpen(false);
      setSelectedDataSetId(response.id);
      showSuccess(didSanitizeInvalidChars ? "Test data created. Invalid characters were removed automatically." : "Test data created.");
      await refreshResources();
    } catch (error) {
      showError(error, "Unable to create test data");
    }
  };

  const handleUpdateDataSet = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedDataSet) {
      return;
    }

    try {
      const { payload, didSanitizeInvalidChars } = buildDataSetPayload(projectId, selectedDataSet.app_type_id || undefined, dataSetDraft);
      await updateDataSet.mutateAsync({
        id: selectedDataSet.id,
        input: payload
      });
      showSuccess(didSanitizeInvalidChars ? "Test data updated. Invalid characters were removed automatically." : "Test data updated.");
      await refreshResources();
    } catch (error) {
      showError(error, "Unable to update test data");
    }
  };

  const handleDeleteDataSet = async () => {
    if (!selectedDataSet || !(await confirmDelete({ message: `Delete test data "${selectedDataSet.name}"?` }))) {
      return;
    }

    try {
      await deleteDataSet.mutateAsync(selectedDataSet.id);
      setSelectedDataSetId("");
      showSuccess("Test data deleted.");
      await refreshResources();
    } catch (error) {
      showError(error, "Unable to delete test data");
    }
  };

  return (
    <div className="page-content">
      {confirmationDialog}
      <PageHeader
        eyebrow="Test Environment"
        title="Run context workspace"
        description={currentViewDescription}
        meta={[
          { label: "Records", value: currentViewCount },
          { label: "Project", value: selectedProjectName },
          { label: "Scope", value: selectedAppTypeName }
        ]}
        actions={<button className="primary-button" disabled={!projectId} onClick={openCreateModal} type="button"><AddIcon />{currentCreateLabel}</button>}
      />

      <ToastMessage message={message} onDismiss={() => setMessage("")} tone={messageTone} />

      <WorkspaceScopeBar
        appTypeId={appTypeId}
        appTypes={appTypes}
        onAppTypeChange={setAppTypeId}
        onProjectChange={setProjectId}
        projectId={projectId}
        projects={projects}
      />

      <WorkspaceSectionTabs
        ariaLabel="Test environment sections"
        items={TEST_ENVIRONMENT_SECTION_ITEMS.map((item) => ({
          ...item,
          meta:
            item.to === "/test-environments"
              ? `${environments.length} records`
              : item.to === "/test-data"
                ? `${dataSets.length} records`
                : `${configurations.length} records`
        }))}
      />

      {view === "environments" ? (
        <WorkspaceMasterDetail
          browseView={(
            <Panel title="Environments" titleVariant="eyebrow" subtitle="Browse run targets as tiles first, then open one environment into a focused editor.">
              <TileBrowserPane className="test-environment-list">
                {environmentsQuery.isLoading ? <TileCardSkeletonGrid /> : null}
                {!environmentsQuery.isLoading && environments.length ? (
                  <div className="tile-browser-grid">
                    {environments.map((environment) => (
                      <button
                        className={selectedEnvironmentId === environment.id ? "record-card tile-card is-active" : "record-card tile-card"}
                        key={environment.id}
                        onClick={() => setSelectedEnvironmentId(environment.id)}
                        type="button"
                      >
                        <div className="tile-card-main">
                          <div className="tile-card-header">
                            <span className="resource-card-badge">URL</span>
                            <div className="tile-card-title-group">
                              <strong>{environment.name}</strong>
                              <span className="tile-card-kicker">{selectedAppTypeName}</span>
                            </div>
                            <TileCardStatusIndicator title={environment.base_url ? "Base URL configured" : "Draft target"} tone={environment.base_url ? "success" : "neutral"} />
                          </div>
                          <p className="tile-card-description">{environment.base_url || environment.description || "No environment URL or summary defined yet."}</p>
                          <div className="resource-card-footer">
                            <span className="count-pill">{environment.variables.length} variable{environment.variables.length === 1 ? "" : "s"}</span>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : null}
                {!environmentsQuery.isLoading && !environments.length ? <div className="empty-state compact">No test environments defined for this scope yet.</div> : null}
              </TileBrowserPane>
            </Panel>
          )}
          detailView={(
            <Panel
              actions={<WorkspaceBackButton label="Back to environment tiles" onClick={closeResourceWorkspace} />}
              title="Selected environment"
              subtitle={selectedEnvironment ? "Refine the target without leaving the list." : "Create an environment to start reusing run targets."}
            >
              {selectedEnvironment ? (
                <EnvironmentForm
                  draft={environmentDraft}
                  isSubmitting={updateEnvironment.isPending}
                  onChange={setEnvironmentDraft}
                  onDelete={handleDeleteEnvironment}
                  onSubmit={handleUpdateEnvironment}
                  submitLabel={updateEnvironment.isPending ? "Saving…" : "Save environment"}
                />
              ) : (
                <div className="empty-state compact">No environment selected.</div>
              )}
            </Panel>
          )}
          isDetailOpen={Boolean(selectedEnvironment)}
        />
      ) : null}

      {view === "configurations" ? (
        <WorkspaceMasterDetail
          browseView={(
            <Panel title="Configurations" titleVariant="eyebrow" subtitle="Browse reusable browser and device profiles as cards before opening one into the editor.">
              <TileBrowserPane className="test-environment-list">
                {configurationsQuery.isLoading ? <TileCardSkeletonGrid /> : null}
                {!configurationsQuery.isLoading && configurations.length ? (
                  <div className="tile-browser-grid">
                    {configurations.map((configuration) => (
                      <button
                        className={selectedConfigurationId === configuration.id ? "record-card tile-card is-active" : "record-card tile-card"}
                        key={configuration.id}
                        onClick={() => setSelectedConfigurationId(configuration.id)}
                        type="button"
                      >
                        <div className="tile-card-main">
                          <div className="tile-card-header">
                            <span className="resource-card-badge">CFG</span>
                            <div className="tile-card-title-group">
                              <strong>{configuration.name}</strong>
                              <span className="tile-card-kicker">{selectedAppTypeName}</span>
                            </div>
                            <TileCardStatusIndicator title={formatConfigurationTarget(configuration) ? "Target configured" : "Draft profile"} tone={formatConfigurationTarget(configuration) ? "success" : "neutral"} />
                          </div>
                          <p className="tile-card-description">{formatConfigurationTarget(configuration) || configuration.description || "No browser, mobile OS, or version defined yet."}</p>
                          <div className="resource-card-footer">
                            <span className="count-pill">{configuration.variables.length} variable{configuration.variables.length === 1 ? "" : "s"}</span>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : null}
                {!configurationsQuery.isLoading && !configurations.length ? <div className="empty-state compact">No test configurations defined for this scope yet.</div> : null}
              </TileBrowserPane>
            </Panel>
          )}
          detailView={(
            <Panel
              actions={<WorkspaceBackButton label="Back to configuration tiles" onClick={closeResourceWorkspace} />}
              title="Selected configuration"
              subtitle={selectedConfiguration ? "Update the reusable run settings in place." : "Create a configuration to start reusing it in runs."}
            >
              {selectedConfiguration ? (
                <ConfigurationForm
                  browserOptions={browserOptions}
                  draft={configurationDraft}
                  isSubmitting={updateConfiguration.isPending}
                  mobileOsOptions={mobileOsOptions}
                  onChange={setConfigurationDraft}
                  onDelete={handleDeleteConfiguration}
                  onSubmit={handleUpdateConfiguration}
                  submitLabel={updateConfiguration.isPending ? "Saving…" : "Save configuration"}
                />
              ) : (
                <div className="empty-state compact">No configuration selected.</div>
              )}
            </Panel>
          )}
          isDetailOpen={Boolean(selectedConfiguration)}
        />
      ) : null}

      {view === "data" ? (
        <WorkspaceMasterDetail
          browseView={(
            <Panel title="Test Data" titleVariant="eyebrow" subtitle="Review reusable data sets as cards first, then open one source into a focused editor.">
              <TileBrowserPane className="test-environment-list">
                {dataSetsQuery.isLoading ? <TileCardSkeletonGrid /> : null}
                {!dataSetsQuery.isLoading && dataSets.length ? (
                  <div className="tile-browser-grid">
                    {dataSets.map((dataSet) => (
                      <button
                        className={selectedDataSetId === dataSet.id ? "record-card tile-card is-active" : "record-card tile-card"}
                        key={dataSet.id}
                        onClick={() => setSelectedDataSetId(dataSet.id)}
                        type="button"
                      >
                        <div className="tile-card-main">
                          <div className="tile-card-header">
                            <span className="resource-card-badge test-data-card-icon"><TestDataUtilityIcon /></span>
                            <div className="tile-card-title-group">
                              <strong>{dataSet.name}</strong>
                              <span className="tile-card-kicker">{dataSet.mode === "table" ? "Table mode" : "Key/value mode"}</span>
                            </div>
                            <TileCardStatusIndicator title={dataSet.mode === "table" ? "Table data set" : "Key/value data set"} tone={dataSet.rows.length ? "success" : "neutral"} />
                          </div>
                          <p className="tile-card-description">{dataSet.description || "No test data summary defined yet."}</p>
                          <div className="resource-card-footer">
                            <span className="count-pill">{dataSet.mode === "table" ? `${dataSet.rows.length} rows · ${dataSet.columns.length} columns` : `${dataSet.rows.length} key/value pairs`}</span>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : null}
                {!dataSetsQuery.isLoading && !dataSets.length ? <div className="empty-state compact">No test data sets defined for this scope yet.</div> : null}
              </TileBrowserPane>
            </Panel>
          )}
          detailView={(
            <Panel
              actions={<WorkspaceBackButton label="Back to test data tiles" onClick={closeResourceWorkspace} />}
              title="Selected test data"
              subtitle={selectedDataSet ? "Maintain reusable run data without leaving the workspace." : "Create a test data set to start attaching data to runs."}
            >
              {selectedDataSet ? (
                <DataSetForm
                  dataSetModeOptions={dataSetModeOptions}
                  draft={dataSetDraft}
                  isSubmitting={updateDataSet.isPending}
                  onChange={setDataSetDraft}
                  onDelete={handleDeleteDataSet}
                  onSubmit={handleUpdateDataSet}
                  savedDataSets={dataSets}
                  submitLabel={updateDataSet.isPending ? "Saving…" : "Save test data"}
                />
              ) : (
                <div className="empty-state compact">No test data set selected.</div>
              )}
            </Panel>
          )}
          isDetailOpen={Boolean(selectedDataSet)}
        />
      ) : null}

      {isCreateEnvironmentModalOpen ? (
        <ResourceModalShell
          onClose={() => !createEnvironment.isPending && setIsCreateEnvironmentModalOpen(false)}
          title="Create test environment"
        >
          <EnvironmentForm
            draft={createEnvironmentDraft}
            isSubmitting={createEnvironment.isPending}
            onChange={setCreateEnvironmentDraft}
            onSubmit={handleCreateEnvironment}
            submitLabel={createEnvironment.isPending ? "Creating…" : "Create environment"}
          />
        </ResourceModalShell>
      ) : null}

      {isCreateConfigurationModalOpen ? (
        <ResourceModalShell
          onClose={() => !createConfiguration.isPending && setIsCreateConfigurationModalOpen(false)}
          title="Create configuration"
        >
          <ConfigurationForm
            browserOptions={browserOptions}
            draft={createConfigurationDraft}
            isSubmitting={createConfiguration.isPending}
            mobileOsOptions={mobileOsOptions}
            onChange={setCreateConfigurationDraft}
            onSubmit={handleCreateConfiguration}
            submitLabel={createConfiguration.isPending ? "Creating…" : "Create configuration"}
          />
        </ResourceModalShell>
      ) : null}

      {isCreateDataSetModalOpen ? (
        <ResourceModalShell
          onClose={() => !createDataSet.isPending && setIsCreateDataSetModalOpen(false)}
          title="Create test data"
        >
          <DataSetForm
            dataSetModeOptions={dataSetModeOptions}
            draft={createDataSetDraft}
            isSubmitting={createDataSet.isPending}
            onChange={setCreateDataSetDraft}
            onSubmit={handleCreateDataSet}
            savedDataSets={dataSets}
            submitLabel={createDataSet.isPending ? "Creating…" : "Create test data"}
          />
        </ResourceModalShell>
      ) : null}
    </div>
  );
}

function buildDataSetPayload(projectId: string, appTypeId: string | undefined, draft: DataSetDraft): DataSetBuildResult {
  const mode = draft.mode;
  const columns = mode === "table" ? normalizeTableColumns(draft.columns) : ["key", "value"];
  const rows =
    mode === "table"
      ? normalizeTableRows(draft.rows, columns)
      : normalizeDataSetKeyValueRows(draft.rows);

  return {
    didSanitizeInvalidChars: draftHasInvalidDataSetChars(draft),
    payload: {
      project_id: projectId,
      app_type_id: appTypeId || undefined,
      name: normalizeDataSetName(draft.name),
      description: normalizeDataSetDescription(draft.description) || undefined,
      mode,
      columns,
      rows
    }
  };
}

function ResourceModalShell({
  title,
  children,
  onClose
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const dialogRef = useDialogFocus<HTMLDivElement>();

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        aria-label={title}
        aria-modal="true"
        className="modal-card resource-modal-card"
        onClick={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="resource-modal-header">
          <div className="resource-modal-title">
            <p className="eyebrow">{title}</p>
          </div>
          <button className="ghost-button" onClick={onClose} type="button">Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function EnvironmentForm({
  draft,
  onChange,
  onSubmit,
  onDelete,
  submitLabel,
  isSubmitting
}: {
  draft: EnvironmentDraft;
  onChange: (draft: EnvironmentDraft) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onDelete?: () => void;
  submitLabel: string;
  isSubmitting: boolean;
}) {
  return (
    <form className="resource-form" onSubmit={onSubmit}>
      <div className="resource-form-body">
        <div className="record-grid">
          <FormField label="Environment name" required>
            <input data-autofocus="true" required value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} />
          </FormField>
          <FormField label="Base URL">
            <input placeholder="https://staging.example.com" value={draft.base_url} onChange={(event) => onChange({ ...draft, base_url: event.target.value })} />
          </FormField>
        </div>

        <FormField label="Description">
          <textarea rows={3} value={draft.description} onChange={(event) => onChange({ ...draft, description: event.target.value })} />
        </FormField>

        <KeyValueEditor
          entries={draft.variables}
          heading="Environment variables"
          emptyMessage="No environment variables added yet."
          onChange={(variables) => onChange({ ...draft, variables })}
          allowSecret
        />
      </div>

      <div className="action-row resource-form-actions">
        <button className="primary-button" disabled={isSubmitting} type="submit">{submitLabel}</button>
        {onDelete ? <button className="ghost-button danger" disabled={isSubmitting} onClick={onDelete} type="button">Delete</button> : null}
      </div>
    </form>
  );
}

function ConfigurationForm({
  draft,
  browserOptions,
  mobileOsOptions,
  onChange,
  onSubmit,
  onDelete,
  submitLabel,
  isSubmitting
}: {
  draft: ConfigurationDraft;
  browserOptions: Array<{ value: string; label: string }>;
  mobileOsOptions: Array<{ value: string; label: string }>;
  onChange: (draft: ConfigurationDraft) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onDelete?: () => void;
  submitLabel: string;
  isSubmitting: boolean;
}) {
  return (
    <form className="resource-form" onSubmit={onSubmit}>
      <div className="resource-form-body">
        <div className="record-grid">
          <FormField label="Configuration name" required>
            <input data-autofocus="true" required value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} />
          </FormField>
          <FormField label="Browser">
            <select value={draft.browser} onChange={(event) => onChange({ ...draft, browser: event.target.value })}>
              <option value="">Any browser</option>
              {browserOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Mobile OS">
            <select value={draft.mobile_os} onChange={(event) => onChange({ ...draft, mobile_os: event.target.value })}>
              <option value="">Any mobile OS</option>
              {mobileOsOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Version">
            <input placeholder="17, 14, 124, or API v2" value={draft.platform_version} onChange={(event) => onChange({ ...draft, platform_version: event.target.value })} />
          </FormField>
        </div>

        <FormField label="Description">
          <textarea rows={3} value={draft.description} onChange={(event) => onChange({ ...draft, description: event.target.value })} />
        </FormField>

        <KeyValueEditor
          entries={draft.variables}
          heading="Configuration variables"
          emptyMessage="No configuration variables added yet."
          onChange={(variables) => onChange({ ...draft, variables })}
          allowSecret
        />
      </div>

      <div className="action-row resource-form-actions">
        <button className="primary-button" disabled={isSubmitting} type="submit">{submitLabel}</button>
        {onDelete ? <button className="ghost-button danger" disabled={isSubmitting} onClick={onDelete} type="button">Delete</button> : null}
      </div>
    </form>
  );
}

function DataSetForm({
  draft,
  dataSetModeOptions,
  onChange,
  onSubmit,
  onDelete,
  savedDataSets = [],
  submitLabel,
  isSubmitting
}: {
  draft: DataSetDraft;
  dataSetModeOptions: Array<{ value: string; label: string }>;
  onChange: (draft: DataSetDraft) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onDelete?: () => void;
  savedDataSets?: TestDataSet[];
  submitLabel: string;
  isSubmitting: boolean;
}) {
  const [importFeedback, setImportFeedback] = useState("");
  const [importFeedbackTone, setImportFeedbackTone] = useState<"success" | "error">("success");
  const [previewRevision, setPreviewRevision] = useState(0);
  const generatedFieldCount = useMemo(() => countGeneratedTestDataFields(draft.rows), [draft.rows]);
  const generatedPreviewRows = useMemo(() => materializeTestDataRows(draft.rows), [draft.rows, previewRevision]);
  const utilityOptions = useMemo(() => buildDataUtilityOptions(draft, savedDataSets), [draft, savedDataSets]);

  const handleDataFileImport = async (file?: File | null) => {
    if (!file) {
      return;
    }

    try {
      const parsed = await parseTestDataFile(file);
      const nextName = draft.name.trim() ? draft.name : file.name.replace(/\.[^.]+$/, "").trim();

      if (draft.mode === "key_value") {
        const importedRows = toKeyValueRows(parsed.columns, parsed.rows);
        onChange({
          ...draft,
          name: nextName,
          columns: ["key", "value"],
          rows: importedRows
        });
        setImportFeedbackTone("success");
        setImportFeedback(
          parsed.warnings.length
            ? `${parsed.warnings.join(" ")} Imported ${importedRows.length} key/value pair${importedRows.length === 1 ? "" : "s"} from ${file.name}.`
            : `Imported ${importedRows.length} key/value pair${importedRows.length === 1 ? "" : "s"} from ${file.name}.`
        );
        return;
      }

      onChange({
        ...draft,
        name: nextName,
        columns: parsed.columns,
        rows: parsed.rows
      });
      setImportFeedbackTone("success");
      setImportFeedback(
        parsed.warnings.length
          ? `${parsed.warnings.join(" ")} Imported ${parsed.rows.length} row${parsed.rows.length === 1 ? "" : "s"} from ${file.name}.`
          : `Imported ${parsed.rows.length} row${parsed.rows.length === 1 ? "" : "s"} from ${file.name}.`
      );
    } catch (error) {
      setImportFeedbackTone("error");
      setImportFeedback(error instanceof Error ? error.message : "Unable to import this file.");
    }
  };

  return (
    <form className="resource-form" onSubmit={onSubmit}>
      <div className="resource-form-body">
        <div className="record-grid">
          <FormField label="Data set name" required>
            <input data-autofocus="true" required value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} />
          </FormField>
          <FormField label="Data format">
            <select
              value={draft.mode}
              onChange={(event) => {
                const mode = event.target.value as TestDataSetMode;
                onChange(switchDataSetDraftMode(draft, mode));
              }}
            >
              {dataSetModeOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </FormField>
          <FormField label={draft.mode === "table" ? "Data file import" : "Key/value import"}>
            <input
              accept=".xlsx,.xls,.csv,.json,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
              onChange={(event) => {
                const nextFile = event.target.files?.[0];
                event.target.value = "";
                void handleDataFileImport(nextFile);
              }}
              type="file"
            />
          </FormField>
        </div>

        <FormField label="Description">
          <textarea rows={3} value={draft.description} onChange={(event) => onChange({ ...draft, description: event.target.value })} />
        </FormField>

        {importFeedback ? <p className={importFeedbackTone === "error" ? "form-error resource-import-feedback" : "form-success resource-import-feedback"}>{importFeedback}</p> : null}

        {generatedFieldCount ? (
          <section className="test-data-generator-panel">
            <div className="test-data-generator-header">
              <div>
                <div className="panel-title-row">
                  <strong>Run data resolution</strong>
                  <InfoTooltip
                    content="Generator templates stay in the saved test data set. Runs resolve them into fresh values and retain the resolved run snapshot."
                    label="Dynamic test data information"
                  />
                </div>
              </div>
              <span className="count-pill">{generatedFieldCount} generated field{generatedFieldCount === 1 ? "" : "s"}</span>
            </div>
            <div className="test-data-generator-preview">
              <div className="test-data-generator-preview-header">
                <strong>Sample before run</strong>
                <button className="ghost-button" onClick={() => setPreviewRevision((current) => current + 1)} type="button">
                  Refresh sample
                </button>
              </div>
              <div className="test-data-generator-preview-rows">
                {generatedPreviewRows.slice(0, 3).map((row, index) => (
                  <article key={`generated-preview-${index}`}>
                    {Object.entries(row).map(([key, value]) => (
                      <span key={key}>
                        <strong>{key}</strong>
                        <code>{value || "-"}</code>
                      </span>
                    ))}
                  </article>
                ))}
              </div>
              <InfoTooltip
                content="This preview is illustrative. The exact generated values are frozen and visible in the created run."
                label="Generated data preview information"
              />
            </div>
          </section>
        ) : null}

        {draft.mode === "key_value" ? (
          <KeyValueEditor
            entries={draft.rows.map((row) => ({ key: String(row.key ?? ""), value: String(row.value ?? "") }))}
            heading="Test data pairs"
            emptyMessage="No test data pairs added yet."
            multilineValue
            utilityOptions={utilityOptions}
            onChange={(entries) =>
              onChange({
                ...draft,
                columns: ["key", "value"],
                rows: entries.map((entry) => ({ key: entry.key, value: entry.value }))
              })
            }
          />
        ) : (
          <DataTableEditor draft={draft} onChange={onChange} utilityOptions={utilityOptions} />
        )}
      </div>

      <div className="action-row resource-form-actions">
        <button className="primary-button" disabled={isSubmitting} type="submit">{submitLabel}</button>
        {onDelete ? <button className="ghost-button danger" disabled={isSubmitting} onClick={onDelete} type="button">Delete</button> : null}
      </div>
    </form>
  );
}

function DataUtilityPicker({
  options,
  onSelect
}: {
  options: TestDataUtilityOption[];
  onSelect: (template: string) => void;
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const filteredOptions = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();

    if (!search) {
      return options;
    }

    return options.filter((option) =>
      [
        option.label,
        option.template,
        option.group,
        option.source || "",
        option.key
      ].join(" ").toLowerCase().includes(search)
    );
  }, [options, searchTerm]);

  return (
    <div className="test-data-utility-panel">
      <input
        aria-label="Search data utilities"
        onChange={(event) => setSearchTerm(event.target.value)}
        placeholder="Search data utilities"
        type="search"
        value={searchTerm}
      />
      <div className="test-data-utility-list">
        {filteredOptions.map((option) => (
          <button
            className="test-data-utility-option"
            key={option.id}
            onClick={() => onSelect(option.template)}
            type="button"
          >
            <span className="test-data-utility-option-meta">
              {option.group}{option.source ? ` · ${option.source}` : ""}
            </span>
            <strong>{option.label}</strong>
            <code>{option.template}</code>
          </button>
        ))}
        {!filteredOptions.length ? <div className="empty-state compact test-data-utility-empty">No matching utilities.</div> : null}
      </div>
    </div>
  );
}

function TestDataCellValueEditor({
  value,
  onChange,
  utilityOptions,
  isUtilityOpen,
  onToggleUtility,
  onApplyUtility,
  utilityLabel
}: {
  value: string;
  onChange: (value: string) => void;
  utilityOptions: TestDataUtilityOption[];
  isUtilityOpen: boolean;
  onToggleUtility: () => void;
  onApplyUtility: (template: string) => void;
  utilityLabel: string;
}) {
  return (
    <div className="test-data-cell-editor">
      <div className="test-data-cell-input-row">
        <textarea
          className="resource-data-cell"
          rows={Math.min(Math.max(String(value || "").split("\n").length, 2), 5)}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          aria-expanded={isUtilityOpen}
          aria-label={utilityLabel}
          className={isUtilityOpen ? "test-data-cell-utility-trigger is-active" : "test-data-cell-utility-trigger"}
          onClick={onToggleUtility}
          title="Data utilities"
          type="button"
        >
          <TestDataUtilityIcon />
        </button>
      </div>
      {isUtilityOpen ? (
        <DataUtilityPicker
          options={utilityOptions}
          onSelect={(template) => {
            onApplyUtility(template);
          }}
        />
      ) : null}
    </div>
  );
}

function KeyValueEditor({
  heading,
  entries,
  onChange,
  emptyMessage,
  allowSecret = false,
  multilineValue = false,
  utilityOptions
}: {
  heading: string;
  entries: KeyValueEntry[];
  onChange: (entries: KeyValueEntry[]) => void;
  emptyMessage: string;
  allowSecret?: boolean;
  multilineValue?: boolean;
  utilityOptions?: TestDataUtilityOption[];
}) {
  const [activeUtilityRow, setActiveUtilityRow] = useState<number | null>(null);

  return (
    <div className="resource-table-shell">
      <div className="resource-table-toolbar">
        <strong>{heading}</strong>
        <button className="ghost-button" onClick={() => onChange([...entries, createKeyValueEntry()])} type="button">Add pair</button>
      </div>
      {!entries.length ? <div className="empty-state compact resource-table-empty">{emptyMessage}</div> : null}
      {entries.length ? (
      <div className="table-wrap">
        <table className="data-table resource-data-table">
          <thead>
            <tr>
              <th>Key</th>
              <th>Value</th>
              {allowSecret ? <th>Secret</th> : null}
              <th />
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, index) => (
              <tr key={entry.id || `${entry.key}-${index}`}>
                <td>
                  <input
                    value={entry.key}
                    onChange={(event) =>
                      onChange(
                        entries.map((current, currentIndex) =>
                          currentIndex === index ? { ...current, key: event.target.value } : current
                        )
                      )
                    }
                  />
                </td>
                <td>
                  {multilineValue && !entry.is_secret && utilityOptions ? (
                    <TestDataCellValueEditor
                      isUtilityOpen={activeUtilityRow === index}
                      onApplyUtility={(template) => {
                        setActiveUtilityRow(null);
                        onChange(
                          entries.map((current, currentIndex) =>
                            currentIndex === index
                              ? { ...current, value: template, has_stored_value: current.has_stored_value || Boolean(template) }
                              : current
                          )
                        );
                      }}
                      onChange={(value) =>
                        onChange(
                          entries.map((current, currentIndex) =>
                            currentIndex === index ? { ...current, value, has_stored_value: current.has_stored_value || Boolean(value) } : current
                          )
                        )
                      }
                      onToggleUtility={() => setActiveUtilityRow((current) => (current === index ? null : index))}
                      utilityLabel={`Open data utilities for ${entry.key || `pair ${index + 1}`}`}
                      utilityOptions={utilityOptions}
                      value={entry.value}
                    />
                  ) : multilineValue && !entry.is_secret ? (
                    <textarea
                      rows={Math.min(Math.max(String(entry.value || "").split("\n").length, 2), 5)}
                      value={entry.value}
                      onChange={(event) =>
                        onChange(
                          entries.map((current, currentIndex) =>
                            currentIndex === index ? { ...current, value: event.target.value, has_stored_value: current.has_stored_value || Boolean(event.target.value) } : current
                          )
                        )
                      }
                    />
                  ) : (
                    <input
                      autoComplete={entry.is_secret ? "new-password" : "off"}
                      placeholder={entry.is_secret && entry.has_stored_value && !entry.value ? "Stored secret. Enter a new value to replace it." : ""}
                      type={entry.is_secret ? "password" : "text"}
                      value={entry.value}
                      onChange={(event) =>
                        onChange(
                          entries.map((current, currentIndex) =>
                            currentIndex === index ? { ...current, value: event.target.value, has_stored_value: current.has_stored_value || Boolean(event.target.value) } : current
                          )
                        )
                      }
                    />
                  )}
                </td>
                {allowSecret ? (
                  <td>
                    <label className="resource-secret-toggle">
                      <input
                        checked={Boolean(entry.is_secret)}
                        onChange={(event) =>
                          onChange(
                            entries.map((current, currentIndex) =>
                              currentIndex === index ? { ...current, is_secret: event.target.checked } : current
                            )
                          )
                        }
                        type="checkbox"
                      />
                      <span>Hide value</span>
                    </label>
                  </td>
                ) : null}
                <td>
                  <button
                    className="ghost-button danger resource-table-remove"
                    onClick={() => onChange(entries.filter((_, currentIndex) => currentIndex !== index))}
                    type="button"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      ) : null}
    </div>
  );
}

function DataTableEditor({
  draft,
  onChange,
  utilityOptions
}: {
  draft: DataSetDraft;
  onChange: (draft: DataSetDraft) => void;
  utilityOptions: TestDataUtilityOption[];
}) {
  const columns = draft.columns;
  const rows = draft.rows;
  const [activeUtilityCell, setActiveUtilityCell] = useState("");
  const [activeUtilityColumn, setActiveUtilityColumn] = useState<number | null>(null);
  const [dragState, setDragState] = useState<{ type: "column" | "row"; index: number } | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const handleAddColumn = () => {
    const nextColumnName = `Column ${columns.length + 1}`;
    onChange({
      ...draft,
      columns: [...columns, nextColumnName],
      rows: rows.map((row) => ({ ...row, [nextColumnName]: "" }))
    });
  };
  const handleAddRow = () => {
    if (!columns.length) {
      const nextColumnName = "Column 1";
      onChange({
        ...draft,
        columns: [nextColumnName],
        rows: [{ [nextColumnName]: "" }]
      });
      return;
    }

    onChange({
      ...draft,
      columns,
      rows: [...rows, columns.reduce<TestDataSetRow>((accumulator, column) => ({ ...accumulator, [column]: "" }), {})]
    });
  };
  const updateCellValue = (rowIndex: number, column: string, value: string) => {
    onChange({
      ...draft,
      columns,
      rows: rows.map((currentRow, currentIndex) =>
        currentIndex === rowIndex ? { ...currentRow, [column]: value } : currentRow
      )
    });
  };
  const applyUtilityToColumn = (column: string, template: string) => {
    const nextRows = rows.length
      ? rows.map((row) => ({ ...row, [column]: template }))
      : [columns.reduce<TestDataSetRow>((accumulator, currentColumn) => ({ ...accumulator, [currentColumn]: currentColumn === column ? template : "" }), {})];

    onChange({
      ...draft,
      columns,
      rows: nextRows
    });
  };
  const handleRenameColumn = (columnIndex: number, value: string) => {
    const column = columns[columnIndex];
    const baseColumn = value || `Column ${columnIndex + 1}`;
    let nextColumn = baseColumn;
    let duplicateCount = 2;

    while (columns.some((currentColumn, currentIndex) => currentIndex !== columnIndex && currentColumn === nextColumn)) {
      nextColumn = `${baseColumn} ${duplicateCount}`;
      duplicateCount += 1;
    }

    const nextColumns = [...columns];
    nextColumns[columnIndex] = nextColumn;
    onChange({
      ...draft,
      columns: nextColumns,
      rows: rows.map((row) => {
        const nextRow = { ...row, [nextColumn]: row[column] ?? "" };
        if (nextColumn !== column) {
          delete nextRow[column];
        }
        return nextRow;
      })
    });
  };
  const handleRemoveColumn = (columnIndex: number) => {
    const column = columns[columnIndex];
    const nextColumns = columns.filter((_, currentIndex) => currentIndex !== columnIndex);

    onChange({
      ...draft,
      columns: nextColumns,
      rows: nextColumns.length
        ? rows.map((row) => {
            const nextRow = { ...row };
            delete nextRow[column];
            return nextRow;
          })
        : []
    });
  };
  const handleMoveColumn = (fromIndex: number, toIndex: number) => {
    const nextColumns = moveArrayItem(columns, fromIndex, toIndex);

    if (nextColumns === columns) {
      return;
    }

    onChange({
      ...draft,
      columns: nextColumns,
      rows
    });
  };
  const handleMoveRow = (fromIndex: number, toIndex: number) => {
    const nextRows = moveArrayItem(rows, fromIndex, toIndex);

    if (nextRows === rows) {
      return;
    }

    onChange({
      ...draft,
      columns,
      rows: nextRows
    });
  };
  const handleColumnDrop = (columnIndex: number) => {
    if (dragState?.type === "column") {
      handleMoveColumn(dragState.index, columnIndex);
    }

    setDragState(null);
  };
  const handleRowDrop = (rowIndex: number) => {
    if (dragState?.type === "row") {
      handleMoveRow(dragState.index, rowIndex);
    }

    setDragState(null);
  };

  return (
    <div className={isExpanded ? "resource-table-shell is-expanded" : "resource-table-shell"}>
      <div className="resource-table-toolbar">
        <strong>Table data</strong>
        <div className="resource-table-actions">
          <button
            aria-pressed={isExpanded}
            className="ghost-button resource-table-add-button"
            onClick={() => setIsExpanded((current) => !current)}
            title={isExpanded ? "Collapse table editor" : "Expand table editor"}
            type="button"
          >
            <TableExpandIcon isExpanded={isExpanded} />
            <span>{isExpanded ? "Collapse" : "Expand"}</span>
          </button>
          <button className="ghost-button resource-table-add-button" onClick={handleAddColumn} type="button">
            <AddIcon />
            <span>Add column</span>
          </button>
          <button className="primary-button resource-table-add-button" onClick={handleAddRow} type="button">
            <AddIcon />
            <span>Add row</span>
          </button>
        </div>
      </div>

      {!columns.length ? (
        <div className="empty-state compact resource-table-empty">
          <span>No columns yet. Import a JSON, CSV, or spreadsheet file, or add a column to start building this table.</span>
          <button className="primary-button resource-table-add-button" onClick={handleAddColumn} type="button">
            <AddIcon />
            <span>Add first column</span>
          </button>
        </div>
      ) : null}

      {columns.length ? (
        <div className="table-wrap resource-sheet-wrap">
          <table className="data-table resource-data-table resource-sheet-table">
            <thead>
              <tr>
                <th className="resource-sheet-corner" aria-label="Row controls" />
                {columns.map((column, columnIndex) => (
                  <th
                    className={dragState?.type === "column" && dragState.index === columnIndex ? "resource-sheet-column is-dragging" : "resource-sheet-column"}
                    key={`${column}-${columnIndex}`}
                    onDragOver={(event) => {
                      if (dragState?.type === "column") {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                      }
                    }}
                    onDrop={() => handleColumnDrop(columnIndex)}
                  >
                    <div className="resource-column-header">
                      <span className="resource-column-letter">{getSpreadsheetColumnLabel(columnIndex)}</span>
                      <button
                        aria-label={`Move column ${getSpreadsheetColumnLabel(columnIndex)}`}
                        className="resource-column-drag-handle"
                        draggable
                        onDragEnd={() => setDragState(null)}
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", `column:${columnIndex}`);
                          setDragState({ type: "column", index: columnIndex });
                        }}
                        title="Drag column"
                        type="button"
                      >
                        <span aria-hidden="true">::</span>
                      </button>
                      <input
                        aria-label={`Column ${getSpreadsheetColumnLabel(columnIndex)} name`}
                        value={column}
                        onChange={(event) => handleRenameColumn(columnIndex, event.target.value)}
                      />
                      <button
                        aria-expanded={activeUtilityColumn === columnIndex}
                        aria-label={`Open data utilities for column ${column}`}
                        className={activeUtilityColumn === columnIndex ? "test-data-cell-utility-trigger is-active resource-column-utility-trigger" : "test-data-cell-utility-trigger resource-column-utility-trigger"}
                        onClick={() => {
                          setActiveUtilityCell("");
                          setActiveUtilityColumn((current) => (current === columnIndex ? null : columnIndex));
                        }}
                        title="Data utilities"
                        type="button"
                      >
                        <TestDataUtilityIcon />
                      </button>
                      <button
                        className="ghost-button danger resource-column-remove"
                        onClick={() => handleRemoveColumn(columnIndex)}
                        title="Remove column"
                        type="button"
                      >
                        x
                      </button>
                      {activeUtilityColumn === columnIndex ? (
                        <div className="resource-column-utility-popover">
                          <DataUtilityPicker
                            options={utilityOptions}
                            onSelect={(template) => {
                              applyUtilityToColumn(column, template);
                              setActiveUtilityColumn(null);
                            }}
                          />
                        </div>
                      ) : null}
                    </div>
                  </th>
                ))}
                <th className="resource-sheet-action-header" aria-label="Row actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr
                  className={dragState?.type === "row" && dragState.index === rowIndex ? "is-row-dragging" : ""}
                  key={`row-${rowIndex}`}
                  onDragOver={(event) => {
                    if (dragState?.type === "row") {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                    }
                  }}
                  onDrop={() => handleRowDrop(rowIndex)}
                >
                  <td className="resource-row-header">
                    <button
                      aria-label={`Move row ${rowIndex + 1}`}
                      className="resource-row-drag-handle"
                      draggable
                      onDragEnd={() => setDragState(null)}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", `row:${rowIndex}`);
                        setDragState({ type: "row", index: rowIndex });
                      }}
                      title="Drag row"
                      type="button"
                    >
                      <span className="resource-row-number">{rowIndex + 1}</span>
                      <span aria-hidden="true" className="resource-row-drag-glyph">::</span>
                    </button>
                  </td>
                  {columns.map((column, columnIndex) => (
                    <td key={`${rowIndex}-${columnIndex}`}>
                      <TestDataCellValueEditor
                        isUtilityOpen={activeUtilityCell === `${rowIndex}:${columnIndex}`}
                        onApplyUtility={(template) => {
                          updateCellValue(rowIndex, column, template);
                          setActiveUtilityCell("");
                        }}
                        onChange={(value) => updateCellValue(rowIndex, column, value)}
                        onToggleUtility={() => {
                          const cellId = `${rowIndex}:${columnIndex}`;
                          setActiveUtilityColumn(null);
                          setActiveUtilityCell((current) => (current === cellId ? "" : cellId));
                        }}
                        utilityLabel={`Open data utilities for row ${rowIndex + 1}, ${column}`}
                        utilityOptions={utilityOptions}
                        value={row[column] ?? ""}
                      />
                    </td>
                  ))}
                  <td className="resource-sheet-action-cell">
                    <button
                      className="ghost-button danger resource-table-remove"
                      onClick={() =>
                        onChange({
                          ...draft,
                          columns,
                          rows: rows.filter((_, currentIndex) => currentIndex !== rowIndex)
                        })
                      }
                      type="button"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              {!rows.length ? (
                <tr>
                  <td className="resource-row-header">
                    <span className="resource-row-number">1</span>
                  </td>
                  <td colSpan={columns.length + 1}>
                    <div className="empty-state compact resource-table-empty">
                      <span>No rows yet. Add one row or import a file with data.</span>
                      <button className="primary-button resource-table-add-button" onClick={handleAddRow} type="button">
                        <AddIcon />
                        <span>Add first row</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
