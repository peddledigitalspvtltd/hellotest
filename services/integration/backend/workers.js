// Loaded only by the process that owns these background jobs.
module.exports = () => {
    const projectSyncService = require("./services/projectSync.service");
    return {
        tasks: [
            {
                intervalMs: 60 * 1000,
                label: "Unable to process queued project sync jobs",
                run: async () => {
                    await projectSyncService.processScheduledIntegrations();
                    await projectSyncService.processQueuedSyncs();
                }
            }
        ],
        close: async () => { await Promise.allSettled([]); }
    };
};
