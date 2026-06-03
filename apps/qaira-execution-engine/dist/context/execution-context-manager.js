import { JSONPath } from "jsonpath-plus";
const TEMPLATE_PATTERN = /{{\s*([\w.\-\[\]'"@:\/]+)\s*}}/g;
export class ExecutionContextManager {
    context;
    constructor(initialValues = {}) {
        this.context = {
            runVariables: { ...initialValues },
            caseVariables: {},
            shared: {},
            outputs: {}
        };
    }
    setRunVariable(key, value) {
        this.context.runVariables[key] = value;
    }
    setSharedVariable(key, value) {
        this.context.shared[key] = value;
    }
    setCaseVariable(caseId, key, value) {
        this.context.caseVariables[caseId] = this.context.caseVariables[caseId] || {};
        this.context.caseVariables[caseId][key] = value;
    }
    getRunVariable(key) {
        return this.context.runVariables[key];
    }
    getCaseVariable(caseId, key) {
        return this.context.caseVariables[caseId]?.[key];
    }
    resolveTemplate(value, caseId) {
        return value.replace(TEMPLATE_PATTERN, (match, token) => {
            const direct = this.context.caseVariables[caseId || ""]?.[token] ?? this.context.runVariables[token] ?? this.context.shared[token];
            if (direct !== undefined) {
                return String(direct);
            }
            if (token.startsWith("$.")) {
                const extracted = this.extractJsonPath(token, this.context.outputs);
                return extracted ?? match;
            }
            return match;
        });
    }
    extractJsonPath(path, source) {
        if (!path || !source) {
            return undefined;
        }
        try {
            const result = JSONPath({ path, json: source });
            if (Array.isArray(result) && result.length > 0) {
                return String(result[0]);
            }
            return result == null ? undefined : String(result);
        }
        catch {
            return undefined;
        }
    }
    setStepOutput(stepId, output) {
        this.context.outputs[stepId] = output;
    }
    getStepOutput(stepId) {
        return this.context.outputs[stepId];
    }
    createCaseIsolation(caseId) {
        this.context.caseVariables[caseId] = this.context.caseVariables[caseId] || {};
    }
    getContext() {
        return this.context;
    }
}
//# sourceMappingURL=execution-context-manager.js.map