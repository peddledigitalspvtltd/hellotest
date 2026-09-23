import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(new URL("../../../testengine/backend/package.json", import.meta.url));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const frontendRoot = new URL("../../", import.meta.url);
const fixture = `
import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "/src/auth/AuthContext";
import { api, sessionStorage } from "/src/lib/api";
import { consumeKnowledgeAssistantStream, KnowledgeStreamError } from "/src/lib/knowledgeAssistantStream";
import { GroundedAssistant } from "/src/components/GroundedAssistant";
import "/src/styles.css";
import "/src/dark-theme.css";
import "/src/catalog-list.css";
import "/src/modal-system.css";
import "/src/execution-run-builder.css";
import "/src/workspace-layout.css";
const session = { token: "fixture-only", user: { id: "qa", role: "admin", name: "QA", email: "fixture@example.test" } };
sessionStorage.write(session);
localStorage.setItem("hellotest.current_project_id", "qa-project");
api.auth.session = async () => session;
api.featureFlags.snapshot = async () => ({ flags: { "hellotest.ai.knowledge": true } });
api.settings.getWorkspacePreferences = async () => ({ preferences: {} });
api.knowledgeRepo.assistant.listIntegrations = async () => [{ id: "qa-model", name: "Project model", scope: "project", project_id: "qa-project", model: "QA Model", is_default: true }];
api.knowledgeRepo.assistant.listSessions = async () => [];
api.knowledgeRepo.assistant.createSession = async () => ({ id: "qa-session", project_id: "qa-project" });
api.knowledgeRepo.sourceDetail = async () => ({ source: { id: "knowledge-source", title: "Checkout release review", source_kind: "file", file_name: "checkout.md", extraction_status: "ready", chunk_count: 1, updated_at: "2026-09-22T10:00:00Z" }, revision: { id: "revision-1", is_current: true, effective_from: "2026-09-22T10:00:00Z", index_state: { required_indexes_ready: true, lexical_state: "ready", dense_state: "ready", indexed_chunk_count: 1 } }, fragments: [{ id: "fragment-1", heading: "Refund coverage", chunk_index: 0, content: "## Refund boundary\\n\\n**Risk:** the refund scenario lacks coverage.\\n\\n- Verify declined refunds\\n- Verify retry behavior", metadata: { page: 3 } }], authorization: { partial: false }, historical: false });
api.knowledgeRepo.sourceRevisions = async () => ({ source_id: "knowledge-source", revisions: [] });
const citation = { id: "e1", evidence_id: "e1", source_id: "knowledge-source", title: "Checkout release review", source_kind: "document", freshness: { current: true }, visibility: { state: "FULL" } };
const answer = (provider = false) => ({ assistant_message: { id: "answer-" + Date.now(), role: "assistant", content: "The checkout review identifies an untested refund scenario.", grounding_status: provider ? "provider_unavailable" : "partially_grounded", citations: [citation], context_packet: { contract_version: "1.0", packet_id: "qa", evidence: [citation], retrieval: { status: "PARTIAL" } }, answer_contract: { contract_type: "AnswerContract", contract_version: "1.0", status: provider ? "provider_unavailable" : "answered", summary: "The checkout review identifies an untested refund scenario.", claims: [{ statement: "**Checkout risk:** the refund scenario is untested.\\n- Verify declined refunds\\n- Verify retry behavior", classification: "SUPPORTED", evidence_ids: ["e1"] }], citation_ids: ["e1"], evidence_gaps: ["The latest test execution was unavailable."], limitations: { retrieval_status: "PARTIAL", unavailable_sources: 1 }, presentation: { recommended_type: "TEXT", structured_payload: {} } }, retrieval: { provider_error_code: provider ? "MODEL_AUTHENTICATION_FAILED" : undefined, processing_trace: [{ stage: "LEXICAL_SEARCH", status: "COMPLETE", message: "Found one release review." }, { stage: "GENERATION", status: provider ? "FAILED" : "COMPLETE", message: provider ? "Model connection not accepted." : "Answer completed." }] } } });
window.qa = { mode: "stream", calls: [], finish: null, progress: null, cancelled: 0 };
api.knowledgeRepo.assistant.streamMessage = async (id, input, options) => {
  window.qa.calls.push({ id, ...input });
  window.qa.progress = options.onProgress;
  options.onProgress({ contract_type: "RetrievalEvent", contract_version: "1.0", stage: "LEXICAL_SEARCH", status: "COMPLETE", message: "Found one release review.", metrics: { elapsed_ms: 520 } });
  if (window.qa.mode === "timeout") throw new KnowledgeStreamError("Service deadline exceeded", "DEADLINE_EXCEEDED");
  if (window.qa.mode === "provider") return answer(true);
  if (window.qa.mode === "success") return answer();
  if (window.qa.mode === "pending") { window.qa.mode = "success"; return { pending: true, retry_after_seconds: 1, client_turn_id: input.client_turn_id }; }
  if (window.qa.mode === "stream") {
    let transport;
    const response = new Response(new ReadableStream({ start(controller) { transport = controller; }, cancel() { window.qa.cancelled++; } }));
    const emit = (name, value) => transport.enqueue(new TextEncoder().encode("event: " + name + "\\ndata: " + JSON.stringify(value) + "\\n\\n"));
    window.qa.progress = (value) => emit("progress", value);
    window.qa.finish = () => { emit("result", answer()); transport.close(); };
    return consumeKnowledgeAssistantStream(response, options);
  }
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException("Stopped", "AbortError"));
    options.signal.addEventListener("abort", abort, { once: true });
    window.qa.finish = () => { options.signal.removeEventListener("abort", abort); resolve(answer()); };
  });
};
createRoot(document.getElementById("root")).render(<QueryClientProvider client={new QueryClient()}><AuthProvider><GroundedAssistant /></AuthProvider></QueryClientProvider>);
`;

test("assistant preserves turns and drafts through progress, pending, Stop, retry and model failure", { timeout: 60000 }, async () => {
  const name = `knowledge-qa-${randomUUID()}`;
  const html = new URL(`${name}.html`, frontendRoot);
  const source = new URL(`${name}.tsx`, frontendRoot);
  let browser;
  let page;
  const browserErrors = [];
  try {
    await writeFile(html, `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    await writeFile(source, fixture);
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
    page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") browserErrors.push(message.text()); });
    await page.goto(`${process.env.VITE_TEST_URL || "http://127.0.0.1:5173"}/${name}.html`);
    await page.getByRole("button", { name: "Open HelloTest grounded assistant", exact: true }).click();
    const input = page.getByRole("textbox", { name: "Ask about this HelloTest project" });
    await input.fill("What should we verify before the checkout release?");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await page.getByRole("region", { name: "Answer progress" }).waitFor();
    await input.fill("Keep this next question");
    assert.equal(await page.getByRole("button", { name: "Send message", exact: true }).isDisabled(), true);
    await page.evaluate(() => window.qa.progress({ contract_type: "RetrievalEvent", contract_version: "1.0", sequence: 2, stage: "GENERATION", status: "IN_PROGRESS", message: "Preparing an answer from the release review.", metrics: { elapsed_ms: 1200 } }));
    await page.locator(".grounded-assistant-progress-heading").getByText("Writing an answer from the evidence", { exact: true }).waitFor();
    await page.evaluate(() => {
      const retry = { contract_type: "RetrievalEvent", contract_version: "1.0", sequence: 3, stage: "GENERATION", status: "IN_PROGRESS", message: "Preparing an evidence-based answer", error_code: "MODEL_RATE_LIMITED", metrics: { model_attempt: 2, model_max_attempts: 3, retry_delay_ms: 1500, elapsed_ms: 2100 } };
      window.qa.progress(retry);
      window.qa.progress(retry);
    });
    await page.locator(".grounded-assistant-progress-heading").getByText("Retrying answer model · attempt 2 of 3", { exact: true }).waitFor();
    await page.getByRole("region", { name: "Answer progress" }).locator(":scope > p").getByText(/The provider is limiting requests. Retrying automatically/).waitFor();
    assert.equal(await page.evaluate(() => window.qa.calls.length), 1, "provider retries do not submit another frontend request");
    assert.equal(await page.locator(".grounded-assistant-message.is-user").count(), 1);
    await page.evaluate(() => window.qa.progress({ contract_type: "RetrievalEvent", contract_version: "1.0", sequence: 4, stage: "GENERATION", status: "IN_PROGRESS", error_code: "MODEL_TIMEOUT", metrics: { model_attempt: 3, model_max_attempts: 3, retry_delay_ms: 300, elapsed_ms: 5500 } }));
    await page.locator(".grounded-assistant-progress-heading").getByText("Retrying answer model · attempt 3 of 3", { exact: true }).waitFor();
    assert.equal(await page.locator(".grounded-assistant-progress-timeline li").getByText("Retrying answer model · attempt 2 of 3", { exact: true }).count(), 1);
    assert.equal(await page.locator(".grounded-assistant-progress-timeline li").getByText("Retrying answer model · attempt 3 of 3", { exact: true }).count(), 1);
    if (process.env.BROWSER_SCREENSHOT_DIR) await page.screenshot({ path: join(process.env.BROWSER_SCREENSHOT_DIR, "knowledge-assistant-progress.png"), animations: "disabled" });
    await page.setViewportSize({ width: 390, height: 950 });
    assert.equal(await page.getByRole("region", { name: "Answer progress" }).evaluate((node) => node.scrollWidth <= node.clientWidth + 1), true);
    if (process.env.BROWSER_SCREENSHOT_DIR) await page.screenshot({ path: join(process.env.BROWSER_SCREENSHOT_DIR, "knowledge-assistant-retry-390.png"), animations: "disabled" });
    await page.setViewportSize({ width: 1440, height: 1050 });
    await page.evaluate(() => window.qa.finish());
    await page.getByText("What the evidence shows", { exact: true }).waitFor();
    assert.equal(await input.inputValue(), "Keep this next question");
    assert.equal(await page.locator(".grounded-assistant-message.is-user").count(), 1);
    assert.equal(await page.locator(".grounded-assistant-message.is-assistant").count(), 1, "all provider attempts resolve into one visible answer");
    assert.equal(await page.evaluate(() => window.qa.calls.length), 1);
    const sourceButton = page.getByRole("button", { name: /Show source 1: Checkout release review/ });
    assert.equal(await sourceButton.count(), 1);
    assert.equal(await page.locator(".knowledge-answer-claims strong").getByText("Checkout risk:", { exact: true }).count(), 1, "Markdown emphasis is presented as readable content");
    assert.equal(await page.locator(".knowledge-answer-claims li li").count(), 2, "Markdown findings render as a list");
    await sourceButton.click();
    const sourceDialog = page.getByRole("dialog", { name: "Checkout release review" });
    await sourceDialog.waitFor();
    assert.equal(await sourceDialog.locator(".knowledge-source-passages strong").getByText("Risk:", { exact: true }).count(), 1);
    assert.equal(await sourceDialog.locator(".knowledge-source-passages li").count(), 2);
    for (const theme of ["light", "dark"]) {
      await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
      const surface = await sourceDialog.evaluate(node => ({ background: getComputedStyle(node).backgroundColor, bodyOverflow: getComputedStyle(node.querySelector('.knowledge-source-detail-body')).overflowY }));
      assert.notEqual(surface.background, "rgba(0, 0, 0, 0)", `${theme} citation dialog has an opaque surface`);
      assert.notEqual(surface.background, "transparent", `${theme} citation dialog has an opaque surface`);
      assert.equal(surface.bodyOverflow, "auto", `${theme} citation content scrolls inside the bounded dialog`);
    }
    await sourceDialog.getByRole("button", { name: "Close source evidence" }).click();
    await sourceDialog.waitFor({ state: "detached" });
    await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
    await page.getByText("Partial retrieval · limited evidence", { exact: true }).waitFor();

    await page.getByRole("button", { name: "Start a new assistant chat" }).click();
    await page.evaluate(() => { window.qa.mode = "timeout"; });
    await input.fill("Find the release risk");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await page.getByText("This answer took too long", { exact: true }).waitFor();
    const timeoutTurn = await page.evaluate(() => window.qa.calls.at(-1).client_turn_id);
    await page.evaluate(() => { window.qa.mode = "pending"; });
    await page.getByRole("button", { name: "Retry this turn", exact: true }).click();
    await page.locator(".grounded-assistant-progress-heading").getByText("Waiting for this turn to finish", { exact: true }).waitFor();
    await page.getByText("What the evidence shows", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.qa.calls.at(-1).client_turn_id), timeoutTurn);
    assert.equal(await page.locator(".grounded-assistant-message.is-user").count(), 1);

    await page.getByRole("button", { name: "Start a new assistant chat" }).click();
    await page.evaluate(() => { window.qa.mode = "stream"; });
    await input.fill("Search the release evidence");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await page.getByRole("button", { name: "Stop answer", exact: true }).waitFor();
    await page.evaluate(() => window.qa.progress({ contract_type: "RetrievalEvent", contract_version: "1.0", stage: "GENERATION", status: "IN_PROGRESS", error_code: "MODEL_RATE_LIMITED", metrics: { model_attempt: 2, model_max_attempts: 3, retry_delay_ms: 5000 } }));
    await page.locator(".grounded-assistant-progress-heading").getByText("Retrying answer model · attempt 2 of 3", { exact: true }).waitFor();
    await input.fill("Do not lose this draft");
    await page.getByRole("button", { name: "Stop answer", exact: true }).click();
    await page.getByText("Answer stopped", { exact: true }).waitFor();
    assert.equal(await input.inputValue(), "Do not lose this draft");
    assert.equal(await page.evaluate(() => window.qa.cancelled), 1, "Stop cancels the pending retry stream");
    assert.equal(await page.locator(".grounded-assistant-message.is-user").count(), 1);
    const stoppedTurn = await page.evaluate(() => window.qa.calls.at(-1).client_turn_id);
    await page.evaluate(() => { window.qa.mode = "provider"; });
    await page.getByRole("button", { name: "Resume this turn", exact: true }).click();
    await page.getByText("Sources found; answer model unavailable", { exact: true }).waitFor();
    await page.getByText(/Check its credentials in Integrations/).waitFor();
    assert.equal(await page.evaluate(() => window.qa.calls.at(-1).client_turn_id), stoppedTurn);
    assert.equal(await input.inputValue(), "Do not lose this draft");
    assert.equal(await page.locator(".grounded-assistant-message.is-user").count(), 1);
    assert.equal(await page.locator(".grounded-assistant-message.is-assistant").count(), 1);
    assert.equal(await page.getByRole("button", { name: /Show source 1: Checkout release review/ }).count(), 1);
    await page.evaluate(() => { window.qa.mode = "success"; });
    await page.getByRole("button", { name: "Retry this turn", exact: true }).click();
    await page.getByText("What the evidence shows", { exact: true }).waitFor();
    const retriedProviderCall = await page.evaluate(() => window.qa.calls.at(-1));
    assert.equal(retriedProviderCall.client_turn_id, stoppedTurn, "provider retry reuses and replaces the failed server turn");
    assert.equal(retriedProviderCall.retry_provider, true);
    assert.equal(await page.locator(".grounded-assistant-message.is-user").count(), 1);
    assert.equal(await page.locator(".grounded-assistant-message.is-assistant").count(), 1);
    for (const width of [1440, 620, 390, 320]) {
      await page.setViewportSize({ width, height: 950 });
      const geometry = await page.locator(".grounded-assistant-panel").evaluate(el => {
        const bounds = el.getBoundingClientRect();
        return { left: bounds.left, right: bounds.right, width: innerWidth, overflowing: [...el.querySelectorAll(".grounded-assistant-header, .grounded-assistant-message-content, .grounded-assistant-composer-shell")].filter(node => node.scrollWidth > node.clientWidth + 1).map(node => node.className) };
      });
      assert.ok(geometry.left >= -1 && geometry.right <= geometry.width + 1, `panel fits ${width}px`);
      assert.deepEqual(geometry.overflowing, [], `content fits ${width}px`);
      if (process.env.BROWSER_SCREENSHOT_DIR && [1440, 390].includes(width)) await page.screenshot({ path: join(process.env.BROWSER_SCREENSHOT_DIR, `knowledge-assistant-answer-${width}.png`), animations: "disabled" });
    }
    assert.deepEqual(errors, []);
  } catch (error) {
    const body = page && !page.isClosed() ? await page.locator("body").innerText().catch(() => "<body unavailable>") : "<body unavailable>";
    throw new Error(`${error.message}\nConsole errors: ${JSON.stringify(browserErrors)}\nBody:\n${body.slice(0, 5000)}`, { cause: error });
  } finally {
    await browser?.close();
    await Promise.all([unlink(html).catch(() => {}), unlink(source).catch(() => {})]);
  }
});
