// Append-only flow survives Story deletion. A small current-state projection
// deduplicates changes made through both Story stamps and Release membership.
module.exports = [
  `CREATE TABLE IF NOT EXISTS requirement_backlog_history_state (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    tracking_started_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    initialized_at TIMESTAMPTZ
  )`,
  `INSERT INTO requirement_backlog_history_state(singleton) VALUES(TRUE) ON CONFLICT DO NOTHING`,
  `CREATE TABLE IF NOT EXISTS requirement_backlog_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    requirement_id TEXT NOT NULL,
    event_kind TEXT NOT NULL CHECK (event_kind IN ('added', 'completed', 'removed')),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    snapshot JSONB NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_requirement_backlog_events_project_month
    ON requirement_backlog_events(project_id, occurred_at) INCLUDE(event_kind)`,
  `CREATE TABLE IF NOT EXISTS requirement_backlog_current_state (
    requirement_id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    active BOOLEAN NOT NULL,
    snapshot JSONB NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_requirement_backlog_current_project ON requirement_backlog_current_state(project_id)`,
  `CREATE OR REPLACE FUNCTION public.requirement_is_active_backlog(story_id TEXT)
    RETURNS BOOLEAN LANGUAGE SQL STABLE AS $backlog$
    SELECT EXISTS (
      SELECT 1 FROM requirements r WHERE r.id = story_id
        AND r.iteration_id IS NULL AND NULLIF(TRIM(r.sprint), '') IS NULL
        AND NULLIF(TRIM(r.release), '') IS NULL AND NULLIF(TRIM(r.fix_version), '') IS NULL
        AND LOWER(REGEXP_REPLACE(TRIM(COALESCE(r.status, '')), '[ _-]+', '_', 'g'))
          NOT IN ('qa_done', 'done', 'closed', 'resolved', 'accepted', 'complete', 'completed')
        AND NOT EXISTS (SELECT 1 FROM requirement_release_items ri
          JOIN requirement_releases rel ON rel.id = ri.release_id
          WHERE ri.source = 'manual' AND ri.requirement_id = r.id AND rel.project_id = r.project_id)
    )
    $backlog$`,
  `CREATE OR REPLACE FUNCTION public.requirement_backlog_snapshot(story_id TEXT)
    RETURNS JSONB LANGUAGE SQL STABLE AS $backlog$
    SELECT jsonb_build_object('id', r.id, 'project_id', r.project_id, 'title', r.title,
      'status', r.status, 'priority', r.priority, 'labels', r.labels, 'created_at', r.created_at,
      'sprint', r.sprint, 'iteration_id', r.iteration_id, 'release', r.release, 'fix_version', r.fix_version)
    FROM requirements r WHERE r.id = story_id
    $backlog$`,
  // Initialize only the state projection. Existing records are not invented
  // creation events, and incomplete historic months remain explicitly unknown.
  `DO $backlog$ BEGIN
    IF EXISTS (SELECT 1 FROM requirement_backlog_history_state WHERE initialized_at IS NULL) THEN
      LOCK TABLE requirements, requirement_release_items, requirement_releases IN SHARE ROW EXCLUSIVE MODE;
      INSERT INTO requirement_backlog_current_state(requirement_id, project_id, active, snapshot)
        SELECT r.id, r.project_id, requirement_is_active_backlog(r.id), requirement_backlog_snapshot(r.id)
        FROM requirements r JOIN projects p ON p.id = r.project_id ON CONFLICT DO NOTHING;
      UPDATE requirement_backlog_history_state
        SET initialized_at = clock_timestamp(), tracking_started_at = clock_timestamp() WHERE singleton;
    END IF;
  END $backlog$`,
  `CREATE OR REPLACE FUNCTION public.record_requirement_backlog_transition(story_id TEXT)
    RETURNS VOID LANGUAGE plpgsql AS $backlog$
    DECLARE previous requirement_backlog_current_state%ROWTYPE;
      current_snapshot JSONB; current_active BOOLEAN; owner_id TEXT; event_name TEXT;
    BEGIN
      SELECT * INTO previous FROM requirement_backlog_current_state WHERE requirement_id = story_id FOR UPDATE;
      current_snapshot := requirement_backlog_snapshot(story_id);
      owner_id := COALESCE(current_snapshot->>'project_id', previous.project_id);
      IF owner_id IS NULL THEN RETURN; END IF;
      -- Project deletion removes this ledger in bounded batches. Never create
      -- fresh history while a project is being removed or after its root is gone.
      IF NOT EXISTS (SELECT 1 FROM projects WHERE id = owner_id)
        OR EXISTS (SELECT 1 FROM project_deletion_jobs WHERE project_id = owner_id
          AND status IN ('queued', 'running', 'cleanup')) THEN
        IF current_snapshot IS NULL THEN
          DELETE FROM requirement_backlog_current_state WHERE requirement_id = story_id;
        END IF;
        RETURN;
      END IF;
      current_active := requirement_is_active_backlog(story_id);
      IF COALESCE(previous.active, FALSE) AND NOT current_active THEN
        event_name := CASE WHEN LOWER(REGEXP_REPLACE(TRIM(COALESCE(current_snapshot->>'status', '')), '[ _-]+', '_', 'g'))
          IN ('qa_done', 'done', 'closed', 'resolved', 'accepted', 'complete', 'completed')
          THEN 'completed' ELSE 'removed' END;
      ELSIF NOT COALESCE(previous.active, FALSE) AND current_active THEN
        event_name := 'added';
      END IF;
      IF event_name IS NOT NULL THEN
        INSERT INTO requirement_backlog_events(project_id, requirement_id, event_kind, snapshot)
          VALUES(owner_id, story_id, event_name, COALESCE(current_snapshot, previous.snapshot));
      END IF;
      IF current_snapshot IS NULL THEN
        DELETE FROM requirement_backlog_current_state WHERE requirement_id = story_id;
      ELSE
        INSERT INTO requirement_backlog_current_state(requirement_id, project_id, active, snapshot)
          VALUES(story_id, owner_id, current_active, current_snapshot)
          ON CONFLICT(requirement_id) DO UPDATE SET project_id = EXCLUDED.project_id,
            active = EXCLUDED.active, snapshot = EXCLUDED.snapshot;
      END IF;
    END $backlog$`,
  `CREATE OR REPLACE FUNCTION public.track_requirement_backlog_flow()
    RETURNS TRIGGER LANGUAGE plpgsql AS $backlog$
    BEGIN
      IF TG_TABLE_NAME = 'requirements' THEN
        PERFORM record_requirement_backlog_transition(CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END);
      ELSE
        IF TG_OP <> 'INSERT' THEN PERFORM record_requirement_backlog_transition(OLD.requirement_id); END IF;
        IF TG_OP <> 'DELETE' AND (TG_OP = 'INSERT' OR NEW.requirement_id IS DISTINCT FROM OLD.requirement_id) THEN
          PERFORM record_requirement_backlog_transition(NEW.requirement_id);
        END IF;
      END IF;
      RETURN NULL;
    END $backlog$`,
  `DROP TRIGGER IF EXISTS requirement_backlog_flow ON requirements`,
  `CREATE TRIGGER requirement_backlog_flow AFTER INSERT OR UPDATE OR DELETE ON requirements
    FOR EACH ROW EXECUTE FUNCTION public.track_requirement_backlog_flow()`,
  `DROP TRIGGER IF EXISTS requirement_backlog_flow ON requirement_release_items`,
  `CREATE TRIGGER requirement_backlog_flow AFTER INSERT OR UPDATE OR DELETE ON requirement_release_items
    FOR EACH ROW EXECUTE FUNCTION public.track_requirement_backlog_flow()`
];
