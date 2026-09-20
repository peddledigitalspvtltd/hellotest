const db = require('../db');
const { normalizeReferenceList } = require('../utils/externalReferences');
const testCaseScopes = require('./testCaseScope.service');

const error = (message, statusCode) => Object.assign(new Error(message), { statusCode });

// The caller owns the Bug and audit transaction. Keep scope validation and both
// directions of manual traceability in that transaction, with no per-link SQL.
exports.replaceManualLinks = async ({ issueId, projectId, testCaseIds = [], requirementIds = [] }) => {
  const cases = normalizeReferenceList(testCaseIds);
  const stories = normalizeReferenceList(requirementIds);
  const caseScopes = new Map((await testCaseScopes.resolveTestCaseScopes(cases)).map(row => [row.id, row]));
  for (const id of cases) {
    const scope = caseScopes.get(id);
    if (!scope) throw error(`Test Case not found: ${id}`, 404);
    if (scope.project_ids.length !== 1) throw error('The Test Case does not have a single project scope', 409);
    if (scope.project_ids[0] !== projectId) throw error('Defect and Test Case must belong to the same project', 403);
  }
  const storyScopes = stories.length ? await db.prepare(`
    SELECT id, project_id FROM requirements
    WHERE id IN (SELECT value FROM jsonb_array_elements_text(?::jsonb))
  `).all(JSON.stringify(stories)) : [];
  const storiesById = new Map(storyScopes.map(row => [row.id, row]));
  for (const id of stories) {
    const story = storiesById.get(id);
    if (!story) throw error(`Story not found: ${id}`, 404);
    if (story.project_id !== projectId) throw error('Defect and Story must belong to the same project', 403);
  }

  await db.prepare("DELETE FROM test_case_defects WHERE issue_id = ? AND link_source = 'manual'").run(issueId);
  await db.prepare("DELETE FROM requirement_defects WHERE issue_id = ? AND link_source = 'manual'").run(issueId);
  if (cases.length) await db.prepare(`
    INSERT INTO test_case_defects (test_case_id, issue_id, link_source)
    SELECT value, ?, 'manual' FROM jsonb_array_elements_text(?::jsonb)
    ON CONFLICT (test_case_id, issue_id) DO UPDATE SET link_source = 'manual'
  `).run(issueId, JSON.stringify(cases));
  if (stories.length) await db.prepare(`
    INSERT INTO requirement_defects (requirement_id, issue_id, link_source)
    SELECT value, ?, 'manual' FROM jsonb_array_elements_text(?::jsonb)
    ON CONFLICT (requirement_id, issue_id) DO UPDATE SET link_source = 'manual'
  `).run(issueId, JSON.stringify(stories));
};
