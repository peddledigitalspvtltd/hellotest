import { FormEvent, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { AddIcon, CollapseExpandIcon, OpenIcon, RefreshIcon, TestDataIcon } from "../components/AppIcons";
import { CatalogSearchFilter } from "../components/CatalogSearchFilter";
import { CatalogSelectionControls } from "../components/CatalogSelectionControls";
import { CatalogViewToggle } from "../components/CatalogViewToggle";
import { DataTable, type DataTableColumn } from "../components/DataTable";
import { DialogCloseButton } from "../components/DialogCloseButton";
import { FormField } from "../components/FormField";
import { InfoTooltip } from "../components/InfoTooltip";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { RichTextContent, RichTextEditor, richTextToPlainText } from "../components/RichTextEditor";
import { TileBrowserPane } from "../components/TileBrowserPane";
import { TileCardSkeletonGrid } from "../components/TileCardSkeletonGrid";
import { ToastMessage } from "../components/ToastMessage";
import { TileCardStatusIndicator } from "../components/TileCardPrimitives";
import { WorkspaceBackButton, WorkspaceMasterDetail } from "../components/WorkspaceMasterDetail";
import { useDeleteConfirmation } from "../components/DeleteConfirmationDialog";
import { useCurrentAppType, useCurrentProject } from "../hooks/useCurrentProject";
import { useDomainMetadata } from "../hooks/useDomainMetadata";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { useFeatureFlags } from "../hooks/useFeatureFlags";
import { useAiPromptRegistry } from "../hooks/useAiPromptRegistry";
import { useCatalogSelection } from "../hooks/useCatalogSelection";
import { api } from "../lib/api";
import { asArray } from "../lib/collectionGuards";
import { areFeatureFlagsEnabled } from "../lib/featureFlags";
import { hasPermission } from "../lib/permissions";
import { parseTestDataFile, toKeyValueRows } from "../lib/testDataImport";
import { countGeneratedTestDataFields, evaluateTestDataTemplate, hasTestDataGeneratorTemplate, materializeTestDataRows, TEST_DATA_GENERATOR_TEMPLATES } from "../lib/testDataGenerators";
import { readDefaultCatalogViewMode } from "../lib/viewPreferences";
import type { AiTestDataGenerationPreviewResponse, KeyValueEntry, TestConfiguration, TestConfigurationTarget, TestDataSet, TestDataSetMode, TestDataSetRow, TestEnvironment } from "../types";
import "./TestEnvironmentPage.rovo.css";

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
  { id: "default-timestamp", key: "timestamp", label: "Timestamp", template: TEST_DATA_GENERATOR_TEMPLATES.timestamp, group: "Data utility" }
];

const CONFIGURATION_HOST_OS_OPTIONS = [
  { value: "Windows", label: "Windows" },
  { value: "macOS", label: "macOS" },
  { value: "Linux", label: "Linux" }
] as const;

const RESERVED_CONFIGURATION_VARIABLE_KEYS = new Set([
  "os",
  "browser",
  "mobile_os",
  "version",
  "platform_version"
]);

type EnvironmentDraft = {
  name: string;
  description: string;
  base_url: string;
  variables: KeyValueEntry[];
};

type ConfigurationDraft = {
  name: string;
  description: string;
  targets: TestConfigurationTarget[];
  variables: KeyValueEntry[];
};

export type DataSetDraft = {
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

const createConfigurationTarget = (values: Partial<TestConfigurationTarget> = {}): TestConfigurationTarget => ({
  id: values.id || globalThis.crypto?.randomUUID?.() || `configuration-target-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  os: values.os || "",
  browser: values.browser || "",
  mobile_os: values.mobile_os || "",
  version: values.version || ""
});

const buildEmptyConfigurationDraft = (): ConfigurationDraft => ({
  name: "",
  description: "",
  targets: [createConfigurationTarget()],
  variables: []
});

export const buildEmptyDataSetDraft = (defaultMode: TestDataSetMode = "table"): DataSetDraft => ({
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

const normalizeConfigurationTargets = (targets: TestConfigurationTarget[]) =>
  targets
    .map((target) => createConfigurationTarget({
      id: String(target.id || "").trim(),
      os: String(target.os || "").trim(),
      browser: String(target.browser || "").trim(),
      mobile_os: String(target.mobile_os || "").trim(),
      version: String(target.version || "").trim()
    }))
    .filter((target) => target.os || target.browser || target.mobile_os || target.version);

const getDuplicateConfigurationTargetIndexes = (targets: TestConfigurationTarget[]) => {
  const seen = new Map<string, number>();
  const duplicateIndexes = new Set<number>();

  targets.forEach((target, index) => {
    const values = [target.os, target.browser, target.mobile_os, target.version]
      .map((value) => String(value || "").trim());
    if (!values.some(Boolean)) return;

    const key = values
      .map((value) => value.toLocaleLowerCase())
      .join("\u0000");
    const existingIndex = seen.get(key);
    if (existingIndex !== undefined) {
      duplicateIndexes.add(existingIndex);
      duplicateIndexes.add(index);
      return;
    }
    seen.set(key, index);
  });

  return duplicateIndexes;
};

const getConfigurationDraftValidationError = (draft: ConfigurationDraft) => {
  const duplicateIndexes = getDuplicateConfigurationTargetIndexes(draft.targets);
  if (duplicateIndexes.size) {
    return "Configuration target rows must be unique. Update or remove the highlighted duplicate rows.";
  }

  const reservedEntry = normalizeVariableRows(draft.variables).find((entry) =>
    RESERVED_CONFIGURATION_VARIABLE_KEYS.has(entry.key.toLocaleLowerCase())
  );
  if (reservedEntry) {
    return `“${reservedEntry.key}” is managed by the target matrix. Remove it from additional runtime variables.`;
  }

  return "";
};

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

const configurationToDraft = (configuration: TestConfiguration): ConfigurationDraft => {
  const persistedTargets = Array.isArray(configuration.targets) ? configuration.targets : [];
  const legacyTarget = createConfigurationTarget({
    browser: configuration.browser || "",
    mobile_os: configuration.mobile_os || "",
    version: configuration.platform_version || ""
  });
  const targets = persistedTargets.length
    ? persistedTargets.map((target) => createConfigurationTarget(target))
    : legacyTarget.browser || legacyTarget.mobile_os || legacyTarget.version
      ? [legacyTarget]
      : [createConfigurationTarget()];

  return {
    name: configuration.name,
    description: configuration.description || "",
    targets,
    variables: configuration.variables
  };
};

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
      const columnLabel = field === "value" && row.key ? fieldLabel : columns.includes(field) ? field : fieldLabel;

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

const getTestDataColumnWidth = (name: string) =>
  `clamp(8rem, ${Math.min(32, Math.max(12, name.trim().length + 9))}ch, 24rem)`;

const draftHasInvalidDataSetChars = (draft: DataSetDraft) => {
  if (hasInvalidDataSetChars(draft.name) || hasInvalidDataSetChars(draft.description)) {
    return true;
  }

  if (draft.columns.some((column) => hasInvalidDataSetChars(column))) {
    return true;
  }

  return draft.rows.some((row) => Object.values(row).some((value) => hasInvalidDataSetChars(value)));
};

const getConfigurationTargets = (
  configuration: Pick<TestConfiguration, "browser" | "mobile_os" | "platform_version" | "targets">
) => {
  const targets = Array.isArray(configuration.targets) ? configuration.targets.filter(Boolean) : [];
  if (targets.length) return targets;
  const legacy = createConfigurationTarget({
    browser: configuration.browser || "",
    mobile_os: configuration.mobile_os || "",
    version: configuration.platform_version || ""
  });
  return legacy.browser || legacy.mobile_os || legacy.version ? [legacy] : [];
};

const formatConfigurationTargetRow = (target: TestConfigurationTarget, includeMobileMetadata: boolean) =>
  [target.os, target.browser, includeMobileMetadata ? target.mobile_os : "", target.version]
    .filter(Boolean)
    .join(" · ");

const formatConfigurationTarget = (
  configuration: Pick<TestConfiguration, "browser" | "mobile_os" | "platform_version" | "targets">,
  includeMobileMetadata: boolean
) => {
  const targets = getConfigurationTargets(configuration);
  const primary = targets[0] ? formatConfigurationTargetRow(targets[0], includeMobileMetadata) : "";
  if (!targets.length) return "";
  return `${primary || "Flexible target"}${targets.length > 1 ? ` · +${targets.length - 1} more` : ""}`;
};

const getConfigurationCoverage = (
  configuration: Pick<TestConfiguration, "browser" | "mobile_os" | "platform_version" | "targets">,
  includeMobileMetadata: boolean
) => {
  const targets = getConfigurationTargets(configuration);
  const hostOsCount = new Set(targets.map((target) => target.os).filter(Boolean)).size;
  const browserCount = new Set(targets.map((target) => target.browser).filter(Boolean)).size;
  const mobileOsCount = includeMobileMetadata
    ? new Set(targets.map((target) => target.mobile_os).filter(Boolean)).size
    : 0;
  const parts = [
    hostOsCount ? `${hostOsCount} host OS` : "",
    browserCount ? `${browserCount} browser${browserCount === 1 ? "" : "s"}` : "",
    mobileOsCount ? `${mobileOsCount} mobile OS` : ""
  ].filter(Boolean);
  return parts.join(" · ") || "Draft profile";
};

export function TestEnvironmentPage({ view }: { view: TestEnvironmentPageView }) {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const [projectId] = useCurrentProject();
  const [appTypeId, setAppTypeId] = useCurrentAppType(projectId);
  const [searchParams, setSearchParams] = useSearchParams();
  const domainMetadataQuery = useDomainMetadata();
  const featureFlagsQuery = useFeatureFlags(Boolean(session));
  const canUseMobileMetadata = hasPermission(session, "mobile.view", projectId)
    && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.mobile.appium"]);
  const { confirmDelete, confirmationDialog } = useDeleteConfirmation();
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState("");
  const [selectedConfigurationId, setSelectedConfigurationId] = useState("");
  const [selectedDataSetId, setSelectedDataSetId] = useState("");
  const [environmentViewMode, setEnvironmentViewMode] = useState<"tile" | "list">(() => readDefaultCatalogViewMode());
  const [configurationViewMode, setConfigurationViewMode] = useState<"tile" | "list">(() => readDefaultCatalogViewMode());
  const [dataSetViewMode, setDataSetViewMode] = useState<"tile" | "list">(() => readDefaultCatalogViewMode());
  const [environmentSearch, setEnvironmentSearch] = useState("");
  const [configurationSearch, setConfigurationSearch] = useState("");
  const [dataSetSearch, setDataSetSearch] = useState("");
  const browserOptions = domainMetadataQuery.data?.test_environments?.browsers || [];
  const mobileOsOptions = canUseMobileMetadata ? domainMetadataQuery.data?.test_environments?.mobile_os || [] : [];
  const dataSetModeOptions = domainMetadataQuery.data?.test_data_sets?.modes || [];
  const defaultDataSetMode = (domainMetadataQuery.data?.test_data_sets?.default_mode || "table") as TestDataSetMode;
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
    enabled: Boolean(projectId) && view === "environments",
    staleTime: 60_000
  });
  const configurationsQuery = useQuery({
    queryKey: ["test-configurations", projectId, appTypeId],
    queryFn: () => api.testConfigurations.list({ project_id: projectId, app_type_id: appTypeId || undefined }),
    enabled: Boolean(projectId) && view === "configurations",
    staleTime: 60_000
  });
  const dataSetsQuery = useQuery({
    queryKey: ["test-data-sets", projectId, appTypeId],
    queryFn: () => api.testDataSets.list({ project_id: projectId, app_type_id: appTypeId || undefined }),
    enabled: Boolean(projectId) && view === "data",
    staleTime: 60_000
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

  const projects = asArray(projectsQuery.data);
  const appTypes = asArray(appTypesQuery.data);
  const environments = asArray(environmentsQuery.data);
  const configurations = asArray(configurationsQuery.data);
  const dataSets = asArray(dataSetsQuery.data);
  const selectedAppTypeName = appTypes.find((item) => item.id === appTypeId)?.name || "All app types";
  const filteredEnvironments = useMemo(() => {
    const normalizedSearch = environmentSearch.trim().toLowerCase();

    if (!normalizedSearch) {
      return environments;
    }

    return environments.filter((environment) =>
      [environment.id, environment.name, environment.description, environment.base_url, environment.browser, environment.notes, selectedAppTypeName]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearch)
    );
  }, [environmentSearch, environments, selectedAppTypeName]);
  const filteredConfigurations = useMemo(() => {
    const normalizedSearch = configurationSearch.trim().toLowerCase();

    if (!normalizedSearch) {
      return configurations;
    }

    return configurations.filter((configuration) =>
      [
        configuration.id,
        configuration.name,
        configuration.description,
        ...getConfigurationTargets(configuration).flatMap((target) => [
          target.os,
          target.browser,
          canUseMobileMetadata ? target.mobile_os : "",
          target.version
        ]),
        selectedAppTypeName
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearch)
    );
  }, [canUseMobileMetadata, configurationSearch, configurations, selectedAppTypeName]);
  const filteredDataSets = useMemo(() => {
    const normalizedSearch = dataSetSearch.trim().toLowerCase();

    if (!normalizedSearch) {
      return dataSets;
    }

    return dataSets.filter((dataSet) =>
      [
        dataSet.id,
        dataSet.name,
        dataSet.description,
        dataSet.mode,
        ...dataSet.columns,
        ...dataSet.rows.flatMap((row) => Object.values(row))
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalizedSearch)
    );
  }, [dataSetSearch, dataSets]);
  const visibleEnvironmentIds = useMemo(() => filteredEnvironments.map((environment) => environment.id), [filteredEnvironments]);
  const visibleConfigurationIds = useMemo(() => filteredConfigurations.map((configuration) => configuration.id), [filteredConfigurations]);
  const visibleDataSetIds = useMemo(() => filteredDataSets.map((dataSet) => dataSet.id), [filteredDataSets]);
  const environmentIds = useMemo(() => environments.map((environment) => environment.id), [environments]);
  const configurationIds = useMemo(() => configurations.map((configuration) => configuration.id), [configurations]);
  const dataSetIds = useMemo(() => dataSets.map((dataSet) => dataSet.id), [dataSets]);
  const environmentSelection = useCatalogSelection(environmentIds, visibleEnvironmentIds);
  const configurationSelection = useCatalogSelection(configurationIds, visibleConfigurationIds);
  const dataSetSelection = useCatalogSelection(dataSetIds, visibleDataSetIds);
  const selectedActionEnvironmentIds = environmentSelection.selectedIds;
  const selectedActionConfigurationIds = configurationSelection.selectedIds;
  const selectedActionDataSetIds = dataSetSelection.selectedIds;
  const environmentListColumns = useMemo<Array<DataTableColumn<TestEnvironment>>>(() => [
    {
      key: "name",
      label: "Environment",
      canToggle: false,
      width: 260,
      minWidth: 180,
      sortValue: (environment) => environment.name,
      render: (environment) => (
        <div className="data-table-multiline">
          <strong>{environment.name}</strong>
          <span className="data-table-multiline-line">{environment.base_url || richTextToPlainText(environment.description) || "No URL configured"}</span>
        </div>
      )
    },
    {
      key: "scope",
      label: "Scope",
      width: 160,
      minWidth: 120,
      render: () => selectedAppTypeName
    },
    {
      key: "baseUrl",
      label: "Base URL",
      width: 320,
      minWidth: 180,
      sortValue: (environment) => environment.base_url || "",
      render: (environment) => environment.base_url || "Draft target"
    },
    {
      key: "variables",
      label: "Variables",
      width: 116,
      minWidth: 92,
      sortValue: (environment) => environment.variables.length,
      render: (environment) => environment.variables.length
    },
    {
      key: "description",
      label: "Description",
      defaultVisible: false,
      width: 280,
      minWidth: 160,
      render: (environment) => richTextToPlainText(environment.description) || "No description"
    }
  ], [selectedAppTypeName]);
  const configurationListColumns = useMemo<Array<DataTableColumn<TestConfiguration>>>(() => [
    {
      key: "name",
      label: "Configuration",
      canToggle: false,
      width: 260,
      minWidth: 180,
      sortValue: (configuration) => configuration.name,
      render: (configuration) => (
        <div className="data-table-multiline">
          <strong>{configuration.name}</strong>
          <span className="data-table-multiline-line">{formatConfigurationTarget(configuration, canUseMobileMetadata) || richTextToPlainText(configuration.description) || "Draft profile"}</span>
        </div>
      )
    },
    {
      key: "scope",
      label: "Scope",
      width: 160,
      minWidth: 120,
      render: () => selectedAppTypeName
    },
    {
      key: "targets",
      label: "Targets",
      width: 108,
      minWidth: 88,
      sortValue: (configuration) => getConfigurationTargets(configuration).length,
      render: (configuration) => {
        const count = getConfigurationTargets(configuration).length;
        return count ? `${count} target${count === 1 ? "" : "s"}` : "Draft";
      }
    },
    {
      key: "coverage",
      label: "Coverage",
      width: 300,
      minWidth: 180,
      sortValue: (configuration) => formatConfigurationTarget(configuration, canUseMobileMetadata),
      render: (configuration) => formatConfigurationTarget(configuration, canUseMobileMetadata) || "No target rows"
    },
    {
      key: "variables",
      label: "Variables",
      width: 116,
      minWidth: 92,
      sortValue: (configuration) => configuration.variables.length,
      render: (configuration) => configuration.variables.length
    },
    {
      key: "description",
      label: "Description",
      defaultVisible: false,
      width: 280,
      minWidth: 160,
      render: (configuration) => richTextToPlainText(configuration.description) || "No description"
    }
  ], [canUseMobileMetadata, selectedAppTypeName]);
  const dataSetListColumns = useMemo<Array<DataTableColumn<TestDataSet>>>(() => [
    {
      key: "name",
      label: "Test data",
      canToggle: false,
      width: 260,
      minWidth: 180,
      sortValue: (dataSet) => dataSet.name,
      render: (dataSet) => (
        <div className="data-table-multiline">
          <span className="test-data-entity-title">
            <TestDataIcon size={16} />
            <strong>{dataSet.name}</strong>
          </span>
          <span className="data-table-multiline-line">{richTextToPlainText(dataSet.description) || (dataSet.mode === "table" ? "Table mode" : "Key/value mode")}</span>
        </div>
      )
    },
    {
      key: "mode",
      label: "Mode",
      width: 130,
      minWidth: 104,
      sortValue: (dataSet) => dataSet.mode,
      render: (dataSet) => dataSet.mode === "table" ? "Table" : "Key/value"
    },
    {
      key: "rows",
      label: "Rows",
      width: 100,
      minWidth: 80,
      sortValue: (dataSet) => dataSet.rows.length,
      render: (dataSet) => dataSet.rows.length
    },
    {
      key: "columns",
      label: "Columns",
      width: 120,
      minWidth: 92,
      sortValue: (dataSet) => dataSet.columns.length,
      render: (dataSet) => dataSet.mode === "table" ? dataSet.columns.length : "key/value"
    },
    {
      key: "description",
      label: "Description",
      defaultVisible: false,
      width: 280,
      minWidth: 160,
      render: (dataSet) => richTextToPlainText(dataSet.description) || "No description"
    }
  ], []);
  const selectedEnvironment = environments.find((item) => item.id === selectedEnvironmentId) || null;
  const selectedConfiguration = configurations.find((item) => item.id === selectedConfigurationId) || null;
  const selectedDataSet = dataSets.find((item) => item.id === selectedDataSetId) || null;
  const isEnvironmentWorkspaceOpen = view === "environments"
    ? Boolean(selectedEnvironmentId)
    : view === "configurations"
      ? Boolean(selectedConfigurationId)
      : Boolean(selectedDataSetId);
  const selectedProjectName = projects.find((project) => String(project.id) === String(projectId))?.name || "No project selected";
  const currentViewDescription =
    view === "environments"
      ? "Keep run targets, URLs, and reusable environment variables organized by project and app type."
      : view === "configurations"
        ? canUseMobileMetadata
          ? "Maintain reusable browser, device, and platform combinations so runs stay consistent."
          : "Maintain reusable browser and platform combinations so runs stay consistent."
        : "Store JSON, spreadsheet-style data, and key/value sets that can be attached to runs on demand.";
  const currentViewTitle = view === "environments"
    ? "Test Environments"
    : view === "configurations"
      ? "Test Configurations"
      : "Test Data";
  const currentViewEyebrow = "Test Environment";
  const currentViewCount = view === "environments" ? environments.length : view === "configurations" ? configurations.length : dataSets.length;

  const syncResourceSearchParams = (key: "environment" | "configuration" | "dataSet", value?: string | null) => {
    const targetValue = value || "";

    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (targetValue) {
        next.delete("environment");
        next.delete("configuration");
        next.delete("dataSet");
        next.set(key, targetValue);
      } else {
        next.delete(key);
      }
      return next;
    }, { replace: true });
  };

  const openEnvironmentWorkspace = (environmentId: string) => {
    syncResourceSearchParams("environment", environmentId);
    setSelectedEnvironmentId(environmentId);
  };

  const openConfigurationWorkspace = (configurationId: string) => {
    syncResourceSearchParams("configuration", configurationId);
    setSelectedConfigurationId(configurationId);
  };

  const openDataSetWorkspace = (dataSetId: string) => {
    syncResourceSearchParams("dataSet", dataSetId);
    setSelectedDataSetId(dataSetId);
  };

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
    if (view !== "environments" || environmentsQuery.isLoading || environmentsQuery.isFetching) {
      return;
    }

    const requestedEnvironmentId = searchParams.get("environment");

    if (requestedEnvironmentId && environments.some((item) => item.id === requestedEnvironmentId)) {
      if (selectedEnvironmentId !== requestedEnvironmentId) {
        setSelectedEnvironmentId(requestedEnvironmentId);
      }
      return;
    }

    if (requestedEnvironmentId) {
      if (selectedEnvironmentId === requestedEnvironmentId) {
        return;
      }

      syncResourceSearchParams("environment", null);
    }

    setSelectedEnvironmentId((current) => (current && environments.some((item) => item.id === current) ? current : ""));
  }, [environments, environmentsQuery.isFetching, environmentsQuery.isLoading, searchParams, selectedEnvironmentId, view]);

  useEffect(() => {
    if (view !== "configurations" || configurationsQuery.isLoading || configurationsQuery.isFetching) {
      return;
    }

    const requestedConfigurationId = searchParams.get("configuration");

    if (requestedConfigurationId && configurations.some((item) => item.id === requestedConfigurationId)) {
      if (selectedConfigurationId !== requestedConfigurationId) {
        setSelectedConfigurationId(requestedConfigurationId);
      }
      return;
    }

    if (requestedConfigurationId) {
      if (selectedConfigurationId === requestedConfigurationId) {
        return;
      }

      syncResourceSearchParams("configuration", null);
    }

    setSelectedConfigurationId((current) =>
      current && configurations.some((item) => item.id === current) ? current : ""
    );
  }, [configurations, configurationsQuery.isFetching, configurationsQuery.isLoading, searchParams, selectedConfigurationId, view]);

  useEffect(() => {
    if (view !== "data" || dataSetsQuery.isLoading || dataSetsQuery.isFetching) {
      return;
    }

    const requestedDataSetId = searchParams.get("dataSet");

    if (requestedDataSetId && dataSets.some((item) => item.id === requestedDataSetId)) {
      if (selectedDataSetId !== requestedDataSetId) {
        setSelectedDataSetId(requestedDataSetId);
      }
      return;
    }

    if (requestedDataSetId) {
      if (selectedDataSetId === requestedDataSetId) {
        return;
      }

      syncResourceSearchParams("dataSet", null);
    }

    setSelectedDataSetId((current) => (current && dataSets.some((item) => item.id === current) ? current : ""));
  }, [dataSets, dataSetsQuery.isFetching, dataSetsQuery.isLoading, searchParams, selectedDataSetId, view]);

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
      syncResourceSearchParams("environment", null);
      setSelectedEnvironmentId("");
      return;
    }

    if (view === "configurations") {
      syncResourceSearchParams("configuration", null);
      setSelectedConfigurationId("");
      return;
    }

    syncResourceSearchParams("dataSet", null);
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
      syncResourceSearchParams("environment", response.id);
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
      syncResourceSearchParams("environment", null);
      setSelectedEnvironmentId("");
      showSuccess("Test environment deleted.");
      await refreshResources();
    } catch (error) {
      showError(error, "Unable to delete test environment");
    }
  };

  const handleCreateConfiguration = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const validationError = getConfigurationDraftValidationError(createConfigurationDraft);
    if (validationError) {
      showError(new Error(validationError), validationError);
      return;
    }

    const targets = normalizeConfigurationTargets(createConfigurationDraft.targets);
    const primaryTarget = targets[0];

    try {
      const response = await createConfiguration.mutateAsync({
        project_id: projectId,
        app_type_id: appTypeId || undefined,
        name: createConfigurationDraft.name,
        description: createConfigurationDraft.description || undefined,
        browser: primaryTarget?.browser || undefined,
        mobile_os: primaryTarget?.mobile_os || undefined,
        platform_version: primaryTarget?.version || undefined,
        targets,
        variables: normalizeVariableRows(createConfigurationDraft.variables)
      });
      setIsCreateConfigurationModalOpen(false);
      syncResourceSearchParams("configuration", response.id);
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

    const validationError = getConfigurationDraftValidationError(configurationDraft);
    if (validationError) {
      showError(new Error(validationError), validationError);
      return;
    }

    const targets = normalizeConfigurationTargets(configurationDraft.targets);
    const primaryTarget = targets[0];

    try {
      await updateConfiguration.mutateAsync({
        id: selectedConfiguration.id,
        input: {
          project_id: projectId,
          app_type_id: selectedConfiguration.app_type_id || "",
          name: configurationDraft.name,
          description: configurationDraft.description,
          browser: primaryTarget?.browser || "",
          mobile_os: primaryTarget?.mobile_os || "",
          platform_version: primaryTarget?.version || "",
          targets,
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
      syncResourceSearchParams("configuration", null);
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
      syncResourceSearchParams("dataSet", response.id);
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
      syncResourceSearchParams("dataSet", null);
      setSelectedDataSetId("");
      showSuccess("Test data deleted.");
      await refreshResources();
    } catch (error) {
      showError(error, "Unable to delete test data");
    }
  };

  return (
    <div className={["page-content", view === "data" ? "page-content--test-data" : ""].filter(Boolean).join(" ")}>
      {confirmationDialog}
      <PageHeader
        className={isEnvironmentWorkspaceOpen ? "page-header--workspace-context" : ""}
        eyebrow={currentViewEyebrow}
        title={currentViewTitle}
        description={currentViewDescription}
        meta={[
          { label: "Records", value: currentViewCount },
          { label: "Project", value: selectedProjectName },
          { label: "Scope", value: selectedAppTypeName }
        ]}
      />

      <ToastMessage message={message} onDismiss={() => setMessage("")} tone={messageTone} />

      {view === "environments" ? (
        <WorkspaceMasterDetail
          browseView={(
            <Panel title="Environments" titleVariant="eyebrow" subtitle="Browse run targets as tiles first, then open one environment into a focused editor.">
              <div className="design-list-toolbar catalog-command-toolbar resource-catalog-toolbar">
                <div className="catalog-toolbar-discovery" aria-label="Environment views, search, and selection">
                  <CatalogViewToggle onChange={setEnvironmentViewMode} value={environmentViewMode} />
                  <CatalogSearchFilter
                    activeFilterCount={environmentSearch.trim() ? 1 : 0}
                    ariaLabel="Search environments"
                    onChange={setEnvironmentSearch}
                    placeholder="Search environments"
                    subtitle="Search by name, URL, browser, notes, or app type scope."
                    title="Environment search"
                    type="search"
                    value={environmentSearch}
                  >
                    <div className="catalog-filter-grid">
                      <div className="catalog-filter-actions">
                        <button className="ghost-button" disabled={!environmentSearch.trim()} onClick={() => setEnvironmentSearch("")} type="button">
                          Clear search
                        </button>
                      </div>
                    </div>
                  </CatalogSearchFilter>
                  <CatalogSelectionControls
                    allSelected={environmentSelection.allVisibleSelected}
                    canSelectAll={Boolean(visibleEnvironmentIds.length)}
                    onClear={environmentSelection.clear}
                    onSelectAll={environmentSelection.selectAllVisible}
                    selectedCount={selectedActionEnvironmentIds.length}
                  />
                </div>
                <div className="catalog-toolbar-actions" aria-label="Environment actions">
                  <button className="primary-button" disabled={!projectId} onClick={openCreateModal} type="button">
                    <AddIcon />
                    Create test environment
                  </button>
                </div>
              </div>
              <TileBrowserPane className="test-environment-list">
                {environmentsQuery.isLoading ? <TileCardSkeletonGrid /> : null}
                {!environmentsQuery.isLoading && filteredEnvironments.length && environmentViewMode === "tile" ? (
                  <div className="tile-browser-grid">
                    {filteredEnvironments.map((environment) => (
                      <button
                        className={selectedEnvironmentId === environment.id ? "record-card tile-card is-active" : "record-card tile-card"}
                        key={environment.id}
                        onClick={() => openEnvironmentWorkspace(environment.id)}
                        type="button"
                      >
                        <div className="tile-card-main">
                          <div className="tile-card-select-row" onClick={(event) => event.stopPropagation()}>
                            <label className="checkbox-field">
                              <input
                                aria-label={`Select ${environment.name}`}
                                checked={selectedActionEnvironmentIds.includes(environment.id)}
                                onChange={() => environmentSelection.toggle(environment.id)}
                                type="checkbox"
                              />
                              <span className="sr-only">Select environment</span>
                            </label>
                          </div>
                          <div className="tile-card-header">
                            <span className="resource-card-badge">URL</span>
                            <div className="tile-card-title-group">
                              <strong>{environment.name}</strong>
                              <span className="tile-card-kicker">{selectedAppTypeName}</span>
                            </div>
                            <TileCardStatusIndicator title={environment.base_url ? "Base URL configured" : "Draft target"} tone={environment.base_url ? "success" : "neutral"} />
                          </div>
                          {environment.base_url ? <p className="tile-card-description">{environment.base_url}</p> : <RichTextContent className="tile-card-description" value={environment.description} fallback="No environment URL or summary defined yet." />}
                          <div className="resource-card-footer">
                            <span className="count-pill">{environment.variables.length} variable{environment.variables.length === 1 ? "" : "s"}</span>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : null}
                {!environmentsQuery.isLoading && filteredEnvironments.length && environmentViewMode === "list" ? (
                  <DataTable
                    columns={environmentListColumns}
                    enableColumnResize
                    enableHeaderColumnReorder
                    enableRowSelection
                    emptyMessage="No environments match the current search."
                    getRowClassName={(environment) => (selectedEnvironmentId === environment.id ? "is-active-row" : "")}
                    getRowKey={(environment) => environment.id}
                    hideToolbarCopy
                    onRowClick={(environment) => openEnvironmentWorkspace(environment.id)}
                    onSelectedRowKeysChange={environmentSelection.setSelectedIds}
                    rows={filteredEnvironments}
                    selectedRowKeys={selectedActionEnvironmentIds}
                    storageKey="hellotest:test-environments:list-columns"
                  />
                ) : null}
                {!environmentsQuery.isLoading && !environments.length ? <div className="empty-state compact">No test environments defined for this scope yet.</div> : null}
                {!environmentsQuery.isLoading && environments.length > 0 && !filteredEnvironments.length ? <div className="empty-state compact">No environments match the current search.</div> : null}
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
            <Panel title="Configurations" titleVariant="eyebrow" subtitle={canUseMobileMetadata ? "Browse reusable browser and device profiles as cards before opening one into the editor." : "Browse reusable browser profiles as cards before opening one into the editor."}>
              <div className="design-list-toolbar catalog-command-toolbar resource-catalog-toolbar">
                <div className="catalog-toolbar-discovery" aria-label="Configuration views, search, and selection">
                  <CatalogViewToggle onChange={setConfigurationViewMode} value={configurationViewMode} />
                  <CatalogSearchFilter
                    activeFilterCount={configurationSearch.trim() ? 1 : 0}
                    ariaLabel="Search configurations"
                    onChange={setConfigurationSearch}
                    placeholder="Search configurations"
                    subtitle={canUseMobileMetadata ? "Search by name, browser, mobile OS, platform version, or app type scope." : "Search by name, browser, platform version, or app type scope."}
                    title="Configuration search"
                    type="search"
                    value={configurationSearch}
                  >
                    <div className="catalog-filter-grid">
                      <div className="catalog-filter-actions">
                        <button className="ghost-button" disabled={!configurationSearch.trim()} onClick={() => setConfigurationSearch("")} type="button">
                          Clear search
                        </button>
                      </div>
                    </div>
                  </CatalogSearchFilter>
                  <CatalogSelectionControls
                    allSelected={configurationSelection.allVisibleSelected}
                    canSelectAll={Boolean(visibleConfigurationIds.length)}
                    onClear={configurationSelection.clear}
                    onSelectAll={configurationSelection.selectAllVisible}
                    selectedCount={selectedActionConfigurationIds.length}
                  />
                </div>
                <div className="catalog-toolbar-actions" aria-label="Configuration actions">
                  <button className="primary-button" disabled={!projectId} onClick={openCreateModal} type="button">
                    <AddIcon />
                    Create configuration
                  </button>
                </div>
              </div>
              <TileBrowserPane className="test-environment-list">
                {configurationsQuery.isLoading ? <TileCardSkeletonGrid /> : null}
                {!configurationsQuery.isLoading && filteredConfigurations.length && configurationViewMode === "tile" ? (
                  <div className="tile-browser-grid">
                    {filteredConfigurations.map((configuration) => {
                      const targets = getConfigurationTargets(configuration);
                      const primaryTarget = targets[0];
                      return (
                        <article
                          className={selectedConfigurationId === configuration.id ? "record-card tile-card configuration-card is-active" : "record-card tile-card configuration-card"}
                          key={configuration.id}
                        >
                          <div className="tile-card-select-row">
                            <label className="checkbox-field">
                              <input
                                aria-label={`Select ${configuration.name}`}
                                checked={selectedActionConfigurationIds.includes(configuration.id)}
                                onChange={() => configurationSelection.toggle(configuration.id)}
                                type="checkbox"
                              />
                              <span className="sr-only">Select configuration</span>
                            </label>
                          </div>
                          <button
                            aria-label={`Open ${configuration.name}`}
                            className="tile-card-main configuration-card-open"
                            onClick={() => openConfigurationWorkspace(configuration.id)}
                            type="button"
                          >
                            <div className="tile-card-header">
                              <span className="resource-card-badge">CFG</span>
                              <div className="tile-card-title-group">
                                <strong>{configuration.name}</strong>
                                <span className="tile-card-kicker">{selectedAppTypeName}</span>
                              </div>
                              <TileCardStatusIndicator title={targets.length ? "Target rows configured" : "Draft profile"} tone={targets.length ? "success" : "neutral"} />
                            </div>
                            {primaryTarget ? (
                              <div className="configuration-target-summary">
                                <span className="configuration-target-summary-count">{targets.length} target{targets.length === 1 ? "" : "s"}</span>
                                <strong className="configuration-target-summary-primary">{formatConfigurationTargetRow(primaryTarget, canUseMobileMetadata) || "Flexible target"}</strong>
                                {targets.length > 1 ? <span className="configuration-target-summary-more">+{targets.length - 1} more row{targets.length === 2 ? "" : "s"}</span> : null}
                              </div>
                            ) : (
                              <RichTextContent className="tile-card-description" value={configuration.description} fallback="No target rows defined yet." />
                            )}
                            <div className="resource-card-footer">
                              <span className="count-pill">{getConfigurationCoverage(configuration, canUseMobileMetadata)}</span>
                              <span className="count-pill">{configuration.variables.length} variable{configuration.variables.length === 1 ? "" : "s"}</span>
                            </div>
                          </button>
                        </article>
                      );
                    })}
                  </div>
                ) : null}
                {!configurationsQuery.isLoading && filteredConfigurations.length && configurationViewMode === "list" ? (
                  <DataTable
                    columns={configurationListColumns}
                    enableColumnResize
                    enableHeaderColumnReorder
                    enableRowSelection
                    emptyMessage="No configurations match the current search."
                    getRowClassName={(configuration) => (selectedConfigurationId === configuration.id ? "is-active-row" : "")}
                    getRowKey={(configuration) => configuration.id}
                    hideToolbarCopy
                    onRowClick={(configuration) => openConfigurationWorkspace(configuration.id)}
                    onSelectedRowKeysChange={configurationSelection.setSelectedIds}
                    rows={filteredConfigurations}
                    selectedRowKeys={selectedActionConfigurationIds}
                    storageKey="hellotest:test-configurations:list-columns"
                  />
                ) : null}
                {!configurationsQuery.isLoading && !configurations.length ? <div className="empty-state compact">No test configurations defined for this scope yet.</div> : null}
                {!configurationsQuery.isLoading && configurations.length > 0 && !filteredConfigurations.length ? <div className="empty-state compact">No configurations match the current search.</div> : null}
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
                  showMobileMetadata={canUseMobileMetadata}
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
              <div className="design-list-toolbar catalog-command-toolbar resource-catalog-toolbar">
                <div className="catalog-toolbar-discovery" aria-label="Test data views, search, and selection">
                  <CatalogViewToggle onChange={setDataSetViewMode} value={dataSetViewMode} />
                  <CatalogSearchFilter
                    activeFilterCount={dataSetSearch.trim() ? 1 : 0}
                    ariaLabel="Search test data"
                    onChange={setDataSetSearch}
                    placeholder="Search test data"
                    subtitle="Search by name, description, mode, columns, or saved values."
                    title="Test data search"
                    type="search"
                    value={dataSetSearch}
                  >
                    <div className="catalog-filter-grid">
                      <div className="catalog-filter-actions">
                        <button className="ghost-button" disabled={!dataSetSearch.trim()} onClick={() => setDataSetSearch("")} type="button">
                          Clear search
                        </button>
                      </div>
                    </div>
                  </CatalogSearchFilter>
                  <CatalogSelectionControls
                    allSelected={dataSetSelection.allVisibleSelected}
                    canSelectAll={Boolean(visibleDataSetIds.length)}
                    onClear={dataSetSelection.clear}
                    onSelectAll={dataSetSelection.selectAllVisible}
                    selectedCount={selectedActionDataSetIds.length}
                  />
                </div>
                <div className="catalog-toolbar-actions" aria-label="Test data actions">
                  <button className="primary-button" disabled={!projectId} onClick={openCreateModal} type="button">
                    <AddIcon />
                    Create test data
                  </button>
                </div>
              </div>
              <TileBrowserPane className="test-environment-list">
                {dataSetsQuery.isLoading ? <TileCardSkeletonGrid /> : null}
                {!dataSetsQuery.isLoading && filteredDataSets.length && dataSetViewMode === "tile" ? (
                  <div className="tile-browser-grid">
                    {filteredDataSets.map((dataSet) => (
                      <button
                        className={selectedDataSetId === dataSet.id ? "record-card tile-card is-active" : "record-card tile-card"}
                        key={dataSet.id}
                        onClick={() => openDataSetWorkspace(dataSet.id)}
                        type="button"
                      >
                        <div className="tile-card-main">
                          <div className="tile-card-select-row" onClick={(event) => event.stopPropagation()}>
                            <label className="checkbox-field">
                              <input
                                aria-label={`Select ${dataSet.name}`}
                                checked={selectedActionDataSetIds.includes(dataSet.id)}
                                onChange={() => dataSetSelection.toggle(dataSet.id)}
                                type="checkbox"
                              />
                              <span className="sr-only">Select test data</span>
                            </label>
                          </div>
                          <div className="tile-card-header">
                            <span aria-hidden="true" className="resource-card-badge resource-card-badge--icon">
                              <TestDataIcon size={16} />
                            </span>
                            <div className="tile-card-title-group">
                              <strong>{dataSet.name}</strong>
                              <span className="tile-card-kicker">{dataSet.mode === "table" ? "Table mode" : "Key/value mode"}</span>
                            </div>
                            <TileCardStatusIndicator title={dataSet.mode === "table" ? "Table data set" : "Key/value data set"} tone={dataSet.rows.length ? "success" : "neutral"} />
                          </div>
                          <RichTextContent className="tile-card-description" value={dataSet.description} fallback="No test data summary defined yet." />
                          <div className="resource-card-footer">
                            <span className="count-pill">{dataSet.mode === "table" ? `${dataSet.rows.length} rows · ${dataSet.columns.length} columns` : `${dataSet.rows.length} key/value pairs`}</span>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                ) : null}
                {!dataSetsQuery.isLoading && filteredDataSets.length && dataSetViewMode === "list" ? (
                  <DataTable
                    columns={dataSetListColumns}
                    enableColumnResize
                    enableHeaderColumnReorder
                    enableRowSelection
                    emptyMessage="No test data sets match the current search."
                    getRowClassName={(dataSet) => (selectedDataSetId === dataSet.id ? "is-active-row" : "")}
                    getRowKey={(dataSet) => dataSet.id}
                    hideToolbarCopy
                    onRowClick={(dataSet) => openDataSetWorkspace(dataSet.id)}
                    onSelectedRowKeysChange={dataSetSelection.setSelectedIds}
                    rows={filteredDataSets}
                    selectedRowKeys={selectedActionDataSetIds}
                    storageKey="hellotest:test-data:list-columns"
                  />
                ) : null}
                {!dataSetsQuery.isLoading && !dataSets.length ? <div className="empty-state compact">No test data sets defined for this scope yet.</div> : null}
                {!dataSetsQuery.isLoading && dataSets.length > 0 && !filteredDataSets.length ? <div className="empty-state compact">No test data sets match the current search.</div> : null}
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
          closeDisabled={createEnvironment.isPending}
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
          className="resource-modal-card--configuration"
          closeDisabled={createConfiguration.isPending}
          onClose={() => !createConfiguration.isPending && setIsCreateConfigurationModalOpen(false)}
          title="Create configuration"
        >
          <ConfigurationForm
            browserOptions={browserOptions}
            draft={createConfigurationDraft}
            isSubmitting={createConfiguration.isPending}
            mobileOsOptions={mobileOsOptions}
            showMobileMetadata={canUseMobileMetadata}
            onChange={setCreateConfigurationDraft}
            onSubmit={handleCreateConfiguration}
            submitLabel={createConfiguration.isPending ? "Creating…" : "Create configuration"}
          />
        </ResourceModalShell>
      ) : null}

      {isCreateDataSetModalOpen ? (
        <ResourceModalShell
          className="resource-modal-card--test-data"
          closeDisabled={createDataSet.isPending}
          titleIcon={<TestDataIcon size={18} />}
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

export function buildDataSetPayload(projectId: string, appTypeId: string | undefined, draft: DataSetDraft): DataSetBuildResult {
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

export function ResourceModalShell({
  className,
  closeDisabled = false,
  titleIcon,
  title,
  children,
  onClose
}: {
  className?: string;
  closeDisabled?: boolean;
  titleIcon?: ReactNode;
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const dialogRef = useDialogFocus<HTMLDivElement>({ closeDisabled, onClose });

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        aria-label={title}
        aria-modal="true"
        className={["modal-card resource-modal-card", className].filter(Boolean).join(" ")}
        onClick={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="resource-modal-header">
          <div className="resource-modal-title">
            {titleIcon ? <span aria-hidden="true" className="resource-modal-title-icon">{titleIcon}</span> : null}
            <h2 className="dialog-title">{title}</h2>
          </div>
          <DialogCloseButton disabled={closeDisabled} label={`Close ${title} dialog`} onClick={onClose} />
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
          <RichTextEditor appearance="canonical" rows={3} value={draft.description} onChange={(description) => onChange({ ...draft, description })} />
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
  showMobileMetadata,
  onChange,
  onSubmit,
  onDelete,
  submitLabel,
  isSubmitting
}: {
  draft: ConfigurationDraft;
  browserOptions: Array<{ value: string; label: string }>;
  mobileOsOptions: Array<{ value: string; label: string }>;
  showMobileMetadata: boolean;
  onChange: (draft: ConfigurationDraft) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onDelete?: () => void;
  submitLabel: string;
  isSubmitting: boolean;
}) {
  const [announcement, setAnnouncement] = useState("");
  const firstControlRefs = useRef(new Map<string, HTMLSelectElement>());
  const targetRowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const [pendingTargetFocusId, setPendingTargetFocusId] = useState("");
  const duplicateTargetIndexes = getDuplicateConfigurationTargetIndexes(draft.targets);
  const validationError = getConfigurationDraftValidationError(draft);

  useEffect(() => {
    if (!pendingTargetFocusId) return;
    const row = targetRowRefs.current.get(pendingTargetFocusId);
    const control = firstControlRefs.current.get(pendingTargetFocusId);
    if (!row || !control) return;

    row.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    control.focus({ preventScroll: true });
    setPendingTargetFocusId("");
  }, [draft.targets, pendingTargetFocusId]);

  const updateTarget = (
    index: number,
    field: "os" | "browser" | "mobile_os" | "version",
    value: string
  ) => {
    onChange({
      ...draft,
      targets: draft.targets.map((target, currentIndex) =>
        currentIndex === index ? { ...target, [field]: value } : target
      )
    });
  };

  const addTarget = () => {
    const target = createConfigurationTarget();
    onChange({ ...draft, targets: [...draft.targets, target] });
    setAnnouncement(`Target row ${draft.targets.length + 1} added.`);
    setPendingTargetFocusId(target.id);
  };

  const duplicateTarget = (index: number) => {
    const source = draft.targets[index];
    if (!source) return;
    const target = createConfigurationTarget({ ...source, id: "" });
    const targets = [...draft.targets];
    targets.splice(index + 1, 0, target);
    onChange({ ...draft, targets });
    setAnnouncement(`Target row ${index + 1} duplicated as row ${index + 2}.`);
    setPendingTargetFocusId(target.id);
  };

  const moveTarget = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= draft.targets.length) return;
    const targets = [...draft.targets];
    const [target] = targets.splice(index, 1);
    targets.splice(nextIndex, 0, target);
    onChange({ ...draft, targets });
    setAnnouncement(`Target row ${index + 1} moved to row ${nextIndex + 1}.`);
    setPendingTargetFocusId(target.id);
  };

  const removeTarget = (index: number) => {
    const targets = draft.targets.filter((_, currentIndex) => currentIndex !== index);
    const nextFocusTarget = targets[Math.min(index, targets.length - 1)];
    onChange({ ...draft, targets });
    setAnnouncement(
      targets.length
        ? `Target row ${index + 1} removed.`
        : "Target row removed. This configuration will be saved as a draft until a target is added."
    );
    if (nextFocusTarget) setPendingTargetFocusId(nextFocusTarget.id);
  };

  return (
    <form className="resource-form resource-form--configuration" onSubmit={onSubmit}>
      <div className="resource-form-body">
        <FormField label="Configuration name" required>
          <input data-autofocus="true" required value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} />
        </FormField>

        <FormField label="Description">
          <RichTextEditor appearance="canonical" rows={3} value={draft.description} onChange={(description) => onChange({ ...draft, description })} />
        </FormField>

        <section aria-labelledby="configuration-targets-heading" className="configuration-matrix">
          <div className="configuration-matrix-header">
            <div>
              <h3 id="configuration-targets-heading">Configuration targets</h3>
              <p className="configuration-matrix-helper">
                Keep the operating system, browser, mobile OS, and version together in one row. Add another row for each exact combination—rows are never cross-multiplied.
              </p>
            </div>
            <button aria-label="Add target row" className="ghost-button configuration-matrix-add" onClick={addTarget} type="button">
              <AddIcon />
              Add target
            </button>
          </div>

          <p className="configuration-matrix-warning" role="note">
            Host OS values are saved for scheduling and reporting; runner capacity is validated when execution starts. iOS requires a compatible external runner.
          </p>

          {draft.targets.length ? (
            <div className="configuration-matrix-table-wrap">
              <table className="configuration-matrix-table">
                <caption className="sr-only">Configuration target rows</caption>
                <thead>
                  <tr>
                    <th scope="col">Row</th>
                    <th scope="col">Host OS</th>
                    <th scope="col">Browser</th>
                    {showMobileMetadata ? <th scope="col">Mobile OS</th> : null}
                    <th scope="col">Version</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {draft.targets.map((target, index) => {
                    const rowNumber = index + 1;
                    const isDuplicate = duplicateTargetIndexes.has(index);
                    const duplicateErrorId = `configuration-target-${target.id}-duplicate`;
                    return (
                      <tr
                        className={isDuplicate ? "is-invalid" : ""}
                        key={target.id}
                        ref={(node) => {
                          if (node) targetRowRefs.current.set(target.id, node);
                          else targetRowRefs.current.delete(target.id);
                        }}
                      >
                        <td className="configuration-matrix-index" data-label="Row">
                          <strong>{rowNumber}</strong>
                          {index === 0 ? <span className="configuration-matrix-default">Default</span> : null}
                        </td>
                        <td data-label="Host OS">
                          <select
                            aria-describedby={isDuplicate ? duplicateErrorId : undefined}
                            aria-invalid={isDuplicate || undefined}
                            aria-label={`Host OS for target row ${rowNumber}`}
                            ref={(node) => {
                              if (node) firstControlRefs.current.set(target.id, node);
                              else firstControlRefs.current.delete(target.id);
                            }}
                            value={target.os}
                            onChange={(event) => updateTarget(index, "os", event.target.value)}
                          >
                            <option value="">Any host OS</option>
                            {CONFIGURATION_HOST_OS_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        </td>
                        <td data-label="Browser">
                          <select
                            aria-describedby={isDuplicate ? duplicateErrorId : undefined}
                            aria-invalid={isDuplicate || undefined}
                            aria-label={`Browser for target row ${rowNumber}`}
                            value={target.browser}
                            onChange={(event) => updateTarget(index, "browser", event.target.value)}
                          >
                            <option value="">Any browser</option>
                            {browserOptions.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        </td>
                        {showMobileMetadata ? (
                          <td data-label="Mobile OS">
                            <select
                              aria-describedby={isDuplicate ? duplicateErrorId : undefined}
                              aria-invalid={isDuplicate || undefined}
                              aria-label={`Mobile OS for target row ${rowNumber}`}
                              value={target.mobile_os}
                              onChange={(event) => updateTarget(index, "mobile_os", event.target.value)}
                            >
                              <option value="">Not a mobile target</option>
                              {mobileOsOptions.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </select>
                          </td>
                        ) : null}
                        <td data-label="Version">
                          <input
                            aria-describedby={isDuplicate ? duplicateErrorId : undefined}
                            aria-invalid={isDuplicate || undefined}
                            aria-label={`Mobile or platform version for target row ${rowNumber}`}
                            list="configuration-version-options"
                            placeholder="13, 14, 17.4, or Latest"
                            value={target.version}
                            onChange={(event) => updateTarget(index, "version", event.target.value)}
                          />
                          {isDuplicate ? <span className="sr-only" id={duplicateErrorId}>This target duplicates another row.</span> : null}
                        </td>
                        <td data-label="Actions">
                          <div className="configuration-matrix-actions">
                            <button aria-label={`Duplicate target row ${rowNumber}`} className="configuration-matrix-action" onClick={() => duplicateTarget(index)} title="Duplicate row" type="button">⧉</button>
                            <button aria-label={`Move target row ${rowNumber} up`} className="configuration-matrix-action" disabled={index === 0} onClick={() => moveTarget(index, -1)} title="Move row up" type="button">↑</button>
                            <button aria-label={`Move target row ${rowNumber} down`} className="configuration-matrix-action" disabled={index === draft.targets.length - 1} onClick={() => moveTarget(index, 1)} title="Move row down" type="button">↓</button>
                            <button aria-label={`Remove target row ${rowNumber}`} className="configuration-matrix-action configuration-matrix-action--danger" onClick={() => removeTarget(index)} title="Remove row" type="button">×</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state compact resource-table-empty">
              No target rows defined. This configuration is a draft until you add one.
            </div>
          )}

          <datalist id="configuration-version-options">
            <option value="13" />
            <option value="14" />
            <option value="15" />
            <option value="16" />
            <option value="17" />
            <option value="Latest" />
          </datalist>
          <span aria-live="polite" className="sr-only">{announcement}</span>
          {duplicateTargetIndexes.size ? <p className="form-field-error" role="alert">Duplicate target rows are highlighted. Every row must represent a unique combination.</p> : null}
        </section>

        <KeyValueEditor
          entries={draft.variables}
          heading="Additional runtime variables"
          emptyMessage="No additional runtime variables added yet."
          onChange={(variables) => onChange({ ...draft, variables })}
          allowSecret
        />
        {validationError && !duplicateTargetIndexes.size ? <p className="form-field-error" role="alert">{validationError}</p> : null}
      </div>

      <div className="action-row resource-form-actions">
        <button className="primary-button" disabled={isSubmitting || Boolean(validationError)} type="submit">{submitLabel}</button>
        {onDelete ? <button className="ghost-button danger" disabled={isSubmitting} onClick={onDelete} type="button">Delete</button> : null}
      </div>
    </form>
  );
}

export function DataSetForm({
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
    <form className="resource-form test-data-form" onSubmit={onSubmit}>
      <div className="resource-form-body test-data-form-body">
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
              accept=".xlsx,.csv,.json,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
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
          <RichTextEditor appearance="canonical" rows={3} value={draft.description} onChange={(description) => onChange({ ...draft, description })} />
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
                <button aria-label="Refresh generated sample" className="ghost-button explorer-icon-button" onClick={() => setPreviewRevision((current) => current + 1)} title="Refresh generated sample" type="button">
                  <RefreshIcon />
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
  contextLabel,
  onSelect
}: {
  options: TestDataUtilityOption[];
  contextLabel?: string;
  onSelect: (template: string, mode: "template" | "static") => void;
}) {
  const { session } = useAuth();
  const [projectId] = useCurrentProject();
  const [appTypeId] = useCurrentAppType(projectId);
  const featureFlagsQuery = useFeatureFlags(Boolean(session));
  const canGenerateAiData = hasPermission(session, "data.ai", projectId)
    && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.ai.test_data_generation"]);
  const { getPrompt, getLlmIntegrationId } = useAiPromptRegistry(Boolean(session) && canGenerateAiData);
  const [selectedUtilityId, setSelectedUtilityId] = useState("");
  const [aiPrompt, setAiPrompt] = useState("");
  const [sampleCount, setSampleCount] = useState(6);
  const [aiPreview, setAiPreview] = useState<AiTestDataGenerationPreviewResponse | null>(null);
  const [selectedSuggestionId, setSelectedSuggestionId] = useState("");
  const [aiMessage, setAiMessage] = useState("");
  const generateAiData = useMutation({ mutationFn: api.testDataSets.previewAiData });
  const selectedUtility = options.find((option) => option.id === selectedUtilityId) || null;
  const selectedUtilityPreview = useMemo(
    () => selectedUtility ? evaluateTestDataTemplate(selectedUtility.template) : "",
    [selectedUtility]
  );
  const selectedSuggestion = aiPreview?.suggestions.find((item) => item.id === selectedSuggestionId)
    || aiPreview?.suggestions[0]
    || null;

  const handleAiGeneration = async () => {
    const prompt = aiPrompt.trim();
    if (!projectId || prompt.length < 3) {
      setAiMessage("Describe the synthetic data you want in at least a few words.");
      return;
    }
    setAiMessage("");
    try {
      const preview = await generateAiData.mutateAsync({
        project_id: projectId,
        app_type_id: appTypeId || undefined,
        prompt,
        field_context: contextLabel || undefined,
        sample_count: sampleCount,
        prompt_instruction: getPrompt("ai.test_data.synthetic") || undefined,
        integration_id: getLlmIntegrationId("ai.test_data.synthetic") || undefined
      });
      setAiPreview(preview);
      setSelectedSuggestionId(preview.suggestions[0]?.id || "");
      setAiMessage(preview.fallback_used
        ? "The direct LLM was unavailable, so HelloTest prepared safe synthetic fallback values for review."
        : "AI values are ready. Select one for Static, or randomize from the reviewed pool.");
    } catch (error) {
      setAiPreview(null);
      setSelectedSuggestionId("");
      setAiMessage(error instanceof Error ? error.message : "Unable to generate synthetic test data.");
    }
  };

  return (
    <div className="test-data-utility-panel">
      {canGenerateAiData && selectedUtilityId === "__llm__" ? (
        <section className="ai-test-data-utility" aria-label="AI synthetic data generator">
          <div className="ai-test-data-utility-head">
            <div>
              <strong>Generate synthetic data with AI</strong>
              <span>Describe the format, locale, constraints, boundaries, or scenario you need. Generated values stay reviewable before they enter the data set.</span>
            </div>
            <span className="count-pill">Direct LLM</span>
          </div>
          <textarea
            aria-label="Describe the synthetic test data"
            onChange={(event) => {
              setAiPrompt(event.target.value);
              setAiPreview(null);
              setSelectedSuggestionId("");
              setAiMessage("");
            }}
            placeholder="Example: Six fictional UK customer reference numbers, uppercase, 12 characters, starting with VIP-"
            rows={3}
            value={aiPrompt}
          />
          <div className="ai-test-data-utility-controls">
            <label>
              <span>Values</span>
              <select aria-label="Number of generated values" onChange={(event) => setSampleCount(Number(event.target.value))} value={sampleCount}>
                {[4, 6, 8, 10, 12].map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <button className="primary-button" disabled={generateAiData.isPending || aiPrompt.trim().length < 3} onClick={() => void handleAiGeneration()} type="button">
              {generateAiData.isPending ? "Generating…" : "Generate data"}
            </button>
          </div>
          {aiMessage ? <p aria-live="polite" className={aiPreview ? "form-success ai-test-data-message" : "form-error ai-test-data-message"}>{aiMessage}</p> : null}
          {aiPreview?.suggestions.length ? (
            <div className="ai-test-data-review">
              <div className="ai-test-data-review-head">
                <div>
                  <strong>{aiPreview.summary}</strong>
                  <span>{aiPreview.suggestions.length} fictional value{aiPreview.suggestions.length === 1 ? "" : "s"} · human review required</span>
                </div>
                <div className="ai-test-data-apply-actions">
                  <button className="primary-button compact" onClick={() => onSelect(aiPreview.randomized_template, "template")} type="button">Randomize</button>
                  <button className="ghost-button compact" disabled={!selectedSuggestion} onClick={() => selectedSuggestion && onSelect(selectedSuggestion.value, "static")} type="button">Static</button>
                </div>
              </div>
              <div className="ai-test-data-suggestions" role="radiogroup" aria-label="Generated synthetic values">
                {aiPreview.suggestions.map((suggestion) => {
                  const isSelected = suggestion.id === (selectedSuggestion?.id || "");
                  return (
                    <button
                      aria-checked={isSelected}
                      className={isSelected ? "ai-test-data-suggestion is-selected" : "ai-test-data-suggestion"}
                      key={suggestion.id}
                      onClick={() => setSelectedSuggestionId(suggestion.id)}
                      role="radio"
                      type="button"
                    >
                      <span aria-hidden="true" className="ai-test-data-radio" />
                      <code>{suggestion.value}</code>
                    </button>
                  );
                })}
              </div>
              <small>Randomize chooses from this reviewed pool when a run snapshot is created. Static stores only the selected value.</small>
            </div>
          ) : null}
        </section>
      ) : null}
      <section className="test-data-utility-library" aria-label="Reusable data utilities">
        <div className="test-data-utility-library-head">
          <div>
            <strong>Reusable utilities</strong>
            <span>Choose from every built-in utility and saved generator available in this project.</span>
          </div>
          <span className="count-pill">{options.length} available</span>
        </div>
        <label className="test-data-utility-select-field">
          <span>Available utilities</span>
          <select
            aria-label="Available data utilities"
            onChange={(event) => setSelectedUtilityId(event.target.value)}
            value={selectedUtilityId}
          >
            <option value="">Choose a utility…</option>
            {canGenerateAiData ? <option value="__llm__">LLM — Generate from a prompt</option> : null}
            {(["Data utility", "Saved template"] as const).map((group) => {
              const groupOptions = options.filter((option) => option.group === group);
              return groupOptions.length ? (
                <optgroup key={group} label={group === "Data utility" ? "Built-in utilities" : "Saved templates"}>
                  {groupOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}{option.source ? ` — ${option.source}` : ""}
                    </option>
                  ))}
                </optgroup>
              ) : null;
            })}
          </select>
        </label>
        {selectedUtilityId === "__llm__" ? (
          <p className="test-data-utility-select-hint">Use the LLM prompt workspace above to generate and review fictional values.</p>
        ) : selectedUtility ? (
          <div className="test-data-utility-selection">
            <div className="test-data-utility-selection-copy">
              <span className="test-data-utility-option-meta">
                {selectedUtility.group}{selectedUtility.source ? ` · ${selectedUtility.source}` : ""}
              </span>
              <strong>{selectedUtility.label}</strong>
              <code>{selectedUtility.template}</code>
              <small>Sample: {selectedUtilityPreview || "-"}</small>
            </div>
            <div className="test-data-utility-option-actions">
              <button className="primary-button compact" onClick={() => onSelect(selectedUtility.template, "template")} type="button">
                Use dynamic value
              </button>
              <button className="ghost-button compact" onClick={() => onSelect(selectedUtility.template, "static")} type="button">
                Use this sample
              </button>
            </div>
          </div>
        ) : (
          <p className="test-data-utility-select-hint">Select a utility to preview its template and sample value.</p>
        )}
      </section>
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
  utilityLabel,
  utilityContextLabel
}: {
  value: string;
  onChange: (value: string) => void;
  utilityOptions: TestDataUtilityOption[];
  isUtilityOpen: boolean;
  onToggleUtility: () => void;
  onApplyUtility: (template: string, mode: "template" | "static") => void;
  utilityLabel: string;
  utilityContextLabel?: string;
}) {
  const modalContextLabel = utilityContextLabel || utilityLabel.replace(/^Open data utilities for\s*/i, "");
  const utilityDialogRef = useDialogFocus<HTMLDivElement>({
    active: isUtilityOpen,
    onClose: onToggleUtility
  });
  const utilityPanel = isUtilityOpen && typeof document !== "undefined" ? createPortal(
    <div className="test-data-utility-modal-backdrop" onMouseDown={onToggleUtility} role="presentation">
      <div
        aria-label={utilityLabel}
        aria-modal="true"
        className="test-data-utility-floating"
        onMouseDown={(event) => event.stopPropagation()}
        ref={utilityDialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="test-data-utility-modal-head">
          <div>
            <strong>Data utilities</strong>
            <span>{modalContextLabel ? `For ${modalContextLabel}` : "Choose a dynamic template or write one generated value into this cell."}</span>
          </div>
          <DialogCloseButton label="Close data utilities" onClick={onToggleUtility} />
        </div>
        <DataUtilityPicker
          contextLabel={modalContextLabel}
          options={utilityOptions}
          onSelect={(template, mode) => {
            onApplyUtility(template, mode);
          }}
        />
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <div className="test-data-cell-editor">
      <div className="test-data-cell-input-row">
        <textarea
          aria-label={`Value for ${modalContextLabel || "test data cell"}`}
          className="resource-data-cell"
          rows={Math.min(Math.max(String(value || "").split("\n").length, 1), 3)}
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
          <TestDataIcon size={18} />
        </button>
      </div>
      {utilityPanel}
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
  const [pendingEntryFocusId, setPendingEntryFocusId] = useState("");
  const keyInputRefs = useRef(new Map<string, HTMLInputElement>());

  useEffect(() => {
    if (!pendingEntryFocusId) return;
    const input = keyInputRefs.current.get(pendingEntryFocusId);
    if (!input) return;

    input.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    input.focus({ preventScroll: true });
    setPendingEntryFocusId("");
  }, [entries, pendingEntryFocusId]);

  const addEntry = () => {
    const entry = createKeyValueEntry();
    onChange([...entries, entry]);
    setPendingEntryFocusId(entry.id || "");
  };

  return (
    <div className="resource-table-shell resource-table-shell--key-value">
      <div className="resource-table-toolbar">
        <strong>{heading}</strong>
        <button className="ghost-button" onClick={addEntry} type="button">Add pair</button>
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
                    ref={(node) => {
                      if (node && entry.id) keyInputRefs.current.set(entry.id, node);
                      else if (entry.id) keyInputRefs.current.delete(entry.id);
                    }}
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
                      onApplyUtility={(template, mode) => {
                        const nextValue = mode === "static" ? evaluateTestDataTemplate(template) : template;
                        setActiveUtilityRow(null);
                        onChange(
                          entries.map((current, currentIndex) =>
                            currentIndex === index
                              ? { ...current, value: nextValue, has_stored_value: current.has_stored_value || Boolean(nextValue) }
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
                      utilityContextLabel={entry.key || `pair ${index + 1}`}
                      utilityLabel={`Open data utilities for ${entry.key || `pair ${index + 1}`}`}
                      utilityOptions={utilityOptions}
                      value={entry.value}
                    />
                  ) : multilineValue && !entry.is_secret ? (
                    <textarea
                      rows={Math.min(Math.max(String(entry.value || "").split("\n").length, 1), 3)}
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
                    aria-label={`Remove pair ${index + 1}`}
                    className="ghost-button danger resource-table-remove resource-remove-icon"
                    onClick={() => onChange(entries.filter((_, currentIndex) => currentIndex !== index))}
                    title="Remove pair"
                    type="button"
                  >
                    <span aria-hidden="true">X</span>
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
  const [dragState, setDragState] = useState<{ type: "column" | "row"; index: number } | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const expandedDialogRef = useDialogFocus<HTMLDivElement>({
    active: isExpanded,
    onClose: () => setIsExpanded(false)
  });
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
    <div
      aria-label={isExpanded ? "Expanded table data editor" : undefined}
      aria-modal={isExpanded ? "true" : undefined}
      className={isExpanded ? "resource-table-shell is-expanded" : "resource-table-shell"}
      ref={expandedDialogRef}
      role={isExpanded ? "dialog" : undefined}
      tabIndex={isExpanded ? -1 : undefined}
    >
      <div className="resource-table-toolbar">
        <div className="resource-table-actions">
          <button
            aria-label={isExpanded ? "Collapse table editor" : "Expand table editor"}
            aria-pressed={isExpanded}
            className="ghost-button resource-table-add-button explorer-icon-button"
            onClick={() => setIsExpanded((current) => !current)}
            title={isExpanded ? "Collapse table editor" : "Expand table editor"}
            type="button"
          >
            <CollapseExpandIcon isExpanded={isExpanded} />
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
                    style={{ "--test-data-column-width": getTestDataColumnWidth(column) } as CSSProperties}
                  >
                    <div className="resource-column-header">
                      <button
                        aria-label={`Move column ${column || columnIndex + 1}`}
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
                        aria-label={`Column ${columnIndex + 1} name`}
                        value={column}
                        onChange={(event) => handleRenameColumn(columnIndex, event.target.value)}
                      />
                      <button
                        aria-label={`Remove column ${column || columnIndex + 1}`}
                        className="ghost-button danger resource-column-remove resource-remove-icon"
                        onClick={() => handleRemoveColumn(columnIndex)}
                        title="Remove column"
                        type="button"
                      >
                        <span aria-hidden="true">X</span>
                      </button>
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
                    <td
                      className="resource-sheet-data-cell"
                      key={`${rowIndex}-${columnIndex}`}
                      style={{ "--test-data-column-width": getTestDataColumnWidth(column) } as CSSProperties}
                    >
                      <TestDataCellValueEditor
                        isUtilityOpen={activeUtilityCell === `${rowIndex}:${columnIndex}`}
                        onApplyUtility={(template, mode) => {
                          updateCellValue(rowIndex, column, mode === "static" ? evaluateTestDataTemplate(template) : template);
                          setActiveUtilityCell("");
                        }}
                        onChange={(value) => updateCellValue(rowIndex, column, value)}
                        onToggleUtility={() => {
                          const cellId = `${rowIndex}:${columnIndex}`;
                          setActiveUtilityCell((current) => (current === cellId ? "" : cellId));
                        }}
                        utilityContextLabel={`row ${rowIndex + 1}, column ${column}`}
                        utilityLabel={`Open data utilities for row ${rowIndex + 1}, ${column}`}
                        utilityOptions={utilityOptions}
                        value={row[column] ?? ""}
                      />
                    </td>
                  ))}
                  <td className="resource-sheet-action-cell">
                    <button
                      aria-label={`Remove row ${rowIndex + 1}`}
                      className="ghost-button danger resource-table-remove resource-remove-icon"
                      onClick={() =>
                        onChange({
                          ...draft,
                          columns,
                          rows: rows.filter((_, currentIndex) => currentIndex !== rowIndex)
                        })
                      }
                      title="Remove row"
                      type="button"
                    >
                      <span aria-hidden="true">X</span>
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
