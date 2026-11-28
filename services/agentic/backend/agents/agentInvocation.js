const nodeKinds = require('../../shared/workflowNodeKinds.json');
const interactive = Object.freeze({ stream: true, progress: true, diagnostics: true });
const workflow = Object.freeze({ stream: false, progress: false, diagnostics: false });

// The host selects presentation. A workflow definition or mapped value cannot
// turn on live agent output, and standalone callers retain their event stream.
function forWorkflowNode(kind, data = {}) {
  const mode = nodeKinds.kinds[kind]?.agent_output;
  return mode === 'final' || mode === 'loop-review' && data?.loopAction === 'customAI' ? workflow : interactive;
}

function finalReview(result) {
  const { model_call_records: _modelCalls, ...outcome } = result;
  return outcome;
}

// Whole cases saved before a terminal failure remain a reviewable outcome.
// The private checkpoint itself contains resume state and is never emitted.
function completedAutomationDrafts(checkpoint) {
  if (!Array.isArray(checkpoint?.stories)) return;
  const data = checkpoint.stories.filter(story => Array.isArray(story?.automation) && story.automation.some(Boolean)).map(story => ({
    story_id: story.story_id,
    story_revision: story.story_revision,
    automation: story.automation,
    automation_input_required: story.automation_input_required,
    automation_failures: story.automation_failures
  }));
  if (data.length && Buffer.byteLength(JSON.stringify(data)) <= 2 * 1024 * 1024) {
    return { artifact_task: 'automation-engineer', partial: true, data };
  }
}

module.exports = { interactive, workflow, forWorkflowNode, finalReview, completedAutomationDrafts };
