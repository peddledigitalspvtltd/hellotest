import pino from "pino";
import { config } from "./config.js";
export const logger = pino({
    level: config.logLevel,
    base: {
        engineId: config.engineId,
        service: "qaira-execution-engine"
    },
    timestamp: pino.stdTimeFunctions.isoTime
});
export const createChildLogger = (meta = {}) => logger.child(meta);
//# sourceMappingURL=logger.js.map