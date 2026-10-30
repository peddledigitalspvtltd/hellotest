const profiles = require('../../shared/workflowNativeTasks.json');

// Defaults become part of the saved node and execution snapshot. Editing the
// catalog never replaces guidance already saved on a node, including blanks.
function withNativeTaskDefaults(nodes) {
  return nodes.map(node => {
    const data = node?.data;
    const profile = data?.kind === 'artifactTask' && profiles[data.artifactTask];
    if (!profile) return node;
    return { ...node, data: {
      task: profile.task, instructions: profile.instructions, guardrails: profile.guardrails,
      ...(profile.readinessPolicy ? { readinessPolicy: profile.readinessPolicy } : {}),
      ...(data.artifactTask === 'automation-engineer' ? { inspectBrowser: true } : {}),
      ...data,
      instructions: typeof data.instructions === 'string' ? data.instructions
        : typeof data.prompt === 'string' && data.prompt.trim() ? data.prompt : profile.instructions
    } };
  });
}

module.exports = { withNativeTaskDefaults };
