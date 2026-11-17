"use strict";

// Canonical serializers for native application records. Text and typed relationship
// metadata are produced together so graph projection never reparses UI labels.
module.exports = ({ db, asArray, asObject, normalizeId, normalizeText, sanitizeExternalReferences, knowledgeAuthorization, LINK_FIELDS, LINK_LABELS, linkLine }) => {
const compactJson = (value, maxLength = 2_000) => {
  try {
    return JSON.stringify(value ?? null).slice(0, maxLength);
  } catch {
    return "";
  }
};

const relationshipRecords = (sourceKind, metadata = {}) => (LINK_FIELDS[sourceKind] || []).flatMap((spec) => {
  const raw = metadata[spec.field];
  const values = typeof raw === "string" ? [raw] : asArray(raw);
  return [...new Set(values.map(normalizeId).filter(Boolean))].map((ref_id) => ({
    field: spec.field, kind: spec.kind, ref_id, type: spec.type, reverse: Boolean(spec.reverse), label: spec.label
  }));
});

const buildRelationshipChunks = (source, startIndex = 0) => {
  const records = relationshipRecords(source?.source_kind, source?.metadata);
  const pages = [];
  let page = [], pageChars = 0;
  const flush = () => {
    if (!page.length) return;
    const lines = [], linkRecords = [];
    let offset = 0;
    for (const record of page) {
      const line = linkLine(record.label, record.ref_id);
      lines.push(line);
      linkRecords.push({ ...record, span_start: offset, span_end: offset + Array.from(line).length });
      offset += Array.from(line).length + 1;
    }
    const content = lines.join("\n");
    pages.push({ index: startIndex + pages.length, heading: `Relationship index: ${page[0].label}`,
      heading_path: ["Relationship index", page[0].label], section_type: "relationship", section_level: 2,
      content, token_count: Math.ceil(content.length / 4), char_start: 0, char_end: content.length,
      relationship_records: linkRecords });
    page = [];
    pageChars = 0;
  };
  for (const record of records) {
    const lineChars = Array.from(record.label).length + Array.from(record.ref_id).length + 2;
    if (page.length && (page[0].field !== record.field || pageChars + lineChars + 1 > 1_200)) flush();
    page.push(record);
    pageChars += lineChars + (page.length > 1 ? 1 : 0);
  }
  flush();
  return pages;
};

const stripRelationshipLines = (content, source) => {
  const expected = new Set(relationshipRecords(source?.source_kind, source?.metadata)
    .map(record => linkLine(record.label, record.ref_id)));
  if (!expected.size) return content;
  return String(content).split("\n").filter(line => !expected.has(line.trim())).join("\n");
};

const serializeRequirement = (row, linkedTestCaseIds = [], totalLinkedTestCases = linkedTestCaseIds.length) => ({
  source_kind: "requirement",
  source_ref_id: row.id,
  app_type_id: null,
  title: row.title || row.display_id || row.id,
  content: [
    `Story ${row.display_id || row.id}: ${row.title}`,
    `Status: ${row.status || "not recorded"}`,
    `Priority: ${row.priority ?? "not recorded"}`,
    row.release ? `Release: ${row.release}` : "",
    row.sprint ? `Sprint: ${row.sprint}` : "",
    row.description || "",
    asArray(row.acceptance_criteria).length ? `Acceptance criteria:\n${asArray(row.acceptance_criteria).map((criterion, index) => `${index + 1}. ${criterion}`).join("\n")}` : "",
    row.specification_content || "",
    asArray(row.gherkin_scenarios).length ? compactJson(row.gherkin_scenarios, 8_000) : "",
    asArray(row.labels).length ? `Labels: ${compactJson(row.labels, 1_000)}` : "",
    sanitizeExternalReferences(row.external_references).length ? `External references: ${compactJson(sanitizeExternalReferences(row.external_references), 2_000)}` : "",
    ...linkedTestCaseIds.map(id => linkLine(LINK_LABELS.linkedTestCaseIds, id)),
    ...asArray(row.release_ids).map(id => linkLine(LINK_LABELS.releaseIds, id)),
    ...asArray(row.sprint_ids).map(id => linkLine(LINK_LABELS.sprintIds, id)),
    totalLinkedTestCases > linkedTestCaseIds.length ? `Relationship index is incomplete: loaded ${linkedTestCaseIds.length} of ${totalLinkedTestCases} linked Test Cases. Retrieve the current Story through MCP before assessing complete coverage.` : ""
  ].filter(Boolean).join("\n\n"),
  metadata: {
    display_id: row.display_id,
    status: row.status,
    priority: row.priority,
    linked_test_case_ids: linkedTestCaseIds,
    linked_test_case_count: totalLinkedTestCases,
    indexed_linked_test_case_count: linkedTestCaseIds.length,
    linked_test_cases_truncated: totalLinkedTestCases > linkedTestCaseIds.length,
    release_ids: asArray(row.release_ids), release_count: asArray(row.release_ids).length,
    sprint_ids: asArray(row.sprint_ids), sprint_count: asArray(row.sprint_ids).length,
    source_updated_at: row.updated_at || row.created_at
  }
});

const serializeTestCase = async (row) => {
  const steps = await db.prepare(`
    SELECT step_order, action, expected_result, step_type, COUNT(*) OVER() AS total_step_count
    FROM test_steps WHERE test_case_id = ? ORDER BY step_order ASC
  `).all(row.id);
  const [requirementLinks, modules] = await Promise.all([
    db.prepare(`
      SELECT requirement_id, COUNT(*) OVER() AS total_link_count FROM (
        SELECT requirement_id FROM requirement_test_cases WHERE test_case_id = ?
        UNION SELECT ?::TEXT WHERE ?::TEXT IS NOT NULL
      ) linked_requirements ORDER BY requirement_id
    `).all(row.id, normalizeId(row.requirement_id) || null, normalizeId(row.requirement_id) || null),
    db.prepare(`
      SELECT modules.id, modules.name
      FROM test_case_module_cases links
      JOIN test_case_modules modules ON modules.id = links.module_id
      WHERE links.test_case_id = ? ORDER BY links.sort_order, modules.id
    `).all(row.id)
  ]);
  const requirementIds = [...new Set([
    normalizeId(row.requirement_id),
    ...requirementLinks.map((link) => normalizeId(link.requirement_id))
  ].filter(Boolean))];
  const totalRequirementCount = Number(requirementLinks[0]?.total_link_count) || requirementIds.length;
  const totalStepCount = Number(steps[0]?.total_step_count) || steps.length;
  return {
    source_kind: "test_case",
    source_ref_id: row.id,
    app_type_id: row.app_type_id || null,
    title: row.title || row.display_id || row.id,
    content: [
      `Test Case ${row.display_id || row.id}: ${row.title}`,
      `Status: ${row.status || "not recorded"}`,
      `Priority: ${row.priority ?? "not recorded"}`,
      `Authoring mode: ${row.authoring_mode || "structured"}`,
      `Review status: ${row.review_status || "not_requested"}`,
      ...requirementIds.map(id => linkLine(LINK_LABELS.requirementIds, id)),
      totalRequirementCount > requirementIds.length ? `Indexed Test Case relationship window: first ${requirementIds.length} of ${totalRequirementCount} linked Stories. Retrieve the current Test Case through MCP before assessing complete coverage.` : "",
      row.suite_id ? linkLine(LINK_LABELS.suiteId, row.suite_id) : "",
      ...modules.map(module => linkLine(LINK_LABELS.moduleIds, module.id)),
      Object.keys(asObject(row.parameter_values)).length ? `Test parameter names: ${compactJson(Object.keys(row.parameter_values), 4_000)}. Values require live, permission-checked test-data retrieval.` : "",
      asArray(row.labels).length ? `Labels: ${compactJson(row.labels, 1_000)}` : "",
      sanitizeExternalReferences(row.external_references).length ? `External references: ${compactJson(sanitizeExternalReferences(row.external_references), 2_000)}` : "",
      row.description || "",
      row.gherkin_document || "",
      ...steps.map((step) => `Step ${step.step_order}: ${step.action || ""}\nExpected: ${step.expected_result || ""}\nType: ${step.step_type || "manual"}`),
      totalStepCount > steps.length ? `Indexed step window: first ${steps.length} of ${totalStepCount} steps. Retrieve the current Test Case through MCP before assessing the complete flow.` : ""
    ].filter(Boolean).join("\n\n"),
    metadata: {
      display_id: row.display_id,
      status: row.status,
      priority: row.priority,
      review_status: row.review_status,
      step_count: totalStepCount,
      indexed_step_count: steps.length,
      steps_truncated: totalStepCount > steps.length,
      requirement_ids: requirementIds,
      requirement_count: totalRequirementCount,
      indexed_requirement_count: requirementIds.length,
      requirements_truncated: totalRequirementCount > requirementIds.length,
      module_ids: modules.map((module) => module.id),
      module_count: modules.length,
      suite_id: row.suite_id || null,
      context_permission_profile: knowledgeAuthorization.APPLICATION_CONTEXT_PROFILE,
      source_updated_at: row.updated_at || row.created_at
    }
  };
};

const serializeExecution = async (row) => {
  // Run summaries are visible under run.view. Result logs, linked case contents
  // and execution snapshots belong to separate permissions and are fetched live
  // through MCP instead of being declassified by a persisted run passage.
  const countRows = await db.prepare(`
      SELECT COALESCE(status, 'unknown') AS status, COUNT(*)::INTEGER AS count
      FROM execution_results WHERE execution_id = ?
      GROUP BY COALESCE(status, 'unknown')
      ORDER BY COALESCE(status, 'unknown')
    `).all(row.id);
  const resultCounts = Object.fromEntries(countRows.map((entry) => [entry.status, Number(entry.count || 0)]));
  const failedOrBlockedTotal = Number(resultCounts.failed || 0) + Number(resultCounts.blocked || 0);
  return {
    source_kind: "execution",
    source_ref_id: row.id,
    app_type_id: row.app_type_id || null,
    title: row.name || `Test Run ${row.id}`,
    content: [
      `Test Run ${row.name || row.id}`,
      `Status: ${row.status || "not recorded"}`,
      `Trigger: ${row.trigger || "not recorded"}`,
      `Mode: ${row.execution_mode || "not recorded"}`,
      `Result summary: ${compactJson(resultCounts, 1_000)}`,
      row.release ? `Release: ${row.release}` : "",
      row.sprint ? `Sprint: ${row.sprint}` : "",
      row.build ? `Build: ${row.build}` : "",
      row.error_message ? `Recorded run error: ${normalizeText(row.error_message, 2_000)}` : "",
      "Failure details, result logs and execution snapshots require live, permission-checked context retrieval."
    ].filter(Boolean).join("\n"),
    metadata: {
      status: row.status,
      release: row.release,
      sprint: row.sprint,
      build: row.build,
      result_counts: resultCounts,
      failed_or_blocked_count: failedOrBlockedTotal,
      context_permission_profile: knowledgeAuthorization.APPLICATION_CONTEXT_PROFILE,
      source_updated_at: row.ended_at || row.started_at || row.created_at
    }
  };
};

const serializeBug = (row) => ({
  source_kind: "bug",
  source_ref_id: row.id,
  app_type_id: null,
  title: row.title || row.display_id || row.id,
  content: [
    `Defect ${row.display_id || row.id}: ${row.title}`,
    `Status: ${row.status || "not recorded"}`,
    `Severity: ${row.severity || "not recorded"}`,
    `Priority: ${row.priority || "not recorded"}`,
    row.environment ? `Environment: ${row.environment}` : "",
    row.build ? `Build: ${row.build}` : "",
    row.release ? `Release: ${row.release}` : "",
    row.sprint ? `Sprint: ${row.sprint}` : "",
    row.fix_version ? `Fix version: ${row.fix_version}` : "",
    row.linked_test_run_id ? linkLine(LINK_LABELS.linkedTestRunId, row.linked_test_run_id) : "",
    ...asArray(row.linked_requirement_ids).map(id => linkLine(LINK_LABELS.linkedStoryIds, id)),
    ...asArray(row.linked_test_case_ids).map(id => linkLine(LINK_LABELS.linkedTestCaseIds, id)),
    ...asArray(row.linked_test_suite_ids).map(id => linkLine(LINK_LABELS.linkedTestSuiteIds, id)),
    ...asArray(row.linked_module_ids).map(id => linkLine(LINK_LABELS.linkedModuleIds, id)),
    row.message || "",
    row.steps_to_reproduce ? `Steps to reproduce:\n${row.steps_to_reproduce}` : "",
    row.expected_result ? `Expected:\n${row.expected_result}` : "",
    row.actual_result ? `Actual:\n${row.actual_result}` : "",
    row.root_cause ? `Recorded root cause:\n${row.root_cause}` : ""
  ].filter(Boolean).join("\n\n"),
  metadata: {
    display_id: row.display_id,
    status: row.status,
    severity: row.severity,
    priority: row.priority,
    linked_test_run_id: row.linked_test_run_id || null,
    linked_requirement_ids: asArray(row.linked_requirement_ids),
    linked_test_case_ids: asArray(row.linked_test_case_ids),
    linked_test_suite_ids: asArray(row.linked_test_suite_ids),
    linked_module_ids: asArray(row.linked_module_ids),
    linked_requirement_count: asArray(row.linked_requirement_ids).length,
    linked_test_case_count: asArray(row.linked_test_case_ids).length,
    source_updated_at: row.updated_at || row.created_at
  }
});

const serializeTestSuite = (row, testCaseIds = []) => ({
  source_kind: "test_suite", source_ref_id: row.id, app_type_id: row.app_type_id,
  title: row.name || row.display_id || row.id,
  content: [`Test Suite ${row.display_id || row.id}: ${row.name}`, row.description || "",
    row.parent_id ? linkLine(LINK_LABELS.parentSuiteId, row.parent_id) : "",
    ...testCaseIds.map(id => linkLine(LINK_LABELS.testCaseIds, id))].filter(Boolean).join("\n\n"),
  metadata: { display_id: row.display_id, parent_suite_id: row.parent_id || null, test_case_ids: testCaseIds, test_case_count: Number(row.test_case_count) || testCaseIds.length,
    source_updated_at: row.updated_at || row.created_at }
});

const serializeTestModule = (row, testCaseIds = [], requirementIds = []) => ({
  source_kind: "test_module", source_ref_id: row.id, app_type_id: row.app_type_id,
  title: row.name || row.display_id || row.id,
  content: [`Test Module ${row.display_id || row.id}: ${row.name}`, row.description || "",
    ...testCaseIds.map(id => linkLine(LINK_LABELS.testCaseIds, id)),
    ...requirementIds.map(id => linkLine(LINK_LABELS.requirementIds, id))].filter(Boolean).join("\n\n"),
  metadata: { display_id: row.display_id, test_case_ids: testCaseIds, test_case_count: Number(row.test_case_count) || testCaseIds.length,
    requirement_ids: requirementIds, requirement_count: Number(row.requirement_count) || requirementIds.length,
    source_updated_at: row.updated_at || row.created_at }
});

const serializeRelease = (row, requirementIds = []) => {
  const sprintIds = asArray(row.sprint_ids).map(normalizeId).filter(Boolean);
  return { source_kind: "release", source_ref_id: row.id, app_type_id: null,
    title: row.name || row.display_id || row.fix_version || row.id,
    content: [`Release ${row.display_id || row.id}: ${row.name || row.fix_version}`, `State: ${row.state || "not recorded"}`,
      row.description || "", ...requirementIds.map(id => linkLine(LINK_LABELS.requirementIds, id)),
      ...sprintIds.map(id => linkLine(LINK_LABELS.sprintIds, id))].filter(Boolean).join("\n\n"),
    metadata: { display_id: row.display_id, state: row.state, fix_version: row.fix_version,
      requirement_ids: requirementIds, requirement_count: Number(row.requirement_count) || requirementIds.length,
      sprint_ids: sprintIds, sprint_count: sprintIds.length, source_updated_at: row.updated_at || row.created_at } };
};

const serializeSprint = (row, requirementIds = []) => ({
  source_kind: "sprint", source_ref_id: row.id, app_type_id: null,
  title: row.name || row.display_id || row.id,
  content: [`Sprint ${row.display_id || row.id}: ${row.name}`, `State: ${row.state || "not recorded"}`,
    row.goal || "", row.description || "", ...requirementIds.map(id => linkLine(LINK_LABELS.requirementIds, id))].filter(Boolean).join("\n\n"),
  metadata: { display_id: row.display_id, state: row.state, requirement_ids: requirementIds,
    requirement_count: Number(row.requirement_count) || requirementIds.length, source_updated_at: row.updated_at || row.created_at }
});

// Execution-result passages contain only the run/case relationship and status.
// Logs, datasets, screenshots and stored input/output remain behind their
// existing higher permissions and are never copied into Knowledge text.
const serializeExecutionResult = row => ({
  source_kind: "execution_result", source_ref_id: row.id, app_type_id: row.app_type_id || null,
  title: `Result ${row.id}`,
  content: `Executed Test Case ID: ${row.test_case_id} in ${linkLine(LINK_LABELS.executionId, row.execution_id)}; outcome: ${row.status || "unknown"}`,
  metadata: { test_case_id: row.test_case_id, execution_id: row.execution_id, status: row.status || "unknown",
    source_updated_at: row.updated_at || row.created_at }
});


return { compactJson, relationshipRecords, buildRelationshipChunks, stripRelationshipLines, serializeRequirement, serializeTestCase, serializeExecution, serializeBug, serializeTestSuite, serializeTestModule, serializeRelease, serializeSprint, serializeExecutionResult };
};
