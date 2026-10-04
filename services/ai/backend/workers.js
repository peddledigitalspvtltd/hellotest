// Loaded only by the process that owns these background jobs.
module.exports = () => {
    const aiTestCaseGenerationService = require("./services/aiTestCaseGeneration.service");
    const requirementWorkspaceService = require("@hellotest/manual/backend/services/requirementWorkspace.service");
    const qualityGraphChanges = require('./services/qualityGraphChanges');
    return {
        tasks: [
            { intervalMs: 5000, label: 'Unable to invalidate changed quality evidence', run: () => qualityGraphChanges.processPending(), runImmediately: false },
            {
                intervalMs: 15 * 1000,
                label: "Unable to process queued AI test case generation jobs",
                run: () => aiTestCaseGenerationService.processQueuedJobs()
            },
            {
                intervalMs: 10 * 1000,
                label: "Unable to process queued Story AI generation jobs",
                run: () => requirementWorkspaceService.processQueuedGenerationJobs(),
                runImmediately: false
            }
        ],
        close: async () => { await Promise.allSettled([]); }
    };
};
