const db = require("../db");
const { normalizeReferenceList } = require("../utils/externalReferences");

const listForTestCase = db.prepare(`
  SELECT issue_id
  FROM test_case_defects
  WHERE test_case_id = ?
  ORDER BY issue_id ASC
`);

const deleteForTestCase = db.prepare(`
  DELETE FROM test_case_defects
  WHERE test_case_id = ?
`);

const insertMapping = db.prepare(`
  INSERT INTO test_case_defects (test_case_id, issue_id, link_source)
  VALUES (?, ?, ?)
  ON CONFLICT (test_case_id, issue_id) DO UPDATE
  SET link_source = EXCLUDED.link_source
`);

const insertAutomaticMapping = db.prepare(`
  INSERT INTO test_case_defects (test_case_id, issue_id, link_source)
  VALUES (?, ?, 'automatic')
  ON CONFLICT (test_case_id, issue_id) DO NOTHING
`);

const selectIssue = db.prepare(`
  SELECT id
  FROM feedback
  WHERE id = ?
`);

exports.getDefectIdsForTestCase = async (testCaseId) => {
  return (await listForTestCase.all(testCaseId)).map((row) => row.issue_id);
};

exports.getDefectsForTestCase = async (testCaseId) => {
  return db.prepare(`
    SELECT feedback.id, feedback.title, feedback.status, feedback.created_at, test_case_defects.link_source
    FROM test_case_defects
    JOIN feedback ON feedback.id = test_case_defects.issue_id
    WHERE test_case_defects.test_case_id = ?
    ORDER BY feedback.created_at DESC, feedback.title ASC
  `).all(testCaseId);
};

exports.listMappings = async ({ test_case_id, issue_id }) => {
  let query = `
    SELECT test_case_id, issue_id, link_source, created_at
    FROM test_case_defects
    WHERE 1 = 1
  `;
  const params = [];

  if (test_case_id) {
    query += ` AND test_case_id = ?`;
    params.push(test_case_id);
  }

  if (issue_id) {
    query += ` AND issue_id = ?`;
    params.push(issue_id);
  }

  query += ` ORDER BY test_case_id ASC, issue_id ASC`;

  return db.prepare(query).all(...params);
};

exports.replaceMappingsForTestCase = async (testCaseId, issueIds = []) => {
  const testCase = await db.prepare(`
    SELECT id
    FROM test_cases
    WHERE id = ?
  `).get(testCaseId);

  if (!testCase) {
    throw new Error("Test case not found");
  }

  const uniqueIds = normalizeReferenceList(issueIds);

  for (const issueId of uniqueIds) {
    const issue = await selectIssue.get(issueId);

    if (!issue) {
      throw new Error(`Issue not found: ${issueId}`);
    }
  }

  const transaction = db.transaction(async () => {
    await deleteForTestCase.run(testCaseId);

    for (const issueId of uniqueIds) {
      await insertMapping.run(testCaseId, issueId, "manual");
    }
  });

  await transaction();

  return { updated: true, mapped: uniqueIds.length };
};

exports.syncAutomaticDefectsForTestCase = async (testCaseId, defectRefs = []) => {
  if (!testCaseId) {
    return { linked: 0 };
  }

  let issueIds = normalizeReferenceList(defectRefs);

  if (!issueIds.length) {
    const rows = await db.prepare(`
      SELECT defects
      FROM execution_results
      WHERE test_case_id = ?
    `).all(testCaseId);

    issueIds = normalizeReferenceList(rows.flatMap((row) => normalizeReferenceList(row.defects)));
  }

  if (!issueIds.length) {
    return { linked: 0 };
  }

  let linked = 0;

  for (const issueId of issueIds) {
    const issue = await selectIssue.get(issueId);

    if (!issue) {
      continue;
    }

    const result = await insertAutomaticMapping.run(testCaseId, issue.id);
    linked += result.changes || 0;
  }

  return { linked };
};
