// Loaded only by the process that owns these background jobs.
module.exports = () => {
    const llmTraceRetention = require("./src/obsDb/llmTraceRetention");
    const projectDeletionService = require("./services/projectDeletion.service");
    const instanceSetupService = require("./services/instanceSetup.service");
    return {
        tasks: [
            { intervalMs: 5 * 60 * 1000, label: "Unable to expire LLM traces", run: () => llmTraceRetention.expire(), runImmediately: false },
            {
                intervalMs: 2 * 1000,
                label: "Unable to process queued instance setup",
                run: () => instanceSetupService.processNext(),
                runImmediately: false
            },
            {
                intervalMs: 2 * 1000,
                label: "Unable to process queued project deletion",
                run: () => projectDeletionService.processNext(),
                runImmediately: false
            }
        ],
        close: async () => { await Promise.allSettled([projectDeletionService.close(), instanceSetupService.close()]); }
    };
};
