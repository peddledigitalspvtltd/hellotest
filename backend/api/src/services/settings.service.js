const db = require("../db");

const LOCALIZATION_SETTINGS_KEY = "localization_strings";
const WORKSPACE_PREFERENCES_KEY_PREFIX = "workspace_preferences:";
const WORKSPACE_METRIC_FORMULA_VALUES_KEY = "workspace_metric_formula_values";
const METRIC_FORMULA_VALUES_PREFERENCE_KEY = "ai_metric_formula_values";

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
  const [row, metricFormulaRow] = await Promise.all([
    db.prepare(`
    SELECT value
    FROM app_settings
    WHERE key = ?
  `).get(workspacePreferenceKeyForUser(userId)),
    db.prepare(`SELECT value FROM app_settings WHERE key = ?`).get(WORKSPACE_METRIC_FORMULA_VALUES_KEY)
  ]);

  return {
    ...normalizeWorkspacePreferences(row?.value),
    ...(metricFormulaRow?.value ? { [METRIC_FORMULA_VALUES_PREFERENCE_KEY]: metricFormulaRow.value } : {})
  };
};

exports.updateWorkspacePreferences = async (userId, preferences) => {
  const currentPreferences = await exports.getWorkspacePreferences(userId);
  const normalizedInput = normalizeWorkspacePreferences(preferences);
  const metricFormulaValues = normalizedInput[METRIC_FORMULA_VALUES_PREFERENCE_KEY];
  const currentMetricFormulaValues = currentPreferences[METRIC_FORMULA_VALUES_PREFERENCE_KEY];
  delete normalizedInput[METRIC_FORMULA_VALUES_PREFERENCE_KEY];
  delete currentPreferences[METRIC_FORMULA_VALUES_PREFERENCE_KEY];
  const nextPreferences = {
    ...currentPreferences,
    ...normalizedInput
  };

  await db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT (key)
    DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
  `).run(workspacePreferenceKeyForUser(userId), nextPreferences);

  if (metricFormulaValues && typeof metricFormulaValues === "object" && !Array.isArray(metricFormulaValues)) {
    await db.prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT (key)
      DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP
    `).run(WORKSPACE_METRIC_FORMULA_VALUES_KEY, metricFormulaValues);
  }

  return {
    updated: true,
    preferences: {
      ...nextPreferences,
      ...((metricFormulaValues || currentMetricFormulaValues) ? {
        [METRIC_FORMULA_VALUES_PREFERENCE_KEY]: metricFormulaValues || currentMetricFormulaValues
      } : {})
    }
  };
};
