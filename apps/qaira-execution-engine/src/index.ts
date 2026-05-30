import "dotenv/config";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { initializeTelemetry, shutdownTelemetry } from "./telemetry.js";
import { QueueWorker } from "./queue/queue-worker.js";

const main = async () => {
  await initializeTelemetry();

  const queueWorker = new QueueWorker();

  process.on("SIGINT", async () => {
    logger.info("Shutdown requested");
    await queueWorker.stop();
    await shutdownTelemetry();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    logger.info("Termination requested");
    await queueWorker.stop();
    await shutdownTelemetry();
    process.exit(0);
  });

  await queueWorker.start();
  logger.info({ engineId: config.engineId }, "QAira Execution Engine is running");
};

main().catch(async (error) => {
  logger.error({ error }, "Execution engine failed to start");
  await shutdownTelemetry();
  process.exit(1);
});
