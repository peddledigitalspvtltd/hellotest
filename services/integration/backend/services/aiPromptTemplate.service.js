const db = require("@hellotest/platform/backend/src/db");
const { randomUUID: uuid } = require("crypto");

const DEFAULT_SCOPE = "test_case_generation";

const BUILT_IN_TEMPLATES = [
  {
    id: "builtin-story-user-outcome", built_in: true, scope: "requirement_creation",
    name: "User outcome", description: "Focused Stories for a user goal and measurable result.",
    test_count: 3, test_format: "Actor, goal, business value and observable acceptance",
    prompt_text: "Organize the supplied product brief into small, distinct user-outcome Stories. Give each a concise title and a description explaining the evidenced actor, goal, value and behavior. Write observable acceptance criteria only for supplied rules. Keep unknown details as short questions, never invented requirements. Avoid overlapping Stories or repeating criteria in the description. Use the requested count and supplied JSON schema; template guidance is not product evidence.",
    applies_to: ["requirements"], tags: ["feature", "persona", "acceptance"]
  },
  {
    id: "builtin-story-business-workflow", built_in: true, scope: "requirement_creation",
    name: "Business workflow", description: "Reviewable workflow slices with roles, decisions and outcomes.",
    test_count: 3, test_format: "Workflow slice with business rules and acceptance",
    prompt_text: "Create distinct Stories around the supplied workflow's evidenced actors, trigger, decisions and outcomes. Keep each slice independently reviewable; preserve stated rules, handoffs and scope boundaries. Include alternate paths only when the brief defines their expected behavior. Use concise descriptions and measurable acceptance criteria, without duplicated workflow text. Respect the requested count and JSON schema. Do not invent roles, approvals, policies or integrations from this template.",
    applies_to: ["requirements"], tags: ["workflow", "roles", "business rules"]
  },
  {
    id: "builtin-story-api-integration", built_in: true, scope: "requirement_creation",
    name: "API and integration", description: "Stories for evidenced service behavior and data exchange.",
    test_count: 2, test_format: "Service outcome, contract boundaries and acceptance",
    prompt_text: "Draft Stories for the service outcomes and data exchanges explicitly described in the supplied brief. Preserve known inputs, outputs, consumers, validation and failure behavior. Keep protocol details and dependencies only when provided; ask about missing contract details instead of inventing endpoints, fields, status codes, timing or retry policies. Separate behavior from observable acceptance, avoid redundant Stories and respect the requested count and JSON schema.",
    applies_to: ["requirements"], tags: ["api", "integration", "contract"]
  },
  {
    id: "builtin-story-quality-improvement", built_in: true, scope: "requirement_creation",
    name: "Quality improvement", description: "A bounded reliability, accessibility or usability improvement.",
    test_count: 1, test_format: "Observed problem, desired outcome and measurable acceptance",
    prompt_text: "Turn the supplied observed problem and desired quality improvement into a bounded Story. State the affected user, current limitation and desired outcome only from supplied evidence. Preserve explicit targets and constraints; never invent performance thresholds, compliance claims or technical remedies. Define acceptance only where the desired result is observable, and keep missing measurements as concise questions. Respect the requested count and supplied JSON schema.",
    applies_to: ["requirements"], tags: ["reliability", "accessibility", "usability"]
  },
  {
    id: "builtin-story-completion-testability", built_in: true, scope: "requirement_completion",
    name: "Clarify acceptance", description: "Refine the current Story into clear, testable outcomes.",
    test_count: 1, test_format: "One refined Story with observable acceptance",
    prompt_text: "Refine only the supplied current Story. Preserve its actor, business goal, scope, existing acceptance and executable specification. Clarify ambiguous wording and convert supported behavior into concise observable acceptance criteria. Keep planning facts and references unchanged unless supplied evidence supports a correction. Do not create another Story or invent missing behavior. Return one complete proposal in the supplied schema, with no before/after comparison or repeated review commentary.",
    applies_to: ["requirements"], tags: ["completion", "acceptance", "testability"]
  },
  {
    id: "builtin-story-completion-workflow", built_in: true, scope: "requirement_completion",
    name: "Clarify workflow and scope", description: "Make the current Story's flow and boundaries explicit.",
    test_count: 1, test_format: "One refined Story with clear flow and boundaries",
    prompt_text: "Refine the current Story's evidenced trigger, actor, ordered behavior, outcome and scope boundaries. Use current acceptance criteria, specification and reviewed context to resolve wording, preserving every stated constraint. Ask about unsupported transitions or decisions instead of filling them with guesses. Keep description and acceptance distinct and concise. Return only one regenerated proposal using the supplied JSON schema; do not repeat the original Story or add unrelated scope.",
    applies_to: ["requirements"], tags: ["completion", "workflow", "scope"]
  },
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
    prompt_text: "Design the requested number of distinct regression cases from the supplied Story acceptance, rules and existing coverage. Prioritize the critical happy path, a meaningful failure, boundary validation, evidenced permission checks and recovery. For each case return the required title, objective, preconditions, data, ordered atomic steps, observable expected results and exact Story references in the supplied JSON schema. Preserve @t/@s tokens and the selected structured or Gherkin mode. Reuse existing coverage without duplicating cases; do not invent requirements or outcomes. Keep cases concise and list unsupported details as review gaps.",
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
    prompt_text: "Design the requested number of distinct authentication or access-control tests for behavior evidenced in the selected Stories. Prioritize valid and invalid sign-in, session expiry, recovery and role boundaries when supported; include lockout, throttling or audit checks only if specified. Include explicit actor, prerequisites, fictional or @t test data, atomic actions and observable expected outcomes, with exact Story references. Preserve the requested structured or Gherkin mode and return only the supplied JSON schema. Do not invent security controls, credentials, timing limits or response messages; expose those gaps for review.",
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
    prompt_text: "Design the requested number of distinct mobile cases around the selected Story’s critical user journey. Add permission, background/foreground, network interruption or rotation coverage only where supported by the available behavior and platform context. Specify device/platform prerequisites, test data, atomic actions and observable expected outcomes; retain Android/iOS step types and exact Story references. Avoid redundant device permutations and unsupported platform assumptions. Return only the supplied case JSON schema in the requested structured or Gherkin mode, keeping missing requirements explicit.",
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

const normalizeCount = (value, scope) => {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Math.max(1, Math.min(scope === "requirement_creation" ? 6 : scope === "requirement_completion" ? 1 : 10, Math.round(parsed)));
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
  test_count: normalizeCount(row.test_count, row.scope),
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
    test_count: normalizeCount(input.test_count, input.scope),
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
