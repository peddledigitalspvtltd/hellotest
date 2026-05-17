const db = require("../db");
const integrationService = require("./integration.service");
const { createLlmProviderError } = require("../utils/upstreamLlmError");

const DIRECT_CASE_SUITE_ID = "default";
const DIRECT_CASE_SUITE_NAME = "Default";
const SMART_EXECUTION_MAX_OUTPUT_TOKENS = 900;
const SMART_EXECUTION_CASE_SELECTION_ATTEMPTS = [
  { csvBudget: 12000, maxCases: 120 },
  { csvBudget: 8000, maxCases: 72 },
  { csvBudget: 5600, maxCases: 40 }
];
const SMART_EXECUTION_MAX_TITLE_LENGTH = 120;
const SMART_EXECUTION_MAX_DESCRIPTION_LENGTH = 220;
const SMART_EXECUTION_MAX_STATUS_LENGTH = 32;
const SMART_EXECUTION_MAX_LIST_ITEMS = 4;
const SMART_EXECUTION_MAX_LIST_ITEM_LENGTH = 60;
const SMART_EXECUTION_MAX_STEP_COUNT_IN_SUMMARY = 5;
const SMART_EXECUTION_MAX_STEP_FRAGMENT_LENGTH = 96;
const SMART_EXECUTION_MAX_STEP_SUMMARY_LENGTH = 360;
const SMART_EXECUTION_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "has",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "this",
  "to",
  "using",
  "with"
]);

const selectTestEnvironment = db.prepare(`
  SELECT id, project_id, app_type_id, name, description, base_url, browser, notes, variables
  FROM test_environments
  WHERE id = ?
`);

const selectTestConfiguration = db.prepare(`
  SELECT id, project_id, app_type_id, name, description, browser, mobile_os, platform_version, variables
  FROM test_configurations
  WHERE id = ?
`);

const selectTestDataSet = db.prepare(`
  SELECT id, project_id, app_type_id, name, description, mode, columns, rows
  FROM test_data_sets
  WHERE id = ?
`);

const selectCasesForPlanning = db.prepare(`
  SELECT id, title, description, priority, status
  FROM test_cases
  WHERE app_type_id = ?
  ORDER BY created_at DESC, title ASC
`);

const selectSuiteMappingsForPlanning = db.prepare(`
  SELECT stc.test_case_id, ts.name AS suite_name
  FROM suite_test_cases stc
  JOIN test_suites ts ON ts.id = stc.suite_id
  WHERE ts.app_type_id = ?
  ORDER BY stc.test_case_id ASC, stc.sort_order ASC, ts.name ASC
`);

const selectRequirementMappingsForPlanning = db.prepare(`
  SELECT rtc.test_case_id, rtc.requirement_id, r.title AS requirement_title
  FROM requirement_test_cases rtc
  JOIN requirements r ON r.id = rtc.requirement_id
  JOIN test_cases tc ON tc.id = rtc.test_case_id
  WHERE tc.app_type_id = ?
  ORDER BY rtc.test_case_id ASC, r.title ASC
`);

const selectRequirementForPlanning = db.prepare(`
  SELECT id, project_id, title
  FROM requirements
  WHERE id = ?
`);

const selectStepsForPlanning = db.prepare(`
  SELECT test_case_id, step_order, action, expected_result, group_name
  FROM test_steps
  WHERE test_case_id IN (
    SELECT id
    FROM test_cases
    WHERE app_type_id = ?
  )
  ORDER BY test_case_id ASC, step_order ASC, id ASC
`);

const normalizeText = (value) => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
};

const truncateText = (value, maxLength) => {
  const normalized = normalizeText(value);

  if (!normalized) {
    return "";
  }

  if (!maxLength || normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(maxLength - 1, 1)).trimEnd()}…`;
};

const tokenizePlanningText = (...values) =>
  uniqueList(
    values
      .flatMap((value) =>
        String(value || "")
          .toLowerCase()
          .split(/[^a-z0-9]+/g)
          .map((token) => token.trim())
      )
      .filter((token) => token.length >= 3 && !SMART_EXECUTION_STOP_WORDS.has(token))
  );

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

  try {
    return JSON.parse(jsonCandidate);
  } catch {
    throw new Error("Unable to parse JSON from the LLM response");
  }
};

const parseJsonValue = (value, fallback) => {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  return value;
};

const toCsvCell = (value) => {
  const raw = value === null || value === undefined ? "" : String(value);
  return `"${raw.replace(/"/g, "\"\"")}"`;
};

const uniqueList = (values = []) => Array.from(new Set(values.filter(Boolean)));

const resolveIntegration = async (integration_id) => {
  const integration = integration_id
    ? await integrationService.getIntegration(integration_id)
    : await integrationService.getActiveIntegrationByType("llm");

  if (!integration) {
    throw new Error("No active LLM integration is configured");
  }

  if (integration.type !== "llm") {
    throw new Error("Selected integration is not an LLM integration");
  }

  if (!integration.is_active) {
    throw new Error("Selected LLM integration is inactive");
  }

  return integration;
};

const requestChatCompletion = async ({ integration, content }) => {
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
      max_tokens: SMART_EXECUTION_MAX_OUTPUT_TOKENS,
      messages: [
        {
          role: "system",
          content: "You are a senior QA architect. Return strict JSON only."
        },
        {
          role: "user",
          content
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

async function resolveExecutionContextResource({ id, label, projectId, appTypeId, lookup, describe }) {
  if (!id) {
    return null;
  }

  const resource = await lookup.get(id);

  if (!resource) {
    throw new Error(`${label} not found`);
  }

  if (resource.project_id !== projectId) {
    throw new Error(`${label} must belong to the selected project`);
  }

  if (resource.app_type_id && resource.app_type_id !== appTypeId) {
    throw new Error(`${label} must belong to the selected app type or be shared at project level`);
  }

  return {
    id: resource.id,
    name: resource.name,
    summary: describe(resource)
  };
}

const summarizeEnvironment = (resource) => {
  return [
    resource.name,
    normalizeText(resource.base_url) ? `Base URL: ${resource.base_url}` : null,
    normalizeText(resource.browser) ? `Browser: ${resource.browser}` : null,
    normalizeText(resource.notes) ? `Notes: ${resource.notes}` : null
  ]
    .filter(Boolean)
    .join(" | ");
};

const summarizeConfiguration = (resource) => {
  const variables = parseJsonValue(resource.variables, []);

  return [
    resource.name,
    normalizeText(resource.browser) ? `Browser: ${resource.browser}` : null,
    normalizeText(resource.mobile_os) ? `Mobile OS: ${resource.mobile_os}` : null,
    normalizeText(resource.platform_version) ? `Platform: ${resource.platform_version}` : null,
    Array.isArray(variables) && variables.length ? `${variables.length} variables` : null
  ]
    .filter(Boolean)
    .join(" | ");
};

const summarizeDataSet = (resource) => {
  const columns = parseJsonValue(resource.columns, []);
  const rows = parseJsonValue(resource.rows, []);

  return [
    resource.name,
    resource.mode ? `Mode: ${resource.mode}` : null,
    Array.isArray(columns) && columns.length ? `${columns.length} columns` : null,
    Array.isArray(rows) ? `${rows.length} rows` : null
  ]
    .filter(Boolean)
    .join(" | ");
};

const compactPromptList = (values = []) => {
  const compact = uniqueList(values)
    .map((value) => truncateText(value, SMART_EXECUTION_MAX_LIST_ITEM_LENGTH))
    .filter(Boolean);

  if (compact.length <= SMART_EXECUTION_MAX_LIST_ITEMS) {
    return compact;
  }

  return compact
    .slice(0, SMART_EXECUTION_MAX_LIST_ITEMS)
    .concat(`+${compact.length - SMART_EXECUTION_MAX_LIST_ITEMS} more`);
};

const buildCaseMaps = ({ cases, suiteMappings, requirementMappings, stepRows }) => {
  const suitesByCaseId = suiteMappings.reduce((accumulator, mapping) => {
    accumulator[mapping.test_case_id] = accumulator[mapping.test_case_id] || [];
    accumulator[mapping.test_case_id].push(mapping.suite_name);
    return accumulator;
  }, {});

  const requirementsByCaseId = requirementMappings.reduce((accumulator, mapping) => {
    accumulator[mapping.test_case_id] = accumulator[mapping.test_case_id] || [];
    accumulator[mapping.test_case_id].push({
      id: mapping.requirement_id,
      title: mapping.requirement_title
    });
    return accumulator;
  }, {});

  const stepsByCaseId = stepRows.reduce((accumulator, step) => {
    accumulator[step.test_case_id] = accumulator[step.test_case_id] || [];
    accumulator[step.test_case_id].push(step);
    return accumulator;
  }, {});

  return cases.map((testCase) => {
    const steps = stepsByCaseId[testCase.id] || [];
    const suite_names = uniqueList(suitesByCaseId[testCase.id] || []);
    const requirementMappingsForCase = requirementsByCaseId[testCase.id] || [];
    const requirement_ids = uniqueList(requirementMappingsForCase.map((mapping) => mapping.id));
    const requirement_titles = uniqueList(requirementMappingsForCase.map((mapping) => mapping.title));
    const summarizedSteps = steps
      .slice(0, SMART_EXECUTION_MAX_STEP_COUNT_IN_SUMMARY)
      .map((step) => {
        const fragments = [
          Number.isFinite(Number(step.step_order)) ? `${Number(step.step_order)}.` : null,
          normalizeText(step.group_name) ? `[${truncateText(step.group_name, 40)}]` : null,
          truncateText(step.action, SMART_EXECUTION_MAX_STEP_FRAGMENT_LENGTH) || "No action"
        ].filter(Boolean);
        const expected = truncateText(step.expected_result, SMART_EXECUTION_MAX_STEP_FRAGMENT_LENGTH);
        return expected ? `${fragments.join(" ")} => ${expected}` : fragments.join(" ");
      });
    const remainingStepCount = Math.max(steps.length - summarizedSteps.length, 0);
    const step_summary = truncateText(
      [
        summarizedSteps.join(" | "),
        remainingStepCount ? `+${remainingStepCount} more step${remainingStepCount === 1 ? "" : "s"}` : null
      ]
        .filter(Boolean)
        .join(" | "),
      SMART_EXECUTION_MAX_STEP_SUMMARY_LENGTH
    );

    return {
      id: testCase.id,
      title: testCase.title,
      description: testCase.description || null,
      priority: testCase.priority ?? null,
      status: testCase.status || null,
      suite_names,
      requirement_ids,
      requirement_titles,
      step_count: steps.length,
      step_summary
    };
  });
};

const buildCaseCsvRow = (testCase) =>
  [
    testCase.id,
    testCase.title,
    testCase.description || "",
    testCase.priority ?? "",
    testCase.status || "",
    testCase.suite_names.join(" | "),
    testCase.requirement_titles.join(" | "),
    testCase.step_count,
    testCase.step_summary
  ]
    .map(toCsvCell)
    .join(",");

const buildCaseCsv = (cases = []) => {
  const rows = [
    [
      "test_case_id",
      "title",
      "description",
      "priority",
      "status",
      "suites",
      "requirements",
      "step_count",
      "steps"
    ].map(toCsvCell).join(",")
  ];

  cases.forEach((testCase) => {
    rows.push(buildCaseCsvRow(testCase));
  });

  return rows.join("\n");
};

const buildFallbackExecutionName = (planningInput, appTypeName) => {
  const scopeSnippet = normalizeText(planningInput)
    ?.split(/\s+/)
    .slice(0, 6)
    .join(" ");

  return scopeSnippet ? `${appTypeName} Impact - ${scopeSnippet}` : `${appTypeName} Impact Execution`;
};

const buildPrompt = ({
  appType,
  releaseScope,
  additionalContext,
  selectedRequirementTitles,
  executionContext,
  sourceCaseCount,
  candidateCaseCount,
  caseCsv
}) => {
  const isPartialLibrary = candidateCaseCount < sourceCaseCount;
  const prompt = [
    "Plan a smart QA execution for a release by selecting impacted existing test cases from the provided CSV candidate library.",
    "",
    `Application type: ${appType.name} (${appType.type})`,
    `Execution suite to use when creating the run: ${DIRECT_CASE_SUITE_NAME} (${DIRECT_CASE_SUITE_ID})`
  ];

  if (releaseScope) {
    prompt.push("", "Release scope:", releaseScope);
  }

  if (additionalContext) {
    prompt.push("");
    prompt.push(releaseScope ? "Additional release/testing context:" : "Planning context:");
    prompt.push(additionalContext);
  }

  if (selectedRequirementTitles.length) {
    prompt.push("");
    prompt.push("Selected impacted requirements:");
    selectedRequirementTitles.forEach((title) => {
      prompt.push(`- ${title}`);
    });
  }

  if (executionContext.length) {
    prompt.push("");
    prompt.push("Selected execution context snapshots:");
    executionContext.forEach((line) => {
      prompt.push(`- ${line}`);
    });
  }

  prompt.push("");
  prompt.push(
    isPartialLibrary
      ? `Candidate existing test case library CSV (${candidateCaseCount} ranked cases from ${sourceCaseCount} total existing cases):`
      : `Existing test case library CSV (${sourceCaseCount} cases):`
  );
  prompt.push("```csv");
  prompt.push(caseCsv);
  prompt.push("```");
  prompt.push("");
  prompt.push("Return strict JSON with this exact shape:");
  prompt.push("{");
  prompt.push('  "execution_name": "string",');
  prompt.push('  "summary": "string",');
  prompt.push('  "cases": [');
  prompt.push("    {");
  prompt.push('      "test_case_id": "exact id from CSV",');
  prompt.push('      "reason": "string",');
  prompt.push('      "impact_level": "critical"');
  prompt.push("    }");
  prompt.push("  ]");
  prompt.push("}");
  prompt.push("");
  prompt.push("Rules:");
  prompt.push("- Use only exact test_case_id values that exist in the provided CSV.");
  if (isPartialLibrary) {
    prompt.push("- The CSV is a relevance-ranked excerpt of the full library based on the release scope and selected execution context.");
  }
  if (selectedRequirementTitles.length) {
    prompt.push("- The CSV is already constrained to cases linked to the selected impacted requirements.");
  }
  prompt.push("- Include every materially impacted case that should be executed for confidence in this release.");
  prompt.push("- Exclude obviously unrelated cases.");
  prompt.push("- Use the reason field to explain why the case belongs in this execution.");
  prompt.push("- impact_level must be one of: critical, high, medium, low.");
  prompt.push("- If nothing is materially impacted, return an empty cases array and explain why in summary.");
  prompt.push("- Do not include markdown or commentary outside the JSON.");

  return prompt.join("\n");
};

const buildPromptReadyCase = (testCase) => ({
  id: testCase.id,
  title: truncateText(testCase.title, SMART_EXECUTION_MAX_TITLE_LENGTH),
  description: truncateText(testCase.description, SMART_EXECUTION_MAX_DESCRIPTION_LENGTH),
  priority: testCase.priority ?? "",
  status: truncateText(testCase.status, SMART_EXECUTION_MAX_STATUS_LENGTH),
  suite_names: compactPromptList(testCase.suite_names),
  requirement_titles: compactPromptList(testCase.requirement_titles),
  step_count: testCase.step_count,
  step_summary: truncateText(testCase.step_summary, SMART_EXECUTION_MAX_STEP_SUMMARY_LENGTH)
});

const scoreCaseForPlanning = (testCase, searchTerms) => {
  const title = `${normalizeText(testCase.title) || ""}`.toLowerCase();
  const description = `${normalizeText(testCase.description) || ""}`.toLowerCase();
  const suites = testCase.suite_names.join(" ").toLowerCase();
  const requirements = testCase.requirement_titles.join(" ").toLowerCase();
  const steps = `${normalizeText(testCase.step_summary) || ""}`.toLowerCase();

  const keywordScore = searchTerms.reduce((score, term) => {
    let next = score;

    if (title.includes(term)) {
      next += 12;
    }

    if (requirements.includes(term)) {
      next += 10;
    }

    if (suites.includes(term)) {
      next += 7;
    }

    if (description.includes(term)) {
      next += 6;
    }

    if (steps.includes(term)) {
      next += 4;
    }

    return next;
  }, 0);

  const priorityBoost = Number.isFinite(Number(testCase.priority)) ? Math.max(0, 6 - Number(testCase.priority)) : 0;
  const stepBoost = Math.min(Number(testCase.step_count) || 0, 6);
  const activeBoost = normalizeText(testCase.status)?.toLowerCase() === "active" ? 1 : 0;

  return keywordScore + priorityBoost + stepBoost + activeBoost;
};

const selectCasesForPrompt = ({
  scopedCases,
  releaseScope,
  additionalContext,
  selectedRequirementTitles,
  executionContext,
  appType,
  csvBudget,
  maxCases
}) => {
  const searchTerms = tokenizePlanningText(
    releaseScope,
    additionalContext,
    selectedRequirementTitles.join(" "),
    executionContext.join(" "),
    appType.name,
    appType.type
  );
  const rankedCases = [...scopedCases]
    .map((testCase, index) => ({
      testCase,
      index,
      score: scoreCaseForPlanning(testCase, searchTerms)
    }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      const leftPriority = Number.isFinite(Number(left.testCase.priority)) ? Number(left.testCase.priority) : Number.POSITIVE_INFINITY;
      const rightPriority = Number.isFinite(Number(right.testCase.priority)) ? Number(right.testCase.priority) : Number.POSITIVE_INFINITY;

      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }

      if (right.testCase.step_count !== left.testCase.step_count) {
        return right.testCase.step_count - left.testCase.step_count;
      }

      return left.index - right.index;
    });
  const selected = [];
  let currentLength = buildCaseCsv([]).length;

  rankedCases.some(({ testCase }) => {
    if (selected.length >= maxCases) {
      return true;
    }

    const promptReadyCase = buildPromptReadyCase(testCase);
    const nextRow = buildCaseCsvRow(promptReadyCase);
    const separatorLength = selected.length ? 1 : 0;

    if (selected.length && currentLength + separatorLength + nextRow.length > csvBudget) {
      return true;
    }

    selected.push(promptReadyCase);
    currentLength += separatorLength + nextRow.length;
    return false;
  });

  return selected.length ? selected : [buildPromptReadyCase(scopedCases[0])];
};

const isPromptTooLargeError = (error) =>
  error?.statusCode === 413 || /request too large/i.test(String(error?.message || ""));

const requestSmartExecutionPlan = async ({
  integration,
  appType,
  releaseScope,
  additionalContext,
  selectedRequirementTitles,
  executionContext,
  scopedCases
}) => {
  let lastSizeError = null;

  for (const attempt of SMART_EXECUTION_CASE_SELECTION_ATTEMPTS) {
    const promptCases = selectCasesForPrompt({
      scopedCases,
      releaseScope,
      additionalContext,
      selectedRequirementTitles,
      executionContext,
      appType,
      csvBudget: attempt.csvBudget,
      maxCases: attempt.maxCases
    });
    const caseCsv = buildCaseCsv(promptCases);
    const prompt = buildPrompt({
      appType,
      releaseScope,
      additionalContext,
      selectedRequirementTitles,
      executionContext,
      sourceCaseCount: scopedCases.length,
      candidateCaseCount: promptCases.length,
      caseCsv
    });

    try {
      const content = await requestChatCompletion({ integration, content: prompt });
      return { content, promptCaseIds: promptCases.map((testCase) => testCase.id) };
    } catch (error) {
      if (!isPromptTooLargeError(error)) {
        throw error;
      }

      lastSizeError = error;
    }
  }

  const error = new Error(
    "AI smart execution prompt still exceeds the configured model limit after trimming the candidate case library. Use a higher-capacity LLM integration or narrow the release scope."
  );
  error.statusCode = lastSizeError?.statusCode || 413;
  throw error;
};

const normalizeImpactLevel = (value) => {
  const normalized = normalizeText(value)?.toLowerCase();

  if (normalized === "critical" || normalized === "high" || normalized === "medium" || normalized === "low") {
    return normalized;
  }

  return "medium";
};

exports.previewSmartExecution = async ({
  project_id,
  appType,
  integration_id,
  release_scope,
  additional_context,
  impacted_requirement_ids,
  test_environment_id,
  test_configuration_id,
  test_data_set_id
}) => {
  const releaseScope = normalizeText(release_scope);
  const additionalContext = normalizeText(additional_context);
  const impactedRequirementIds = uniqueList(
    (Array.isArray(impacted_requirement_ids) ? impacted_requirement_ids : []).map((value) => normalizeText(value))
  );

  if (!project_id || !appType?.id || (!releaseScope && !additionalContext)) {
    throw new Error("Project, app type, and either release scope or additional context are required");
  }

  const [selectedEnvironment, selectedConfiguration, selectedDataSet, cases, suiteMappings, requirementMappings, stepRows, integration] =
    await Promise.all([
      resolveExecutionContextResource({
        id: test_environment_id,
        label: "Test environment",
        projectId: project_id,
        appTypeId: appType.id,
        lookup: selectTestEnvironment,
        describe: summarizeEnvironment
      }),
      resolveExecutionContextResource({
        id: test_configuration_id,
        label: "Test configuration",
        projectId: project_id,
        appTypeId: appType.id,
        lookup: selectTestConfiguration,
        describe: summarizeConfiguration
      }),
      resolveExecutionContextResource({
        id: test_data_set_id,
        label: "Test data set",
        projectId: project_id,
        appTypeId: appType.id,
        lookup: selectTestDataSet,
        describe: summarizeDataSet
      }),
      selectCasesForPlanning.all(appType.id),
      selectSuiteMappingsForPlanning.all(appType.id),
      selectRequirementMappingsForPlanning.all(appType.id),
      selectStepsForPlanning.all(appType.id),
      resolveIntegration(integration_id)
    ]);

  if (!cases.length) {
    throw new Error("No existing test cases are available in this app type yet");
  }

  const scopedCases = buildCaseMaps({
    cases,
    suiteMappings,
    requirementMappings,
    stepRows
  });
  const selectedRequirements = impactedRequirementIds.length
    ? impactedRequirementIds.map((requirementId) => {
        const requirement = selectRequirementForPlanning.get(requirementId);

        if (!requirement) {
          throw new Error(`Requirement not found: ${requirementId}`);
        }

        if (requirement.project_id !== project_id) {
          throw new Error("Impacted requirements must belong to the selected project");
        }

        return requirement;
      })
    : [];
  const filteredScopedCases = impactedRequirementIds.length
    ? scopedCases.filter((testCase) => testCase.requirement_ids.some((requirementId) => impactedRequirementIds.includes(requirementId)))
    : scopedCases;

  if (impactedRequirementIds.length && !filteredScopedCases.length) {
    throw new Error("No existing test cases are linked to the selected impacted requirements in this app type yet.");
  }

  const executionContext = [
    selectedEnvironment ? `Environment: ${selectedEnvironment.summary}` : null,
    selectedConfiguration ? `Configuration: ${selectedConfiguration.summary}` : null,
    selectedDataSet ? `Data set: ${selectedDataSet.summary}` : null
  ].filter(Boolean);
  const { content, promptCaseIds } = await requestSmartExecutionPlan({
    integration,
    appType,
    releaseScope,
    additionalContext,
    selectedRequirementTitles: selectedRequirements.map((requirement) => requirement.title),
    executionContext,
    scopedCases: filteredScopedCases
  });
  const caseMap = new Map(
    filteredScopedCases
      .filter((testCase) => promptCaseIds.includes(testCase.id))
      .map((testCase) => [testCase.id, testCase])
  );
  const payload = extractJsonPayload(content);
  const rawCases = Array.isArray(payload?.cases)
    ? payload.cases
    : Array.isArray(payload?.test_cases)
      ? payload.test_cases
      : Array.isArray(payload?.testCases)
        ? payload.testCases
        : [];

  const normalizedCases = uniqueList(
    rawCases
      .map((item) => {
        const testCaseId = normalizeText(item?.test_case_id || item?.testCaseId || item?.id);

        if (!testCaseId || !caseMap.has(testCaseId)) {
          return null;
        }

        const match = caseMap.get(testCaseId);

        return {
          test_case_id: match.id,
          title: match.title,
          description: match.description,
          priority: match.priority,
          status: match.status,
          suite_names: match.suite_names,
          requirement_titles: match.requirement_titles,
          step_count: match.step_count,
          reason: normalizeText(item?.reason) || "Selected as impacted by the planning context.",
          impact_level: normalizeImpactLevel(item?.impact_level || item?.impactLevel)
        };
      })
      .filter(Boolean)
      .map((item) => item.test_case_id)
  ).map((test_case_id) => {
    const raw = rawCases.find((item) => {
      const candidateId = normalizeText(item?.test_case_id || item?.testCaseId || item?.id);
      return candidateId === test_case_id;
    });
    const match = caseMap.get(test_case_id);

    return {
      test_case_id: match.id,
      title: match.title,
      description: match.description,
      priority: match.priority,
      status: match.status,
      suite_names: match.suite_names,
      requirement_titles: match.requirement_titles,
      step_count: match.step_count,
      reason: normalizeText(raw?.reason) || "Selected as impacted by the planning context.",
      impact_level: normalizeImpactLevel(raw?.impact_level || raw?.impactLevel)
    };
  });

  if (rawCases.length && !normalizedCases.length) {
    throw new Error("AI could not match impacted cases to the existing library. Refine the planning context and try again.");
  }

  return {
    integration: {
      id: integration.id,
      name: integration.name,
      type: integration.type,
      model: integration.model
    },
    app_type: {
      id: appType.id,
      name: appType.name
    },
    default_suite: {
      id: DIRECT_CASE_SUITE_ID,
      name: DIRECT_CASE_SUITE_NAME
    },
    source_case_count: filteredScopedCases.length,
    matched_case_count: normalizedCases.length,
    execution_name:
      normalizeText(payload?.execution_name || payload?.executionName) ||
      buildFallbackExecutionName(releaseScope || additionalContext, appType.name),
    summary:
      normalizeText(payload?.summary) ||
      (normalizedCases.length
        ? `${normalizedCases.length} impacted test case${normalizedCases.length === 1 ? "" : "s"} selected from ${filteredScopedCases.length} existing case${filteredScopedCases.length === 1 ? "" : "s"}${selectedRequirements.length ? " linked to the selected requirements" : ""}.`
        : `No materially impacted test cases were identified for this ${releaseScope ? "release scope" : "planning context"}.`),
    cases: normalizedCases
  };
};
