const db = require("../db");
const { normalizeReferenceList } = require("../utils/externalReferences");

const listForRequirement = db.prepare(`
  SELECT issue_id
  FROM requirement_defects
  WHERE requirement_id = ?
  ORDER BY issue_id ASC
`);

const deleteForRequirement = db.prepare(`
  DELETE FROM requirement_defects
  WHERE requirement_id = ?
`);

const insertMapping = db.prepare(`
  INSERT INTO requirement_defects (requirement_id, issue_id, link_source)
  VALUES (?, ?, ?)
  ON CONFLICT (requirement_id, issue_id) DO UPDATE
  SET link_source = EXCLUDED.link_source
`);

const insertAutomaticMapping = db.prepare(`
  INSERT INTO requirement_defects (requirement_id, issue_id, link_source)
  VALUES (?, ?, 'automatic')
  ON CONFLICT (requirement_id, issue_id) DO NOTHING
`);

const selectIssue = db.prepare(`
  SELECT id
  FROM feedback
  WHERE id = ?
`);

exports.getDefectIdsForRequirement = async (requirementId) => {
  return (await listForRequirement.all(requirementId)).map((row) => row.issue_id);
};

exports.getDefectsForRequirement = async (requirementId) => {
  return db.prepare(`
    SELECT feedback.id, feedback.title, feedback.status, feedback.created_at, requirement_defects.link_source
    FROM requirement_defects
    JOIN feedback ON feedback.id = requirement_defects.issue_id
    WHERE requirement_defects.requirement_id = ?
    ORDER BY feedback.created_at DESC, feedback.title ASC
  `).all(requirementId);
};

exports.listMappings = async ({ requirement_id, issue_id }) => {
  let query = `
    SELECT requirement_id, issue_id, link_source, created_at
    FROM requirement_defects
    WHERE 1 = 1
  `;
  const params = [];

  if (requirement_id) {
    query += ` AND requirement_id = ?`;
    params.push(requirement_id);
  }

  if (issue_id) {
    query += ` AND issue_id = ?`;
    params.push(issue_id);
  }

  query += ` ORDER BY requirement_id ASC, issue_id ASC`;

  return db.prepare(query).all(...params);
};

exports.replaceMappingsForRequirement = async (requirementId, issueIds = []) => {
  const requirement = await db.prepare(`
    SELECT id
    FROM requirements
    WHERE id = ?
  `).get(requirementId);

  if (!requirement) {
    throw new Error("Requirement not found");
  }

  const uniqueIds = normalizeReferenceList(issueIds);

  for (const issueId of uniqueIds) {
    const issue = await selectIssue.get(issueId);

    if (!issue) {
      throw new Error(`Issue not found: ${issueId}`);
    }
  }

  const transaction = db.transaction(async () => {
    await deleteForRequirement.run(requirementId);

    for (const issueId of uniqueIds) {
      await insertMapping.run(requirementId, issueId, "manual");
    }
  });

  await transaction();

  return { updated: true, mapped: uniqueIds.length };
};

exports.syncAutomaticDefectsForTestCase = async (testCaseId, defectRefs = []) => {
  if (!testCaseId) {
    return { linked: 0 };
  }

  const requirementRows = await db.prepare(`
    SELECT requirement_id
    FROM requirement_test_cases
    WHERE test_case_id = ?
    UNION
    SELECT requirement_id
    FROM test_cases
    WHERE id = ? AND requirement_id IS NOT NULL
  `).all(testCaseId, testCaseId);
  const requirementIds = [...new Set(requirementRows.map((row) => row.requirement_id).filter(Boolean))];
  let linked = 0;

  for (const requirementId of requirementIds) {
    const result = await exports.syncAutomaticDefectsForRequirement(requirementId);
    linked += result.linked || 0;
  }

  return { linked };
};

exports.syncAutomaticDefectsForRequirement = async (requirementId) => {
  if (!requirementId) {
    return { linked: 0 };
  }

  const evidence = await db.prepare(`
    SELECT DISTINCT derived.issue_id
    FROM (
      SELECT requirement_test_cases.requirement_id, feedback.id AS issue_id
      FROM requirement_test_cases
      JOIN execution_results ON execution_results.test_case_id = requirement_test_cases.test_case_id
      CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(execution_results.defects, '[]'::jsonb)) AS defect_ref(value)
      JOIN feedback ON feedback.id = defect_ref.value
      WHERE requirement_test_cases.requirement_id = ?
      UNION
      SELECT test_cases.requirement_id, feedback.id AS issue_id
      FROM test_cases
      JOIN execution_results ON execution_results.test_case_id = test_cases.id
      CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(execution_results.defects, '[]'::jsonb)) AS defect_ref(value)
      JOIN feedback ON feedback.id = defect_ref.value
      WHERE test_cases.requirement_id = ?
    ) AS derived
    ORDER BY derived.issue_id
  `).all(requirementId, requirementId);
  const issueIds = evidence.map((row) => row.issue_id);

  const transaction = db.transaction(async () => {
    if (issueIds.length) {
      await db.prepare(`
        DELETE FROM requirement_defects
        WHERE requirement_id = ? AND link_source = 'automatic'
          AND issue_id NOT IN (${issueIds.map(() => "?").join(",")})
      `).run(requirementId, ...issueIds);
    } else {
      await db.prepare(`DELETE FROM requirement_defects WHERE requirement_id = ? AND link_source = 'automatic'`).run(requirementId);
    }

    let linked = 0;
    for (const issueId of issueIds) {
      const result = await insertAutomaticMapping.run(requirementId, issueId);
      linked += result.changes || 0;
    }
    return { linked, retained: issueIds.length };
  });

  return transaction();
};
