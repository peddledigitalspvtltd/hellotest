const db = require("../db");
const { randomUUID: uuid } = require("crypto");
const displayIdService = require("./displayId.service");
const aiLlmSelectionService = require("./aiLlmSelection.service");
const { fetchLlmWithRetry } = require("../utils/llmHttpClient");
const { getCompletionContent } = require("../utils/llmResponse");
const { latestFinalizedCaseResultsCte } = require("../utils/finalizedCaseMetrics");
const { mapWithConcurrency } = require("../utils/boundedConcurrency");
const { releaseStoryMembershipSql, releaseExecutionMembershipSql } = require("../utils/deliveryScopeSql");

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
  parsed.setUTCHours(0, 0, 0, 0);
  return parsed.toISOString();
};

const COMPLETED_STORY_STATUSES = ["qa_done", "qa done", "done", "closed", "resolved", "accepted", "complete", "completed"];
const isCompletedStoryStatus = (value) => COMPLETED_STORY_STATUSES.includes(String(value || "").trim().toLowerCase().replace(/[ _-]+/g, "_"));
const isOpenReleaseBug = (status) => !["closed", "done", "resolved", "accepted", "complete", "completed", "fixed", "verified"].includes(String(status || "").trim().toLowerCase());
const isAutomatedReleaseCase = (row) => String(row.automated || "").trim().toLowerCase() === "yes"
  || ["ready", "automated", "yes", "covered"].includes(String(row.automation_status || "").trim().toLowerCase());

// Both supported Story links belong to the same cohort. UNION also prevents a
// legacy primary link mirrored in the join table from counting a case twice.
const getReleaseCaseLinks = async (storyIds, projectId) => {
  if (!storyIds.length) return [];
  const placeholders = storyIds.map(() => "?").join(",");
  return db.prepare(`
    SELECT requirement_test_cases.requirement_id, test_cases.id AS test_case_id
    FROM requirement_test_cases
    JOIN test_cases ON test_cases.id = requirement_test_cases.test_case_id
    LEFT JOIN app_types ON app_types.id = test_cases.app_type_id
    WHERE requirement_test_cases.requirement_id IN (${placeholders}) AND (test_cases.app_type_id IS NULL OR app_types.project_id = ?)
    UNION
    SELECT test_cases.requirement_id, test_cases.id AS test_case_id
    FROM test_cases
    LEFT JOIN app_types ON app_types.id = test_cases.app_type_id
    WHERE test_cases.requirement_id IN (${placeholders}) AND (test_cases.app_type_id IS NULL OR app_types.project_id = ?)
  `).all(...storyIds, projectId, ...storyIds, projectId);
};

const getReleaseBugLinks = async (storyIds, projectId) => {
  if (!storyIds.length) return [];
  return db.prepare(`
    SELECT DISTINCT requirement_defects.requirement_id, feedback.id, feedback.status
    FROM requirement_defects JOIN feedback ON feedback.id = requirement_defects.issue_id
    WHERE requirement_defects.requirement_id IN (${storyIds.map(() => "?").join(",")})
      AND feedback.project_id = ?
  `).all(...storyIds, projectId);
};

const ensureReleaseStoriesComplete = async (release, requirementIds, sprintIds) => {
  const sourceById = await resolveMembership({ requirementIds, sprintIds, projectId: release.project_id });
  const effectiveIds = [...sourceById.keys()];
  const stories = effectiveIds.length ? await db.prepare(`
    SELECT id, display_id, title, status
    FROM requirements
    WHERE id IN (${effectiveIds.map(() => "?").join(",")})
  `).all(...effectiveIds) : [];
  const incomplete = stories.filter((story) => !isCompletedStoryStatus(story.status));
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
  if (!sprintIds.length) return;
  const rows = await db.prepare("SELECT id, project_id FROM requirement_iterations WHERE id IN (SELECT value FROM jsonb_array_elements_text(?::jsonb))").all(JSON.stringify(sprintIds));
  const byId = new Map(rows.map(row => [row.id, row]));
  for (const sprintId of sprintIds) {
    const row = byId.get(sprintId);
    if (!row) throw new Error(`Sprint not found: ${sprintId}`);
    if (row.project_id !== projectId) throw new Error("Sprint must belong to the same project as the release");
  }
};

const ensureStories = async (requirementIds, projectId) => {
  if (!requirementIds.length) return;
  const rows = await db.prepare("SELECT id, project_id FROM requirements WHERE id IN (SELECT value FROM jsonb_array_elements_text(?::jsonb))").all(JSON.stringify(requirementIds));
  const byId = new Map(rows.map(row => [row.id, row]));
  for (const requirementId of requirementIds) {
    const row = byId.get(requirementId);
    if (!row) throw new Error(`Story not found: ${requirementId}`);
    if (row.project_id !== projectId) throw new Error("Story must belong to the same project as the release");
  }
};

const resolveMembership = async ({ requirementIds, sprintIds, projectId }) => {
  await ensureSprints(sprintIds, projectId);
  await ensureStories(requirementIds, projectId);
  const sprintRows = sprintIds.length ? await db.prepare(`
    SELECT id, iteration_id FROM requirements
    WHERE project_id = ? AND (iteration_id IN (SELECT value FROM jsonb_array_elements_text(?::jsonb))
      OR (iteration_id IS NULL AND NULLIF(TRIM(sprint), '') IS NOT NULL AND EXISTS (
        SELECT 1 FROM requirement_iterations i WHERE i.project_id = requirements.project_id AND LOWER(TRIM(i.name)) = LOWER(TRIM(requirements.sprint))
          AND i.id IN (SELECT value FROM jsonb_array_elements_text(?::jsonb))
          AND (SELECT COUNT(*) FROM requirement_iterations candidate WHERE candidate.project_id = i.project_id AND LOWER(TRIM(candidate.name)) = LOWER(TRIM(i.name))) = 1)))
  `).all(projectId, JSON.stringify(sprintIds), JSON.stringify(sprintIds)) : [];
  const sourceById = new Map(requirementIds.map((id) => [id, "manual"]));
  sprintRows.forEach((row) => sourceById.set(row.id, sourceById.get(row.id) || "sprint"));
  return sourceById;
};

const deriveState = (release) => {
  if (release.state === "released") return "released";
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  if (release.target_date && Date.parse(release.target_date) < today.getTime()) return "overdue";
  return release.state || "planned";
};

const hydrateReleases = async (releases, { includeDetails = true } = {}) => {
  if (!releases.length) return [];
  const selectedReleases = releases.map((release) => ({
    id: release.id, project_id: release.project_id, name: release.name, fix_version: release.fix_version,
    sprint_ids: Array.isArray(release.sprint_ids) ? release.sprint_ids : []
  }));
  // Hydrate the complete catalog in one query. The selected release recordset
  // avoids one queued database read per release and retains live sprint scope.
  const items = await db.prepare(`
    SELECT ${includeDetails ? "requirements.*" : "requirements.id"}, selected.id AS hydration_release_id,
      CASE
        WHEN requirement_release_items.source = 'manual' THEN 'manual'
        WHEN EXISTS (SELECT 1 FROM requirement_release_sprints scope JOIN requirement_iterations sprint ON sprint.id = scope.iteration_id
          WHERE scope.release_id = selected.id AND (scope.iteration_id = requirements.iteration_id
            OR (requirements.iteration_id IS NULL AND LOWER(TRIM(sprint.name)) = LOWER(TRIM(requirements.sprint))))) THEN 'sprint'
        ELSE COALESCE(requirement_release_items.source, 'manual')
      END AS release_membership_source
    FROM jsonb_to_recordset(?::jsonb) AS selected(id text, project_id text, name text, fix_version text, sprint_ids jsonb)
    JOIN LATERAL (
      SELECT requirement_id FROM requirement_release_items WHERE release_id = selected.id AND source = 'manual'
      UNION
      SELECT story.id FROM requirement_release_sprints scope JOIN requirements story ON story.iteration_id = scope.iteration_id
        WHERE scope.release_id = selected.id AND story.project_id = selected.project_id
      UNION
      SELECT story.id FROM requirement_release_sprints scope JOIN requirement_iterations sprint ON sprint.id = scope.iteration_id
        JOIN requirements story ON story.project_id = selected.project_id AND story.iteration_id IS NULL AND LOWER(TRIM(story.sprint)) = LOWER(TRIM(sprint.name))
        WHERE scope.release_id = selected.id
      UNION
      SELECT story.id FROM requirements story WHERE story.project_id = selected.project_id
        AND LOWER(TRIM(COALESCE(NULLIF(TRIM(story.fix_version), ''), story.release))) IN (LOWER(TRIM(selected.fix_version)), LOWER(TRIM(selected.name)))
    ) membership(requirement_id) ON TRUE
    JOIN requirements ON requirements.id = membership.requirement_id AND requirements.project_id = selected.project_id
    LEFT JOIN requirement_release_items
      ON requirements.id = requirement_release_items.requirement_id
      AND requirement_release_items.release_id = selected.id
    WHERE ${releaseStoryMembershipSql('requirements', 'selected')}
    ORDER BY selected.id, COALESCE(requirements.updated_at, requirements.created_at) DESC, requirements.title
  `).all(JSON.stringify(selectedReleases));
  const itemsByRelease = new Map(releases.map((release) => [release.id, []]));
  for (const { hydration_release_id: releaseId, ...item } of items) itemsByRelease.get(releaseId)?.push(item);
  return releases.map((release) => {
    const requirements = itemsByRelease.get(release.id);
    return {
      ...release,
      state: deriveState(release),
      persisted_state: release.state,
      sprint_ids: Array.isArray(release.sprint_ids) ? release.sprint_ids : [],
      requirement_ids: requirements.map((item) => item.id),
      requirement_count: requirements.length,
      requirements
    };
  });
};

const hydrateRelease = async (release) => release ? (await hydrateReleases([release]))[0] : release;

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

exports.appendScope = async (id, { requirement_ids = [], sprint_ids = [], updated_by } = {}) => {
  const appendedRequirementIds = normalizeList(requirement_ids);
  const appendedSprintIds = normalizeList(sprint_ids);
  if (!appendedRequirementIds.length && !appendedSprintIds.length) {
    throw new Error("At least one Story or Sprint is required");
  }

  let releaseId = normalizeText(id);
  const transaction = db.transaction(async () => {
    // Serialize additive updates for this Release. Without the row lock, two
    // simultaneous Story/Sprint creations could both read the old scope and the
    // later writer would accidentally discard the earlier append.
    await db.prepare("SELECT id FROM requirement_releases WHERE id = ? FOR UPDATE").get(releaseId);
    const release = await exports.getRelease(releaseId);
    releaseId = release.id;
    if (release.persisted_state === "released") {
      const error = new Error("Completed Releases are read-only and cannot accept new scope");
      error.statusCode = 409;
      error.code = "RELEASE_SCOPE_LOCKED";
      throw error;
    }

    await ensureStories(appendedRequirementIds, release.project_id);
    await ensureSprints(appendedSprintIds, release.project_id);

    // Hydrated `requirement_ids` includes Sprint-derived Stories. Read only the
    // direct rows here so rebuilding membership never turns inherited scope into
    // manual scope and never replaces another user's existing direct selection.
    const existingDirectRows = await db.prepare(`
      SELECT requirement_id
      FROM requirement_release_items
      WHERE release_id = ? AND source = 'manual'
    `).all(release.id);
    const nextRequirementIds = normalizeList([
      ...existingDirectRows.map((row) => row.requirement_id),
      ...appendedRequirementIds
    ]);
    const nextSprintIds = normalizeList([
      ...(Array.isArray(release.sprint_ids) ? release.sprint_ids : []),
      ...appendedSprintIds
    ]);

    await db.prepare(`
      UPDATE requirement_releases
      SET sprint_ids = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(JSON.stringify(nextSprintIds), normalizeText(updated_by) || release.updated_by || release.created_by, release.id);
    await replaceMembership(release, nextRequirementIds, nextSprintIds);
  });
  await transaction();

  return {
    updated: true,
    appended_requirement_ids: appendedRequirementIds,
    appended_sprint_ids: appendedSprintIds,
    release: await exports.getRelease(releaseId)
  };
};

// Keep the materialized Release membership rows and Story delivery stamps in
// step with native Sprint membership changes. Release scope keeps sprint_ids
// for API compatibility, while requirement_release_items is the durable,
// queryable membership projection used by readiness and traceability.
exports.syncSprintMembership = async (sprintId, { remove = false, updated_by } = {}) => {
  const normalizedSprintId = normalizeText(sprintId);
  if (!normalizedSprintId) return { updated: false, releases: 0 };

  const releaseRows = await db.prepare(`
    SELECT id
    FROM requirement_releases
    WHERE sprint_ids @> ?::jsonb
  `).all(JSON.stringify([normalizedSprintId]));
  const scopedReleaseIds = releaseRows.map((release) => release.id);
  if (!scopedReleaseIds.length) return { updated: false, releases: 0 };

  const transaction = db.transaction(async () => {
    for (const releaseId of scopedReleaseIds) {
      await db.prepare("SELECT id FROM requirement_releases WHERE id = ? FOR UPDATE").get(releaseId);
      const release = await getReleaseRow(releaseId);
      if (!release) continue;
      if (release.state === "released") {
        const error = new Error("Completed Releases are read-only and cannot change Sprint scope");
        error.statusCode = 409;
        error.code = "RELEASE_SCOPE_LOCKED";
        throw error;
      }

      const directRows = await db.prepare(`
        SELECT requirement_id
        FROM requirement_release_items
        WHERE release_id = ? AND source = 'manual'
      `).all(release.id);
      const sprintIds = normalizeList(release.sprint_ids)
        .filter((candidateId) => !remove || candidateId !== normalizedSprintId);

      await db.prepare(`
        UPDATE requirement_releases
        SET sprint_ids = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        JSON.stringify(sprintIds),
        normalizeText(updated_by) || release.updated_by || release.created_by,
        release.id
      );
      await replaceMembership(
        release,
        directRows.map((row) => row.requirement_id),
        sprintIds,
        { name: release.name, fixVersion: release.fix_version }
      );
    }
  });
  await transaction();

  return { updated: true, releases: scopedReleaseIds.length };
};

// A Story's selected release is one direct membership. Independent manual
// scope and membership inherited from a Sprint are preserved when it changes.
// The caller's Story transaction owns this operation and its delivery stamps.
exports.setStoryRelease = async (requirementId, { releaseId, projectId, previousRelease, previousFixVersion, updated_by } = {}) => {
  const selectedId = normalizeText(releaseId);
  const releases = await db.prepare(`
    SELECT releases.* FROM requirement_releases releases
    WHERE releases.id = ? OR (releases.project_id = ?
      AND releases.name = ? AND releases.fix_version = ?
      AND EXISTS (SELECT 1 FROM requirement_release_items items
        WHERE items.release_id = releases.id AND items.requirement_id = ? AND items.source = 'manual'))
    ORDER BY releases.id FOR UPDATE
  `).all(selectedId, projectId, normalizeText(previousRelease), normalizeText(previousFixVersion), requirementId);
  const selected = releases.find(release => release.id === selectedId);
  if (selectedId && !selected) throw Object.assign(new Error("Release not found"), { statusCode: 404 });
  if (selected && selected.project_id !== projectId) throw Object.assign(new Error("Release must belong to the Story's project"), { statusCode: 400 });
  if (releases.some(release => release.state === 'released')) {
    throw Object.assign(new Error("Completed Releases are read-only and cannot change Story scope"), { statusCode: 409, code: "RELEASE_SCOPE_LOCKED" });
  }
  for (const release of releases) {
    if (release.id !== selectedId) {
      const inherited = await db.prepare(`SELECT id FROM requirements WHERE id = ? AND project_id = ?
        AND ?::jsonb @> jsonb_build_array(iteration_id)`).get(requirementId, projectId, JSON.stringify(release.sprint_ids || []));
      if (inherited) await db.prepare("UPDATE requirement_release_items SET source = 'sprint' WHERE release_id = ? AND requirement_id = ?").run(release.id, requirementId);
      else await db.prepare("DELETE FROM requirement_release_items WHERE release_id = ? AND requirement_id = ? AND source = 'manual'").run(release.id, requirementId);
    }
    await db.prepare("UPDATE requirement_releases SET updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(normalizeText(updated_by) || release.updated_by || release.created_by, release.id);
  }
  if (selected) {
    await db.prepare(`INSERT INTO requirement_release_items(release_id,requirement_id,source) VALUES (?,?,'manual')
      ON CONFLICT (release_id,requirement_id) DO UPDATE SET source='manual'`).run(selected.id, requirementId);
    await db.prepare("UPDATE requirements SET release = ?, fix_version = ? WHERE id = ?").run(selected.name, selected.fix_version, requirementId);
  } else if (previousRelease || previousFixVersion) {
    await db.prepare(`UPDATE requirements SET
      release = CASE WHEN release = ? THEN NULL ELSE release END,
      fix_version = CASE WHEN fix_version = ? THEN NULL ELSE fix_version END WHERE id = ?`)
      .run(normalizeText(previousRelease), normalizeText(previousFixVersion), requirementId);
  }
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
  return hydrateReleases(rows);
};

exports.getRelease = async (id) => {
  const release = await getReleaseRow(id);
  if (!release) throw new Error("Release not found");
  return hydrateRelease(release);
};

// Enrich only after the route has checked access to the underlying evidence.
// Dedupe shared Stories once, then restore each Release's membership metadata.
exports.withStoryMetrics = async (releases, { includeExecution = false } = {}) => {
  const stories = [...new Map(releases.flatMap(release => release.requirements || []).map(story => [story.id, story])).values()];
  const hydrated = await require('./requirementCatalog.service').withCatalogMetrics(stories, { include_execution:includeExecution });
  const byId = new Map(hydrated.map(story => [story.id, story.catalog_metrics]));
  return releases.map(release => ({ ...release, requirements:(release.requirements || []).map(story => ({ ...story, catalog_metrics:byId.get(story.id) })) }));
};

exports.createRelease = async ({ project_id, name, description, fix_version, target_date_label, plan_date, target_date, external_link, state, sprint_ids = [], requirement_ids = [], created_by } = {}) => {
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
  const nextState = normalizeState(state);
  const transaction = db.transaction(async () => {
    if (nextState === "released") {
      await ensureReleaseStoriesComplete(release, requirementIds, sprintIds);
    }
    await db.prepare(`
      INSERT INTO requirement_releases (id, display_id, project_id, name, description, fix_version, target_date_label, plan_date, target_date, external_link, state, sprint_ids, created_by, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(id, displayId, projectId, releaseName, normalizeText(description), fixVersion, normalizeText(target_date_label), normalizeDate(plan_date), normalizeDate(target_date), normalizeText(external_link), nextState, JSON.stringify(sprintIds), actor, actor);
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
      SET name = ?, description = ?, fix_version = ?, target_date_label = ?, plan_date = ?, target_date = ?, external_link = ?, state = ?, sprint_ids = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(nextName, data.description !== undefined ? normalizeText(data.description) : existing.description, nextVersion, data.target_date_label !== undefined ? normalizeText(data.target_date_label) : existing.target_date_label, data.plan_date !== undefined ? normalizeDate(data.plan_date) : existing.plan_date, data.target_date !== undefined ? normalizeDate(data.target_date) : existing.target_date, data.external_link !== undefined ? normalizeText(data.external_link) : existing.external_link, nextState, JSON.stringify(sprintIds), normalizeText(data.updated_by) || existing.updated_by || existing.created_by, id);
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

exports.getReadiness = async (id, { release: hydratedRelease } = {}) => {
  const release = hydratedRelease?.id === id ? hydratedRelease : await exports.getRelease(id);
  const storyIds = release.requirement_ids;
  if (!storyIds.length) return {
    release_id: id, total_stories: 0, covered_stories: 0, test_coverage_percent: null,
    linked_cases: 0, executed_cases: 0, passed_cases: 0, pass_rate_percent: null,
    total_bugs: 0, open_bugs: 0, bug_density: null, automation_coverage_percent: null,
    readiness_score: null, readiness_state: "not_ready", story_metrics: {}
  };
  const links = await getReleaseCaseLinks(storyIds, release.project_id);
  const caseIds = [...new Set(links.map((row) => row.test_case_id))];
  const casePlaceholders = caseIds.map(() => "?").join(",");
  // Runs persist the canonical delivery token (fix_version), not a release ID.
  // Resolve it from the stored Release; a shared case's unrelated latest run is
  // not evidence for this Release, even when it belongs to the same project.
  const latestResults = caseIds.length ? await db.prepare(`
    WITH ${latestFinalizedCaseResultsCte(`
      SELECT er.id, er.execution_id, er.test_case_id, er.status, er.created_at,
             er.ended_at, er.data_set_iteration_index, er.data_set_iteration_key
      FROM execution_results er JOIN executions e ON e.id = er.execution_id
      JOIN requirement_releases rel ON rel.id = ? AND rel.project_id = e.project_id
      WHERE er.test_case_id IN (${casePlaceholders}) AND e.project_id = ?
        AND ${releaseExecutionMembershipSql()}
    `)}
    SELECT test_case_id, status FROM latest_finalized
  `).all(release.id, ...caseIds, release.project_id) : [];
  const cases = caseIds.length ? await db.prepare(`SELECT id, automated, automation_status FROM test_cases WHERE id IN (${casePlaceholders})`).all(...caseIds) : [];
  const bugLinks = await getReleaseBugLinks(storyIds, release.project_id);
  const bugs = [...new Map(bugLinks.map((row) => [row.id, row])).values()];
  const percent = (n, d) => d ? Math.round((n / d) * 1000) / 10 : null;
  const coveredStories = new Set(links.map((row) => row.requirement_id)).size;
  const passedCases = latestResults.filter((row) => String(row.status).toLowerCase() === "passed").length;
  const openBugs = bugs.filter((row) => isOpenReleaseBug(row.status)).length;
  const automatedCases = cases.filter(isAutomatedReleaseCase).length;
  const testCoverage = percent(coveredStories, storyIds.length);
  const passRate = percent(passedCases, latestResults.length);
  const bugHealth = Math.max(0, 100 - (openBugs / storyIds.length) * 25);
  const readinessScore = latestResults.length && caseIds.length
    ? Math.round((coveredStories / storyIds.length * 30) + (passedCases / latestResults.length * 50) + (bugHealth * 0.2))
    : null;
  const caseById = new Map(cases.map((row) => [row.id, row]));
  const resultByCaseId = new Map(latestResults.map((row) => [row.test_case_id, row]));
  const caseIdsByStory = new Map(storyIds.map((storyId) => [storyId, new Set()]));
  const bugsByStory = new Map(storyIds.map((storyId) => [storyId, new Map()]));
  for (const link of links) caseIdsByStory.get(link.requirement_id)?.add(link.test_case_id);
  for (const bug of bugLinks) bugsByStory.get(bug.requirement_id)?.set(bug.id, bug);
  const storyMetrics = Object.fromEntries(storyIds.map((storyId) => {
    const storyCaseIds = [...caseIdsByStory.get(storyId)];
    const storyResults = storyCaseIds.map((caseId) => resultByCaseId.get(caseId)).filter(Boolean);
    const storyBugs = [...bugsByStory.get(storyId).values()];
    const storyPassed = storyResults.filter((row) => String(row.status).trim().toLowerCase() === "passed").length;
    const storyOpenBugs = storyBugs.filter((row) => isOpenReleaseBug(row.status)).length;
    const storyAutomated = storyCaseIds.filter((caseId) => isAutomatedReleaseCase(caseById.get(caseId) || {})).length;
    const storyPassRate = percent(storyPassed, storyResults.length);
    return [storyId, {
      linked_cases: storyCaseIds.length,
      executed_cases: storyResults.length,
      passed_cases: storyPassed,
      pass_rate_percent: storyPassRate,
      automated_cases: storyAutomated,
      automation_coverage_percent: percent(storyAutomated, storyCaseIds.length) ?? 0,
      total_bugs: storyBugs.length,
      open_bugs: storyOpenBugs,
      readiness_score: storyCaseIds.length && storyResults.length
        ? Math.round(30 + (storyPassed / storyResults.length * 50) + (Math.max(0, 100 - storyOpenBugs * 25) * 0.2))
        : null
    }];
  }));
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
    story_metrics: storyMetrics,
    methodology: {
      test_coverage_weight: 30,
      pass_rate_weight: 50,
      bug_health_weight: 20,
      automation_is_informational: true,
      test_coverage: "Stories with at least one linked Test Case divided by release Stories.",
      pass_rate: "Latest finalized passed case divided by linked Test Cases with a finalized passed, failed or blocked outcome in this Release's runs. All planned Data Set rows must be finalized; a failed or blocked row determines the case outcome.",
      no_run_evidence: "Readiness is unavailable until at least one linked Test Case has a finalized outcome.",
      execution_scope: "Linked Test Cases in same-project runs linked by native Release ID, or release-unassigned runs in its Sprints. Legacy labels are accepted only when they identify one project Release; renamed native relationships retain historical runs.",
      release_token: release.fix_version || "",
      bug_health: "100 minus 25 points per open Defect per Story, floored at zero."
    }
  };
};

exports.listReadiness = async ({ project_id } = {}) => {
  const projectId = normalizeText(project_id);
  if (!projectId) throw new Error("project_id is required");
  const rows = await db.prepare(`
    SELECT id, project_id, name, sprint_ids, fix_version
    FROM requirement_releases
    WHERE project_id = ?
    ORDER BY updated_at DESC, id ASC
  `).all(projectId);
  const releases = await hydrateReleases(rows, { includeDetails: false });
  // Leave database capacity available for ordinary reads and edits. The shared
  // scheduler stops on failure and waits for already-started reads to settle.
  return mapWithConcurrency(releases, 3, (release) => exports.getReadiness(release.id, { release }));
};

const normalizeNoteList = (value, fallback = []) => {
  if (!Array.isArray(value)) return fallback;
  const normalized = value.map((item) => normalizeText(item)).filter(Boolean).slice(0, 12);
  return normalized.length ? normalized : fallback;
};

const normalizeChangeGroups = (value, fallback = []) => {
  if (!Array.isArray(value)) return fallback;
  const groups = value.map((group) => ({
    title: normalizeText(group?.title),
    items: normalizeNoteList(group?.items)
  })).filter((group) => group.title && group.items.length).slice(0, 6);
  return groups.length ? groups : fallback;
};

const compactReleaseEvidence = (value, maxLength = 520) => String(value || "")
  .replace(/<[^>]*>/g, " ")
  .replace(/&nbsp;/gi, " ")
  .replace(/&amp;/gi, "&")
  .replace(/&lt;/gi, "<")
  .replace(/&gt;/gi, ">")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, maxLength);

const parseReleaseNotesJson = (value) => {
  const text = String(value || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const requestReleaseNotesNarrative = async ({ integration, release, readiness, storyEvaluations, userId }) => {
  const baseUrl = String(integration.base_url || "https://api.openai.com/v1").replace(/\/+$/, "");
  const evidence = {
    release: {
      id: release.display_id || release.id,
      name: release.name,
      fix_version: release.fix_version,
      state: release.state,
      plan_date: release.plan_date || null,
      target_date: release.target_date || null
    },
    readiness,
    stories: storyEvaluations.slice(0, 100)
  };
  const response = await fetchLlmWithRetry(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${integration.api_key}`
    },
    body: JSON.stringify({
      model: integration.model,
      temperature: 0.15,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "You are a mature product release manager. Compose audience-ready release notes strictly from supplied evidence. Lead with observable product changes, group them by change type, call out known limitations, and keep test/readiness data in a short validation summary. Do not turn delivery statuses into the release narrative. Return JSON only with audience_summary, change_groups (array of {title, items}), known_limitations, and validation_summary. Never invent features, dates, quality claims, or customer impact."
        },
        {
          role: "user",
          content: `Create release notes from this bounded evidence. Every change item and limitation must be a plain, concise sentence. Omit empty change groups. Evidence:\n${JSON.stringify(evidence)}`
        }
      ]
    })
  }, { integration, operation: "requirement-release.notes", actorId: userId });
  if (!response.ok) throw new Error("Release-notes provider request failed");
  const payload = await response.json();
  return parseReleaseNotesJson(getCompletionContent(payload));
};

exports.generateReleaseNotes = async (id, { user_id, allow_ai = false } = {}) => {
  const release = await exports.getRelease(id);
  const readiness = await exports.getReadiness(id, { release });
  const storyEvaluations = (release.requirements || []).map((story) => {
    const evidence = readiness.story_metrics[story.id];
    const linkedCases = evidence?.linked_cases || 0;
    const bugs = { total: evidence?.total_bugs || 0, open: evidence?.open_bugs || 0 };
    const completed = isCompletedStoryStatus(story.status);
    const health = bugs.open ? "at_risk" : !completed || !linkedCases ? "attention" : "healthy";
    const outcome = compactReleaseEvidence(story.description);
    const acceptanceScope = compactReleaseEvidence(
      story.specification_content || (Array.isArray(story.gherkin_scenarios) ? story.gherkin_scenarios.join(" ") : ""),
      360
    );
    return {
      id: story.display_id || story.id,
      title: story.title,
      status: story.status || "open",
      priority: story.priority ?? 3,
      labels: Array.isArray(story.labels) ? story.labels : [],
      sprint: story.sprint || null,
      completed,
      linked_cases: linkedCases,
      total_bugs: bugs.total,
      open_bugs: bugs.open,
      health,
      outcome: outcome || null,
      acceptance_scope: acceptanceScope || null,
      summary: `${completed ? "Delivery complete" : "Delivery in progress"}; ${linkedCases} linked test case${linkedCases === 1 ? "" : "s"}; ${bugs.open} open Defect${bugs.open === 1 ? "" : "s"}.`
    };
  });
  const completedStories = storyEvaluations.filter((story) => story.completed);
  const releaseCategoryFor = (story) => {
    const evidence = `${story.title} ${(story.labels || []).join(" ")}`.toLowerCase();
    if (/breaking|migration|deprecat/.test(evidence)) return "Breaking changes";
    if (/security|permission|auth|compliance/.test(evidence)) return "Security and access";
    if (/bug|fix|defect|regression|correct/.test(evidence)) return "Fixes";
    if (/improv|enhanc|performance|refactor|polish|usability/.test(evidence)) return "Improvements";
    return "New capabilities";
  };
  const groupedChanges = new Map();
  completedStories.forEach((story) => {
    const category = releaseCategoryFor(story);
    const item = story.outcome
      ? `${story.title} — ${story.outcome}`
      : story.acceptance_scope
        ? `${story.title} — ${story.acceptance_scope}`
        : story.title;
    groupedChanges.set(category, [...(groupedChanges.get(category) || []), item]);
  });
  const defaultChangeGroups = [...groupedChanges].map(([title, items]) => ({ title, items: items.slice(0, 12) }));
  if (!defaultChangeGroups.length) defaultChangeGroups.push({ title: "Release scope", items: ["No completed product changes are available to announce yet."] });
  const defaultLimitations = [
    !storyEvaluations.length ? "Release scope is empty; add Stories before publishing these notes." : "",
    storyEvaluations.some((story) => !story.completed) ? `${storyEvaluations.filter((story) => !story.completed).length} scoped changes are still in progress and are not included as delivered changes.` : "",
    readiness.open_bugs ? `${readiness.open_bugs} open Defects remain across the Release scope.` : "",
    readiness.test_coverage_percent !== null && readiness.test_coverage_percent < 80 ? `Story test coverage is ${readiness.test_coverage_percent}%, below the 80% release target.` : "",
    readiness.pass_rate_percent === null ? "No finalized Release test outcomes are available to assess pass rate or readiness." : "",
    release.state === "overdue" ? "The Release target date has passed." : ""
  ].filter(Boolean);
  const validationSummary = storyEvaluations.length
    ? `${completedStories.length} of ${storyEvaluations.length} scoped changes are complete. Linked evidence reports ${readiness.test_coverage_percent ?? 0}% Story coverage, ${readiness.pass_rate_percent === null ? "no finalized test outcomes" : `${readiness.pass_rate_percent}% finalized-case pass rate`}, and ${readiness.open_bugs} open ${readiness.open_bugs === 1 ? "Defect" : "Defects"}.`
    : "Validation is unavailable because the Release has no scoped Stories.";
  const deterministic = {
    executive_summary: completedStories.length
      ? `${release.name} introduces ${completedStories.length} completed ${completedStories.length === 1 ? "change" : "changes"} across ${defaultChangeGroups.length} ${defaultChangeGroups.length === 1 ? "category" : "categories"}. The notes below describe the delivered product outcomes; validation evidence is reported separately.`
      : `${release.name} does not yet contain a completed change that is ready to announce.`,
    change_groups: defaultChangeGroups,
    known_limitations: defaultLimitations.length ? defaultLimitations : ["No known limitations were identified from the current linked Release evidence."],
    validation_summary: validationSummary
  };
  let narrative = deterministic;
  let generationMode = "deterministic";
  try {
    if (!allow_ai) throw new Error("AI release-note composition is not available for this request");
    const integration = await aiLlmSelectionService.resolveLlmIntegrationForUsage({
      userId: user_id,
      usageKey: "ai.release.notes",
      projectId: release.project_id,
      fallback: "project-then-global",
      allowMissing: true
    });
    if (integration) {
      const generated = await requestReleaseNotesNarrative({ integration, release, readiness, storyEvaluations, userId: user_id });
      if (generated) {
        narrative = {
          executive_summary: normalizeText(generated.audience_summary) || deterministic.executive_summary,
          change_groups: normalizeChangeGroups(generated.change_groups, deterministic.change_groups),
          known_limitations: normalizeNoteList(generated.known_limitations, deterministic.known_limitations),
          validation_summary: normalizeText(generated.validation_summary) || deterministic.validation_summary
        };
        generationMode = "llm";
      }
    }
  } catch {
    generationMode = "deterministic";
  }
  return {
    release_id: release.id,
    release_name: release.name,
    fix_version: release.fix_version,
    generated_at: new Date().toISOString(),
    generation_mode: generationMode,
    ...narrative,
    highlights: narrative.change_groups.flatMap((group) => group.items).slice(0, 12),
    risks: narrative.known_limitations,
    scope_summary: {
      scoped_changes: storyEvaluations.length,
      delivered_changes: completedStories.length,
      change_categories: narrative.change_groups.length
    },
    quality_summary: {
      readiness_score: readiness.readiness_score,
      readiness_state: readiness.readiness_state,
      story_completion: `${completedStories.length}/${storyEvaluations.length}`,
      test_coverage_percent: readiness.test_coverage_percent,
      pass_rate_percent: readiness.pass_rate_percent,
      open_bugs: readiness.open_bugs
    },
    story_evaluations: storyEvaluations
  };
};

exports.deleteRelease = async (id) => {
  await exports.getRelease(id);
  await db.prepare("DELETE FROM requirement_releases WHERE id = ?").run(id);
  return { deleted: true, id };
};
