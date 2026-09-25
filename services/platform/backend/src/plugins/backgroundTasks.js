const { routeEnabled } = require("../runtime/serviceProfile");
const workerLoaders = [
  ["platform", () => require("@hellotest/platform/backend/workers")],
  ["agentic", () => require("@hellotest/agentic/backend/workers")],
  ["testing", () => require("@hellotest/testing/backend/workers")],
  ["ai", () => require("@hellotest/ai/backend/workers")],
  ["integration", () => require("@hellotest/integration/backend/workers")],
  ["knowledge", () => require("@hellotest/knowledge/backend/workers")],
  ["automation", () => require("@hellotest/automation/backend/workers")]
];

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

  const workers = workerLoaders.filter(([owner]) => routeEnabled({ service: owner }))
    .map(([, load]) => load()());
  for (const worker of workers) for (const task of worker.tasks) registerRecurringTask(task);

  fastify.addHook("onClose", async () => {
    acceptingWork = false;
    await Promise.allSettled(workers.map((worker) => worker.close()));
    for (const timer of timers) {
      clearInterval(timer);
    }

    timers.clear();
    await Promise.allSettled([...inFlight]);
  });
};
