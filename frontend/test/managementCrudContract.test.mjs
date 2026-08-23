import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("People management exposes user CRUD and role editors without Jira-specific UI", async () => {
  const page = await readSource("../src/pages/PeoplePage.tsx");

  for (const capability of ["Create user", "Initial password", "Confirm password", "Save user", "Delete user", "Create role", "Save permissions"]) {
    assert.match(page, new RegExp(capability));
  }
  assert.doesNotMatch(page, /Jira/i);
  assert.match(page, /api\.users\.create/);
  assert.match(page, /api\.users\.update/);
  assert.match(page, /api\.users\.delete/);
});

test("Requirements Management appears above Product Management authoring and owns Stories", async () => {
  const [shell, sections] = await Promise.all([
    readSource("../src/components/AppShell.tsx"),
    readSource("../src/lib/workspaceSections.ts")
  ]);

  assert.match(shell, /label: "Requirements Management"/);
  assert.match(shell, /icon: RequirementsManagementIcon/);
  assert.ok(shell.indexOf('label: "Requirements Management"') < shell.indexOf('id: "authoring"'));
  assert.match(sections, /REQUIREMENTS_MANAGEMENT_SECTION_ITEMS[\s\S]*label: "Stories"/);
  const authoring = sections.slice(sections.indexOf("TEST_AUTHORING_SECTION_ITEMS"), sections.indexOf("TEST_ENVIRONMENT_SECTION_ITEMS"));
  assert.doesNotMatch(authoring, /label: "Stories"/);
});

test("manual test-case details place mature automation cards beside Details", async () => {
  const page = await readSource("../src/pages/TestCasesPage.tsx");
  const tabs = page.slice(page.indexOf('items={['), page.indexOf(']}', page.indexOf('items={[')));

  assert.ok(tabs.indexOf('label: "Details"') < tabs.indexOf('label: "Automation Cases"'));
  assert.match(page, /automation-case-tile test-case-linked-automation-card/);
  assert.match(page, /Create one with AI, the smart recorder, or a blank canvas/);
  assert.doesNotMatch(page, /summary="Create an independent automation case while preserving this manual case as its traceable source\."/);
});

test("Story-linked test-case creation enters the standard new-case workspace with coherent scope", async () => {
  const page = await readSource("../src/pages/TestCasesPage.tsx");

  assert.match(page, /beginCreateCase\(requestedSuiteId, requestedRequirementId\)/);
  assert.match(page, /setProjectId\(requestedProjectId\)/);
  assert.match(page, /requirement_id: requirementId/);
});

test("project tiles present exact delivery scope in Stories, Modules, Cases, Bugs order", async () => {
  const [page, types] = await Promise.all([
    readSource("../src/pages/ProjectsPage.tsx"),
    readSource("../src/types.ts")
  ]);
  const metaGrid = page.slice(page.indexOf('<div className="project-meta-grid">'), page.indexOf('</div>', page.indexOf('<div className="project-meta-grid">')));

  assert.ok(metaGrid.indexOf("Stories") < metaGrid.indexOf("Modules"));
  assert.ok(metaGrid.indexOf("Modules") < metaGrid.indexOf("Cases"));
  assert.ok(metaGrid.indexOf("Cases") < metaGrid.indexOf("Bugs"));
  assert.match(metaGrid, /item\.requirementCount/);
  assert.match(metaGrid, /item\.moduleCount/);
  assert.match(metaGrid, /item\.testCaseCount/);
  assert.match(metaGrid, /item\.bugCount/);
  assert.match(types, /story_count\?: number \| null;[\s\S]*module_count\?: number \| null;[\s\S]*case_count\?: number \| null;[\s\S]*bug_count\?: number \| null;/);
});

test("project creation and catalog expose mature visibility, favorite, and locked states", async () => {
  const [page, api, styles, dataTable] = await Promise.all([
    readSource("../src/pages/ProjectsPage.tsx"),
    readSource("../src/lib/api.ts"),
    readSource("../src/pages/ProjectsPage.css"),
    readSource("../src/components/DataTable.tsx")
  ]);

  assert.match(page, /<FormField label="Project type"/);
  assert.match(page, /Private — only you/);
  assert.match(page, /Public — invite workspace users/);
  assert.match(page, /projectDraft\.visibility === "private"/);
  assert.match(page, /project-private-owner-card/);
  assert.match(page, /project-tile-favorite/);
  assert.match(page, /key: "select-favorite"[\s\S]*key: "id"/);
  assert.match(page, /key: "select-favorite"[\s\S]*width: 88/);
  assert.match(dataTable, /Math\.max\(SELECTION_COLUMN_WIDTH, Math\.round\(column\.width \|\| 0\)\)/);
  assert.match(page, /key: "favorites"[\s\S]*key: "projects"[\s\S]*key: "locked"/);
  assert.match(page, /isLocked \? <IconLock/);
  assert.match(api, /catalog: \(\) => request<Project\[\]>\("\/projects\/catalog"\)/);
  assert.match(api, /favorite: \(id: string\)/);
  assert.match(api, /unfavorite: \(id: string\)/);
  assert.match(styles, /\.project-favorite-button\.is-favorite/);
  assert.match(styles, /\.catalog-data-table \.project-favorite-button\.is-favorite \{[\s\S]*background: transparent/);
  assert.match(styles, /\.project-portfolio-card\.is-locked/);
});

test("project platform icons and compressed attachments stay selected, scoped, and reviewable", async () => {
  const [page, dropdown, editor, api, types, modalStyles] = await Promise.all([
    readSource("../src/pages/ProjectsPage.tsx"),
    readSource("../src/components/AppTypeDropdown.tsx"),
    readSource("../src/components/RichTextEditor.tsx"),
    readSource("../src/lib/api.ts"),
    readSource("../src/types.ts"),
    readSource("../src/modal-system.css")
  ]);

  for (const kind of ["web", "api", "android", "ios"]) {
    assert.match(dropdown, new RegExp(`kind=\\"${kind}\\"`));
  }
  assert.match(dropdown, /platform-type-icon--unified/);
  assert.match(page, /project-app-type-icon[\s\S]*data-platform-type=\{normalizeAppTypeKind/);
  assert.match(page, /<AppTypeIcon isUnified=\{appType\.is_unified\}[\s\S]*type=\{appType\.type\}/);
  assert.match(editor, /title: "Link"/);
  assert.doesNotMatch(editor, /window\.prompt/);
  assert.match(editor, /className="modal-card rich-text-link-dialog"/);
  assert.match(editor, /DialogCloseButton label="Close add link dialog"/);
  assert.match(editor, /Enter a valid http, https, or mailto link/);
  assert.match(editor, /title: "Attach files"/);
  assert.match(page, /gzip compressed on upload/);
  assert.match(page, /entityType="project"/);
  assert.match(page, /section === "attachments"/);
  assert.match(page, /<Panel title="Project attachments"/);
  assert.match(api, /entity_type: "project" \|/);
  assert.match(types, /HelloTestEntityType = "project" \|/);
  assert.match(modalStyles, /\.project-create-attachments-section/);
});

test("project portfolio analytics are all-project, configurable, prioritized, flippable, and exportable", async () => {
  const [page, api, registry, settings, flipCard, styles] = await Promise.all([
    readSource("../src/pages/ProjectsPage.tsx"),
    readSource("../src/lib/api.ts"),
    readSource("../src/lib/aiPromptRegistry.ts"),
    readSource("../src/pages/SettingsPage.tsx"),
    readSource("../src/components/EvidenceFlipCard.tsx"),
    readSource("../src/pages/ProjectsPage.css")
  ]);

  assert.match(api, /portfolioAnalytics: \(\) => request<ProjectPortfolioAnalytics>\("\/projects\/portfolio-analytics"\)/);
  assert.match(page, /label="Projects need attention"/);
  assert.match(page, /label="Execution failure cases"/);
  assert.match(page, /label="Evidence Missing"/);
  assert.match(page, /label="Bugs"/);
  assert.match(page, /compactImpactEvidence\("Modules"/);
  assert.match(page, /compactImpactEvidence\("Stories"/);
  assert.match(page, /item\.bugCount/);
  assert.match(page, /downloadPortfolioAttentionPdf/);
  assert.match(page, /captureProjectAttentionSnapshot/);
  const snapshotCapture = page.slice(
    page.indexOf("async function captureProjectAttentionSnapshot"),
    page.indexOf("const formatProjectTimeAgo")
  );
  assert.match(snapshotCapture, /is-exporting-snapshot/);
  assert.match(snapshotCapture, /rendered_snapshot_pages_data_urls/);
  assert.match(snapshotCapture, /\.project-risk-project-card/);
  assert.match(snapshotCapture, /for \(const fragment of fragments\)/);
  assert.match(snapshotCapture, /\.dialog-close-button, \.metric-methodology-info/);
  assert.doesNotMatch(snapshotCapture, /matches\("button/);
  const blobRequestHelper = api.slice(
    api.indexOf("async function requestBlob"),
    api.indexOf("async function requestForm")
  );
  assert.match(blobRequestHelper, /headers\.set\("Content-Type", "application\/json"\)/);
  assert.match(flipCard, /window\.setTimeout/);
  assert.match(flipCard, /evidence\.slice\(0, maxEvidenceItems\)/);
  assert.match(flipCard, /className="evidence-flip-card-back-button"[\s\S]*<svg/);
  assert.match(registry, /AI_METRIC_FORMULA_VALUES_KEY/);
  assert.match(registry, /key: "metric\.project\.execution_evidence"/);
  assert.match(registry, /key: "metric\.project\.execution_failures"/);
  assert.match(registry, /key: "metric\.project\.bugs"/);
  assert.match(settings, /Formula values/);
  assert.match(settings, /portfolio readiness weights must total 100%/i);
  assert.match(styles, /\.project-risk-summary-card\.evidence-flip-card/);
});

test("project traceability toolbar keeps compact app scope and embedded search controls", async () => {
  const [traceability, styles, projectStyles, page] = await Promise.all([
    readSource("../src/components/ProjectTraceabilityMap.tsx"),
    readSource("../src/styles.css"),
    readSource("../src/pages/ProjectsPage.css"),
    readSource("../src/pages/ProjectsPage.tsx")
  ]);

  assert.match(traceability, /className="project-traceability-app-filter"/);
  assert.match(traceability, /aria-label="Filter traceability by application"/);
  assert.match(traceability, /className="search-input-with-icon project-traceability-search"/);
  assert.match(traceability, /type="search"/);
  assert.match(traceability, /className="project-traceability-sprints"/);
  assert.match(traceability, /Backlog \/ No sprint/);
  assert.match(traceability, /Module links are derived from the Story’s linked cases/);
  assert.match(traceability, /Bugs include direct Story, module, and test-case references/);
  assert.match(page, /traceabilitySprintsQuery/);
  assert.match(page, /sprints=\{\(traceabilitySprintsQuery\.data \|\| \[\]\)/);
  assert.match(styles, /\.project-traceability-search > svg[\s\S]*position: absolute/);
  assert.match(styles, /\.project-traceability-app-filter[\s\S]*max-width: 12rem/);
  assert.match(projectStyles, /\.project-traceability-sprint-toggle/);
  assert.match(projectStyles, /\.project-traceability-path-links/);
});

test("native checkboxes retain a white surface across application themes", async () => {
  const styles = await readSource("../src/styles.css");

  assert.match(styles, /:where\(input\[type="checkbox"\]\)[\s\S]*color-scheme: light !important/);
  assert.match(styles, /:where\(input\[type="checkbox"\]\)[\s\S]*background-color: #ffffff !important/);
  assert.match(styles, /:where\(input\[type="checkbox"\]\)[\s\S]*accent-color: var\(--brand-blue-600, #2563eb\) !important/);
});

test("Object Repository separates manual screen creation from the inspection workspace", async () => {
  const [page, styles] = await Promise.all([
    readSource("../src/pages/AutomationPage.tsx"),
    readSource("../src/styles.css")
  ]);

  assert.match(page, /addRepositoryScreen\.mutate\(\{ inspectAfterSave: false \}\)/);
  assert.match(page, /addRepositoryScreen\.mutate\(\{ inspectAfterSave: true \}\)/);
  assert.match(page, /options\?\.inspectAfterSave[\s\S]*setIsInspectOpen\(true\)[\s\S]*setIsInspectOpen\(false\)/);
  assert.match(page, /setQueryData<AutomationLearningCacheEntry\[\]>\([\s\S]*"automation-learning-cache"[\s\S]*currentEntry\.id !== entry\.id/);
  assert.match(page, /Save screen/);
  assert.match(page, /Save and inspect/);
  assert.match(page, /className="object-repository-browser-tabs"|object-repository-browser-tabs/);
  assert.ok(page.indexOf('className="object-repository-tab-picker object-repository-browser-tabs"') < page.indexOf('<iframe src={inspectRecorderLiveUrl}'));
  assert.match(page, /object-repository-live-inspect object-repository-collapsible-section/);
  assert.match(page, /DialogCloseButton label="Close object repository inspector"/);
  assert.match(page, /className="object-repository-inspector-review-tabs"/);
  assert.match(page, /Selected locators/);
  assert.match(page, /Selector evidence/);
  assert.match(page, /Highlight all/);
  assert.match(page, /Remove all/);
  assert.match(page, /className="object-repository-selected-fields object-repository-review-panel"/);
  assert.match(page, /object-repository-inspector-preview object-repository-collapsible-section/);
  assert.match(styles, /\.object-repository-inspector \{[\s\S]*width: min\(1480px/);
  assert.match(styles, /\.object-repository-browser-tabs \{[\s\S]*display: flex/);
  assert.match(styles, /\.object-repository-browser-preview iframe \{[\s\S]*height: clamp\(22rem, 48dvh, 35rem\)/);
  assert.match(styles, /\.object-repository-field-actions \{[\s\S]*flex-wrap: nowrap/);
});

test("admin password replacement retains the form across awaits and sample setup reports administrator access", async () => {
  const [admin, api] = await Promise.all([
    readSource("../src/admin/AdminApp.tsx"),
    readSource("../src/admin/api.ts")
  ]);
  const securityPage = admin.slice(admin.indexOf("function SecurityPage"), admin.indexOf("export function AdminApp"));

  assert.match(securityPage, /const formElement = event\.currentTarget/);
  assert.match(securityPage, /await adminApi\.changePassword[\s\S]*formElement\.reset\(\)[\s\S]*await onRefresh\(\)/);
  assert.doesNotMatch(securityPage, /event\.currentTarget\.reset/);
  assert.match(securityPage, /disabled=\{busy\}[\s\S]*Updating…/);
  assert.match(admin, /granted \$\{result\.administrator_memberships\} active administrator/);
  assert.match(api, /administrator_memberships: number/);
});
