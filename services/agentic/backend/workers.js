// Loaded only by the process that owns these background jobs.
module.exports = () => {
    const repositoryAgentsService = require("./agents/repositoryAgents.service");
    return {
        tasks: [
            {
                intervalMs: 2 * 1000,
                label: "Unable to process queued repository agent analyses",
                run: () => repositoryAgentsService.processQueuedRuns(),
                runImmediately: false
            }
        ],
        close: async () => { await Promise.allSettled([repositoryAgentsService.shutdown()]); }
    };
};
