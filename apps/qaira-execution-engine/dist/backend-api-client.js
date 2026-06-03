import axios from "axios";
import { config } from "./config.js";
import { logger } from "./logger.js";
export class EngineApiClient {
    baseUrl;
    constructor(baseUrl = config.backendUrl) {
        this.baseUrl = baseUrl.replace(/\/+$/, "");
    }
    async claimRun(engineId) {
        const url = `${this.baseUrl}/api/engine/runs/claim`;
        logger.info({ url, engineId }, "Requesting a run claim");
        const response = await axios.post(url, { engine_id: engineId }, {
            timeout: 15_000
        });
        return response.data || null;
    }
    async loadRunSnapshot(runId) {
        const url = `${this.baseUrl}/api/engine/runs/${encodeURIComponent(runId)}/snapshot`;
        logger.info({ url, runId }, "Loading run snapshot");
        const response = await axios.get(url, {
            timeout: 20_000
        });
        return response.data;
    }
    async sendHeartbeat(runId, engineId) {
        const url = `${this.baseUrl}/api/engine/runs/${encodeURIComponent(runId)}/heartbeat`;
        try {
            await axios.post(url, { engine_id: engineId }, { timeout: 10_000 });
            return true;
        }
        catch (error) {
            logger.warn({ error, runId, engineId }, "Heartbeat failed");
            return false;
        }
    }
}
//# sourceMappingURL=backend-api-client.js.map