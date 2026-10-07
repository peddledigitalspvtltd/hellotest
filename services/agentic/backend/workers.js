// Loaded only by the process that owns these background jobs.
module.exports = () => {
    const repositoryAgentsService = require("./agents/repositoryAgents.service");
    const qualityAgentsService = require("./services/qualityAgents.service");
    return {
        tasks: [
            {
                intervalMs: 2 * 1000,
                label: "Unable to process queued repository agent analyses",
                run: () => repositoryAgentsService.processQueuedRuns(),
                runImmediately: false
            },
            {
                intervalMs: 2 * 1000,
                label: "Unable to reconcile durable quality agent reviews",
                run: () => qualityAgentsService.processQueuedRuns(),
                runImmediately: true
            }
        ],
        close: async () => { await Promise.allSettled([repositoryAgentsService.shutdown(),qualityAgentsService.shutdown()]); }
    };
};
