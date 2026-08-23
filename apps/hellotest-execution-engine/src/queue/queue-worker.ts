import { Worker, type Job } from "bullmq";
import Redis from "ioredis";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { EngineApiClient } from "../backend-api-client.js";
import { RunOrchestrator } from "../orchestrator/run-orchestrator.js";

export class QueueWorker {
  private readonly connection: Redis;
  private readonly worker: Worker;
  private readonly apiClient = new EngineApiClient();

  constructor() {
    this.connection = new Redis(config.redisUrl);
    this.worker = new Worker(
      config.queueName,
      async (job: Job) => this.processJob(job),
      {
        connection: this.connection,
        concurrency: 1,
        lockDuration: 60_000
      }
    );

    this.worker.on("error", (error) => {
      logger.error({ error }, "Queue worker error");
    });
  }

  async start(): Promise<void> {
    logger.info({ queue: config.queueName, redis: config.redisUrl }, "Starting engine queue worker");
    await this.worker.waitUntilReady();
  }

  private async processJob(job: Job): Promise<void> {
    logger.info({ jobId: job.id, runId: job.data?.runId }, "Processing queue job");

    const claim = await this.apiClient.claimRun(config.engineId);
    if (!claim?.runId) {
      throw new Error("No queued run available to claim");
    }

    const snapshot = await this.apiClient.loadRunSnapshot(claim.runId);
    const orchestrator = new RunOrchestrator(claim.runId, snapshot, this.apiClient);
    await orchestrator.execute();
  }

  async stop(): Promise<void> {
    await this.worker.close();
    await this.connection.quit();
  }
}
