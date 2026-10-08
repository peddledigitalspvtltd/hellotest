import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../src/auth/AuthContext";
import { useFeatureFlags } from "../src/platform/hooks/useFeatureFlags";
import { useLocalization } from "../src/context/LocalizationContext";
import { AddIcon, CollapseExpandIcon, CopyIcon, SaveIcon, TrashIcon } from "../src/platform/components/AppIcons";
import { LoadingState } from "../src/shared/components/LoadingState";
import { PageHeader } from "../src/shared/components/PageHeader";
import { Panel } from "../src/shared/components/Panel";
import { ToastMessage } from "../src/shared/components/ToastMessage";
import { api } from "../src/lib/api";
import {
  AI_METRIC_CRITERIA_OVERRIDES_KEY,
  AI_METRIC_FORMULA_VALUES_KEY,
  AI_PROMPT_LLM_OVERRIDES_KEY,
  AI_PROMPT_OVERRIDES_KEY
} from "@hellotest/integration/frontend/lib/aiPromptRegistry";
import { parseLocalizationPack, MAX_LOCALIZATION_BYTES } from "../src/platform/lib/localizationPack";
import { DEFAULT_LOCALIZATION_STRINGS } from "../src/platform/lib/localization";
import { areFeatureFlagsEnabled } from "../src/platform/lib/featureFlags";
import { hasPermission } from "../src/platform/lib/permissions";
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  readNotificationPreferences,
  writeNotificationPreferences,
  type NotificationPreferences
} from "../src/platform/lib/notificationPreferences";
import { queryKeys } from "../src/platform/lib/queryKeys";
import type { ApiKeyScope, ApiKeyScopeOption, Integration, UserApiKey } from "../src/types";
import { readDefaultCatalogViewMode, writeDefaultCatalogViewMode, type CatalogViewModePreference } from "../src/shared/lib/viewPreferences";
import { isRovoIntegrationId } from "@hellotest/integration/frontend/lib/rovo";
import {
  PREFERENCES_UPDATED_EVENT,
  emitWorkspacePreferenceUpdate,
  preferenceStorageKeys,
  readSidebarMode,
  readWorkspaceTheme,
  writeSidebarMode,
  type SidebarMode,
  type WorkspaceTheme
} from "../src/platform/lib/workspacePreferences";

const DEFAULT_API_KEY_SCOPE_OPTIONS: ApiKeyScopeOption[] = [
  { value: "user", label: "User access", description: "Default. Uses your current user permissions." },
  { value: "read", label: "Read only", description: "GET and HEAD requests only." },
  { value: "design", label: "Design", description: "Stories, test cases, suites, steps, and data." },
  { value: "automation", label: "Automation", description: "Automation build, object repository, recorder, and workflows." },
  { value: "runs", label: "Runs", description: "Executions, results, schedules, reports, and defects." },
  { value: "environment", label: "Environment", description: "Environments, configurations, app types, and data sets." },
  { value: "integrations", label: "Integrations", description: "Integrations, AI knowledge, and prompt templates." },
  { value: "admin", label: "Admin", description: "Full API access, limited by your user permissions." }
];

type ProjectAutomationSettings = {
  waitTimeMs: string;
  failureRetries: string;
  videoMode: "off" | "on" | "retain-on-failure";
  screenshotMode: "off" | "on" | "only-on-failure";
  defaultLlmIntegrationId: string;
  localEngineBaseUrl: string;
  remoteGridProvider: "default" | "browserstack" | "lambdatest" | "saucelabs" | "crossbrowser";
};

const DEFAULT_PROJECT_AUTOMATION_SETTINGS: ProjectAutomationSettings = {
  waitTimeMs: "750",
  failureRetries: "2",
  videoMode: "retain-on-failure",
  screenshotMode: "only-on-failure",
  defaultLlmIntegrationId: "",
  localEngineBaseUrl: "http://localhost:4311",
  remoteGridProvider: "default"
};

type SettingsSectionId =
  | "general"
  | "apiKeys"
  | "automationDefaults"
  | "exportRetention"
  | "notifications"
  | "localization";

const DEFAULT_EXPANDED_SETTINGS_SECTIONS: Record<SettingsSectionId, boolean> = {
  general: true,
  apiKeys: false,
  automationDefaults: false,
  exportRetention: false,
  notifications: true,
  localization: false
};

function readProjectAutomationSettings(): ProjectAutomationSettings {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(preferenceStorageKeys.projectAutomationSettings) || "{}") as Partial<ProjectAutomationSettings>;
    const settings = { ...DEFAULT_PROJECT_AUTOMATION_SETTINGS, ...parsed };
    return {
      ...settings,
      defaultLlmIntegrationId: isRovoIntegrationId(settings.defaultLlmIntegrationId) ? "" : settings.defaultLlmIntegrationId
    };
  } catch {
    return DEFAULT_PROJECT_AUTOMATION_SETTINGS;
  }
}

export function SettingsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const { strings, setWorkspaceStrings, t, formatDate } = useLocalization();
  const [theme, setTheme] = useState<WorkspaceTheme>("light");
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>("collapsed");
  const [defaultCatalogViewMode, setDefaultCatalogViewMode] = useState<CatalogViewModePreference>("tile");
  const [autoExport, setAutoExport] = useState(false);
  const [projectAutomationSettings, setProjectAutomationSettings] = useState<ProjectAutomationSettings>(DEFAULT_PROJECT_AUTOMATION_SETTINGS);
  const [notificationPreferences, setNotificationPreferences] = useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFERENCES);
  const [apiKeyName, setApiKeyName] = useState("");
  const [apiKeyScope, setApiKeyScope] = useState<ApiKeyScope>("user");
  const [createdApiKey, setCreatedApiKey] = useState("");
  const [createdApiKeyRecord, setCreatedApiKeyRecord] = useState<UserApiKey | null>(null);
  const [isCreatingApiKey, setIsCreatingApiKey] = useState(false);
  const [revokingApiKeyId, setRevokingApiKeyId] = useState("");
  const [deletingApiKeyId, setDeletingApiKeyId] = useState("");
  const [expandedSettingsSections, setExpandedSettingsSections] = useState<Record<SettingsSectionId, boolean>>(DEFAULT_EXPANDED_SETTINGS_SECTIONS);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">("success");
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [pendingLanguagePack, setPendingLanguagePack] = useState<{ name: string; strings: Record<string, string> } | null>(null);
  const [isSavingLocalization, setIsSavingLocalization] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const featureFlagsQuery = useFeatureFlags(Boolean(session));
  const canManageApiKeys = hasPermission(session, "api_key.manage")
    && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.api.keys"]);
  const canManageLocalization = hasPermission(session, "localization.manage")
    && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.ops.settings", "hellotest.ops.admin"]);
  const canUseAutomationWorkspace = areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.automation.workspace"]);
  const canViewIntegrations = hasPermission(session, "integration.view") && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.api.integrations"]);
  const integrationsQuery = useQuery({ queryKey: queryKeys.integrations.all(), queryFn: () => api.integrations.list(), enabled: Boolean(session && canViewIntegrations && canUseAutomationWorkspace) });
  const llmIntegrations = useMemo(() => (integrationsQuery.data || []).filter((integration: Integration) => integration.type === "llm" && integration.is_active && !isRovoIntegrationId(integration.id)), [integrationsQuery.data]);
  const workspacePreferencesQuery = useQuery({
    queryKey: queryKeys.settings.workspacePreferences(),
    queryFn: api.settings.getWorkspacePreferences,
    enabled: Boolean(session)
  });
  const apiKeysQuery = useQuery({
    queryKey: queryKeys.settings.apiKeys(),
    queryFn: api.settings.listApiKeys,
    enabled: Boolean(session && canManageApiKeys)
  });
  const apiKeyScopeOptions = useMemo(
    () => (apiKeysQuery.data?.scopes?.length ? apiKeysQuery.data.scopes : DEFAULT_API_KEY_SCOPE_OPTIONS)
      .filter((scope) => canUseAutomationWorkspace || scope.value !== "automation"),
    [apiKeysQuery.data, canUseAutomationWorkspace]
  );
  const apiKeyScopeLabels = useMemo(
    () => Object.fromEntries(apiKeyScopeOptions.map((scope) => [scope.value, scope.label])) as Record<ApiKeyScope, string>,
    [apiKeyScopeOptions]
  );

  useEffect(() => {
    setTheme(readWorkspaceTheme());
    setSidebarMode(readSidebarMode());
    setDefaultCatalogViewMode(readDefaultCatalogViewMode());
    setAutoExport(window.localStorage.getItem(preferenceStorageKeys.autoExport) === "true");
    setProjectAutomationSettings(readProjectAutomationSettings());
    setNotificationPreferences(readNotificationPreferences());
  }, []);

  useEffect(() => {
    const syncJiraTheme = () => setTheme(readWorkspaceTheme());
    window.addEventListener(PREFERENCES_UPDATED_EVENT, syncJiraTheme);
    return () => window.removeEventListener(PREFERENCES_UPDATED_EVENT, syncJiraTheme);
  }, []);


  const saveSettings = async () => {
    setIsSavingSettings(true);

    try {
      writeSidebarMode(sidebarMode);
      window.localStorage.setItem(preferenceStorageKeys.autoExport, String(autoExport));
      window.localStorage.setItem(preferenceStorageKeys.projectAutomationSettings, JSON.stringify({
        ...projectAutomationSettings,
        defaultLlmIntegrationId: isRovoIntegrationId(projectAutomationSettings.defaultLlmIntegrationId)
          ? ""
          : projectAutomationSettings.defaultLlmIntegrationId
      }));
      writeDefaultCatalogViewMode(defaultCatalogViewMode);
      writeNotificationPreferences(notificationPreferences);
      const governedPreferenceKeys = new Set([
        AI_PROMPT_OVERRIDES_KEY,
        AI_PROMPT_LLM_OVERRIDES_KEY,
        AI_METRIC_CRITERIA_OVERRIDES_KEY,
        AI_METRIC_FORMULA_VALUES_KEY
      ]);
      const preferencesToSave: Record<string, unknown> = Object.fromEntries(
        Object.entries(workspacePreferencesQuery.data?.preferences || {}).filter(([key]) => !governedPreferenceKeys.has(key))
      );

      await api.settings.updateWorkspacePreferences({ preferences: preferencesToSave });
      await workspacePreferencesQuery.refetch();
      await queryClient.invalidateQueries({ queryKey: ["projects", "portfolio-analytics"] });
      emitWorkspacePreferenceUpdate({ sidebarMode });
      setMessageTone("success");
      setMessage("Settings changes saved.");
    } catch (error) {
      showError(error, "Unable to save settings changes.");
    } finally {
      setIsSavingSettings(false);
    }
  };

  const updateProjectAutomationSetting = <Key extends keyof ProjectAutomationSettings>(
    key: Key,
    value: ProjectAutomationSettings[Key]
  ) => {
    setProjectAutomationSettings((current) => ({
      ...current,
      [key]: value
    }));
  };

  const showError = (error: unknown, fallback: string) => {
    setMessageTone("error");
    setMessage(error instanceof Error ? error.message : fallback);
  };

  const handleDownloadLocalization = async () => {
    try {
    const current = await api.settings.getLocalization();
    const blob = new Blob([JSON.stringify({ ...DEFAULT_LOCALIZATION_STRINGS, ...current.strings }, null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = "hellotest-localization.json";
    link.click();
    URL.revokeObjectURL(href);
    } catch (error) { showError(error, "Unable to download workspace strings."); }
  };

  const persistLocalization = async (nextStrings: Record<string, string>, successMessage: string) => {
    if (!canManageLocalization) {
      showError(new Error("Permission required: localization.manage"), "Unable to save localization strings.");
      return;
    }

    setIsSavingLocalization(true);

    try {
      const response = await api.settings.updateLocalization({ strings: nextStrings });
      setWorkspaceStrings(response.strings);
      setMessageTone("success");
      setMessage(successMessage);
      setPendingLanguagePack(null);
    } catch (error) {
      showError(error, "Unable to save localization strings.");
    } finally {
      setIsSavingLocalization(false);
    }
  };

  const handleUploadLocalization = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      if (file.size > MAX_LOCALIZATION_BYTES) throw new Error("Language packs must be smaller than 512 KB.");
      const parsed = parseLocalizationPack(await file.text());
      setPendingLanguagePack({ name: file.name, strings: parsed });
    } catch (error) {
      showError(error, "Unable to upload localization strings.");
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const formatApiDate = (value?: string | null) => {
    if (!value) {
      return "Never";
    }

    return formatDate(value);
  };

  const copyToClipboard = async (value: string, successMessage: string) => {
    if (!value) {
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      setMessageTone("success");
      setMessage(successMessage);
      setPendingLanguagePack(null);
    } catch (error) {
      showError(error, "Unable to copy to clipboard.");
    }
  };

  const handleCreateApiKey = async () => {
    if (!canManageApiKeys) {
      setMessageTone("error");
      setMessage("Permission required: api_key.manage");
      return;
    }

    if (apiKeyName.trim().length < 2) {
      setMessageTone("error");
      setMessage("Enter an API key name with at least 2 characters.");
      return;
    }

    setIsCreatingApiKey(true);

    try {
      const response = await api.settings.createApiKey({
        name: apiKeyName.trim(),
        scope: apiKeyScope
      });
      setCreatedApiKey(response.key);
      setCreatedApiKeyRecord(response.api_key);
      setApiKeyName("");
      setApiKeyScope("user");
      await apiKeysQuery.refetch();
      setMessageTone("success");
      setMessage("API key created. Copy it now; it will not be shown again.");
    } catch (error) {
      showError(error, "Unable to create API key.");
    } finally {
      setIsCreatingApiKey(false);
    }
  };

  const handleRevokeApiKey = async (apiKeyRecord: UserApiKey) => {
    if (!canManageApiKeys) {
      setMessageTone("error");
      setMessage("Permission required: api_key.manage");
      return;
    }

    if (!apiKeyRecord.is_active || !window.confirm(`Revoke API key "${apiKeyRecord.name}"?`)) {
      return;
    }

    setRevokingApiKeyId(apiKeyRecord.id);

    try {
      await api.settings.revokeApiKey(apiKeyRecord.id);
      if (createdApiKeyRecord?.id === apiKeyRecord.id) {
        setCreatedApiKey("");
        setCreatedApiKeyRecord(null);
      }
      await apiKeysQuery.refetch();
      setMessageTone("success");
      setMessage("API key revoked.");
    } catch (error) {
      showError(error, "Unable to revoke API key.");
    } finally {
      setRevokingApiKeyId("");
    }
  };

  const handleDeleteApiKey = async (apiKeyRecord: UserApiKey) => {
    if (!canManageApiKeys) {
      setMessage("You do not have permission to manage API keys.");
      setMessageTone("error");
      return;
    }

    if (!window.confirm(`Delete API key "${apiKeyRecord.name}" from this list? This cannot be undone.`)) {
      return;
    }

    setDeletingApiKeyId(apiKeyRecord.id);
    setMessage("");
    try {
      await api.settings.deleteApiKey(apiKeyRecord.id);
      if (createdApiKeyRecord?.id === apiKeyRecord.id) {
        setCreatedApiKey("");
        setCreatedApiKeyRecord(null);
      }
      await apiKeysQuery.refetch();
      setMessageTone("success");
      setMessage("API key deleted.");
    } catch (error) {
      showError(error, "Unable to delete API key.");
    } finally {
      setDeletingApiKeyId("");
    }
  };

  const toggleSettingsSection = (section: SettingsSectionId) => {
    setExpandedSettingsSections((current) => ({
      ...current,
      [section]: !current[section]
    }));
  };

  const settingsActions = (
    <button
      className="primary-button"
      disabled={isSavingSettings || isSavingLocalization}
      onClick={() => void saveSettings()}
      type="button"
    >
      <SaveIcon />
      {isSavingSettings ? "Saving..." : "Save changes"}
    </button>
  );

  const renderSettingsSection = (
    section: SettingsSectionId,
    eyebrow: string,
    title: string,
    children: ReactNode,
    options: { actions?: ReactNode; visible?: boolean } = {}
  ) => {
    if (options.visible === false) {
      return null;
    }

    const isExpanded = expandedSettingsSections[section];

    return (
      <section className={isExpanded ? "settings-section is-expanded" : "settings-section is-collapsed"} key={section}>
        <div className="settings-section-heading settings-section-heading--with-action">
          <button
            aria-expanded={isExpanded}
            className="settings-section-toggle"
            onClick={() => toggleSettingsSection(section)}
            type="button"
          >
            <span>
              <span className="eyebrow">{eyebrow}</span>
              <strong>{title}</strong>
            </span>
            <span aria-hidden="true" className="settings-section-toggle-icon"><CollapseExpandIcon isExpanded={isExpanded} /></span>
          </button>
          {options.actions ? <div className="settings-section-actions">{options.actions}</div> : null}
        </div>
        {isExpanded ? children : null}
      </section>
    );
  };

  return (
    <div className={embedded ? "admin-embedded-page settings-admin-page" : "page-content"}>
      {!embedded ? (
	        <PageHeader
          eyebrow="Settings"
          title="Workspace Settings"
          description="Save the interface defaults and behavior preferences you want to carry across sessions."
	          meta={[
	            { label: "Theme", value: theme === "light" ? "Light" : "Dark" },
	            { label: "Sidebar", value: sidebarMode === "collapsed" ? "Collapsed" : "Expanded" },
	            { label: "Catalogs", value: defaultCatalogViewMode === "tile" ? "Grid" : "List" },
	            { label: "Export prompts", value: autoExport ? "Enabled" : "Off" }
	          ]}
	          actions={settingsActions}
	        />
	      ) : null}

      <ToastMessage message={message} onDismiss={() => setMessage("")} tone={messageTone} />

	      {embedded ? (
	        <div className="settings-top-save-bar">
	          <div>
	            <span className="eyebrow">Settings</span>
	            <strong>Workspace settings</strong>
	          </div>
	          {settingsActions}
	        </div>
	      ) : null}

	      <div className="settings-section-stack">
        {renderSettingsSection("general", "General", "Appearance and navigation", (
          <div className="two-column-grid">
            <Panel title="Appearance" subtitle="HelloTest keeps your workspace appearance preference on this device.">
              <div className="detail-stack">
                <div className="settings-native-preference">
                  <strong>{theme === "dark" ? t("settings.general.themeDark", "Dark theme") : t("settings.general.themeLight", "Light theme")}</strong>
                  <span>Use the header theme control to switch appearance; your choice is restored automatically.</span>
                </div>
                <label className="checkbox-field">
                  <input checked={sidebarMode === "expanded"} name="sidebar-preference" onChange={() => setSidebarMode("expanded")} type="radio" />
                  <span>{t("settings.general.sidebarExpanded", "Expanded sidebar by default")}</span>
                </label>
                <label className="checkbox-field">
                  <input checked={sidebarMode === "collapsed"} name="sidebar-preference" onChange={() => setSidebarMode("collapsed")} type="radio" />
                  <span>{t("settings.general.sidebarCollapsed", "Collapsed sidebar by default")}</span>
                </label>
              </div>
            </Panel>

            <Panel title="Catalog view preference" subtitle="Choose the default view used when catalog pages open.">
              <div className="detail-stack">
                <label className="checkbox-field">
                  <input checked={defaultCatalogViewMode === "tile"} name="catalog-view-preference" onChange={() => setDefaultCatalogViewMode("tile")} type="radio" />
                  <span>{t("settings.general.catalogGrid", "Open catalogs in grid view by default")}</span>
                </label>
                <label className="checkbox-field">
                  <input checked={defaultCatalogViewMode === "list"} name="catalog-view-preference" onChange={() => setDefaultCatalogViewMode("list")} type="radio" />
                  <span>{t("settings.general.catalogList", "Open catalogs in list view by default")}</span>
                </label>
              </div>
            </Panel>
          </div>
	        ))}

        {renderSettingsSection("apiKeys", "API", "API access keys", (
          <Panel title="Scoped API keys" subtitle="Create personal keys for API clients. A key can never exceed your current user permissions.">
            <div className="settings-api-create-grid">
              <label className="settings-input-field">
                <span>Key name</span>
                <input
                  onChange={(event) => setApiKeyName(event.target.value)}
                  placeholder="CI runner, local script, reporting job"
                  value={apiKeyName}
                />
                <small>Use a name that makes the client easy to audit later.</small>
              </label>
              <label className="settings-input-field">
                <span>Scope</span>
                <select
                  onChange={(event) => setApiKeyScope(event.target.value as ApiKeyScope)}
                  value={apiKeyScope}
                >
                  {apiKeyScopeOptions.map((scope) => (
                    <option key={scope.value} value={scope.value}>{scope.label}</option>
                  ))}
                </select>
                <small>{apiKeyScopeOptions.find((scope) => scope.value === apiKeyScope)?.description || "Scoped API access."}</small>
              </label>
              <button
                className="primary-button settings-api-create-button"
                disabled={isCreatingApiKey || apiKeyName.trim().length < 2}
                onClick={() => void handleCreateApiKey()}
                type="button"
              >
                <AddIcon />
                <span>{isCreatingApiKey ? "Creating..." : "Create API key"}</span>
              </button>
            </div>

            {createdApiKey ? (
              <div className="settings-api-key-reveal" role="status">
                <div>
                  <strong>{createdApiKeyRecord?.name || "New API key"}</strong>
                  <span>Copy this key now. It will not be shown again after you leave this screen.</span>
                </div>
                <code>{createdApiKey}</code>
                <button className="ghost-button compact" onClick={() => void copyToClipboard(createdApiKey, "API key copied.")} type="button">
                  <CopyIcon size={15} />
                  <span>Copy key</span>
                </button>
              </div>
            ) : null}

            <div className="settings-api-scope-grid" aria-label="API key scopes">
              {apiKeyScopeOptions.map((scope) => (
                <div className={scope.value === apiKeyScope ? "settings-api-scope-pill is-selected" : "settings-api-scope-pill"} key={scope.value}>
                  <strong>{scope.label}</strong>
                  <span>{scope.description}</span>
                </div>
              ))}
            </div>

            <div className="settings-api-key-list" aria-label="Created API keys">
              {apiKeysQuery.isLoading ? <LoadingState label="Loading API keys" /> : null}
              {!apiKeysQuery.isLoading && !(apiKeysQuery.data?.api_keys || []).length ? (
                <div className="empty-state compact">No API keys created yet.</div>
              ) : null}
              {(apiKeysQuery.data?.api_keys || []).map((apiKeyRecord) => (
                <article className={apiKeyRecord.is_active ? "settings-api-key-card" : "settings-api-key-card is-revoked"} key={apiKeyRecord.id}>
                  <div className="settings-api-key-main">
                    <strong>{apiKeyRecord.name}</strong>
                    <span>{apiKeyScopeLabels[apiKeyRecord.scope] || apiKeyRecord.scope}</span>
                  </div>
                  <code>{apiKeyRecord.key_prefix}</code>
                  <div className="settings-api-key-meta">
                    <span>{apiKeyRecord.is_active ? "Active" : "Revoked"}</span>
                    <span>Created {formatApiDate(apiKeyRecord.created_at)}</span>
                    <span>Last used {formatApiDate(apiKeyRecord.last_used_at)}</span>
                  </div>
                  <div className="settings-api-key-actions">
                    <button
                      className="ghost-button compact danger"
                      disabled={!apiKeyRecord.is_active || revokingApiKeyId === apiKeyRecord.id || deletingApiKeyId === apiKeyRecord.id}
                      onClick={() => void handleRevokeApiKey(apiKeyRecord)}
                      type="button"
                    >
                      <span>{revokingApiKeyId === apiKeyRecord.id ? "Revoking..." : "Revoke"}</span>
                    </button>
                    <button
                      aria-label={`Delete API key ${apiKeyRecord.name}`}
                      className="ghost-button compact danger icon-only-button"
                      disabled={deletingApiKeyId === apiKeyRecord.id}
                      onClick={() => void handleDeleteApiKey(apiKeyRecord)}
                      title="Delete API key"
                      type="button"
                    >
                      <TrashIcon size={15} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </Panel>
        ), { visible: canManageApiKeys })}

        {canUseAutomationWorkspace ? renderSettingsSection("automationDefaults", "Project settings", "Automation defaults", (
          <Panel title="Project automation settings" subtitle="Default behavior for generated automation, local runs, remote grid runs, and evidence capture.">
            <div className="settings-project-grid">
              <label className="settings-input-field">
                <span>Wait time after recovery</span>
                <input
                  inputMode="numeric"
                  min="0"
                  onChange={(event) => updateProjectAutomationSetting("waitTimeMs", event.target.value)}
                  type="number"
                  value={projectAutomationSettings.waitTimeMs}
                />
                <small>Milliseconds before retrying a healed action.</small>
              </label>
              <label className="settings-input-field">
                <span>Failure retries</span>
                <input
                  inputMode="numeric"
                  min="0"
                  max="10"
                  onChange={(event) => updateProjectAutomationSetting("failureRetries", event.target.value)}
                  type="number"
                  value={projectAutomationSettings.failureRetries}
                />
                <small>Retry count for flaky automation steps.</small>
              </label>
              <label className="settings-input-field">
                <span>Video capture</span>
                <select
                  onChange={(event) => updateProjectAutomationSetting("videoMode", event.target.value as ProjectAutomationSettings["videoMode"])}
                  value={projectAutomationSettings.videoMode}
                >
                  <option value="retain-on-failure">Retain on failure</option>
                  <option value="on">Always capture</option>
                  <option value="off">Off</option>
                </select>
                <small>Default run-level video evidence behavior.</small>
              </label>
              <label className="settings-input-field">
                <span>Screenshots</span>
                <select
                  onChange={(event) => updateProjectAutomationSetting("screenshotMode", event.target.value as ProjectAutomationSettings["screenshotMode"])}
                  value={projectAutomationSettings.screenshotMode}
                >
                  <option value="only-on-failure">Only on failure</option>
                  <option value="on">Every step</option>
                  <option value="off">Off</option>
                </select>
                <small>Default screenshot policy for automation runs.</small>
              </label>
              <label className="settings-input-field">
                <span>Default direct LLM</span>
                <select
                  onChange={(event) => updateProjectAutomationSetting("defaultLlmIntegrationId", event.target.value)}
                  value={projectAutomationSettings.defaultLlmIntegrationId}
                >
                  <option value="">System default</option>
                  {llmIntegrations.map((integration) => (
                    <option key={integration.id} value={integration.id}>{integration.name}</option>
                  ))}
                </select>
                <small>Used for direct automation model calls when a project does not override it. Rovo conversations are separate.</small>
              </label>
              <label className="settings-input-field">
                <span>Local engine URL</span>
                <input
                  onChange={(event) => updateProjectAutomationSetting("localEngineBaseUrl", event.target.value)}
                  value={projectAutomationSettings.localEngineBaseUrl}
                />
                <small>Default endpoint for local Playwright/Test Engine runs.</small>
              </label>
              <label className="settings-input-field">
                <span>Remote grid</span>
                <select
                  onChange={(event) => updateProjectAutomationSetting("remoteGridProvider", event.target.value as ProjectAutomationSettings["remoteGridProvider"])}
                  value={projectAutomationSettings.remoteGridProvider}
                >
                  <option value="default">Use active integration</option>
                  <option value="browserstack">BrowserStack</option>
                  <option value="lambdatest">LambdaTest</option>
                  <option value="saucelabs">Sauce Labs</option>
                  <option value="crossbrowser">CrossBrowser</option>
                </select>
                <small>Preferred cloud execution provider for remote runs.</small>
              </label>
            </div>
          </Panel>
	        )) : null}



        {renderSettingsSection("exportRetention", "Evidence", "Export and retention", (
          <div className="two-column-grid">
            <Panel title="Export & retention" subtitle="Decide how much trace data should be surfaced and exported.">
              <div className="detail-stack">
                <label className="checkbox-field">
                  <input checked={autoExport} onChange={(event) => setAutoExport(event.target.checked)} type="checkbox" />
                  <span>{t("settings.export.autoPrompt", "Offer execution export prompts after completed runs")}</span>
                </label>
                <div className="detail-summary">
                  <strong>{t("settings.export.historyTitle", "Historical evidence is preserved")}</strong>
                  <span>{t("settings.export.historyCopy", "Deleting live suites or test cases does not remove execution snapshots already captured.")}</span>
                </div>
              </div>
            </Panel>
          </div>
	        ))}

        {renderSettingsSection("notifications", "Notifications", "Notification preferences", (
          <Panel title="Notification routing" subtitle="Configure which workspace events should create in-app notifications or digest entries.">
            <div className="settings-preference-grid">
              {[
                ["executionFailures", "Execution failures and blocked runs"],
                ["executionCompletions", "Execution completions and run finalization"],
                ["runAssignments", "Run and case assignment changes"],
                ["issueReports", "Reported defects and feedback updates"],
                ["aiDesign", "AI design previews and accepted generated cases"],
                ["aiAutomation", "AI automation build and recorder events"],
                ["importExport", "Import, export, backup, and sync jobs"],
                ["requirementChanges", "Story creation, completion, and coverage changes"],
                ["testCaseChanges", "Test case, suite, and Shared Step Group changes"],
                ["integrationChanges", "Integration activation, import, and credential changes"],
                ["userRoleChanges", "User, role, and permission changes"],
                ["projectMembership", "Project membership and app type changes"],
                ["scheduledRuns", "Scheduled run creation, execution, and failures"],
                ["inApp", "Show enabled events as in-app notifications"],
                ["digest", "Include enabled events in the daily digest"]
              ].filter(([key]) => canUseAutomationWorkspace || key !== "aiAutomation").map(([key, label]) => (
                <label className="checkbox-field" key={key}>
                  <input
                    checked={notificationPreferences[key as keyof NotificationPreferences]}
                    onChange={(event) =>
                      setNotificationPreferences((current) => ({
                        ...current,
                        [key]: event.target.checked
                      }))
                    }
                    type="checkbox"
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </Panel>
	        ))}

        {renderSettingsSection("localization", "Localization", "Workspace language strings", (
          <Panel
            title={t("settings.localization.title", "Localization")}
            subtitle={t("settings.localization.subtitle", "Download the current runtime strings, edit the JSON, then upload it to relabel menus and supported interface text.")}
          >
            <div className="detail-stack">
              <div className="detail-summary">
                <strong>{Object.keys(strings).length} strings ready</strong>
                <span>{t("settings.localization.helper", "Publishing workspace strings requires localization.manage.")}</span>
              </div>

              <div className="action-row">
                <button className="ghost-button" onClick={handleDownloadLocalization} type="button">
                  {t("settings.localization.download", "Download current strings")}
                </button>
                {canManageLocalization ? (<button
                  className="ghost-button"
                  disabled={!canManageLocalization || isSavingLocalization}
                  onClick={() => fileInputRef.current?.click()}
                  type="button"
                >
                  {t("settings.localization.upload", "Upload JSON")}
                </button>) : null}
                {canManageLocalization ? (<button
                  className="ghost-button danger"
                  disabled={!canManageLocalization || isSavingLocalization}
                  onClick={() => void persistLocalization(DEFAULT_LOCALIZATION_STRINGS, "Uploaded localization reset to defaults.")}
                  type="button"
                >
                  {t("settings.localization.reset", "Reset uploaded strings")}
                </button>) : null}
              </div>

              <p className="regional-scope">Workspace packs may include <code>meta.language</code> (for example, <code>es</code>) and <code>meta.direction</code> (<code>ltr</code> or <code>rtl</code>). Omitted labels use English defaults. Personal language and regional preferences are available from the page toolbar.</p>
              {pendingLanguagePack ? <section className="regional-preview" aria-label="Language pack review">
                <strong>Review {pendingLanguagePack.name}</strong>
                <p>{Object.keys(pendingLanguagePack.strings).length} strings will replace the current workspace pack. Review the sample before publishing for everyone.</p>
                <dl>{Object.entries(pendingLanguagePack.strings).slice(0, 8).map(([key, value]) => <div key={key}><dt>{key}</dt><dd style={{ overflowWrap: "anywhere", maxWidth: "100%" }}>{value.slice(0, 200)}{value.length > 200 ? "…" : ""}</dd></div>)}</dl>
                <div className="action-row">{canManageLocalization ? (<button className="primary-button" type="button" disabled={isSavingLocalization || !canManageLocalization} onClick={() => void persistLocalization(pendingLanguagePack.strings, "Workspace language pack published.")}>{isSavingLocalization ? "Publishing…" : "Publish workspace pack"}</button>) : null}<button className="ghost-button" type="button" disabled={isSavingLocalization} onClick={() => setPendingLanguagePack(null)}>Discard</button></div>
              </section> : null}
              <input
                accept="application/json"
                hidden
                onChange={(event) => void handleUploadLocalization(event)}
                ref={fileInputRef}
                type="file"
              />
            </div>
          </Panel>
        ), { visible: canManageLocalization })}
      </div>
    </div>
  );
}
