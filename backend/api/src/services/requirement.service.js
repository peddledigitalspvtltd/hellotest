const db = require("../db");
const { v4: uuid } = require("uuid");
const requirementTestCaseService = require("./requirementTestCase.service");
const displayIdService = require("./displayId.service");
const workspaceTransactionService = require("./workspaceTransaction.service");
const integrationService = require("./integration.service");
const aiKnowledgeService = require("./aiKnowledge.service");
const { normalizeReferenceList, normalizeStoredReferenceList } = require("../utils/externalReferences");
const { createLlmProviderError } = require("../utils/upstreamLlmError");

const selectLinkedTestCases = db.prepare(`
  SELECT test_cases.id, test_cases.title, test_cases.description, test_cases.automated, test_cases.priority, test_cases.status
  FROM requirement_test_cases
  JOIN test_cases ON test_cases.id = requirement_test_cases.test_case_id
  WHERE requirement_test_cases.requirement_id = ?
  ORDER BY test_cases.title ASC
`);

const normalizeText = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
};

const extractJsonPayload = (content) => {
  const trimmed = String(content || "").trim();

  if (!trimmed) {
    throw new Error("LLM response was empty");
  }

  const withoutFence = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim()
    : trimmed;
  const firstBrace = withoutFence.indexOf("{");
  const lastBrace = withoutFence.lastIndexOf("}");
  const jsonCandidate =
    firstBrace !== -1 && lastBrace !== -1 && lastBrace >= firstBrace
      ? withoutFence.slice(firstBrace, lastBrace + 1)
      : withoutFence;

  return JSON.parse(jsonCandidate);
};

const resolveLlmIntegration = async (integrationId, projectId) => {
  const integration = integrationId
    ? await integrationService.getIntegration(integrationId)
    : await integrationService.getActiveIntegrationByTypeForProject("llm", projectId)
      || await integrationService.getActiveIntegrationByType("llm");

  if (!integration) {
    return null;
  }

  if (integration.type !== "llm") {
    throw new Error("Selected integration is not an LLM integration");
  }

  if (!integration.is_active) {
    throw new Error("Selected LLM integration is inactive");
  }

  return integration;
};

const requestRequirementOptimization = async ({ integration, prompt }) => {
  const baseUrl = (integration.base_url || "https://api.openai.com/v1").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${integration.api_key}`
    },
    body: JSON.stringify({
      model: integration.model,
      temperature: 0.15,
      messages: [
        {
          role: "system",
          content: "You are a senior product owner and QA architect. Return strict JSON only."
        },
        {
          role: "user",
          content: prompt
        }
      ]
    })
  });

  if (!response.ok) {
    const raw = await response.text();
    throw createLlmProviderError({ status: response.status, detail: raw });
  }

  const payload = await response.json();
  const messageContent = payload?.choices?.[0]?.message?.content;

  if (!messageContent) {
    throw new Error("LLM response did not include generated content");
  }

  return messageContent;
};

const buildRequirementOptimizationPrompt = ({ requirement, linkedTestCases, knowledge, additionalContext }) => [
  "Mature and complete this requirement for enterprise QA and product delivery.",
  "",
  "Return strict JSON with this shape:",
  "{",
  '  "title": "optimized requirement title",',
  '  "description": "complete requirement description with acceptance criteria, business rules, data rules, negative cases, and measurable outcomes",',
  '  "priority": 1,',
  '  "status": "open|active|ready|done or current workflow status",',
  '  "external_references": ["reference"],',
  '  "acceptance_criteria": ["criterion"],',
  '  "risks": ["risk"],',
  '  "open_questions": ["question"],',
  '  "change_summary": ["what changed and why"]',
  "}",
  "",
  "Rules:",
  "- Do not invent integrations, policies, or screens that are not implied by context.",
  "- Make the requirement testable and automation-friendly.",
  "- Prefer clear acceptance criteria and observable outcomes.",
  "- Keep title concise and user/business oriented.",
  "- Preserve existing external references unless clearly duplicated.",
  "",
  "Current requirement:",
  JSON.stringify(requirement, null, 2),
  "",
  "Linked test cases:",
  JSON.stringify(linkedTestCases, null, 2),
  "",
  "Active application knowledge:",
  JSON.stringify(knowledge.map((item) => ({
    title: item.title,
    type: item.content_type,
    description: item.description,
    content: String(item.content || "").slice(0, 4000)
  })), null, 2),
  "",
  additionalContext ? `User guidance:\n${additionalContext}` : "User guidance: none"
].join("\n");

const buildDeterministicRequirementOptimization = (requirement, additionalContext) => {
  const references = normalizeStoredReferenceList(requirement.external_references);
  const description = [
    requirement.description || "Describe the expected business behavior.",
    "",
    "Acceptance criteria:",
    "- Primary happy path is clearly observable and can be validated by a tester.",
    "- Required inputs, validations, and error states are documented.",
    "- Data persistence, audit, notification, or integration outcomes are stated when applicable.",
    "- Negative and boundary conditions are testable.",
    additionalContext ? `- Product guidance considered: ${additionalContext}` : null
  ].filter(Boolean).join("\n");

  return {
    title: requirement.title,
    description,
    priority: requirement.priority ?? 3,
    status: requirement.status || "open",
    external_references: references,
    acceptance_criteria: [
      "User-visible behavior is testable with clear expected outcomes.",
      "Validation and failure states are documented.",
      "Automation can identify required screens, fields, APIs, and data."
    ],
    risks: ["AI integration unavailable; deterministic requirement completion was used."],
    open_questions: ["Confirm any domain-specific business rules not present in the current requirement."],
    change_summary: ["Added structured acceptance criteria and testability guidance."],
    fallback_used: true,
    fallback_reason: "No active LLM integration is configured."
  };
};

const hydrateTestCaseIds = async (requirement) => {
  if (!requirement) {
    return requirement;
  }

  return {
    ...requirement,
    external_references: normalizeStoredReferenceList(requirement.external_references),
    test_case_ids: await requirementTestCaseService.getTestCaseIdsForRequirement(requirement.id)
  };
};

exports.bulkImportRequirements = async ({ project_id, rows = [], created_by, transaction_id } = {}) => {
  if (!project_id) {
    throw new Error("project_id is required");
  }

  if (!Array.isArray(rows) || !rows.length) {
    throw new Error("At least one row is required");
  }

  const project = await db.prepare(`
    SELECT id FROM projects WHERE id = ?
  `).get(project_id);

  if (!project) {
    throw new Error("Project not found");
  }

  const created = [];
  const errors = [];
  const transaction = transaction_id
    ? await workspaceTransactionService.updateTransaction(transaction_id, {
        project_id,
        category: "bulk_import",
        action: "requirement_import",
        status: "running",
        title: "Requirement import",
        description: `Importing ${rows.length} requirement${rows.length === 1 ? "" : "s"} from CSV.`,
        metadata: {
          import_source: "csv",
          total_rows: rows.length,
          total_items: rows.length,
          processed_items: 0,
          progress_percent: 0,
          current_phase: "prepare"
        },
        started_at: new Date().toISOString()
      })
    : await workspaceTransactionService.createTransaction({
        project_id,
        category: "bulk_import",
        action: "requirement_import",
        status: "running",
        title: "Requirement import",
        description: `Importing ${rows.length} requirement${rows.length === 1 ? "" : "s"} from CSV.`,
        metadata: {
          import_source: "csv",
          total_rows: rows.length,
          total_items: rows.length,
          processed_items: 0,
          progress_percent: 0,
          current_phase: "prepare"
        },
        created_by,
        started_at: new Date().toISOString()
      });
  await workspaceTransactionService.appendTransactionEvent(transaction.id, {
    phase: "prepare",
    message: `Started requirement import for ${rows.length} CSV row${rows.length === 1 ? "" : "s"}.`,
    details: {
      import_source: "csv",
      total_rows: rows.length
    }
  });

  for (const [index, row] of rows.entries()) {
    const title = typeof row?.title === "string" ? row.title.trim() : "";

    try {
      if (title.length < 2) {
        throw new Error("Title must be at least 2 characters");
      }

      const response = await exports.createRequirement({
        project_id,
        title,
        description: typeof row?.description === "string" ? row.description : undefined,
        external_references: normalizeReferenceList(row?.external_references || row?.externalReferences || row?.reference || row?.references),
        priority: typeof row?.priority === "number" && Number.isFinite(row.priority) ? row.priority : undefined,
        status: typeof row?.status === "string" ? row.status : undefined,
        created_by
      });

      created.push({
        row: index + 1,
        id: response.id,
        title
      });
    } catch (error) {
      errors.push({
        row: index + 1,
        title: title || null,
        message: error.message || "Unable to import requirement"
      });
    }

    const processed = index + 1;

    if (processed === 1 || processed === rows.length || processed % 10 === 0) {
      await workspaceTransactionService.updateTransaction(transaction.id, {
        description: `Imported ${created.length} of ${rows.length} requirement${rows.length === 1 ? "" : "s"} so far.`,
        metadata: {
          processed_items: processed,
          total_items: rows.length,
          imported: created.length,
          failed: errors.length,
          progress_percent: rows.length ? Math.round((processed / rows.length) * 100) : 0,
          current_phase: "import"
        }
      });
      await workspaceTransactionService.appendTransactionEvent(transaction.id, {
        phase: "import",
        message: `Processed ${processed} of ${rows.length} requirement row${rows.length === 1 ? "" : "s"}.`,
        details: {
          processed_items: processed,
          total_items: rows.length,
          imported: created.length,
          failed: errors.length
        }
      });
    }
  }

  const response = {
    imported: created.length,
    failed: errors.length,
    created,
    errors
  };

  await workspaceTransactionService.updateTransaction(transaction.id, {
    status: created.length ? "completed" : "failed",
    description: created.length
      ? `Imported ${created.length} of ${rows.length} requirement${rows.length === 1 ? "" : "s"} from CSV.`
      : "No requirements were imported from the CSV file.",
    metadata: {
      import_source: "csv",
      total_rows: rows.length,
      total_items: rows.length,
      processed_items: rows.length,
      imported: created.length,
      failed: errors.length,
      progress_percent: 100,
      current_phase: "completed"
    },
    completed_at: new Date().toISOString()
  });
  await workspaceTransactionService.appendTransactionEvent(transaction.id, {
    level: created.length ? "success" : "error",
    phase: "complete",
    message: created.length
      ? `Imported ${created.length} requirement${created.length === 1 ? "" : "s"} with ${errors.length} failure${errors.length === 1 ? "" : "s"}.`
      : "Requirement import completed with no created records.",
    details: {
      imported: created.length,
      failed: errors.length,
      sample_errors: errors.slice(0, 10)
    }
  });

  return response;
};

exports.createRequirement = async ({ project_id, title, description, external_references, priority, status, created_by }) => {
  if (!project_id || !title) {
    throw new Error("Missing required fields");
  }

  const project = await db.prepare(`
    SELECT id FROM projects WHERE id = ?
  `).get(project_id);

  if (!project) throw new Error("Project not found");

  const id = uuid();
  const display_id = await displayIdService.createDisplayId("requirement");

  await db.prepare(`
    INSERT INTO requirements (id, display_id, project_id, title, description, external_references, priority, status, created_by, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(
    id,
    display_id,
    project_id,
    title,
    description || null,
    normalizeReferenceList(external_references),
    priority ?? 3,
    status || null,
    created_by || null,
    created_by || null
  );

  return { id };
};

exports.getRequirements = async ({ project_id, status, priority }) => {
  let query = `SELECT * FROM requirements WHERE 1=1`;
  const params = [];

  if (project_id) {
    query += ` AND project_id = ?`;
    params.push(project_id);
  }

  if (status) {
    query += ` AND status = ?`;
    params.push(status);
  }

  if (priority !== undefined) {
    query += ` AND priority = ?`;
    params.push(priority);
  }

  query += ` ORDER BY COALESCE(updated_at, created_at) DESC, created_at DESC`;

  const rows = await db.prepare(query).all(...params);
  return Promise.all(rows.map(hydrateTestCaseIds));
};

exports.getRequirement = async (id) => {
  const requirement = await db.prepare(`
    SELECT * FROM requirements WHERE id = ?
  `).get(id);

  if (!requirement) throw new Error("Requirement not found");

  return hydrateTestCaseIds(requirement);
};

exports.updateRequirement = async (id, data) => {
  const existing = await exports.getRequirement(id);

  if (data.project_id) {
    const project = await db.prepare(`
      SELECT id FROM projects WHERE id = ?
    `).get(data.project_id);

    if (!project) throw new Error("Project not found");
  }

  await db.prepare(`
    UPDATE requirements
    SET project_id = ?, title = ?, description = ?, external_references = ?, priority = ?, status = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    data.project_id ?? existing.project_id,
    data.title ?? existing.title,
    data.description ?? existing.description,
    data.external_references !== undefined
      ? normalizeReferenceList(data.external_references)
      : normalizeStoredReferenceList(existing.external_references),
    data.priority ?? existing.priority,
    data.status ?? existing.status,
    data.updated_by ?? existing.updated_by ?? existing.created_by ?? null,
    id
  );

  return { updated: true };
};

exports.previewRequirementOptimization = async ({ id, integration_id, additional_context } = {}) => {
  const requirement = await exports.getRequirement(id);
  const linkedTestCases = await selectLinkedTestCases.all(id);
  const knowledge = await aiKnowledgeService.buildKnowledgeContextPackage(requirement.project_id, {
    app_type_id: requirement.app_type_id || null,
    query: requirement.description || requirement.title,
    module_name: requirement.module_name || null,
    feature_name: requirement.feature_name || null
  });
  const integration = await resolveLlmIntegration(integration_id, requirement.project_id);
  let suggestion;

  if (integration) {
    try {
      const content = await requestRequirementOptimization({
        integration,
        prompt: buildRequirementOptimizationPrompt({
          requirement,
          linkedTestCases,
          knowledge,
          additionalContext: normalizeText(additional_context)
        })
      });
      suggestion = extractJsonPayload(content);
    } catch (error) {
      suggestion = {
        ...buildDeterministicRequirementOptimization(requirement, normalizeText(additional_context)),
        fallback_used: true,
        fallback_reason: error instanceof Error ? error.message : "Requirement optimization failed"
      };
    }
  } else {
    suggestion = buildDeterministicRequirementOptimization(requirement, normalizeText(additional_context));
  }

  return {
    requirement: {
      id: requirement.id,
      title: requirement.title
    },
    integration: integration
      ? {
          id: integration.id,
          name: integration.name,
          type: integration.type,
          model: integration.model
        }
      : null,
    suggestion: {
      title: normalizeText(suggestion.title) || requirement.title,
      description: normalizeText(suggestion.description) || requirement.description || "",
      priority: Number.isFinite(Number(suggestion.priority)) ? Number(suggestion.priority) : requirement.priority ?? 3,
      status: normalizeText(suggestion.status) || requirement.status || "open",
      external_references: normalizeReferenceList(suggestion.external_references || requirement.external_references),
      acceptance_criteria: Array.isArray(suggestion.acceptance_criteria) ? suggestion.acceptance_criteria.map(String) : [],
      risks: Array.isArray(suggestion.risks) ? suggestion.risks.map(String) : [],
      open_questions: Array.isArray(suggestion.open_questions) ? suggestion.open_questions.map(String) : [],
      change_summary: Array.isArray(suggestion.change_summary) ? suggestion.change_summary.map(String) : []
    },
    fallback_used: Boolean(suggestion.fallback_used),
    fallback_reason: suggestion.fallback_reason || null
  };
};

exports.deleteRequirement = async (id) => {
  await exports.getRequirement(id);
  await db.prepare(`
    DELETE FROM requirement_test_cases
    WHERE requirement_id = ?
  `).run(id);

  await db.prepare(`
    UPDATE test_cases
    SET requirement_id = NULL
    WHERE requirement_id = ?
  `).run(id);

  await db.prepare(`
    DELETE FROM requirements WHERE id = ?
  `).run(id);

  return { deleted: true };
};
