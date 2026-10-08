const db = require("../src/db");

const LOCALIZATION_SETTINGS_KEY = "localization_strings";
const WORKSPACE_PREFERENCES_KEY_PREFIX = "workspace_preferences:";
const GOVERNED_WORKSPACE_PREFERENCE_KEY_PREFIX = "workspace_governed_preference:";
const WORKSPACE_METRIC_FORMULA_VALUES_KEY = "workspace_metric_formula_values";
const METRIC_FORMULA_VALUES_PREFERENCE_KEY = "ai_metric_formula_values";
const GOVERNED_WORKSPACE_PREFERENCE_KEYS = Object.freeze([
  "ai_prompt_registry_overrides",
  "ai_prompt_registry_llm_overrides",
  "ai_metric_criteria_overrides",
  METRIC_FORMULA_VALUES_PREFERENCE_KEY
]);
const GOVERNED_WORKSPACE_PREFERENCE_KEY_SET = new Set(GOVERNED_WORKSPACE_PREFERENCE_KEYS);
const DEFECT_LOCALIZATION_KEYS = new Set([
  "nav.reportIssue", "nav.feedback", "page.issues", "page.feedback", "capability.bugs.name"
]);

const normalizeLocalizationStrings = (input) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(input)
      .filter(([key, value]) => typeof key === "string" && key.trim() && typeof value === "string")
      .map(([key, value]) => {
        const normalizedKey = key.trim();
        // Migrate only former English module names; preserve custom labels,
        // translations, and stable localization keys used by existing packs.
        const normalizedValue = DEFECT_LOCALIZATION_KEYS.has(normalizedKey)
          && /^(?:report\s+(?:an?\s+)?)?(?:issues?|bugs?)$/i.test(value.trim()) ? "Defects" : value;
        return [normalizedKey, normalizedValue];
      })
  );
};

const isSerializablePreferenceValue = (value) => {
  if (value === null) {
    return true;
  }

  if (["string", "number", "boolean"].includes(typeof value)) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every((item) => isSerializablePreferenceValue(item));
  }

  if (typeof value === "object") {
    return Object.entries(value).every(([key, nestedValue]) => typeof key === "string" && isSerializablePreferenceValue(nestedValue));
  }

  return false;
};

const normalizeWorkspacePreferences = (input) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(input)
      .filter(([key, value]) => typeof key === "string" && key.trim() && isSerializablePreferenceValue(value))
      .map(([key, value]) => [key.trim(), value])
  );
};

const workspacePreferenceKeyForUser = (userId) => `${WORKSPACE_PREFERENCES_KEY_PREFIX}${userId}`;
const governedWorkspacePreferenceSettingKey = (preferenceKey) => `${GOVERNED_WORKSPACE_PREFERENCE_KEY_PREFIX}${preferenceKey}`;

const readPersonalWorkspacePreferences = async (userId) => {
  const row = await db.prepare(`
    SELECT value
    FROM app_settings
    WHERE key = ?
  `).get(workspacePreferenceKeyForUser(userId));
  const preferences = normalizeWorkspacePreferences(row?.value);

  // Governed values are workspace-wide. Never let a legacy user row shadow
  // the global policy while a deployment is being migrated.
  GOVERNED_WORKSPACE_PREFERENCE_KEYS.forEach((key) => delete preferences[key]);
  return preferences;
};

const readGovernedWorkspacePreferences = async () => {
  const settingKeys = GOVERNED_WORKSPACE_PREFERENCE_KEYS.map(governedWorkspacePreferenceSettingKey);
  const [rows, metricFormulaRow] = await Promise.all([
    db.prepare(`
      SELECT key, value
      FROM app_settings
      WHERE key IN (?, ?, ?, ?)
    `).all(...settingKeys),
    // Keep a read fallback for deployments that have not yet run the runtime
    // bootstrap which migrates the original global formula setting.
    db.prepare(`SELECT value FROM app_settings WHERE key = ?`).get(WORKSPACE_METRIC_FORMULA_VALUES_KEY)
  ]);
  const preferences = {};

  rows.forEach((row) => {
    const preferenceKey = String(row.key || "").slice(GOVERNED_WORKSPACE_PREFERENCE_KEY_PREFIX.length);
    if (GOVERNED_WORKSPACE_PREFERENCE_KEY_SET.has(preferenceKey) && isSerializablePreferenceValue(row.value)) {
      preferences[preferenceKey] = row.value;
    }
  });

  if (!Object.hasOwn(preferences, METRIC_FORMULA_VALUES_PREFERENCE_KEY)
    && metricFormulaRow
    && isSerializablePreferenceValue(metricFormulaRow.value)) {
    preferences[METRIC_FORMULA_VALUES_PREFERENCE_KEY] = metricFormulaRow.value;
  }

  return preferences;
};

exports.getLocalizationStrings = async () => {
  const row = await db.prepare(`
    SELECT value
    FROM app_settings
    WHERE key = ?
  `).get(LOCALIZATION_SETTINGS_KEY);

  return normalizeLocalizationStrings(row?.value);
};

exports.updateLocalizationStrings = async (strings) => {
  const invalid = (message) => { const error = new Error(message); error.statusCode = 400; throw error; };
  if (!strings || typeof strings !== "object" || Array.isArray(strings)) invalid("Localization must be a JSON object of text values.");
  const entries = Object.entries(strings);
  if (entries.length > 2000 || Buffer.byteLength(JSON.stringify(strings), "utf8") > 512 * 1024) invalid("Language packs support up to 2,000 strings and 512 KB.");
  for (const [key, value] of entries) {
    if (!key.trim() || key.length > 160 || ["__proto__", "constructor", "prototype"].includes(key.trim()) || typeof value !== "string" || value.length > 10000) invalid("Language pack keys and values must be bounded text strings.");
    if (key === "meta.direction" && !["ltr", "rtl"].includes(value)) invalid("meta.direction must be ltr or rtl.");
    if (key === "meta.language") { try { if (!Intl.getCanonicalLocales(value).length) invalid("Invalid language tag."); } catch { invalid("meta.language must be a valid language tag."); } }
  }
  const normalizedStrings = normalizeLocalizationStrings(strings);

  await db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT (key)
    DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
  `).run(LOCALIZATION_SETTINGS_KEY, normalizedStrings);

  return {
    updated: true,
    strings: normalizedStrings
  };
};

exports.getWorkspacePreferences = async (userId) => {
  const [personalPreferences, governedPreferences] = await Promise.all([
    readPersonalWorkspacePreferences(userId),
    readGovernedWorkspacePreferences()
  ]);

  const [managed,metrics] = await Promise.all([require("./aiConfiguration.service").publishedOverrides(),require("./metricGovernance.service").publishedOverrides()]);
  return {
    ...personalPreferences,
    ...governedPreferences,
    ai_metric_criteria_overrides: { ...governedPreferences.ai_metric_criteria_overrides, ...metrics.criteria },
    ai_metric_formula_values: { ...governedPreferences.ai_metric_formula_values, ...metrics.parameters },
    ai_prompt_registry_overrides: { ...governedPreferences.ai_prompt_registry_overrides, ...managed.prompts },
    ai_prompt_registry_llm_overrides: { ...governedPreferences.ai_prompt_registry_llm_overrides, ...managed.integrations }
  };
};

exports.updateWorkspacePreferences = async (userId, preferences) => {
  const [currentPersonalPreferences, currentGovernedPreferences] = await Promise.all([
    readPersonalWorkspacePreferences(userId),
    readGovernedWorkspacePreferences()
  ]);
  const normalizedInput = normalizeWorkspacePreferences(preferences);
  const governedUpdates = {};

  GOVERNED_WORKSPACE_PREFERENCE_KEYS.forEach((key) => {
    if (Object.hasOwn(normalizedInput, key)) {
      governedUpdates[key] = normalizedInput[key];
      delete normalizedInput[key];
    }
  });

  const nextPersonalPreferences = {
    ...currentPersonalPreferences,
    ...normalizedInput
  };
  const nextGovernedPreferences = {
    ...currentGovernedPreferences,
    ...governedUpdates
  };

  const updatePreferences = db.transaction(async () => {
    if (Object.keys(normalizedInput).length) {
      await db.prepare(`
        INSERT INTO app_settings (key, value, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT (key)
        DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
      `).run(workspacePreferenceKeyForUser(userId), nextPersonalPreferences);
    }

    for (const [key, value] of Object.entries(governedUpdates)) {
      await db.prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT (key)
      DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
      `).run(governedWorkspacePreferenceSettingKey(key), value);
    }
  });
  await updatePreferences();

  return {
    updated: true,
    preferences: {
      ...nextPersonalPreferences,
      ...nextGovernedPreferences
    }
  };
};

exports.GOVERNED_WORKSPACE_PREFERENCE_KEYS = GOVERNED_WORKSPACE_PREFERENCE_KEYS;
