// Loaded only by the process that owns these background jobs.
module.exports = () => {
    const executionScheduleService = require("./services/executionSchedule.service");
    const batchProcessService = require("./services/batchProcess.service");
    return {
        tasks: [
            {
                intervalMs: 60 * 1000,
                label: "Unable to process due execution schedules",
                run: () => executionScheduleService.processDueSchedules()
            },
            {
                intervalMs: 30 * 1000,
                label: "Unable to process queued batch jobs",
                run: () => batchProcessService.processQueuedJobs()
            }
        ],
        close: async () => { await Promise.allSettled([]); }
    };
};
