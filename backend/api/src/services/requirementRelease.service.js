const db = require("../db");
const { randomUUID: uuid } = require("crypto");
const displayIdService = require("./displayId.service");

const normalizeText = (value) => typeof value === "string" && value.trim() ? value.trim() : null;
const normalizeList = (values = []) => [...new Set((Array.isArray(values) ? values : []).map(normalizeText).filter(Boolean))];
const normalizeState = (value, fallback = "planned") => {
  const state = normalizeText(value) || fallback;
  if (!["planned", "in_progress", "released"].includes(state)) throw new Error("Invalid release state");
  return state;
};
const normalizeDate = (value) => {
  const text = normalizeText(value);
  if (!text) return null;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) throw new Error("Invalid release target date");
  return parsed.toISOString();
};

const COMPLETED_STORY_STATUSES = ["qa_done", "qa done", "done", "closed", "resolved", "accepted", "complete", "completed"];

const ensureReleaseStoriesComplete = async (release, requirementIds, sprintIds) => {
  const sourceById = await resolveMembership({ requirementIds, sprintIds, projectId: release.project_id });
  const effectiveIds = [...sourceById.keys()];
  const stories = effectiveIds.length ? await db.prepare(`
    SELECT id, display_id, title, status
    FROM requirements
    WHERE id IN (${effectiveIds.map(() => "?").join(",")})
  `).all(...effectiveIds) : [];
  const incomplete = stories.filter((story) =>
    !COMPLETED_STORY_STATUSES.includes(String(story.status || "").trim().toLowerCase())
  );
  if (!incomplete.length) return;
  const error = new Error(`Release “${release.name}” cannot be completed because ${incomplete.length} ${incomplete.length === 1 ? "Story is" : "Stories are"} unfinished. Move every Story to QA Done, Done, Resolved, Accepted, or Closed, then try again.`);
  error.statusCode = 409;
  error.code = "DELIVERY_STORIES_INCOMPLETE";
  throw error;
};

const getReleaseRow = (id) => db.prepare("SELECT * FROM requirement_releases WHERE id = ?").get(id);

const ensureProject = async (projectId) => {
  const id = normalizeText(projectId);
  if (!id) throw new Error("project_id is required");
  if (!await db.prepare("SELECT id FROM projects WHERE id = ?").get(id)) throw new Error("Project not found");
  return id;
};

const ensureSprints = async (sprintIds, projectId) => {
  for (const sprintId of sprintIds) {
    const row = await db.prepare("SELECT id, project_id FROM requirement_iterations WHERE id = ?").get(sprintId);
    if (!row) throw new Error(`Sprint not found: ${sprintId}`);
    if (row.project_id !== projectId) throw new Error("Sprint must belong to the same project as the release");
  }
};

const ensureStories = async (requirementIds, projectId) => {
  for (const requirementId of requirementIds) {
    const row = await db.prepare("SELECT id, project_id FROM requirements WHERE id = ?").get(requirementId);
    if (!row) throw new Error(`Story not found: ${requirementId}`);
    if (row.project_id !== projectId) throw new Error("Story must belong to the same project as the release");
  }
};

const resolveMembership = async ({ requirementIds, sprintIds, projectId }) => {
  await ensureSprints(sprintIds, projectId);
  await ensureStories(requirementIds, projectId);
  const sprintRows = sprintIds.length ? await db.prepare(`
    SELECT id, iteration_id FROM requirements
    WHERE project_id = ? AND iteration_id IN (${sprintIds.map(() => "?").join(",")})
  `).all(projectId, ...sprintIds) : [];
  const sourceById = new Map(requirementIds.map((id) => [id, "manual"]));
  sprintRows.forEach((row) => sourceById.set(row.id, sourceById.get(row.id) || "sprint"));
  return sourceById;
};

const deriveState = (release) => {
  if (release.state === "released") return "released";
  if (release.target_date && Date.parse(release.target_date) < Date.now()) return "overdue";
  return release.state || "planned";
};

const hydrateRelease = async (release) => {
  if (!release) return release;
  const sprintIds = Array.isArray(release.sprint_ids) ? release.sprint_ids : [];
  const sprintPlaceholders = sprintIds.map(() => "?").join(",");
  const items = await db.prepare(`
    SELECT requirements.*,
      CASE
        WHEN requirement_release_items.source = 'manual' THEN 'manual'
        WHEN requirements.iteration_id IN (${sprintPlaceholders || "NULL"}) THEN 'sprint'
        ELSE COALESCE(requirement_release_items.source, 'manual')
      END AS release_membership_source
    FROM requirements
    LEFT JOIN requirement_release_items
      ON requirements.id = requirement_release_items.requirement_id
      AND requirement_release_items.release_id = ?
    WHERE requirements.project_id = ?
      AND (
        requirement_release_items.release_id IS NOT NULL
        ${sprintIds.length ? `OR requirements.iteration_id IN (${sprintPlaceholders})` : ""}
      )
    ORDER BY COALESCE(requirements.updated_at, requirements.created_at) DESC, requirements.title
  `).all(...sprintIds, release.id, release.project_id, ...sprintIds);
  return {
    ...release,
    state: deriveState(release),
    persisted_state: release.state,
    sprint_ids: sprintIds,
    requirement_ids: items.map((item) => item.id),
    requirement_count: items.length,
    requirements: items
  };
};

const replaceMembership = async (release, requirementIds, sprintIds, previousStamp = null) => {
  const sourceById = await resolveMembership({ requirementIds, sprintIds, projectId: release.project_id });
  const previousMembers = await db.prepare("SELECT requirement_id FROM requirement_release_items WHERE release_id = ?").all(release.id);
  if (previousStamp?.name || previousStamp?.fixVersion) {
    for (const { requirement_id: requirementId } of previousMembers) {
      await db.prepare(`
        UPDATE requirements
        SET release = CASE WHEN release = ? THEN NULL ELSE release END,
            fix_version = CASE WHEN fix_version = ? THEN NULL ELSE fix_version END,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(previousStamp.name || null, previousStamp.fixVersion || null, requirementId);
    }
  }
  await db.prepare("DELETE FROM requirement_release_items WHERE release_id = ?").run(release.id);
  for (const [requirementId, source] of sourceById) {
    await db.prepare(`
      INSERT INTO requirement_release_items (release_id, requirement_id, source)
      VALUES (?, ?, ?)
      ON CONFLICT (release_id, requirement_id) DO UPDATE SET source = EXCLUDED.source
    `).run(release.id, requirementId, source);
    await db.prepare(`
      UPDATE requirements
      SET release = ?, fix_version = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(release.name, release.fix_version, requirementId);
  }
  return sourceById.size;
};

exports.listReleases = async ({ project_id } = {}) => {
  if (!normalizeText(project_id)) throw new Error("project_id is required");
  let query = "SELECT * FROM requirement_releases WHERE 1 = 1";
  const params = [];
  if (project_id) {
    query += " AND project_id = ?";
    params.push(project_id);
  }
  query += " ORDER BY CASE state WHEN 'in_progress' THEN 0 WHEN 'planned' THEN 1 ELSE 2 END, target_date NULLS LAST, updated_at DESC";
  const rows = await db.prepare(query).all(...params);
  return Promise.all(rows.map(hydrateRelease));
};

exports.getRelease = async (id) => {
  const release = await getReleaseRow(id);
  if (!release) throw new Error("Release not found");
  return hydrateRelease(release);
};

exports.createRelease = async ({ project_id, name, description, fix_version, target_date_label, target_date, external_link, state, sprint_ids = [], requirement_ids = [], created_by } = {}) => {
  const projectId = await ensureProject(project_id);
  const releaseName = normalizeText(name);
  const fixVersion = normalizeText(fix_version);
  if (!releaseName) throw new Error("Release name is required");
  if (!fixVersion) throw new Error("Fix version is required");
  const duplicate = await db.prepare("SELECT id FROM requirement_releases WHERE project_id = ? AND (LOWER(name) = LOWER(?) OR LOWER(fix_version) = LOWER(?)) LIMIT 1").get(projectId, releaseName, fixVersion);
  if (duplicate) throw new Error("A release with this name or fix version already exists in the project");
  const sprintIds = normalizeList(sprint_ids);
  const requirementIds = normalizeList(requirement_ids);
  const id = uuid();
  const displayId = await displayIdService.createDisplayId("requirement_release");
  const actor = normalizeText(created_by);
  const release = {
    id, project_id: projectId, name: releaseName, fix_version: fixVersion
  };
  const transaction = db.transaction(async () => {
    await db.prepare(`
      INSERT INTO requirement_releases (id, display_id, project_id, name, description, fix_version, target_date_label, target_date, external_link, state, sprint_ids, created_by, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(id, displayId, projectId, releaseName, normalizeText(description), fixVersion, normalizeText(target_date_label), normalizeDate(target_date), normalizeText(external_link), normalizeState(state), JSON.stringify(sprintIds), actor, actor);
    await replaceMembership(release, requirementIds, sprintIds);
  });
  await transaction();
  return { id, release: await exports.getRelease(id) };
};

exports.updateRelease = async (id, data = {}) => {
  const existing = await exports.getRelease(id);
  const nextName = data.name !== undefined ? normalizeText(data.name) : existing.name;
  const nextVersion = data.fix_version !== undefined ? normalizeText(data.fix_version) : existing.fix_version;
  if (!nextName) throw new Error("Release name is required");
  if (!nextVersion) throw new Error("Fix version is required");
  const duplicate = await db.prepare("SELECT id FROM requirement_releases WHERE project_id = ? AND id != ? AND (LOWER(name) = LOWER(?) OR LOWER(fix_version) = LOWER(?)) LIMIT 1").get(existing.project_id, id, nextName, nextVersion);
  if (duplicate) throw new Error("A release with this name or fix version already exists in the project");
  const sprintIds = data.sprint_ids !== undefined ? normalizeList(data.sprint_ids) : existing.sprint_ids;
  const requirementIds = data.requirement_ids !== undefined ? normalizeList(data.requirement_ids) : existing.requirement_ids;
  const nextState = data.state !== undefined ? normalizeState(data.state, existing.persisted_state) : existing.persisted_state;
  if (nextState === "released" && (existing.persisted_state !== "released" || data.requirement_ids !== undefined || data.sprint_ids !== undefined)) {
    await ensureReleaseStoriesComplete(existing, requirementIds, sprintIds);
  }
  const transaction = db.transaction(async () => {
    await db.prepare(`
      UPDATE requirement_releases
      SET name = ?, description = ?, fix_version = ?, target_date_label = ?, target_date = ?, external_link = ?, state = ?, sprint_ids = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(nextName, data.description !== undefined ? normalizeText(data.description) : existing.description, nextVersion, data.target_date_label !== undefined ? normalizeText(data.target_date_label) : existing.target_date_label, data.target_date !== undefined ? normalizeDate(data.target_date) : existing.target_date, data.external_link !== undefined ? normalizeText(data.external_link) : existing.external_link, nextState, JSON.stringify(sprintIds), normalizeText(data.updated_by) || existing.updated_by || existing.created_by, id);
    await replaceMembership(
      { ...existing, name: nextName, fix_version: nextVersion },
      requirementIds,
      sprintIds,
      { name: existing.name, fixVersion: existing.fix_version }
    );
  });
  await transaction();
  return { updated: true, release: await exports.getRelease(id) };
};

exports.getReadiness = async (id) => {
  const release = await exports.getRelease(id);
  const storyIds = release.requirement_ids;
  if (!storyIds.length) return {
    release_id: id, total_stories: 0, covered_stories: 0, test_coverage_percent: null,
    linked_cases: 0, executed_cases: 0, passed_cases: 0, pass_rate_percent: null,
    total_bugs: 0, open_bugs: 0, bug_density: null, automation_coverage_percent: null,
    readiness_score: 0, readiness_state: "not_ready"
  };
  const placeholders = storyIds.map(() => "?").join(",");
  const links = await db.prepare(`SELECT DISTINCT requirement_id, test_case_id FROM requirement_test_cases WHERE requirement_id IN (${placeholders})`).all(...storyIds);
  const caseIds = [...new Set(links.map((row) => row.test_case_id))];
  const casePlaceholders = caseIds.map(() => "?").join(",");
  const latestResults = caseIds.length ? await db.prepare(`
    SELECT DISTINCT ON (execution_results.test_case_id) execution_results.test_case_id, execution_results.status
    FROM execution_results JOIN executions ON executions.id = execution_results.execution_id
    WHERE execution_results.test_case_id IN (${casePlaceholders}) AND executions.project_id = ?
    ORDER BY execution_results.test_case_id, execution_results.created_at DESC, execution_results.id DESC
  `).all(...caseIds, release.project_id) : [];
  const cases = caseIds.length ? await db.prepare(`SELECT id, automation_status FROM test_cases WHERE id IN (${casePlaceholders})`).all(...caseIds) : [];
  const bugs = await db.prepare(`
    SELECT DISTINCT feedback.id, feedback.status
    FROM requirement_defects JOIN feedback ON feedback.id = requirement_defects.issue_id
    WHERE requirement_defects.requirement_id IN (${placeholders})
  `).all(...storyIds);
  const percent = (n, d) => d ? Math.round((n / d) * 1000) / 10 : null;
  const coveredStories = new Set(links.map((row) => row.requirement_id)).size;
  const passedCases = latestResults.filter((row) => String(row.status).toLowerCase() === "passed").length;
  const openBugs = bugs.filter((row) => !["closed", "done", "resolved"].includes(String(row.status || "").toLowerCase())).length;
  const automatedCases = cases.filter((row) => ["automated", "yes", "covered"].includes(String(row.automation_status || "").toLowerCase())).length;
  const testCoverage = percent(coveredStories, storyIds.length);
  const passRate = percent(passedCases, latestResults.length);
  const bugHealth = Math.max(0, 100 - (openBugs / storyIds.length) * 25);
  const readinessScore = Math.round(((testCoverage || 0) * 0.3) + ((passRate || 0) * 0.5) + (bugHealth * 0.2));
  return {
    release_id: id,
    total_stories: storyIds.length,
    covered_stories: coveredStories,
    test_coverage_percent: testCoverage,
    linked_cases: caseIds.length,
    executed_cases: latestResults.length,
    passed_cases: passedCases,
    pass_rate_percent: passRate,
    total_bugs: bugs.length,
    open_bugs: openBugs,
    bug_density: Math.round((bugs.length / storyIds.length) * 100) / 100,
    automated_cases: automatedCases,
    automation_coverage_percent: percent(automatedCases, caseIds.length),
    readiness_score: readinessScore,
    readiness_state: readinessScore >= 80 && openBugs === 0 ? "ready" : readinessScore >= 60 ? "at_risk" : "not_ready",
    methodology: {
      test_coverage_weight: 30,
      pass_rate_weight: 50,
      bug_health_weight: 20,
      automation_is_informational: true,
      test_coverage: "Stories with at least one linked Test Case divided by release Stories.",
      pass_rate: "Latest passed result divided by linked Test Cases with a result.",
      bug_health: "100 minus 25 points per open Bug per Story, floored at zero."
    }
  };
};

exports.listReadiness = async ({ project_id } = {}) => {
  const projectId = normalizeText(project_id);
  if (!projectId) throw new Error("project_id is required");
  const releases = await db.prepare(`
    SELECT id
    FROM requirement_releases
    WHERE project_id = ?
    ORDER BY updated_at DESC, id ASC
  `).all(projectId);
  return Promise.all(releases.map((release) => exports.getReadiness(release.id)));
};

exports.deleteRelease = async (id) => {
  await exports.getRelease(id);
  await db.prepare("DELETE FROM requirement_releases WHERE id = ?").run(id);
  return { deleted: true, id };
};
