import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("Story creation and submit actions reuse the Create Project action palette", async () => {
  const [page, catalogStyles, modalStyles] = await Promise.all([
    readSource("../src/pages/RequirementsPage.tsx"),
    readSource("../src/catalog-list.css"),
    readSource("../src/modal-system.css")
  ]);

  const toolbar = page.slice(page.indexOf('aria-label="Story actions"'), page.indexOf('aria-label="Story catalog"'));
  const storySubmit = modalStyles.slice(
    modalStyles.indexOf(".story-create-dialog .story-create-submit-button {"),
    modalStyles.indexOf(".story-create-dialog .story-create-submit-icon")
  );

  assert.match(toolbar, /requirement-create-story-button/);
  assert.match(toolbar, /onClick=\{\(\) => openCreateRequirementModal\(\)\}/);
  assert.match(catalogStyles, /\.requirement-toolbar-actions > \.requirement-create-story-button:not\(:disabled\)[\s\S]*?var\(--project-create-action, #0758c9\)/);
  assert.match(catalogStyles, /\.requirement-toolbar-actions > \.requirement-create-story-button:hover:not\(:disabled\)[\s\S]*?var\(--project-create-action-hover, #0649aa\)/);
  assert.match(storySubmit, /var\(--project-create-action, #0758c9\)/);
  assert.match(storySubmit, /var\(--project-create-action-hover, #0649aa\)/);
  assert.doesNotMatch(storySubmit, /#000000/);
});

test("Bulk Story import keeps the secondary action before the project-blue submit action", async () => {
  const [page, modalStyles] = await Promise.all([
    readSource("../src/pages/RequirementsPage.tsx"),
    readSource("../src/modal-system.css")
  ]);
  const importDialog = page.slice(page.indexOf("{isImportModalOpen ?"), page.indexOf("{isOptimizeModalOpen"));
  const clearIndex = importDialog.indexOf("Clear preview");
  const submitIndex = importDialog.indexOf("requirement-import-submit-button");

  assert.ok(clearIndex >= 0);
  assert.ok(submitIndex > clearIndex);
  assert.match(importDialog, /requirement-import-submit-button[\s\S]*?Queue \$\{importRows\.length\}/);
  assert.match(modalStyles, /\.requirement-import-modal-card \.requirement-import-submit-button:not\(:disabled\)[\s\S]*?var\(--project-create-action, #0758c9\)/);
  assert.match(modalStyles, /\.requirement-import-modal-card \.requirement-import-submit-button:hover:not\(:disabled\)[\s\S]*?var\(--project-create-action-hover, #0649aa\)/);
});
