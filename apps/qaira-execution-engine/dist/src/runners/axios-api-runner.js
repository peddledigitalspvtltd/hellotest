import axios from "axios";
import { JSONPath } from "jsonpath-plus";
export class AxiosApiRunner {
    async setup(_context) {
        return;
    }
    async executeStep(step, context) {
        const startedAt = new Date().toISOString();
        const stepStartTime = Date.now();
        const method = String(step.parameters?.method || "GET").toUpperCase();
        const url = String(step.parameters?.url || "");
        try {
            const response = await axios.request({
                method: method,
                url,
                headers: step.parameters?.headers,
                data: step.parameters?.body ?? undefined,
                timeout: step.timeoutMs || 30_000
            });
            const captures = {};
            if (Array.isArray(step.parameters?.captures)) {
                for (const capture of step.parameters?.captures) {
                    const value = JSONPath({ path: capture.path, json: response.data });
                    captures[capture.name] = Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
                }
            }
            Object.entries(captures).forEach(([key, value]) => {
                context.setRunVariable(key, value);
            });
            const assertions = Array.isArray(step.parameters?.assertions) ? step.parameters.assertions : [];
            for (const assertion of assertions) {
                if (assertion.kind === "status" && Number(assertion.expected) !== response.status) {
                    throw new Error(`Expected status ${assertion.expected} but got ${response.status}`);
                }
                if (assertion.kind === "body_contains" && !String(response.data).includes(String(assertion.expected || ""))) {
                    throw new Error(`Response body does not contain expected text`);
                }
                if (assertion.kind === "json_path") {
                    const copied = JSONPath({ path: String(assertion.target), json: response.data });
                    if (!copied.length) {
                        throw new Error(`JSONPath ${assertion.target} did not resolve`);
                    }
                }
            }
            context.setStepOutput(step.stepId, response.data);
            return {
                stepId: step.stepId,
                status: "passed",
                startedAt,
                endedAt: new Date().toISOString(),
                durationMs: Date.now() - stepStartTime,
                data: {
                    status: response.status,
                    headers: response.headers,
                    body: response.data,
                    captures
                }
            };
        }
        catch (error) {
            return {
                stepId: step.stepId,
                status: "failed",
                startedAt,
                endedAt: new Date().toISOString(),
                durationMs: Date.now() - stepStartTime,
                note: error instanceof Error ? error.message : String(error)
            };
        }
    }
    async captureArtifact(_step, _context) {
        return;
    }
    async teardown(_context) {
        return;
    }
}
//# sourceMappingURL=axios-api-runner.js.map