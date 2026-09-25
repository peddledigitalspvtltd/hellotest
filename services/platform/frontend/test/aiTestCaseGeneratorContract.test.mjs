import { readApiSources } from "./helpers/readApiSources.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("AI Test Case Generator exposes the reference workbench and live draft actions", async () => {
  const [modal, styles] = await Promise.all([
    readSource("../../../ai/frontend/components/AiDesignStudioModal.tsx"),
    readSource("../../../ai/frontend/components/TestCaseAiStudioModal.css")
  ]);

  for (const marker of ["Context Setup", "Test Case Drafts", "Intelligence Status", "Grounding Analysis", "Session Log"]) {
    assert.match(modal, new RegExp(marker));
  }
  for (const action of ["Select all", "Clear selection", "Decline all", "Regenerate", "Accept"] ) {
    assert.match(modal, new RegExp(action, "i"));
  }
  assert.match(modal, /is-\$\{viewMode\}/);
  assert.match(modal, /setViewMode\("list"\)/);
  assert.match(modal, /setViewMode\("grid"\)/);
  assert.match(styles, /width:\s*min\(1480px, calc\(100vw - 48px\)\)/);
  assert.match(styles, /height:\s*min\(860px, calc\(100dvh - 48px\)\)/);
  assert.match(styles, /grid-template-columns:\s*300px minmax\(600px, 1fr\) 280px/);
  assert.match(modal, /intelligenceOpen/);
  assert.match(modal, /Show.*intelligence status/);
  assert.match(styles, /ai-test-generator-status-footer/);
});

test("Gherkin mode is propagated through generation, editing, scheduling, and acceptance", async () => {
  const [modal, api, testCases, requirements] = await Promise.all([
    readSource("../../../ai/frontend/components/AiDesignStudioModal.tsx"),
    readApiSources(),
    readSource("../../../testing/frontend/pages/TestCasesPage.tsx"),
    readSource("../../../manual/frontend/pages/RequirementsPage.tsx")
  ]);

  assert.match(modal, /className="ai-test-generator-authoring-tabs" role="radiogroup"/);
  assert.match(modal, /<GherkinEditor/);
  assert.match(modal, /readOnly=\{!editing\}/);
  assert.match(modal, /onPreview\(authoringMode\)/);
  assert.match(modal, /onSchedule\(authoringMode\)/);
  assert.match(api, /authoring_mode\?: "structured" \| "gherkin"/);
  for (const page of [testCases, requirements]) {
    assert.match(page, /authoring_mode: authoringMode/);
    assert.match(page, /gherkin_document: item\.gherkin_document/);
    assert.match(page, /parameter_values: item\.parameter_values/);
  }
});

test("nested template overlays cannot close the Test Case Generator", async () => {
  const [modal, picker] = await Promise.all([
    readSource("../../../ai/frontend/components/AiDesignStudioModal.tsx"),
    readSource("../../../ai/frontend/components/AiPromptTemplatePicker.tsx")
  ]);

  assert.match(modal, /event\.target === event\.currentTarget && !closeIsDisabled/);
  assert.match(picker, /className="modal-backdrop ai-prompt-template-backdrop"/);
  assert.match(picker, /createPortal\(/);
  assert.match(picker, /document\.body/);
  assert.match(picker, /event\.stopPropagation\(\)/);
  assert.match(picker, /event\.target === event\.currentTarget/);
});

test("AI Improve Test Case reuses the generator with one Story and existing Test Case context", async () => {
  const [improve, modal, page, api] = await Promise.all([
    readSource("../../../ai/frontend/components/AiCaseAuthoringModal.tsx"),
    readSource("../../../ai/frontend/components/AiDesignStudioModal.tsx"),
    readSource("../../../testing/frontend/pages/TestCasesPage.tsx"),
    readApiSources()
  ]);

  assert.match(improve, /<AiDesignStudioModal/);
  assert.match(improve, /allowMultipleRequirements=\{false\}/);
  assert.match(improve, /maxCases=\{1\}/);
  assert.match(improve, /sourceCase=\{sourceCase\}/);
  assert.match(modal, /Existing Test Case/);
  assert.match(modal, /sourceCase\.gherkinDocument/);
  assert.match(page, /handlePreviewAiCaseAuthoring = async \(authoringMode: "structured" \| "gherkin"/);
  assert.match(page, /gherkin_document: aiCaseAuthoringPreview\.authoring_mode === "gherkin"/);
  assert.match(api, /previewCaseAuthoring:[\s\S]*?authoring_mode\?: "structured" \| "gherkin"/);
});
