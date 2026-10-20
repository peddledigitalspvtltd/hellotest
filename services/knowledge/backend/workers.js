// Loaded only by the process that owns these background jobs.
module.exports = () => {
    const knowledgeRagService = require("./services/knowledgeRag.service");
    const shutdown = new AbortController();
    return {
        tasks: [
            {
                intervalMs: 5000,
                label: "Unable to refresh project knowledge",
                run: () => require("./services/knowledgeRefresh.service").processDue(),
                runImmediately: false
            },
            {
                intervalMs: 5 * 1000,
                label: "Unable to process queued Knowledge Repo ingestion jobs",
                run: async () => {
                    await knowledgeRagService.processQueuedIngestions({ limit: 2, staleAfterMinutes: 60 });
                    await knowledgeRagService.processLegacyKnowledgeSyncOutbox({ limit: 4, leaseMinutes: 10 });
                },
                runImmediately: false
            },
            {
                intervalMs: 5000,
                label: "Unable to reconcile deleted Knowledge source records",
                run: () => require("./services/knowledgeSourceLifecycle.service").archiveMissingApplicationSources({ limit: 20 }),
                runImmediately: false
            },
            {
                intervalMs: 5000,
                label: "Unable to reconcile Knowledge graph evidence",
                run: () => require("./services/knowledgeGraph.service").processBackfill({ limit: 4 }),
                runImmediately: false
            },
            {
                intervalMs: 5000,
                label: "Unable to reconcile Knowledge vector projections",
                run: () => require("./services/knowledgeVectorProjection.service").processDue({ limit: 4, signal: shutdown.signal }),
                runImmediately: false
            }
        ],
        close: async () => { shutdown.abort(new Error("Knowledge workers are stopping")); }
    };
};
