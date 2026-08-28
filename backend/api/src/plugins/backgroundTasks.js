const executionScheduleService = require("../services/executionSchedule.service");
const aiTestCaseGenerationService = require("../services/aiTestCaseGeneration.service");
const aiAutomationBuilderService = require("../services/aiAutomationBuilder.service");
const projectSyncService = require("../services/projectSync.service");
const batchProcessService = require("../services/batchProcess.service");
const knowledgeRagService = require("../services/knowledgeRag.service");
const requirementWorkspaceService = require("../services/requirementWorkspace.service");

module.exports = async function backgroundTasksPlugin(fastify) {
  const timers = new Set();
  const inFlight = new Set();
  let acceptingWork = true;

  const registerRecurringTask = ({ intervalMs, label, run, runImmediately = true }) => {
    let running = false;
    const guardedRun = async () => {
      if (running || !acceptingWork) return;
      running = true;
      const operation = Promise.resolve()
        .then(run)
        .catch((error) => {
          fastify.log.error(error, label);
        })
        .finally(() => {
          running = false;
          inFlight.delete(operation);
        });
      inFlight.add(operation);
      return operation;
    };

    fastify.addHook("onReady", async () => {
      if (runImmediately) {
        await guardedRun();
      }

      const timer = setInterval(guardedRun, intervalMs);
      timers.add(timer);
    });
  };

  registerRecurringTask({
    intervalMs: 60 * 1000,
    label: "Unable to process due execution schedules",
    run: () => executionScheduleService.processDueSchedules()
  });

  registerRecurringTask({
    intervalMs: 15 * 1000,
    label: "Unable to process queued AI test case generation jobs",
    run: () => aiTestCaseGenerationService.processQueuedJobs()
  });

  registerRecurringTask({
    intervalMs: 10 * 1000,
    label: "Unable to process queued Story AI generation jobs",
    run: () => requirementWorkspaceService.processQueuedGenerationJobs(),
    runImmediately: false
  });

  registerRecurringTask({
    intervalMs: 60 * 1000,
    label: "Unable to process queued project sync jobs",
    run: async () => {
      await projectSyncService.processScheduledIntegrations();
      await projectSyncService.processQueuedSyncs();
    }
  });

  registerRecurringTask({
    intervalMs: 5 * 1000,
    label: "Unable to process queued Knowledge Repo ingestion jobs",
    run: async () => {
      await knowledgeRagService.processQueuedIngestions({ limit: 2, staleAfterMinutes: 60 });
      await knowledgeRagService.processLegacyKnowledgeSyncOutbox({ limit: 4, leaseMinutes: 10 });
    },
    runImmediately: false
  });

  registerRecurringTask({
    intervalMs: 30 * 1000,
    label: "Unable to process queued batch jobs",
    run: () => batchProcessService.processQueuedJobs()
  });

  registerRecurringTask({
    intervalMs: 60 * 1000,
    label: "Unable to clean up orphan recorder sessions",
    run: () => aiAutomationBuilderService.cleanupOrphanRecorderSessions(),
    runImmediately: false
  });

  fastify.addHook("onClose", async () => {
    acceptingWork = false;
    for (const timer of timers) {
      clearInterval(timer);
    }

    timers.clear();
    await Promise.allSettled([...inFlight]);
  });
};
