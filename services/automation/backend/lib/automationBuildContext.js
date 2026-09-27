const db = require("@hellotest/platform/backend/src/db");
const { getOptionalEvidenceAccess } = require("@hellotest/platform/backend/services/optionalEvidenceAccess.service");

async function loadAutomationStoryContext({ caseId, projectId, userId }) {
  if (!userId || !projectId || !(await getOptionalEvidenceAccess({ id: userId }, projectId, ["requirement.view"]))["requirement.view"]) return { stories: [], related_stories: [] };
  const stories = await db.prepare(`
    SELECT DISTINCT r.id, r.display_id, r.title, r.description, r.additional_fields, r.status,
      r.gherkin_scenarios, r.specification_format, r.specification_content, r.external_references
    FROM requirements r
    JOIN requirement_test_cases link ON link.requirement_id = r.id
    WHERE (link.test_case_id = ? OR link.test_case_id IN (SELECT manual_test_case_id FROM automation_case_links WHERE automation_test_case_id = ?)) AND r.project_id = ?
    ORDER BY r.id LIMIT 30
  `).all(caseId, caseId, projectId);
  const related = stories.length ? await db.prepare(`
    SELECT DISTINCT r.id, r.display_id, r.title, r.description, r.additional_fields, r.status,
      r.gherkin_scenarios, r.specification_format, r.specification_content, r.external_references
    FROM requirement_relations rel
    JOIN requirements r ON r.id = rel.related_requirement_id OR r.id = rel.requirement_id
    WHERE r.project_id = ? AND (
      (rel.requirement_id IN (${stories.map(() => '?').join(',')}) AND r.id = rel.related_requirement_id)
      OR (rel.related_requirement_id IN (${stories.map(() => '?').join(',')}) AND r.id = rel.requirement_id)
    ) ORDER BY r.id LIMIT 30
  `).all(projectId, ...stories.map((story) => story.id), ...stories.map((story) => story.id)) : [];
  const bounded = (rows) => rows.map(({ additional_fields, ...row }) => {
    let fields = additional_fields;
    if (typeof fields === "string") { try { fields = JSON.parse(fields); } catch { fields = {}; } }
    return {
      ...row,
      description: String(row.description || '').slice(0, 4000),
      acceptance_criteria: JSON.stringify(fields?.acceptance_criteria || []).slice(0, 4000),
      gherkin_scenarios: JSON.stringify(row.gherkin_scenarios || []).slice(0, 8000),
      specification_content: String(row.specification_content || '').slice(0, 8000),
      external_references: JSON.stringify(row.external_references || []).slice(0, 2000)
    };
  });
  return { stories: bounded(stories), related_stories: bounded(related.filter((row) => !stories.some((story) => story.id === row.id))) };
}
module.exports = { loadAutomationStoryContext };
