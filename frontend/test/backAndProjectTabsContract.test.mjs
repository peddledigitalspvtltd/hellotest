import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("every dedicated Back control keeps visible text and a direct single-click callback", async () => {
  const [workspace, reportBug, evidence, executions, agents, issueStyles, sharedStyles] = await Promise.all([
    readSource("../src/components/WorkspaceMasterDetail.tsx"),
    readSource("../src/components/ReportBugModal.tsx"),
    readSource("../src/components/EvidenceFlipCard.tsx"),
    readSource("../src/pages/ExecutionsPage.tsx"),
    readSource("../src/pages/AgenticWorkflowsPage.tsx"),
    readSource("../src/pages/IssuesPage.css"),
    readSource("../src/styles.css")
  ]);

  assert.match(workspace, /<button[^>]*onClick=\{onClick\}[^>]*type="button"[\s\S]*?<WorkspaceBackIcon \/>[\s\S]*?<span>Back<\/span>/);
  assert.match(reportBug, /report-bug-modal-back-button[\s\S]*?onClick=\{onClose\}[\s\S]*?type="button"[\s\S]*?<span>Back<\/span>/);
  assert.match(evidence, /evidence-flip-card-back-button[\s\S]*?onClick=\{\(\) => showFace\(false\)\}[\s\S]*?type="button"[\s\S]*?<span>Back<\/span>/);
  assert.equal((executions.match(/<span>Back<\/span>/g) || []).length, 3);
  for (const destination of ["Back to run library", "Back to scheduled runs", "Back to "]) {
    assert.match(executions, new RegExp(destination));
  }
  assert.match(agents, /aria-label="Back to all AI Agents"[\s\S]*?onClick=\{openAgentCatalog\}[\s\S]*?<span>Back<\/span>/);
  assert.doesNotMatch([workspace, reportBug, evidence, executions, agents].join("\n"), /onDoubleClick|history\.back\(|navigate\(-1\)/);
  assert.doesNotMatch(issueStyles, /\.issue-detail-header \.workspace-back-button span\s*\{[^}]*clip:\s*rect/);
  assert.doesNotMatch(sharedStyles, /\.test-case-workspace-identity \.workspace-back-button span\s*\{[^}]*display:\s*none/);
});

test("Project Details uses an icon-led, accessible secondary tab surface", async () => {
  const [page, styles, tabs] = await Promise.all([
    readSource("../src/pages/ProjectsPage.tsx"),
    readSource("../src/pages/ProjectsPage.css"),
    readSource("../src/components/SubnavTabs.tsx")
  ]);

  assert.match(page, /<SubnavTabs[\s\S]*?ariaLabel="Project detail sections"[\s\S]*?className="project-detail-tabs"/);
  for (const [label, icon] of [
    ["Project details", "IconFileDescription"],
    ["Members", "IconUsers"],
    ["Applications", "IconApps"],
    ["Attachments", "IconPaperclip"],
    ["Traceability", "IconGitBranch"]
  ]) {
    assert.match(page, new RegExp(`label: "${label}"[^\\n]*icon: <${icon}`));
  }
  assert.match(styles, /\.project-detail-tabs\.subnav-tabs\s*\{[\s\S]*grid-template-columns:\s*repeat\(5/);
  assert.match(styles, /\.project-detail-tabs > \.subnav-tab\.is-active[\s\S]*\.subnav-tab-icon/);
  assert.match(styles, /@media \(max-width: 900px\)[\s\S]*\.project-detail-tabs\.subnav-tabs[\s\S]*overflow-x:\s*auto/);
  assert.match(styles, /:root\[data-theme="dark"\] \.projects-page \.project-detail-tabs/);
  assert.match(styles, /@media \(forced-colors: active\)[\s\S]*\.project-detail-tabs/);
  assert.match(tabs, /event\.key === "ArrowRight"[\s\S]*event\.key === "Home"[\s\S]*event\.key === "End"/);
});
