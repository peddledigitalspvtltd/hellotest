// These legacy project-owned tables do not consistently have a project FK in
// existing installations. The guard also admits writes only while the project
// is writable and holds a root-row lock until the writer's transaction ends.
// Deletion takes FOR UPDATE on that root before collecting/deleting child rows.
const guardedTables = [
  "agentic_workflow_runs",
  "agentic_workflows",
  "ai_knowledge_repo",
  "ai_prompt_templates",
  "ai_test_case_generation_jobs",
  "automation_generator_jobs",
  "execution_schedules"
];

module.exports = [
  `CREATE OR REPLACE FUNCTION public.enforce_project_deletion_write_guard()
    RETURNS TRIGGER LANGUAGE plpgsql AS $project_deletion_guard$
    BEGIN
      -- NULL-scoped legacy automation jobs retain their existing semantics.
      IF NEW.project_id IS NULL THEN RETURN NEW; END IF;
      -- Reject known deletion work before waiting on the deleter's root lock,
      -- then recheck after locking to close admission races with enqueue.
      IF EXISTS (
        SELECT 1 FROM public.project_deletion_jobs
        WHERE project_id = NEW.project_id AND status IN ('queued', 'running', 'cleanup')
      ) THEN
        RAISE EXCEPTION USING ERRCODE = 'PJD01', MESSAGE = 'Project is being deleted';
      END IF;
      PERFORM id FROM public.projects WHERE id = NEW.project_id FOR KEY SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'Project does not exist';
      END IF;
      IF EXISTS (
        SELECT 1 FROM public.project_deletion_jobs
        WHERE project_id = NEW.project_id AND status IN ('queued', 'running', 'cleanup')
      ) THEN
        RAISE EXCEPTION USING ERRCODE = 'PJD01', MESSAGE = 'Project is being deleted';
      END IF;
      RETURN NEW;
    END;
    $project_deletion_guard$`,
  ...guardedTables.flatMap(table => [
    `DROP TRIGGER IF EXISTS project_deletion_write_guard ON public.${table}`,
    `CREATE TRIGGER project_deletion_write_guard BEFORE INSERT OR UPDATE ON public.${table}
      FOR EACH ROW EXECUTE FUNCTION public.enforce_project_deletion_write_guard()`
  ])
];
