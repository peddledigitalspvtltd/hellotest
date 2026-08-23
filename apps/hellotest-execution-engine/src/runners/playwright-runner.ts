import { chromium, firefox, webkit, type Browser, type BrowserContext, type Page } from "playwright";
import type { ExecutionContext, RunStep, RunnerStepResult } from "../models/execution.js";
import type { RunnerAdapter } from "./runner-adapter.js";

const resolveBrowser = async (browserName: string) => {
  if (browserName === "firefox") {
    return await firefox.launch({ headless: true });
  }

  if (browserName === "webkit") {
    return await webkit.launch({ headless: true });
  }

  return await chromium.launch({ headless: true });
};

export class PlaywrightRunner implements RunnerAdapter {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;

  async setup(_context: ExecutionContext): Promise<void> {
    this.browser = await resolveBrowser("chromium");
    this.context = await this.browser.newContext();
    this.page = await this.context.newPage();
  }

  async executeStep(step: RunStep, _context: ExecutionContext): Promise<RunnerStepResult> {
    if (!this.page) {
      throw new Error("Playwright page is not initialized");
    }

    const startedAt = new Date().toISOString();
    const stepStartTime = Date.now();

    try {
      switch (step.action) {
        case "goto":
          await this.page.goto(String(step.parameters?.url), { timeout: step.timeoutMs || 30_000 });
          break;
        case "click":
          await this.page.click(String(step.parameters?.selector), { timeout: step.timeoutMs || 30_000 });
          break;
        case "fill":
          await this.page.fill(String(step.parameters?.selector), String(step.parameters?.value));
          break;
        case "select":
          await this.page.selectOption(String(step.parameters?.selector), String(step.parameters?.value));
          break;
        case "upload":
          await this.page.setInputFiles(String(step.parameters?.selector), String(step.parameters?.filePath));
          break;
        case "wait":
          if (step.parameters?.selector) {
            await this.page.waitForSelector(String(step.parameters.selector), { timeout: step.timeoutMs || 30_000 });
          } else {
            await this.page.waitForTimeout(Number(step.parameters?.timeoutMs || 1000));
          }
          break;
        case "assert": {
          const actual = await this.page.textContent(String(step.parameters?.selector));
          const expected = String(step.parameters?.value || "");
          if (actual?.trim() !== expected.trim()) {
            throw new Error(`Assertion failed: expected '${expected}' but got '${actual}'`);
          }
          break;
        }
        default:
          throw new Error(`Unsupported web action: ${step.action}`);
      }

      return {
        stepId: step.stepId,
        status: "passed",
        startedAt,
        endedAt: new Date().toISOString(),
        durationMs: Date.now() - stepStartTime,
        data: {}
      };
    } catch (error) {
      const note = error instanceof Error ? error.message : String(error);
      if (this.page) {
        try {
          await this.page.screenshot({ path: `./playwright-failure-${step.stepId}.png`, fullPage: true });
        } catch {
          // ignore
        }
      }
      return {
        stepId: step.stepId,
        status: "failed",
        startedAt,
        endedAt: new Date().toISOString(),
        durationMs: Date.now() - stepStartTime,
        note
      };
    }
  }

  async captureArtifact(_step: RunStep, _context: ExecutionContext): Promise<void> {
    return;
  }

  async teardown(_context: ExecutionContext): Promise<void> {
    if (this.page) {
      await this.page.close();
    }
    if (this.context) {
      await this.context.close();
    }
    if (this.browser) {
      await this.browser.close();
    }
  }
}
