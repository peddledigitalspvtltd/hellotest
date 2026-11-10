const db = require("@hellotest/platform/backend/src/db");

const MAX_CASES = 10;
const MAX_STEPS_PER_CASE = 50;
const MAX_STEP_TEXT = 1_200;
const plainText = (value, max = MAX_STEP_TEXT) => String(value || "")
  .replace(/<br\s*\/?>/gi, "\n")
  .replace(/<\/(?:p|div|li|h[1-6])\s*>/gi, "\n")
  .replace(/<[^>]*>/g, " ")
  .replace(/&nbsp;/gi, " ")
  .replace(/&amp;/gi, "&")
  .replace(/&lt;/gi, "<")
  .replace(/&gt;/gi, ">")
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&quot;/gi, '"')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
  .replace(/[ \t]+/g, " ")
  .replace(/\n\s*/g, "\n")
  .trim()
  .slice(0, max);

function parseGherkin(document) {
  const actions = [];
  const expected = [];
  let expectationPhase = false;
  for (const rawLine of String(document || "").split(/\r?\n/)) {
    const match = rawLine.trim().match(/^(Given|When|Then|And|But|\*)\s+(.+)$/i);
    if (!match) continue;
    const keyword = match[1].toLowerCase();
    const text = plainText(match[2]);
    if (!text) continue;
    if (keyword === "given" || keyword === "when") expectationPhase = false;
    else if (keyword === "then") expectationPhase = true;
    (expectationPhase ? expected : actions).push(text);
  }
  return { actions, expected };
}

function summarizeCase(testCase, stepRows = []) {
  const steps = stepRows.slice().sort((left, right) => Number(left.step_order || 0) - Number(right.step_order || 0) || String(left.id || "").localeCompare(String(right.id || ""))).slice(0, MAX_STEPS_PER_CASE).map((step) => ({
    id: step.id,
    step_order: Number(step.step_order || 0),
    action: plainText(step.action),
    expected_result: plainText(step.expected_result)
  })).filter((step) => step.action || step.expected_result);
  const structuredActions = steps.map((step) => step.action).filter(Boolean);
  const structuredExpected = steps.map((step) => step.expected_result).filter(Boolean);
  const hasStructuredSteps = structuredActions.length > 0 || structuredExpected.length > 0;
  const gherkin = hasStructuredSteps ? { actions: [], expected: [] } : parseGherkin(testCase.gherkin_document);
  const actions = structuredActions.length ? structuredActions : gherkin.actions;
  const expected = structuredExpected.length ? structuredExpected : gherkin.expected;
  const gherkinStepCount = gherkin.actions.length + gherkin.expected.length;
  const totalSteps = Number(stepRows[0]?.total_case_steps || 0) || steps.length || gherkinStepCount;
  const returnedSteps = hasStructuredSteps ? steps.length : gherkinStepCount;
  return {
    id: testCase.id,
    display_id: testCase.display_id || null,
    title: plainText(testCase.title, 500),
    description: plainText(testCase.description, 2_400),
    status: testCase.status || null,
    priority: testCase.priority ?? null,
    updated_at: testCase.updated_at || null,
    authoring_mode: testCase.authoring_mode || "structured",
    steps,
    reproduction_steps: actions,
    expected_result: expected.join("\n"),
    total_steps: totalSteps,
    omitted_steps: Math.max(0, totalSteps - returnedSteps)
  };
}

function buildReproduction(cases = []) {
  const actionsFor = (item) => (Array.isArray(item.reproduction_steps)
    ? item.reproduction_steps
    : String(item.reproduction_steps || "").split(/\r?\n/).map((line) => line.replace(/^\s*\d+\.\s*/, "")))
    .map((action) => plainText(action))
    .filter(Boolean)
    .slice(0, MAX_STEPS_PER_CASE);
  const usable = (Array.isArray(cases) ? cases : []).filter((item) => item && (actionsFor(item).length || item.expected_result));
  const multiple = usable.length > 1;
  const steps_to_reproduce = usable.flatMap((item) => {
    const actions = actionsFor(item);
    if (!actions.length) return [];
    return [
      ...(multiple ? [`${item.title || item.display_id || "Test Case"}:`] : []),
      ...actions.map((action, index) => `${index + 1}. ${action}`)
    ];
  }).join("\n");
  const expectedCases = usable.filter((item) => item.expected_result);
  const expected_result = expectedCases.map((item) => [
    ...(multiple ? [`${item.title || item.display_id || "Test Case"}:`] : []),
    item.expected_result
  ].filter(Boolean).join("\n")).join("\n\n");
  return { steps_to_reproduce, expected_result };
}

async function loadCaseReproduction({ projectId, testCaseIds = [], database = db } = {}) {
  const requestedIds = [...new Set((Array.isArray(testCaseIds) ? testCaseIds : [])
    .filter((id) => typeof id === "string" && id.trim()).map((id) => id.trim()))].slice(0, MAX_CASES);
  if (!projectId || !requestedIds.length) return [];
  const placeholders = requestedIds.map(() => "?").join(",");
  const rows = await database.prepare(`
    SELECT tc.id, tc.display_id, tc.title, tc.description, tc.status, tc.priority, tc.updated_at,
      tc.authoring_mode, tc.gherkin_document
    FROM test_cases tc
    JOIN app_types app ON app.id = tc.app_type_id
    WHERE tc.id IN (${placeholders}) AND app.project_id = ?
  `).all(...requestedIds, projectId);
  const casesById = new Map(rows.map((item) => [item.id, item]));
  const validIds = requestedIds.filter((id) => casesById.has(id));
  if (!validIds.length) return [];
  const validPlaceholders = validIds.map(() => "?").join(",");
  const stepRows = await database.prepare(`
    SELECT id, test_case_id, step_order, action, expected_result, total_case_steps
    FROM (
      SELECT test_steps.id, test_steps.test_case_id, test_steps.step_order, test_steps.action, test_steps.expected_result,
        COUNT(*) OVER (PARTITION BY test_steps.test_case_id)::INTEGER AS total_case_steps,
        ROW_NUMBER() OVER (PARTITION BY test_steps.test_case_id ORDER BY test_steps.step_order, test_steps.id) AS case_step_rank
      FROM test_steps
      JOIN test_cases tc ON tc.id = test_steps.test_case_id
      JOIN app_types app ON app.id = tc.app_type_id
      WHERE test_steps.test_case_id IN (${validPlaceholders}) AND app.project_id = ?
    ) ordered_steps
    WHERE case_step_rank <= ?
    ORDER BY test_case_id, step_order, id
  `).all(...validIds, projectId, MAX_STEPS_PER_CASE);
  const stepsByCase = new Map();
  for (const step of stepRows) {
    if (!stepsByCase.has(step.test_case_id)) stepsByCase.set(step.test_case_id, []);
    stepsByCase.get(step.test_case_id).push(step);
  }
  return validIds.map((id) => summarizeCase(casesById.get(id), stepsByCase.get(id) || []));
}

module.exports = { MAX_CASES, MAX_STEPS_PER_CASE, buildReproduction, loadCaseReproduction, parseGherkin, summarizeCase };
