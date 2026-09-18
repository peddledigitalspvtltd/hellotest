const db = require("../db");
const { normalizeReferenceList } = require("../utils/externalReferences");
const testCaseScopes = require("./testCaseScope.service");

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
  const uniqueIds = normalizeReferenceList(issueIds);
  const transaction = db.transaction(async () => {
    const testCase = await db.prepare("SELECT id FROM test_cases WHERE id = ? FOR UPDATE").get(testCaseId);
    if (!testCase) throw Object.assign(new Error("Test Case not found"), { statusCode: 404 });
    const [scope] = await testCaseScopes.resolveTestCaseScopes([testCaseId]);
    if (!scope || scope.project_ids.length !== 1) {
      throw Object.assign(new Error("The Test Case does not have a single project scope"), { statusCode: 409 });
    }
    const encodedIds = JSON.stringify(uniqueIds);
    if (uniqueIds.length) {
      const issues = await db.prepare(`
        SELECT id, project_id FROM feedback
        WHERE id IN (SELECT value FROM jsonb_array_elements_text(?::jsonb)) ORDER BY id FOR SHARE
      `).all(encodedIds);
      const issuesById = new Map(issues.map((row) => [row.id, row]));
      for (const issueId of uniqueIds) {
        const issue = issuesById.get(issueId);
        if (!issue) throw Object.assign(new Error(`Issue not found: ${issueId}`), { statusCode: 404 });
        if (issue.project_id !== scope.project_ids[0]) {
          throw Object.assign(new Error("Test Case and Bug must belong to the same project"), { statusCode: 403 });
        }
      }
    }
    await deleteForTestCase.run(testCaseId);
    if (uniqueIds.length) {
      await db.prepare(`
        INSERT INTO test_case_defects (test_case_id, issue_id, link_source)
        SELECT ?, value, 'manual' FROM jsonb_array_elements_text(?::jsonb)
        ON CONFLICT (test_case_id, issue_id) DO UPDATE SET link_source = EXCLUDED.link_source
      `).run(testCaseId, encodedIds);
    }
  });
  await transaction();
  return { updated: true, mapped: uniqueIds.length };
};

exports.syncAutomaticDefectsForTestCase = async (testCaseId, defectRefs = []) => {
  if (!testCaseId) {
    return { linked: 0 };
  }

  // Always reconcile from persisted result evidence so unlinking the last
  // occurrence removes stale automatic traceability while manual links remain.
  const evidence = await db.prepare(`
    SELECT DISTINCT feedback.id
    FROM execution_results
    CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(execution_results.defects, '[]'::jsonb)) AS defect_ref(value)
    JOIN feedback ON feedback.id = defect_ref.value
    WHERE execution_results.test_case_id = ?
    ORDER BY feedback.id
  `).all(testCaseId);
  const issueIds = evidence.map((row) => row.id);

  const transaction = db.transaction(async () => {
    if (issueIds.length) {
      await db.prepare(`
        DELETE FROM test_case_defects
        WHERE test_case_id = ? AND link_source = 'automatic'
          AND issue_id NOT IN (${issueIds.map(() => "?").join(",")})
      `).run(testCaseId, ...issueIds);
    } else {
      await db.prepare(`DELETE FROM test_case_defects WHERE test_case_id = ? AND link_source = 'automatic'`).run(testCaseId);
    }

    const result = issueIds.length ? await db.prepare(`
      INSERT INTO test_case_defects (test_case_id, issue_id, link_source)
      SELECT ?, value, 'automatic' FROM jsonb_array_elements_text(?::jsonb)
      ON CONFLICT (test_case_id, issue_id) DO NOTHING
    `).run(testCaseId, JSON.stringify(issueIds)) : null;
    const linked = result?.changes || 0;
    return { linked, retained: issueIds.length };
  });

  return transaction();
};
