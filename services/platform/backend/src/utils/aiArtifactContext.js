const object = (value) => {
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return {}; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
};
const text = (value, limit = 1000) => value instanceof Date ? value.toISOString() : typeof value === "string" || typeof value === "number" || typeof value === "boolean"
  ? String(value).replace(/\u0000/g, "").trim().slice(0, limit) : "";
const list = (value, limit = 12, itemLimit = 500) => {
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { value = [value]; }
  }
  return [...new Set((Array.isArray(value) ? value : []).map(item => text(item, itemLimit)).filter(Boolean))].slice(0, limit);
};
const boundedFields = (value, limit = 12, itemLimit = 200) => Object.fromEntries(Object.entries(object(value))
  .filter(([key]) => !key.startsWith("_") && key !== "acceptance_criteria")
  .slice(0, limit)
  .map(([key, field]) => [text(key, 80), text(typeof field === "object" ? JSON.stringify(field) : field, itemLimit)]));

const sensitiveParameterName = /password|passwd|secret|token|credential|api.?key|authorization|cookie|session|csrf|xsrf|private.?key|passcode|(?:^|[._ -])pin(?:$|[._ -])|otp|verification.?code/i;
const scopedParameterReference = /^@[tsr]\.(?:[A-Za-z][A-Za-z0-9_-]*|\[(?:\\.|[^\]\\\r\n])+\])$/i;
function privateCaseProjection(testCase) {
  const { normalizeParameterKey } = require('./stepParameterResolution');
  const options = object(testCase.test_data_options);
  const names = new Set([...list(options.private_parameter_names, 100, 255), ...list(options.effective_private_parameter_names, 100, 255),
    ...list(testCase.effective_private_parameter_names, 100, 255)].map(name => normalizeParameterKey(name, 't')));
  const values = object(testCase.parameter_values), protectedValues = [], privateReferences = [];
  const safeValues = Object.fromEntries(Object.entries(values).map(([key, value]) => {
    if (!names.has(normalizeParameterKey(key, 't')) && !sensitiveParameterName.test(key)) return [key, value];
    const name = normalizeParameterKey(key, 't'), rawName = name.slice(2);
    const reference = `@${name.slice(0, 2)}${/^[a-z][a-z0-9_-]*$/i.test(rawName) ? rawName : `[${rawName.replace(/\\/g, '\\\\').replace(/\]/g, '\\]')}]`}`;
    privateReferences.push(reference);
    // Existing reviewed external references are safe context; their values are not.
    if (typeof value === 'string' && scopedParameterReference.test(value.trim())) return [key, value];
    if (value != null && String(value) && !/^\[(?:Missing:|Private)/i.test(String(value))) protectedValues.push({ value: String(value), reference });
    return [key, '[Missing: protected value supplied privately at execution]'];
  }));
  if (!privateReferences.length) return { value: testCase, privateReferences };
  const projectText = input => {
    if (typeof input !== 'string') return input;
    let output = input;
    for (const entry of protectedValues.sort((left, right) => right.value.length - left.value.length)) {
      const escaped = entry.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const before = /^[A-Za-z0-9_]/.test(entry.value) ? '(?<![A-Za-z0-9_])' : '';
      const after = /[A-Za-z0-9_]$/.test(entry.value) ? '(?![A-Za-z0-9_])' : '';
      output = output.replace(new RegExp(`${before}${escaped}${after}`, 'g'), () => entry.reference);
    }
    return output;
  };
  const project = value => typeof value === 'string' ? projectText(value) : Array.isArray(value) ? value.map(project)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, project(entry)])) : value;
  // Project selected artifact content only; hydrated histories and relations do
  // not belong to a snapshot and must not be walked to prepare model context.
  const projected = { ...testCase, title: projectText(testCase.title), description: projectText(testCase.description),
    gherkin_document: projectText(testCase.gherkin_document), parameter_values: project(safeValues),
    steps: Array.isArray(testCase.steps) ? testCase.steps.map(row => ({ ...row, action: projectText(row?.action), expected_result: projectText(row?.expected_result ?? row?.expectedResult) })) : testCase.steps,
    test_data_options: project(options), external_references: project(testCase.external_references), labels: project(testCase.labels) };
  return { value: projected, privateReferences };
}

const withContextLimits = (snapshot, original) => {
  const truncated = [];
  const omitted = {};
  for (const [key, value] of Object.entries(snapshot)) {
    const source = original[key];
    if (typeof value === "string" && typeof source === "string" && source.trim().length > value.length) truncated.push(key);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const originalFields = object(source);
      const keys = Object.keys(originalFields).filter(field => !field.startsWith("_") && field !== "acceptance_criteria");
      if (keys.length > Object.keys(value).length) omitted[key] = keys.length - Object.keys(value).length;
      if (Object.entries(value).some(([field, item]) => { const originalItem = originalFields[field]; return typeof item === "string" && String(typeof originalItem === "object" ? JSON.stringify(originalItem) : originalItem ?? "").length > item.length; })) truncated.push(key);
    }
    if (Array.isArray(value)) {
      let sourceItems = source;
      if (typeof sourceItems === "string") { try { sourceItems = JSON.parse(sourceItems); } catch { sourceItems = [sourceItems]; } }
      if (Array.isArray(sourceItems)) {
        if (sourceItems.length > value.length) omitted[key] = sourceItems.length - value.length;
        if (value.some((item, index) => typeof item === "string" && typeof sourceItems[index] === "string" && sourceItems[index].length > item.length)) truncated.push(key);
      }
    }
  }
  if (truncated.length || Object.keys(omitted).length) snapshot.context_limits = { truncated_fields: truncated, omitted_items: omitted, note: "Only the supplied bounded excerpt was reviewed; omitted content is unknown." };
  return snapshot;
};

// Deliberately select artifact content rather than serializing hydrated records,
// which may include histories, duplicate relations, and operational metadata.
function storyAiSnapshot(story = {}, { textLimit = 4000, itemLimit = 500, listLimit = 8 } = {}) {
  story = object(story);
  const fields = object(story.additional_fields);
  const snapshot = {
    id: text(story.id, 255), display_id: text(story.display_id, 100),
    title: text(story.title, 500), description: text(story.description, textLimit),
    acceptance_criteria: list(story.acceptance_criteria ?? fields.acceptance_criteria, listLimit, itemLimit),
    gherkin_scenarios: list(story.gherkin_scenarios, Math.min(listLimit, 4), itemLimit),
    specification_format: text(story.specification_format, 80),
    specification_content: text(story.specification_content, textLimit),
    priority: Number.isFinite(Number(story.priority)) && story.priority != null ? Math.max(1, Math.min(5, Number(story.priority))) : null, status: text(story.status, 100),
    dev_status: text(story.dev_status, 100), qa_status: text(story.qa_status, 100),
    labels: list(story.labels, listLimit, 100),
    external_references: list(story.external_references, listLimit, Math.min(itemLimit, 500)),
    sprint: text(story.sprint, 180), iteration_id: text(story.iteration_id, 255),
    release: text(story.release, 180), release_id: text(story.release_id, 255),
    fix_version: text(story.fix_version, 180), scrum_team: text(story.scrum_team, 180),
    dev_completion_target_date: text(story.dev_completion_target_date, 100),
    qa_completion_target_date: text(story.qa_completion_target_date, 100),
    additional_fields: boundedFields(fields, listLimit, Math.min(itemLimit, 200))
  };
  return withContextLimits(snapshot, { ...story, additional_fields: fields, acceptance_criteria: story.acceptance_criteria ?? fields.acceptance_criteria });
}

function testCaseAiSnapshot(testCase = {}, { stepLimit = 30, itemLimit = 500 } = {}) {
  testCase = object(testCase);
  const privateProjection = privateCaseProjection(testCase);
  testCase = privateProjection.value;
  const authoringMode = testCase.authoring_mode === "gherkin" ? "gherkin" : "structured";
  const gherkin = text(testCase.gherkin_document, 10000);
  const steps = (Array.isArray(testCase.steps) ? testCase.steps : []).slice(0, stepLimit).map((step, index) => ({
    step_order: index + 1,
    step_type: text(step?.step_type, 30) || "web",
    action: text(step?.action, itemLimit), expected_result: text(step?.expected_result ?? step?.expectedResult, itemLimit)
  }));
  const snapshot = {
    id: text(testCase.id, 255), title: text(testCase.title, 500), description: text(testCase.description, 4000),
    priority: Number.isFinite(Number(testCase.priority)) && testCase.priority != null ? Math.max(1, Math.min(5, Number(testCase.priority))) : null, status: text(testCase.status, 100),
    test_case_type: text(testCase.test_case_type, 120), automated: text(testCase.automated, 30),
    automation_status: text(testCase.automation_status, 100),
    reviewer_id: text(testCase.reviewer_id, 255), review_status: text(testCase.review_status, 100),
    test_data_set_ids: list(testCase.test_data_set_ids, 10, 255),
    test_data_options: boundedFields(testCase.test_data_options, 5, 100),
    authoring_mode: authoringMode, gherkin_document: authoringMode === "gherkin" ? gherkin : "",
    // Gherkin is already the canonical body; sending cached structured steps
    // repeats evidence and can contradict unsaved Gherkin edits.
    steps: authoringMode === "gherkin" && gherkin ? [] : steps,
    parameter_values: boundedFields(testCase.parameter_values, 20, 200),
    ...(privateProjection.privateReferences.length ? { private_parameter_references: privateProjection.privateReferences.slice(0, 20),
      private_parameter_reference_count: privateProjection.privateReferences.length, private_parameter_values_omitted: true } : {}),
    external_references: list(testCase.external_references, 10, 500),
    labels: list(testCase.labels, 12, 100),
    requirement_ids: list(testCase.requirement_ids || [testCase.requirement_id], 20, 255),
    module_ids: list(testCase.module_ids || [testCase.module_id], 20, 255)
  };
  if (steps.some((step, index) => String(testCase.steps[index]?.action || "").length > step.action.length || String(testCase.steps[index]?.expected_result || testCase.steps[index]?.expectedResult || "").length > step.expected_result.length)) snapshot.step_text_truncated = true;
  // Cached structured steps intentionally omitted in Gherkin mode are not lost evidence.
  return withContextLimits(snapshot, authoringMode === "gherkin" && gherkin ? { ...testCase, steps: [], gherkin_document: testCase.gherkin_document } : testCase);
}

module.exports = { storyAiSnapshot, testCaseAiSnapshot, text, list, object };
