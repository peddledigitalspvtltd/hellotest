// Loaded only by the process that owns these background jobs.
module.exports = () => {
    const aiAutomationBuilderService = require("./services/aiAutomationBuilder.service");
    return {
        tasks: [
            {
                intervalMs: 60 * 1000,
                label: "Unable to clean up orphan recorder sessions",
                run: () => aiAutomationBuilderService.cleanupOrphanRecorderSessions(),
                runImmediately: false
            }
        ],
        close: async () => { await Promise.allSettled([]); }
    };
};
