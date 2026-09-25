// Loaded only by the process that owns these background jobs.
module.exports = () => {
    const knowledgeRagService = require("./services/knowledgeRag.service");
    return {
        tasks: [
            {
                intervalMs: 5 * 1000,
                label: "Unable to process queued Knowledge Repo ingestion jobs",
                run: async () => {
                    await knowledgeRagService.processQueuedIngestions({ limit: 2, staleAfterMinutes: 60 });
                    await knowledgeRagService.processLegacyKnowledgeSyncOutbox({ limit: 4, leaseMinutes: 10 });
                },
                runImmediately: false
            }
        ],
        close: async () => { await Promise.allSettled([]); }
    };
};
