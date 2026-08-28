const db = require("../db");

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

const normalizeLocalizationStrings = (input) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(input)
      .filter(([key, value]) => typeof key === "string" && key.trim() && typeof value === "string")
      .map(([key, value]) => [key.trim(), value])
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

  return {
    ...personalPreferences,
    ...governedPreferences
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
