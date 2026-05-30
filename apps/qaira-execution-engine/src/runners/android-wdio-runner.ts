import { remote, type Browser } from "webdriverio";
import type { ExecutionContext, RunStep, RunnerStepResult } from "../models/execution.js";
import type { RunnerAdapter } from "./runner-adapter.js";

export class AndroidWdioRunner implements RunnerAdapter {
  private session: Browser | null = null;

  async setup(context: ExecutionContext): Promise<void> {
    const capabilities = {
      platformName: "Android",
      deviceName: String(context.runVariables["deviceName"] || "Android Emulator"),
      app: String(context.runVariables["app"] || ""),
      automationName: "UiAutomator2"
    };

    this.session = await remote({
      path: "/wd/hub",
      protocol: "http",
      hostname: String(context.runVariables["appiumHost"] || "localhost"),
      port: Number(context.runVariables["appiumPort"] || 4723),
      capabilities
    });
  }

  async executeStep(step: RunStep, _context: ExecutionContext): Promise<RunnerStepResult> {
    if (!this.session) {
      throw new Error("Android session is not initialized");
    }

    const startedAt = new Date().toISOString();
    const stepStartTime = Date.now();

    try {
      switch (step.action) {
        case "launch":
          await this.session.launchApp();
          break;
        case "tap": {
          const element = await this.session.$(String(step.parameters?.selector));
          await element.click();
          break;
        }
        case "type": {
          const element = await this.session.$(String(step.parameters?.selector));
          await element.setValue(String(step.parameters?.text));
          break;
        }
        case "waitForElement": {
          const element = await this.session.$(String(step.parameters?.selector));
          await element.waitForExist({ timeout: step.timeoutMs || 30_000 });
          break;
        }
        case "scroll": {
          const element = await this.session.$(String(step.parameters?.selector));
          await element.scrollIntoView();
          break;
        }
        case "assert": {
          const element = await this.session.$(String(step.parameters?.selector));
          const text = await element.getText();
          if (String(text).trim() !== String(step.parameters?.value || "").trim()) {
            throw new Error(`Expected '${step.parameters?.value}' but got '${text}'`);
          }
          break;
        }
        default:
          throw new Error(`Unsupported android action: ${step.action}`);
      }

      return {
        stepId: step.stepId,
        status: "passed",
        startedAt,
        endedAt: new Date().toISOString(),
        durationMs: Date.now() - stepStartTime
      };
    } catch (error) {
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

  async captureArtifact(step: RunStep, _context: ExecutionContext): Promise<void> {
    if (!this.session) {
      return;
    }

    await this.session.saveScreenshot(`./android-failure-${step.stepId}.png`);
  }

  async teardown(_context: ExecutionContext): Promise<void> {
    if (this.session) {
      await this.session.deleteSession();
    }
  }
}
