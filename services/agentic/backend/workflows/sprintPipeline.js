const { fail } = require('./endpointPolicy');

const WORKSPACE_SPRINT_STORIES = 'workspaceSprintStories';
const isSprintDraftPipeline = settings => ['sprint-automator', 'spec-to-script'].includes(settings?.template_id);
const isAutomaticSprintPublication = settings => isSprintDraftPipeline(settings) && settings.library_publication_mode === 'automatic';

async function readWorkspaceSprintStories({ run, user, signal }) {
  const tasks = require('./artifactTasks');
  const sprints = require('@hellotest/manual/backend/services/requirementIteration.service');
  const stories = require('@hellotest/manual/backend/services/requirement.service');
  const sprintId = tasks.checkSprintInput(run);
  await tasks.access(user, run.project_id, ['requirement_iteration.view', 'requirement.view']);
  const sprint = await sprints.getIterationSummary(sprintId).catch(error => {
    if (error.message !== 'Iteration not found') throw error;
    return null;
  });
  if (!sprint || sprint.project_id !== run.project_id) throw fail('Choose a Sprint in the workflow project.', 404);
  const capacity = require('./workflowLoopBudget').sprintCapacity(run.workflow_snapshot, run.input_payload) ?? 100;
  signal?.throwIfAborted();
  const page = await stories.getRequirementsPage({ project_id: run.project_id, sprint_id: sprintId, page_size: capacity, include_total: false });
  signal?.throwIfAborted();
  if (!page.is_last) throw fail(`The selected Sprint exceeds this workflow's ${capacity}-Story capacity. Reduce the configured case count or use a smaller Sprint.`, 422);
  return { data: { items: page.items.map(story => ({
    story_id: story.id, story_revision: tasks.revision(story), title: story.title, display_id: story.display_id
  })), sprint_id: sprintId } };
}

module.exports = { WORKSPACE_SPRINT_STORIES, isSprintDraftPipeline, isAutomaticSprintPublication, readWorkspaceSprintStories };
