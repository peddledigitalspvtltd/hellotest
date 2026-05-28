const db = require("../db");
const { v4: uuid } = require("uuid");

const DEFAULT_SCOPE = "test_case_generation";

const BUILT_IN_TEMPLATES = [
  {
    id: "builtin-risk-based-regression",
    built_in: true,
    scope: DEFAULT_SCOPE,
    name: "Risk based regression pack",
    description: "Broad regression coverage for a mature business workflow.",
    domain: "Business application",
    role: "Senior QA architect",
    test_type: "Regression, negative, boundary, and data validation",
    test_format: "Manual test cases with clear preconditions, test data, steps, and expected results",
    test_count: 8,
    prompt_text: "Generate high-signal tests for the most business-critical happy path, failure path, role/permission boundary, validation rules, and recovery flows. Prefer reusable @t test data tokens and avoid duplicate cases.",
    applies_to: ["requirements", "test_cases"],
    tags: ["regression", "risk", "negative"]
  },
  {
    id: "builtin-auth-security",
    built_in: true,
    scope: DEFAULT_SCOPE,
    name: "Auth and access control",
    description: "Authentication, authorization, account recovery, and session behavior.",
    domain: "Authentication and identity",
    role: "Security-minded QA lead",
    test_type: "Positive, negative, abuse, session, and permission tests",
    test_format: "Concise executable cases grouped by user role and risk",
    test_count: 10,
    prompt_text: "Focus on login, logout, password reset, locked/disabled users, expired sessions, role-restricted actions, invalid credentials, rate limiting signals, and audit-worthy expectations. Include only behavior supported by the requirement context.",
    applies_to: ["requirements", "test_cases"],
    tags: ["auth", "security", "roles"]
  },
  {
    id: "builtin-mobile-critical-path",
    built_in: true,
    scope: DEFAULT_SCOPE,
    name: "Mobile critical path",
    description: "Android/iOS friendly cases with device, permission, and interruption thinking.",
    domain: "Mobile app",
    role: "Mobile QA architect",
    test_type: "Functional, interruption, permission, and device compatibility",
    test_format: "Mobile-ready manual cases using android/ios step types when helpful",
    test_count: 6,
    prompt_text: "Create mobile-aware tests for the critical user journey, permission prompts, background/foreground behavior, network interruption, device rotation where relevant, and clear observable expected results.",
    applies_to: ["requirements", "test_cases"],
    tags: ["mobile", "android", "ios"]
  }
];

const selectPromptTemplates = db.prepare(`
  SELECT *
  FROM ai_prompt_templates
  WHERE project_id = ?
    AND is_active = TRUE
    AND scope = ?
    AND (app_type_id IS NULL OR app_type_id = ?)
  ORDER BY updated_at DESC, name ASC
`);

const selectPromptTemplate = db.prepare(`
  SELECT *
  FROM ai_prompt_templates
  WHERE id = ?
`);

const insertPromptTemplate = db.prepare(`
  INSERT INTO ai_prompt_templates (
    id,
    project_id,
    app_type_id,
    scope,
    name,
    description,
    domain,
    role,
    test_type,
    test_format,
    test_count,
    prompt_text,
    applies_to,
    tags,
    is_active,
    created_by,
    created_at,
    updated_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  RETURNING *
`);

const updatePromptTemplate = db.prepare(`
  UPDATE ai_prompt_templates
  SET app_type_id = ?,
      scope = ?,
      name = ?,
      description = ?,
      domain = ?,
      role = ?,
      test_type = ?,
      test_format = ?,
      test_count = ?,
      prompt_text = ?,
      applies_to = ?,
      tags = ?,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
  RETURNING *
`);

const deactivatePromptTemplate = db.prepare(`
  UPDATE ai_prompt_templates
  SET is_active = FALSE,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
  RETURNING *
`);

const normalizeText = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
};

const normalizeJsonArray = (value, fallback = []) => {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  }

  return fallback;
};

const normalizeCount = (value) => {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Math.max(1, Math.min(50, Math.round(parsed)));
};

const normalizePromptTemplateRow = (row) => row ? ({
  id: row.id,
  project_id: row.project_id,
  app_type_id: row.app_type_id || null,
  scope: normalizeText(row.scope) || DEFAULT_SCOPE,
  name: normalizeText(row.name) || "Untitled prompt template",
  description: normalizeText(row.description),
  domain: normalizeText(row.domain),
  role: normalizeText(row.role),
  test_type: normalizeText(row.test_type),
  test_format: normalizeText(row.test_format),
  test_count: normalizeCount(row.test_count),
  prompt_text: String(row.prompt_text || ""),
  applies_to: normalizeJsonArray(row.applies_to, ["requirements", "test_cases"]),
  tags: normalizeJsonArray(row.tags, []),
  built_in: Boolean(row.built_in),
  is_active: row.is_active !== false,
  created_by: row.created_by || null,
  created_at: row.created_at || null,
  updated_at: row.updated_at || null
}) : null;

const normalizePromptInput = (input = {}) => {
  const name = normalizeText(input.name);
  const promptText = normalizeText(input.prompt_text);

  if (!name) {
    throw new Error("Prompt template name is required.");
  }

  if (!promptText) {
    throw new Error("Prompt template text is required.");
  }

  return {
    app_type_id: normalizeText(input.app_type_id),
    scope: normalizeText(input.scope) || DEFAULT_SCOPE,
    name,
    description: normalizeText(input.description),
    domain: normalizeText(input.domain),
    role: normalizeText(input.role),
    test_type: normalizeText(input.test_type),
    test_format: normalizeText(input.test_format),
    test_count: normalizeCount(input.test_count),
    prompt_text: promptText,
    applies_to: normalizeJsonArray(input.applies_to, ["requirements", "test_cases"]),
    tags: normalizeJsonArray(input.tags, [])
  };
};

exports.listPromptTemplates = async ({ project_id, app_type_id, scope } = {}) => {
  const projectId = normalizeText(project_id);
  const appTypeId = normalizeText(app_type_id);
  const normalizedScope = normalizeText(scope) || DEFAULT_SCOPE;

  if (!projectId) {
    throw new Error("Project scope is required for prompt templates.");
  }

  const rows = await selectPromptTemplates.all(projectId, normalizedScope, appTypeId);
  const savedTemplates = rows.map(normalizePromptTemplateRow).filter(Boolean);
  const builtIns = BUILT_IN_TEMPLATES
    .filter((template) => template.scope === normalizedScope)
    .map((template) => normalizePromptTemplateRow({
      ...template,
      project_id: projectId,
      app_type_id: null,
      is_active: true,
      created_at: null,
      updated_at: null
    }));

  return [...savedTemplates, ...builtIns];
};

exports.getPromptTemplate = async (id) => {
  const normalizedId = normalizeText(id);

  if (!normalizedId) {
    throw new Error("Prompt template id is required.");
  }

  const builtIn = BUILT_IN_TEMPLATES.find((template) => template.id === normalizedId);

  if (builtIn) {
    return normalizePromptTemplateRow({ ...builtIn, project_id: null, is_active: true });
  }

  const row = await selectPromptTemplate.get(normalizedId);
  const template = normalizePromptTemplateRow(row);

  if (!template || !template.is_active) {
    throw new Error("Prompt template not found.");
  }

  return template;
};

exports.createPromptTemplate = async ({ project_id, created_by, ...input } = {}) => {
  const projectId = normalizeText(project_id);

  if (!projectId) {
    throw new Error("Project scope is required for prompt templates.");
  }

  const normalized = normalizePromptInput(input);
  const row = await insertPromptTemplate.get(
    uuid(),
    projectId,
    normalized.app_type_id,
    normalized.scope,
    normalized.name,
    normalized.description,
    normalized.domain,
    normalized.role,
    normalized.test_type,
    normalized.test_format,
    normalized.test_count,
    normalized.prompt_text,
    normalized.applies_to,
    normalized.tags,
    normalizeText(created_by)
  );

  return normalizePromptTemplateRow(row);
};

exports.updatePromptTemplate = async (id, input = {}) => {
  const existing = await exports.getPromptTemplate(id);

  if (existing.built_in) {
    throw new Error("Built-in prompt templates cannot be changed. Save a new template instead.");
  }

  const normalized = normalizePromptInput({
    ...existing,
    ...input
  });
  const row = await updatePromptTemplate.get(
    normalized.app_type_id,
    normalized.scope,
    normalized.name,
    normalized.description,
    normalized.domain,
    normalized.role,
    normalized.test_type,
    normalized.test_format,
    normalized.test_count,
    normalized.prompt_text,
    normalized.applies_to,
    normalized.tags,
    existing.id
  );

  return normalizePromptTemplateRow(row);
};

exports.deletePromptTemplate = async (id) => {
  const existing = await exports.getPromptTemplate(id);

  if (existing.built_in) {
    throw new Error("Built-in prompt templates cannot be deleted.");
  }

  const row = await deactivatePromptTemplate.get(existing.id);
  return { deleted: Boolean(row), id: existing.id };
};
