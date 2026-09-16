const db = require("../db");
const { randomUUID: uuid } = require("crypto");
const { APP_TYPE_VALUES } = require("../domain/catalog");
const displayIdService = require("./displayId.service");
const attachmentService = require("./attachment.service");

const VALID_APP_TYPES = new Set(APP_TYPE_VALUES);

const selectRoleByName = db.prepare(`
  SELECT id
  FROM roles
  WHERE name = ?
`);

const selectAdminUsers = db.prepare(`
  SELECT DISTINCT users.id
  FROM users
  WHERE COALESCE(users.is_workspace_admin, FALSE) = TRUE
`);

const insertProjectMember = db.prepare(`
  INSERT INTO project_members (id, project_id, user_id, role_id)
  VALUES (?, ?, ?, ?)
  ON CONFLICT (project_id, user_id) DO NOTHING
`);

const insertAppType = db.prepare(`
  INSERT INTO app_types (id, project_id, name, type, is_unified)
  VALUES (?, ?, ?, ?, ?)
`);

const selectUserById = db.prepare(`
  SELECT id, is_workspace_admin
  FROM users
  WHERE id = ?
`);

const selectProjectForDeletion = db.prepare(`
  SELECT id FROM projects WHERE id = ? FOR UPDATE
`);

// Execution activity lives in the same database as project records. Use the
// same adapter so a later constraint failure also rolls this cleanup back.
const deleteProjectTransactionEvents = db.prepare(`
  DELETE FROM workspace_transaction_events
  WHERE transaction_id IN (
    SELECT id
    FROM workspace_transactions
    WHERE project_id = ?
  )
`);

const deleteProjectExecutionResults = db.prepare(`
  DELETE FROM execution_results
  WHERE execution_id IN (
      SELECT id
      FROM executions
      WHERE project_id = ?
    )
    OR app_type_id IN (
      SELECT id
      FROM app_types
      WHERE project_id = ?
    )
`);

const deleteProjectExecutionStepSnapshots = db.prepare(`
  DELETE FROM execution_step_snapshots
  WHERE execution_id IN (
    SELECT id
    FROM executions
    WHERE project_id = ?
  )
`);

const deleteProjectExecutionCaseSnapshots = db.prepare(`
  DELETE FROM execution_case_snapshots
  WHERE execution_id IN (
    SELECT id
    FROM executions
    WHERE project_id = ?
  )
`);

const deleteProjectExecutionSuites = db.prepare(`
  DELETE FROM execution_suites
  WHERE execution_id IN (
    SELECT id
    FROM executions
    WHERE project_id = ?
  )
`);

const deleteProjectExecutions = db.prepare(`
  DELETE FROM executions
  WHERE project_id = ?
`);

const deleteProjectExecutionSchedules = db.prepare(`
  DELETE FROM execution_schedules
  WHERE project_id = ?
`);

const deleteProjectTestSteps = db.prepare(`
  DELETE FROM test_steps
  WHERE test_case_id IN (
    SELECT test_cases.id
    FROM test_cases
    JOIN app_types ON app_types.id = test_cases.app_type_id
    WHERE app_types.project_id = ?
  )
`);

const deleteProjectSuiteMappings = db.prepare(`
  DELETE FROM suite_test_cases
  WHERE suite_id IN (
      SELECT test_suites.id
      FROM test_suites
      JOIN app_types ON app_types.id = test_suites.app_type_id
      WHERE app_types.project_id = ?
    )
    OR test_case_id IN (
      SELECT test_cases.id
      FROM test_cases
      JOIN app_types ON app_types.id = test_cases.app_type_id
      WHERE app_types.project_id = ?
    )
`);

const deleteProjectRequirementMappings = db.prepare(`
  DELETE FROM requirement_test_cases
  WHERE requirement_id IN (
      SELECT id
      FROM requirements
      WHERE project_id = ?
    )
    OR test_case_id IN (
      SELECT test_cases.id
      FROM test_cases
      JOIN app_types ON app_types.id = test_cases.app_type_id
      WHERE app_types.project_id = ?
    )
`);

const clearLegacyProjectCaseSuiteIds = db.prepare(`
  UPDATE test_cases
  SET suite_id = NULL
  WHERE app_type_id IN (
    SELECT id
    FROM app_types
    WHERE project_id = ?
  )
`);

const deleteProjectTestCases = db.prepare(`
  DELETE FROM test_cases
  WHERE app_type_id IN (
    SELECT id
    FROM app_types
    WHERE project_id = ?
  )
`);

const deleteProjectTestSuites = db.prepare(`
  DELETE FROM test_suites
  WHERE app_type_id IN (
    SELECT id
    FROM app_types
    WHERE project_id = ?
  )
`);

const deleteProjectRequirements = db.prepare(`
  DELETE FROM requirements
  WHERE project_id = ?
`);

const deleteProjectSharedStepGroups = db.prepare(`
  DELETE FROM shared_step_groups
  WHERE app_type_id IN (
    SELECT id
    FROM app_types
    WHERE project_id = ?
  )
`);

const deleteProjectTestEnvironments = db.prepare(`
  DELETE FROM test_environments
  WHERE project_id = ?
`);

const deleteProjectTestConfigurations = db.prepare(`
  DELETE FROM test_configurations
  WHERE project_id = ?
`);

const deleteProjectTestDataSets = db.prepare(`
  DELETE FROM test_data_sets
  WHERE project_id = ?
`);

const deleteProjectAiGenerationJobs = db.prepare(`
  DELETE FROM ai_test_case_generation_jobs
  WHERE project_id = ?
`);

const deleteProjectKnowledge = db.prepare(`
  DELETE FROM ai_knowledge_repo WHERE project_id = ?
`);

const deleteProjectPromptTemplates = db.prepare(`
  DELETE FROM ai_prompt_templates WHERE project_id = ?
`);

const deleteProjectWorkflowRuns = db.prepare(`
  DELETE FROM agentic_workflow_runs WHERE project_id = ?
`);

const deleteProjectWorkflows = db.prepare(`
  DELETE FROM agentic_workflows WHERE project_id = ?
`);

const deleteProjectAutomationJobs = db.prepare(`
  DELETE FROM automation_generator_jobs
  WHERE project_id = ?
    OR (project_id IS NULL AND (
      transaction_id IN (SELECT id FROM workspace_transactions WHERE project_id = ?)
      OR app_type_id IN (SELECT id FROM app_types WHERE project_id = ?)
      OR test_case_id IN (
        SELECT test_cases.id FROM test_cases
        JOIN app_types ON app_types.id = test_cases.app_type_id
        WHERE app_types.project_id = ?
      )
    ))
`);

const clearDeletedProjectIntegrationScope = db.prepare(`
  UPDATE integrations
  SET
    config = CASE
      WHEN config->>'project_id' = ? THEN config - 'project_id'
      ELSE config
    END,
    project_key = CASE
      WHEN project_key = ? THEN NULL
      ELSE project_key
    END,
    updated_at = CURRENT_TIMESTAMP
  WHERE config->>'project_id' = ?
     OR project_key = ?
`);

const deleteProjectWorkspaceTransactions = db.prepare(`
  DELETE FROM workspace_transactions
  WHERE project_id = ?
`);

const deleteProjectAppTypes = db.prepare(`
  DELETE FROM app_types
  WHERE project_id = ?
`);

const deleteProjectMembers = db.prepare(`
  DELETE FROM project_members
  WHERE project_id = ?
`);

const deleteProjectRecord = db.prepare(`
  DELETE FROM projects
  WHERE id = ?
`);

exports.createProject = async ({ name, description, visibility, created_by, members, member_ids, app_types }) => {
  if (!name || !created_by) throw new Error("Missing fields");

  const normalizedName = String(name).trim();
  if (!normalizedName) throw new Error("Project name is required");
  const normalizedVisibility = visibility === "public" ? "public" : "private";

  const id = uuid();
  const display_id = await displayIdService.createDisplayId("project");

  const user = await selectUserById.get(created_by);
  if (!user) throw new Error("Invalid user");

  const requestedMemberIds = Array.isArray(members)
    ? members.map((member) => member?.user_id)
    : member_ids;
  const normalizedMemberIds = normalizedVisibility === "public" && Array.isArray(requestedMemberIds)
    ? [...new Set(requestedMemberIds.map((value) => String(value || "").trim()).filter(Boolean))]
    : [];
  const normalizedAppTypes = Array.isArray(app_types)
    ? app_types
        .map((item = {}) => ({
          name: String(item.name || "").trim(),
          type: String(item.type || "").trim(),
          is_unified: Boolean(item.is_unified)
        }))
        .filter((item) => item.name || item.type)
    : [];

  const adminRole = await selectRoleByName.get("admin");
  const memberRole = await selectRoleByName.get("member");
  const creatorRoleId = user.is_workspace_admin ? (adminRole?.id || memberRole?.id) : (memberRole?.id || adminRole?.id);
  const selectedMemberRoleId = memberRole?.id || adminRole?.id;

  if (!creatorRoleId || !selectedMemberRoleId) {
    throw new Error("No project roles are configured");
  }

  if (!normalizedAppTypes.length) {
    throw new Error("At least one app type is required");
  }

  normalizedAppTypes.forEach((appType, index) => {
    if (!appType.name) {
      throw new Error(`App type ${index + 1} is missing a name`);
    }

    if (!VALID_APP_TYPES.has(appType.type)) {
      throw new Error(`App type ${index + 1} has an invalid type`);
    }
  });

  for (const memberId of normalizedMemberIds) {
    const memberUser = await selectUserById.get(memberId);

    if (!memberUser) {
      throw new Error("One of the selected members no longer exists");
    }
  }

  const adminUsers = normalizedVisibility === "public" ? await selectAdminUsers.all() : [];
  const memberships = new Map();

  for (const adminUser of adminUsers) {
    memberships.set(adminUser.id, adminRole?.id || creatorRoleId);
  }

  memberships.set(created_by, creatorRoleId);

  for (const memberId of normalizedMemberIds) {
    if (!memberships.has(memberId)) {
      memberships.set(memberId, selectedMemberRoleId);
    }
  }

  const createProjectWithMemberships = db.transaction(async () => {
    await db.prepare(`
      INSERT INTO projects (id, display_id, name, description, visibility, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, display_id, normalizedName, description || null, normalizedVisibility, created_by);

    for (const [userId, roleId] of memberships.entries()) {
      await insertProjectMember.run(uuid(), id, userId, roleId);
    }

    for (const appType of normalizedAppTypes) {
      await insertAppType.run(uuid(), id, appType.name, appType.type, Boolean(appType.is_unified));
    }
  });

  await createProjectWithMemberships();

  return {
    id,
    display_id,
    name: normalizedName,
    description: description || null,
    visibility: normalizedVisibility,
    created_by,
    members_added: memberships.size,
    app_types_created: normalizedAppTypes.length
  };
};

exports.getProjectCatalog = async (userId) => {
  if (!userId) throw new Error("User is required");

  return db.prepare(`
    WITH catalog AS (
      SELECT
        p.*,
        EXISTS (
          SELECT 1
          FROM project_members pm
          WHERE pm.project_id = p.id
            AND pm.user_id = ?
        ) AS has_access,
        EXISTS (
          SELECT 1
          FROM project_favorites pf
          WHERE pf.project_id = p.id
            AND pf.user_id = ?
        ) AS is_favorite
      FROM projects p
    )
    SELECT
      catalog.id,
      catalog.display_id,
      catalog.name,
      CASE WHEN catalog.has_access THEN catalog.description ELSE NULL END AS description,
      catalog.visibility,
      CASE WHEN catalog.has_access THEN catalog.created_by ELSE NULL END AS created_by,
      catalog.created_at,
      catalog.has_access,
      catalog.is_favorite,
      CASE WHEN catalog.has_access THEN
        (SELECT COUNT(*)::INTEGER FROM requirements WHERE requirements.project_id = catalog.id)
      ELSE NULL END AS story_count,
      CASE WHEN catalog.has_access THEN (
        SELECT COUNT(*)::INTEGER
        FROM test_case_modules
        JOIN app_types ON app_types.id = test_case_modules.app_type_id
        WHERE app_types.project_id = catalog.id
      ) ELSE NULL END AS module_count,
      CASE WHEN catalog.has_access THEN (
        SELECT COUNT(*)::INTEGER
        FROM test_cases
        JOIN app_types ON app_types.id = test_cases.app_type_id
        WHERE app_types.project_id = catalog.id
      ) ELSE NULL END AS case_count,
      CASE WHEN catalog.has_access THEN
        (SELECT COUNT(*)::INTEGER FROM feedback WHERE feedback.project_id = catalog.id)
      ELSE NULL END AS bug_count
    FROM catalog
    ORDER BY catalog.created_at DESC
  `).all(userId, userId);
};

exports.favoriteProject = async (projectId, userId) => {
  await exports.getProject(projectId);
  await db.prepare(`
    INSERT INTO project_favorites (project_id, user_id)
    VALUES (?, ?)
    ON CONFLICT (project_id, user_id) DO NOTHING
  `).run(projectId, userId);
  return { updated: true, is_favorite: true };
};

exports.unfavoriteProject = async (projectId, userId) => {
  await db.prepare(`
    DELETE FROM project_favorites
    WHERE project_id = ? AND user_id = ?
  `).run(projectId, userId);
  return { updated: true, is_favorite: false };
};

// Get projects filtered by user membership
exports.getProjects = async (userId = null) => {
  if (!userId) {
    return db.prepare(`
      SELECT
        projects.*,
        (SELECT COUNT(*)::INTEGER FROM requirements WHERE requirements.project_id = projects.id) AS story_count,
        (
          SELECT COUNT(*)::INTEGER
          FROM test_case_modules
          JOIN app_types ON app_types.id = test_case_modules.app_type_id
          WHERE app_types.project_id = projects.id
        ) AS module_count,
        (
          SELECT COUNT(*)::INTEGER
          FROM test_cases
          JOIN app_types ON app_types.id = test_cases.app_type_id
          WHERE app_types.project_id = projects.id
        ) AS case_count,
        (SELECT COUNT(*)::INTEGER FROM feedback WHERE feedback.project_id = projects.id) AS bug_count
      FROM projects
      ORDER BY projects.created_at DESC
    `).all();
  }
  
  // Only return projects where user is a member
  return db.prepare(`
    SELECT
      p.*,
      (SELECT COUNT(*)::INTEGER FROM requirements WHERE requirements.project_id = p.id) AS story_count,
      (
        SELECT COUNT(*)::INTEGER
        FROM test_case_modules
        JOIN app_types ON app_types.id = test_case_modules.app_type_id
        WHERE app_types.project_id = p.id
      ) AS module_count,
      (
        SELECT COUNT(*)::INTEGER
        FROM test_cases
        JOIN app_types ON app_types.id = test_cases.app_type_id
        WHERE app_types.project_id = p.id
      ) AS case_count,
      (SELECT COUNT(*)::INTEGER FROM feedback WHERE feedback.project_id = p.id) AS bug_count
    FROM projects p
    WHERE EXISTS (
      SELECT 1
      FROM project_members pm
      WHERE pm.project_id = p.id
        AND pm.user_id = ?
    )
    ORDER BY p.created_at DESC
  `).all(userId);
};

exports.getProject = async (id, userId = null) => {
  const project = await db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
  if (!project) throw new Error("Project not found");
  
  // If userId provided, verify user is a member
  if (userId) {
    const membership = await db.prepare(`
      SELECT id FROM project_members 
      WHERE project_id = ? AND user_id = ?
    `).get(id, userId);
    
    if (!membership) {
      throw new Error("Access denied: You are not a member of this project");
    }
  }
  
  return project;
};

exports.updateProject = async (id, data) => {
  const existing = await exports.getProject(id);
  const nextName = data.name === undefined ? existing.name : String(data.name || "").trim();
  const nextDescription = data.description === undefined
    ? existing.description
    : String(data.description || "").trim() || null;

  if (!nextName) {
    const error = new Error("Project name is required");
    error.statusCode = 400;
    throw error;
  }

  await db.prepare(`
    UPDATE projects SET name = ?, description = ?
    WHERE id = ?
  `).run(nextName, nextDescription, id);

  return { updated: true };
};

exports.deleteProject = async (id) => {
  const executeDelete = db.transaction(async () => {
    if (!await selectProjectForDeletion.get(id)) throw new Error("Project not found");
    const projectAttachmentObjects = await attachmentService.listProjectObjects(id);
    await deleteProjectAutomationJobs.run(id, id, id, id);
    await deleteProjectTransactionEvents.run(id);
    await deleteProjectWorkspaceTransactions.run(id);
    await deleteProjectExecutionResults.run(id, id);
    await deleteProjectExecutionStepSnapshots.run(id);
    await deleteProjectExecutionCaseSnapshots.run(id);
    await deleteProjectExecutionSuites.run(id);
    await deleteProjectExecutions.run(id);
    await deleteProjectExecutionSchedules.run(id);
    await deleteProjectTestSteps.run(id);
    await deleteProjectSuiteMappings.run(id, id);
    await deleteProjectRequirementMappings.run(id, id);
    await clearLegacyProjectCaseSuiteIds.run(id);
    await deleteProjectTestCases.run(id);
    await deleteProjectTestSuites.run(id);
    await deleteProjectRequirements.run(id);
    await deleteProjectSharedStepGroups.run(id);
    await deleteProjectTestEnvironments.run(id);
    await deleteProjectTestConfigurations.run(id);
    await deleteProjectTestDataSets.run(id);
    await deleteProjectAiGenerationJobs.run(id);
    await deleteProjectKnowledge.run(id);
    await deleteProjectPromptTemplates.run(id);
    await deleteProjectWorkflowRuns.run(id);
    await deleteProjectWorkflows.run(id);
    await clearDeletedProjectIntegrationScope.run(id, id, id, id);
    await deleteProjectAppTypes.run(id);
    await deleteProjectMembers.run(id);
    await deleteProjectRecord.run(id);
    return projectAttachmentObjects;
  });

  const projectAttachmentObjects = await executeDelete();
  const attachmentCleanup = await attachmentService.purgeProjectObjects(id, projectAttachmentObjects);
  return { deleted: true, attachment_cleanup: attachmentCleanup };
};
