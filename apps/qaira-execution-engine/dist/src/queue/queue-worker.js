import { QueueScheduler, Worker } from "bullmq";
import Redis from "ioredis";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { EngineApiClient } from "../backend-api-client.js";
import { RunOrchestrator } from "../orchestrator/run-orchestrator.js";
export class QueueWorker {
    connection;
    scheduler;
    worker;
    apiClient = new EngineApiClient();
    constructor() {
        this.connection = new Redis(config.redisUrl);
        this.scheduler = new QueueScheduler(config.queueName, { connection: this.connection });
        this.worker = new Worker(config.queueName, async (job) => this.processJob(job), {
            connection: this.connection,
            concurrency: 1,
            lockDuration: 60_000
        });
        this.worker.on("error", (error) => {
            logger.error({ error }, "Queue worker error");
        });
    }
    async start() {
        logger.info({ queue: config.queueName, redis: config.redisUrl }, "Starting engine queue worker");
        await this.scheduler.waitUntilReady();
    }
    async processJob(job) {
        logger.info({ jobId: job.id, runId: job.data?.runId }, "Processing queue job");
        const claim = await this.apiClient.claimRun(config.engineId);
        if (!claim?.runId) {
            throw new Error("No queued run available to claim");
        }
        const snapshot = await this.apiClient.loadRunSnapshot(claim.runId);
        const orchestrator = new RunOrchestrator(claim.runId, snapshot, this.apiClient);
        await orchestrator.execute();
    }
    async stop() {
        await this.worker.close();
        await this.scheduler.close();
        await this.connection.quit();
    }
}
//# sourceMappingURL=queue-worker.js.map