const executionScheduleService = require("../services/executionSchedule.service");
const aiTestCaseGenerationService = require("../services/aiTestCaseGeneration.service");
const aiAutomationBuilderService = require("../services/aiAutomationBuilder.service");
const projectSyncService = require("../services/projectSync.service");
const batchProcessService = require("../services/batchProcess.service");

module.exports = async function backgroundTasksPlugin(fastify) {
  const timers = new Set();

  const registerRecurringTask = ({ intervalMs, label, run, runImmediately = true }) => {
    const guardedRun = async () => {
      try {
        await run();
      } catch (error) {
        fastify.log.error(error, label);
      }
    };

    fastify.addHook("onReady", async () => {
      if (runImmediately) {
        await guardedRun();
      }

      timers.add(setInterval(guardedRun, intervalMs));
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
    intervalMs: 60 * 1000,
    label: "Unable to process queued project sync jobs",
    run: async () => {
      await projectSyncService.processScheduledIntegrations();
      await projectSyncService.processQueuedSyncs();
    }
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
    for (const timer of timers) {
      clearInterval(timer);
    }

    timers.clear();
  });
};
