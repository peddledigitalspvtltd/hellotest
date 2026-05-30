import { JSONPath } from "jsonpath-plus";
import type { ExecutionContext } from "../models/execution.js";

const TEMPLATE_PATTERN = /{{\s*([\w.\-\[\]'"@:\/]+)\s*}}/g;

export class ExecutionContextManager {
  private readonly context: ExecutionContext;

  constructor(initialValues: Record<string, string> = {}) {
    this.context = {
      runVariables: { ...initialValues },
      caseVariables: {},
      shared: {},
      outputs: {}
    };
  }

  setRunVariable(key: string, value: string) {
    this.context.runVariables[key] = value;
  }

  setSharedVariable(key: string, value: string) {
    this.context.shared[key] = value;
  }

  setCaseVariable(caseId: string, key: string, value: string) {
    this.context.caseVariables[caseId] = this.context.caseVariables[caseId] || {};
    this.context.caseVariables[caseId][key] = value;
  }

  getRunVariable(key: string): string | undefined {
    return this.context.runVariables[key];
  }

  getCaseVariable(caseId: string, key: string): string | undefined {
    return this.context.caseVariables[caseId]?.[key];
  }

  resolveTemplate(value: string, caseId?: string): string {
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

  extractJsonPath(path: string, source: unknown): string | undefined {
    if (!path || !source) {
      return undefined;
    }

    try {
      const result = JSONPath({ path, json: source });
      if (Array.isArray(result) && result.length > 0) {
        return String(result[0]);
      }
      return result == null ? undefined : String(result);
    } catch {
      return undefined;
    }
  }

  setStepOutput(stepId: string, output: unknown) {
    this.context.outputs[stepId] = output;
  }

  getStepOutput(stepId: string): unknown {
    return this.context.outputs[stepId];
  }

  createCaseIsolation(caseId: string) {
    this.context.caseVariables[caseId] = this.context.caseVariables[caseId] || {};
  }

  getContext(): ExecutionContext {
    return this.context;
  }
}
