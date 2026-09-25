import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("bulk selection uses one checked-or-empty icon language across application workflows", async () => {
  const [icons, controls, suitePicker, cases, requirements, executions, knowledge, smartContext, projects, issues] = await Promise.all([
    readSource("../src/platform/components/AppIcons.tsx"),
    readSource("../src/shared/components/CatalogSelectionControls.tsx"),
    readSource("../../../testing/frontend/components/SuiteCasePicker.tsx"),
    readSource("../../../testing/frontend/pages/TestCasesPage.tsx"),
    readSource("../../../manual/frontend/pages/RequirementsPage.tsx"),
    readSource("../../../testing/frontend/pages/ExecutionsPage.tsx"),
    readSource("../../../knowledge/frontend/components/KnowledgeContextStudio.tsx"),
    readSource("../../../ai/frontend/components/SmartContextWorkbench.tsx"),
    readSource("../pages/ProjectsPage.tsx"),
    readSource("../../../testing/frontend/pages/IssuesPage.tsx")
  ]);

  assert.match(icons, /export function SelectionToggleIcon\(\{ checked, size = 18, strokeWidth = 1\.9 \}/);
  assert.match(icons, /\{checked \? <path d="m9\.25 10\.8 2\.35 2\.4 5\.2-5\.35"/);
  assert.doesNotMatch(icons, /export function (SelectAllIcon|ClearSelectionIcon)/);

  assert.match(controls, /<SelectionToggleIcon checked \/>/);
  assert.match(controls, /<SelectionToggleIcon checked=\{false\} \/>/);
  assert.match(controls, /aria-label=\{selectAllLabel\}/);
  assert.match(controls, /aria-label=\{clearLabel\}/);

  for (const source of [suitePicker, cases, requirements, executions, knowledge, smartContext, projects, issues]) {
    assert.match(source, /<SelectionToggleIcon checked/);
    assert.doesNotMatch(source, /SelectAllIcon|ClearSelectionIcon/);
  }
  for (const source of [suitePicker, cases, requirements, executions, smartContext, projects, issues]) {
    assert.match(source, /<SelectionToggleIcon checked=\{false\}/);
  }
});
