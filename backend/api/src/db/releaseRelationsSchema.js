// Keep native delivery relationships alongside the public text labels. Legacy
// labels are resolved only when there is one matching entity in the project.
// Database triggers cover imports, automation, and every API write path.
module.exports = [
  `CREATE TABLE IF NOT EXISTS requirement_release_sprints (
    release_id TEXT NOT NULL REFERENCES requirement_releases(id) ON DELETE CASCADE,
    iteration_id TEXT NOT NULL REFERENCES requirement_iterations(id) ON DELETE CASCADE,
    PRIMARY KEY (release_id, iteration_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_release_sprints_iteration ON requirement_release_sprints(iteration_id, release_id)`,
  `CREATE INDEX IF NOT EXISTS idx_release_normalized_version ON requirement_releases(project_id, (LOWER(TRIM(fix_version))))`,
  `CREATE INDEX IF NOT EXISTS idx_release_normalized_name ON requirement_releases(project_id, (LOWER(TRIM(name))))`,
  `CREATE INDEX IF NOT EXISTS idx_iteration_normalized_name ON requirement_iterations(project_id, (LOWER(TRIM(name))))`,
  `CREATE INDEX IF NOT EXISTS idx_requirement_legacy_release ON requirements(project_id, (LOWER(TRIM(COALESCE(NULLIF(TRIM(fix_version), ''), release)))))`,
  `CREATE INDEX IF NOT EXISTS idx_requirement_legacy_sprint ON requirements(project_id, (LOWER(TRIM(sprint)))) WHERE iteration_id IS NULL`,
  `CREATE OR REPLACE FUNCTION validate_release_sprint_project() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM requirement_releases r JOIN requirement_iterations i ON i.project_id = r.project_id
        WHERE r.id = NEW.release_id AND i.id = NEW.iteration_id) THEN
        RAISE EXCEPTION 'Release Sprints must belong to the same project' USING ERRCODE = '23503';
      END IF;
      RETURN NEW;
    END $$`,
  `DROP TRIGGER IF EXISTS release_sprint_project_guard ON requirement_release_sprints`,
  `CREATE TRIGGER release_sprint_project_guard BEFORE INSERT OR UPDATE ON requirement_release_sprints
    FOR EACH ROW EXECUTE FUNCTION validate_release_sprint_project()`,
  `CREATE OR REPLACE FUNCTION sync_release_sprint_relations() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(NEW.sprint_ids) selected(id)
        WHERE NOT EXISTS (SELECT 1 FROM requirement_iterations i WHERE i.id = selected.id AND i.project_id = NEW.project_id)) THEN
        RAISE EXCEPTION 'Release Sprints must belong to the same project' USING ERRCODE = '23503';
      END IF;
      DELETE FROM requirement_release_sprints WHERE release_id = NEW.id;
      INSERT INTO requirement_release_sprints(release_id, iteration_id)
        SELECT NEW.id, value FROM jsonb_array_elements_text(NEW.sprint_ids) ON CONFLICT DO NOTHING;
      RETURN NEW;
    END $$`,
  `DROP TRIGGER IF EXISTS release_sprint_relations_sync ON requirement_releases`,
  `CREATE TRIGGER release_sprint_relations_sync AFTER INSERT OR UPDATE OF sprint_ids, project_id
    ON requirement_releases FOR EACH ROW EXECUTE FUNCTION sync_release_sprint_relations()`,
  `INSERT INTO requirement_release_sprints(release_id, iteration_id)
    SELECT r.id, i.id FROM requirement_releases r
    CROSS JOIN LATERAL jsonb_array_elements_text(r.sprint_ids) selected(id)
    JOIN requirement_iterations i ON i.id = selected.id AND i.project_id = r.project_id
    ON CONFLICT DO NOTHING`,
  `DELETE FROM requirement_release_sprints relation WHERE NOT EXISTS (
    SELECT 1 FROM requirement_releases r JOIN requirement_iterations i ON i.project_id = r.project_id
    WHERE r.id = relation.release_id AND i.id = relation.iteration_id
      AND r.sprint_ids @> jsonb_build_array(i.id))`,
  `ALTER TABLE executions ADD COLUMN IF NOT EXISTS release_id TEXT REFERENCES requirement_releases(id) ON DELETE SET NULL`,
  `ALTER TABLE executions ADD COLUMN IF NOT EXISTS iteration_id TEXT REFERENCES requirement_iterations(id) ON DELETE SET NULL`,
  `CREATE INDEX IF NOT EXISTS idx_executions_release_scope ON executions(project_id, release_id, created_at DESC, id)`,
  `CREATE INDEX IF NOT EXISTS idx_executions_iteration_scope ON executions(project_id, iteration_id, created_at DESC, id)`,
  `CREATE INDEX IF NOT EXISTS idx_executions_native_release ON executions(release_id) WHERE release_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_executions_native_iteration ON executions(iteration_id) WHERE iteration_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_executions_legacy_release ON executions(project_id, (LOWER(TRIM(release)))) WHERE release_id IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_executions_legacy_sprint ON executions(project_id, (LOWER(TRIM(sprint)))) WHERE iteration_id IS NULL`,
  `CREATE OR REPLACE FUNCTION resolve_execution_delivery_relations() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE resolve_release BOOLEAN; resolve_sprint BOOLEAN;
    BEGIN
      IF TG_OP = 'INSERT' THEN
        resolve_release := NEW.release_id IS NULL;
        resolve_sprint := NEW.iteration_id IS NULL;
      ELSE
        resolve_release := (NEW.release IS DISTINCT FROM OLD.release OR NEW.project_id IS DISTINCT FROM OLD.project_id)
          AND NEW.release_id IS NOT DISTINCT FROM OLD.release_id
          OR NEW.release_id IS NULL AND OLD.release_id IS NULL;
        resolve_sprint := (NEW.sprint IS DISTINCT FROM OLD.sprint OR NEW.project_id IS DISTINCT FROM OLD.project_id)
          AND NEW.iteration_id IS NOT DISTINCT FROM OLD.iteration_id
          OR NEW.iteration_id IS NULL AND OLD.iteration_id IS NULL;
      END IF;
      IF resolve_release THEN
        SELECT CASE WHEN COUNT(*) = 1 THEN MIN(id) END INTO NEW.release_id
        FROM requirement_releases WHERE project_id = NEW.project_id
          AND NULLIF(LOWER(TRIM(NEW.release)), '') IS NOT NULL
          AND (LOWER(TRIM(fix_version)) = LOWER(TRIM(NEW.release)) OR LOWER(TRIM(name)) = LOWER(TRIM(NEW.release)));
      END IF;
      IF resolve_sprint THEN
        SELECT CASE WHEN COUNT(*) = 1 THEN MIN(id) END INTO NEW.iteration_id
        FROM requirement_iterations WHERE project_id = NEW.project_id
          AND NULLIF(LOWER(TRIM(NEW.sprint)), '') IS NOT NULL AND LOWER(TRIM(name)) = LOWER(TRIM(NEW.sprint));
      END IF;
      IF NEW.release_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.release_id IS DISTINCT FROM OLD.release_id OR NEW.project_id IS DISTINCT FROM OLD.project_id)
        AND NOT EXISTS (SELECT 1 FROM requirement_releases WHERE id = NEW.release_id AND project_id = NEW.project_id) THEN
        RAISE EXCEPTION 'Run Release must belong to the same project' USING ERRCODE = '23503';
      END IF;
      IF NEW.iteration_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.iteration_id IS DISTINCT FROM OLD.iteration_id OR NEW.project_id IS DISTINCT FROM OLD.project_id)
        AND NOT EXISTS (SELECT 1 FROM requirement_iterations WHERE id = NEW.iteration_id AND project_id = NEW.project_id) THEN
        RAISE EXCEPTION 'Run Sprint must belong to the same project' USING ERRCODE = '23503';
      END IF;
      RETURN NEW;
    END $$`,
  `DROP TRIGGER IF EXISTS executions_delivery_relations ON executions`,
  `CREATE TRIGGER executions_delivery_relations BEFORE INSERT OR UPDATE OF project_id, release, sprint, release_id, iteration_id
    ON executions FOR EACH ROW EXECUTE FUNCTION resolve_execution_delivery_relations()`,
  `CREATE OR REPLACE FUNCTION resolve_existing_runs_for_new_release() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      UPDATE executions SET release = release WHERE project_id = NEW.project_id AND release_id IS NULL
        AND LOWER(TRIM(release)) IN (LOWER(TRIM(NEW.fix_version)), LOWER(TRIM(NEW.name)));
      RETURN NEW;
    END $$`,
  `DROP TRIGGER IF EXISTS new_release_existing_runs ON requirement_releases`,
  `CREATE TRIGGER new_release_existing_runs AFTER INSERT ON requirement_releases
    FOR EACH ROW EXECUTE FUNCTION resolve_existing_runs_for_new_release()`,
  `CREATE OR REPLACE FUNCTION resolve_existing_runs_for_new_sprint() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      UPDATE executions SET sprint = sprint WHERE project_id = NEW.project_id AND iteration_id IS NULL
        AND LOWER(TRIM(sprint)) = LOWER(TRIM(NEW.name));
      RETURN NEW;
    END $$`,
  `DROP TRIGGER IF EXISTS new_sprint_existing_runs ON requirement_iterations`,
  `CREATE TRIGGER new_sprint_existing_runs AFTER INSERT ON requirement_iterations
    FOR EACH ROW EXECUTE FUNCTION resolve_existing_runs_for_new_sprint()`,
  // Resolve existing evidence without rewriting its original run labels.
  `UPDATE executions e SET release = e.release, sprint = e.sprint
    WHERE (e.release_id IS NULL AND NULLIF(TRIM(e.release), '') IS NOT NULL AND
      (SELECT COUNT(*) FROM requirement_releases r WHERE r.project_id = e.project_id AND
        (LOWER(TRIM(r.fix_version)) = LOWER(TRIM(e.release)) OR LOWER(TRIM(r.name)) = LOWER(TRIM(e.release)))) = 1)
       OR (e.iteration_id IS NULL AND NULLIF(TRIM(e.sprint), '') IS NOT NULL AND
      (SELECT COUNT(*) FROM requirement_iterations i WHERE i.project_id = e.project_id AND LOWER(TRIM(i.name)) = LOWER(TRIM(e.sprint))) = 1)`,
  `CREATE OR REPLACE FUNCTION clear_deleted_sprint_delivery_scope() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      UPDATE requirement_releases r SET sprint_ids = (SELECT COALESCE(jsonb_agg(selected.id), '[]'::jsonb)
        FROM jsonb_array_elements_text(r.sprint_ids) selected(id) JOIN requirement_iterations i ON i.id = selected.id AND i.project_id = r.project_id)
        WHERE sprint_ids @> jsonb_build_array(OLD.id);
      RETURN OLD;
    END $$`,
  `DROP TRIGGER IF EXISTS deleted_sprint_delivery_scope ON requirement_iterations`,
  `CREATE TRIGGER deleted_sprint_delivery_scope AFTER DELETE ON requirement_iterations
    FOR EACH ROW EXECUTE FUNCTION clear_deleted_sprint_delivery_scope()`
];
