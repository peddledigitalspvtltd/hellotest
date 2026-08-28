import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("step automation exposes supported choices and scopes capability checks to the active project", async () => {
  const editor = await readSource("../src/components/StepAutomationEditor.tsx");

  assert.match(editor, /AUTHORING_STEP_TYPE_OPTIONS = STEP_TYPE_OPTIONS\.filter\(\(option\) => option\.value !== "ios"\)/);
  assert.match(editor, /hasPermission\(session, "mobile\.manage", projectId\)/);
  assert.match(editor, /resolveCanEditAutomationCode\(session, featureFlagsQuery\.data, projectId\)/);
  assert.match(editor, /resolveCanViewAutomationCode\(session, featureFlagsQuery\.data, projectId\)/);
  assert.match(editor, /resolveCanPreviewAutomationCode\(session, featureFlagsQuery\.data, projectId\)/);
  assert.doesNotMatch(editor, /hasPermission\(session, "mobile\.manage"\)/);
  assert.doesNotMatch(editor, /resolveCan(?:Edit|View|Preview)AutomationCode\(session, featureFlagsQuery\.data\)/);
});

test("API request validation uses preview access while read-only code uses view access", async () => {
  const editor = await readSource("../src/components/StepAutomationEditor.tsx");

  assert.match(editor, /if \(!canPreviewAutomationCode\) \{[\s\S]*API request preview permission and feature access are required/);
  assert.match(editor, /disabled=\{!canPreviewAutomationCode \|\| isRunningApiRequest \|\| !resolvedApiRequest\?\.url\}/);
  assert.match(editor, /if \(!canViewAutomationCode\) onClose\(\)/);
  assert.doesNotMatch(editor, /if \(!canPreviewAutomationCode\) onClose\(\)/);
});
