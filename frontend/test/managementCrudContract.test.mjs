import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");
const readBinary = (relativePath) => readFile(new URL(relativePath, import.meta.url));

test("release notes ribbon uses the supplied document-and-rocket artwork exactly", async () => {
  const [releases, icons, artwork] = await Promise.all([
    readSource("../src/pages/ReleasesPage.tsx"),
    readSource("../src/components/AppIcons.tsx"),
    readBinary("../src/assets/release-notes-icon.png")
  ]);

  assert.match(releases, /<ReleaseNotesIcon size=\{23\}/);
  assert.doesNotMatch(releases, /<ReleaseNotesIcon size=\{23\} \/><span>/);
  assert.match(icons, /import releaseNotesIcon from "\.\.\/assets\/release-notes-icon\.png"/);
  assert.equal(createHash("sha256").update(artwork).digest("hex"), "d5f3213473172d94b41d25c8683d1802fec2754b98db45e5284cd137d53d4199");
});

test("release ribbons keep identity, actions, metrics, and readiness artwork on one compact row", async () => {
  const [releases, releaseStyles, icons, catalogStyles] = await Promise.all([
    readSource("../src/pages/ReleasesPage.tsx"),
    readSource("../src/pages/ReleasesPage.css"),
    readSource("../src/components/AppIcons.tsx"),
    readSource("../src/catalog-list.css")
  ]);

  const identity = releases.slice(releases.indexOf("const renderReleaseIdentity"), releases.indexOf("const renderReleaseMetrics"));
  const header = releases.slice(releases.indexOf("const renderReleaseHeader"), releases.indexOf("const renderReleaseStoryTile"));
  const readinessIcon = icons.slice(icons.indexOf("export function ReleaseReadinessIcon"), icons.indexOf("export function UsersIcon"));
  const readinessIconStyles = catalogStyles.slice(catalogStyles.indexOf(".release-readiness-icon {"), catalogStyles.indexOf(".test-case-entity-icon__file"));

  assert.match(releases, /const releaseVersionLabel[\s\S]*replace\(\/\^version[\s\S]*return `v\$\{normalized \|\| "—"\}`/);
  assert.match(identity, /requirement-sprint-heading release-ribbon-title-line[\s\S]*release-ribbon-name-version[\s\S]*release-ribbon-name[\s\S]*\{release\.name\}[\s\S]*release-ribbon-version-separator[\s\S]*release-ribbon-version[\s\S]*releaseVersionLabel\(release\.fix_version\)/);
  assert.ok(identity.indexOf("release-ribbon-title-line") < identity.indexOf("release-ribbon-schedule"));
  assert.ok(identity.indexOf("release-ribbon-schedule") < identity.indexOf("release-ribbon-description"));
  assert.ok(header.indexOf("renderReleaseIdentity(release)") < header.indexOf("renderReleaseActions(release)"));
  assert.ok(header.indexOf("renderReleaseActions(release)") < header.indexOf("renderReleaseMetrics(release)"));
  assert.match(releaseStyles, /\.test-case-module-header\.requirement-iteration-header\.release-iteration-header[\s\S]*grid-template-columns:\s*auto auto minmax\(13rem, 1fr\) auto minmax\(28rem, max-content\)/);
  assert.match(releaseStyles, /\.release-iteration-header > \.release-hierarchy-actions\s*\{[^}]*grid-column:\s*4/);
  assert.match(releaseStyles, /\.release-iteration-header > \.hierarchy-quick-insights\s*\{[^}]*grid-column:\s*5/);
  assert.match(releaseStyles, /\.release-iteration-header \.hierarchy-quick-insights-grid\s*\{[^}]*flex-wrap:\s*nowrap/);
  assert.doesNotMatch(releaseStyles, /\.release-iteration-header > \.hierarchy-quick-insights\s*\{[^}]*grid-column:\s*1 \/ -1/);
  assert.match(releaseStyles, /\.release-ribbon-description\s*\{[^}]*max-inline-size:\s*min\(32ch, 100%\)[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/);
  assert.match(releaseStyles, /\.release-ribbon-name-version\s*\{[^}]*width:\s*fit-content[^}]*max-width:\s*100%[^}]*gap:\s*\.14rem/);
  assert.match(releaseStyles, /\.release-ribbon-name\s*\{[^}]*flex:\s*0 1 auto[^}]*text-overflow:\s*ellipsis/);
  assert.match(releaseStyles, /\.release-ribbon-version\s*\{[^}]*flex:\s*0 0 auto/);
  assert.match(releaseStyles, /\.release-ribbon-version\s*\{[^}]*font-size:\s*\.7rem/);

  assert.match(releases, /<ReleaseReadinessIcon size=\{26\}/);
  assert.match(readinessIcon, /checkSize = Math\.max\(3, Math\.round\(size \* 0\.15\)\)/);
  assert.match(readinessIcon, /rocketSize = Math\.max\(15, Math\.round\(size \* 0\.82\)\)/);
  assert.match(readinessIcon, /IconRocket[\s\S]*release-readiness-icon__checks/);
  assert.equal((readinessIcon.match(/<IconCheckbox/g) || []).length, 1);
  assert.doesNotMatch(readinessIcon, /IconHierarchy3|release-readiness-icon__hierarchy/);
  assert.match(readinessIconStyles, /display:\s*inline-grid[\s\S]*grid-template-rows:\s*minmax\(0, 1fr\) auto/);
  assert.match(readinessIconStyles, /release-readiness-icon__checks[\s\S]*grid-row:\s*2/);
  assert.match(readinessIconStyles, /release-readiness-icon__rocket[\s\S]*grid-row:\s*1[\s\S]*transform:\s*none/);
  assert.doesNotMatch(readinessIconStyles, /position:\s*absolute/);
});

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

test("Product Management replaces Requirements Management and separates Stories, Backlog, Sprints, and Releases", async () => {
  const [shell, sections, navigationStyles, icons, sectionTabs, productManagementArtwork] = await Promise.all([
    readSource("../src/components/AppShell.tsx"),
    readSource("../src/lib/workspaceSections.ts"),
    readSource("../src/components/module-navigation.css"),
    readSource("../src/components/AppIcons.tsx"),
    readSource("../src/components/WorkspaceSectionTabs.tsx"),
    readBinary("../src/assets/product-management-icon.png")
  ]);

  assert.match(shell, /id: "product-management"/);
  assert.match(shell, /label: "Product Management"/);
  assert.match(shell, /icon: ProductManagementIcon/);
  assert.match(shell, /import productManagementIcon from "\.\.\/assets\/product-management-icon\.png"/);
  assert.match(shell, /function ProductManagementIcon[\s\S]*product-management-entity-icon[\s\S]*src=\{productManagementIcon\}/);
  assert.doesNotMatch(shell, /IconTargetArrow/);
  assert.equal(createHash("sha256").update(productManagementArtwork).digest("hex"), "2ad79ac0fab87d0674bb87ecf81ee239ad0cf1353baa54d1838d3bc32a09c865");
  assert.doesNotMatch(shell, /label: "Requirements Management"/);
  assert.ok(shell.indexOf('label: "Product Management"') < shell.indexOf('id: "authoring"'));
  assert.match(sections, /PRODUCT_MANAGEMENT_SECTION_ITEMS[\s\S]*label: "Stories"[\s\S]*label: "Backlog"[\s\S]*label: "Sprints"[\s\S]*label: "Releases"/);
  assert.match(sections, /to: WORKSPACE_ROUTES\.stories[\s\S]*icon: "stories"/);
  assert.match(sections, /to: WORKSPACE_ROUTES\.backlog[\s\S]*icon: "backlog"/);
  assert.match(sections, /to: WORKSPACE_ROUTES\.sprints[\s\S]*icon: "sprint"/);
  assert.match(sections, /to: WORKSPACE_ROUTES\.releases[\s\S]*icon: "release"/);
  assert.match(shell, /case "backlog":[\s\S]*return BacklogIcon/);
  assert.match(shell, /case "sprint":[\s\S]*return SprintIcon/);
  assert.match(shell, /case "release":[\s\S]*return ReleaseIcon/);
  assert.match(sectionTabs, /case "sprint":[\s\S]*<SprintIcon/);
  assert.match(sectionTabs, /case "release":[\s\S]*<ReleaseIcon/);
  assert.match(icons, /export function SprintIcon/);
  assert.match(icons, /export function ReleaseIcon/);
  assert.match(icons, /import backlogIcon from "\.\.\/assets\/backlog-icon\.png"/);
  assert.match(icons, /export function BacklogIcon[\s\S]*--backlog-entity-icon-image[\s\S]*backlog-entity-icon/);
  assert.doesNotMatch(icons, /IconArrowIteration/);
  assert.match(navigationStyles, /data-nav-identity="backlog"[\s\S]*backlog-entity-icon/);
  assert.match(navigationStyles, /data-nav-identity="sprint"/);
  assert.match(navigationStyles, /data-nav-identity="release"/);
  const authoring = sections.slice(sections.indexOf("TEST_AUTHORING_SECTION_ITEMS"), sections.indexOf("TEST_ENVIRONMENT_SECTION_ITEMS"));
  assert.doesNotMatch(authoring, /label: "Stories"|label: "Backlog"|label: "Sprints"|label: "Releases"/);
});

test("Backlog uses the approved gear and dual-workflow-arrow artwork", async () => {
  const [styles, artwork] = await Promise.all([
    readSource("../src/catalog-list.css"),
    readBinary("../src/assets/backlog-icon.png")
  ]);

  assert.match(styles, /\.backlog-entity-icon[\s\S]*mask-image: var\(--backlog-entity-icon-image\)[\s\S]*mask-size: contain/);
  assert.equal(createHash("sha256").update(artwork).digest("hex"), "769ecfb0735dfd7cf5b59b3035fc14ba444412fad91738e7048b7d66ae7d86b2");
});

test("Product Management workspaces expose delivery governance without using automation as readiness", async () => {
  const [app, stories, releases, readiness, icons, issues, completionGuard, projects, api, types] = await Promise.all([
    readSource("../src/App.tsx"),
    readSource("../src/pages/RequirementsPage.tsx"),
    readSource("../src/pages/ReleasesPage.tsx"),
    readSource("../src/components/ReleaseReadinessDashboard.tsx"),
    readSource("../src/components/AppIcons.tsx"),
    readSource("../src/pages/IssuesPage.tsx"),
    readSource("../src/components/DeliveryCompletionGuardDialog.tsx"),
    readSource("../src/pages/ProjectsPage.tsx"),
    readSource("../src/lib/api.ts"),
    readSource("../src/types.ts")
  ]);

  assert.match(app, /workspaceMode="backlog"/);
  assert.match(app, /workspaceMode="sprints"/);
  assert.match(app, /workspaceMode="stories"/);
  assert.match(app, /import\("\.\/pages\/ReleasesPage"\)/);
  for (const capability of [
    "Dev completion target", "QA completion target", "Scrum team", "Spec Kit",
    "Test coverage", "Release readiness", "Automation progress", "Retrospective",
    "Slipped", "On course", "Groomed", "Not groomed", "Link Story"
  ]) assert.match(stories, new RegExp(capability, "i"));
  assert.match(stories, /selectedRequirementTestCoverage \* 0\.3/);
  assert.match(stories, /selectedRequirementPassCoverage\.percent \* 0\.5/);
  assert.match(stories, /selectedRequirementBugHealth \* 0\.2/);
  assert.match(stories, /Automation is informational and is not part of readiness/);
  for (const productMetric of ["Grooming readiness", "Specification ready", "High-priority demand", "Team ownership"]) {
    assert.match(stories, new RegExp(productMetric, "i"));
  }
  assert.match(stories, /isStoryAssignedToSprint/);
  assert.match(stories, /selectedRequirementHasSprint \? <button[\s\S]*AI Test Cases Generation/);
  assert.match(stories, /selectedRequirementHasSprint \? \[[\s\S]*Linked test cases[\s\S]*Linked bugs[\s\S]*Historical runs/);
  assert.match(stories, /workspaceMode === "backlog"[\s\S]*<StoryIcon size=\{16\}/);
  assert.match(stories, /IconPlayerPlay[\s\S]*IconFlagCheck[\s\S]*IconNotes/);
  assert.match(stories, /listRequirements\(iteration\.id, \{ page_size: 200, cursor, projection: "summary" \}\)/);
  assert.match(stories, /dismissedRequirementRouteRef/);
  assert.match(stories, /setSelectedRequirementId\(""\);[\s\S]*syncRequirementSearchParams\(null\)/);
  for (const metric of ["Backlog inventory", "Sprint commitment", "Release scope", "QA completion"]) assert.match(stories, new RegExp(metric));
  assert.match(stories, /workspaceMode === "stories"[\s\S]*filteredRequirements/);
  assert.match(releases, /Create release/);
  assert.match(releases, /Fix Version/);
  assert.match(releases, /Release target date/);
  assert.match(releases, /Release plan date/);
  assert.match(releases, /Release notes/);
  assert.match(releases, /generateReleaseNotes/);
  assert.match(releases, /Open release readiness board/);
  assert.match(releases, /<ReleaseReadinessIcon size=\{26\}/);
  assert.match(readiness, /<ReleaseReadinessIcon size=\{28\}/);
  assert.match(icons, /export function ReleaseReadinessIcon[\s\S]*IconRocket[\s\S]*release-readiness-icon__checks/);
  assert.doesNotMatch(icons, /IconHierarchy3|release-readiness-icon__hierarchy/);
  assert.match(releases, /release_id=/);
  assert.match(releases, /Release portfolio health/i);
  for (const metric of ["Release ready", "At risk", "Story completion", "Test coverage", "Open Bugs"]) {
    assert.match(releases, new RegExp(metric, "i"));
  }
  assert.match(releases, /visibleReleases\.map/);
  assert.match(releases, /CatalogViewToggle/);
  assert.match(releases, /CatalogSearchFilter/);
  assert.match(releases, /CatalogSelectionControls/);
  assert.match(releases, /Select release/);
  assert.match(releases, /Delete selected/);
  assert.match(releases, /requirementReleases\.get\(release\.id\)/);
  assert.match(releases, /TileBrowserPane/);
  assert.match(releases, /DataTable/);
  assert.match(releases, /rowGroups=\{releaseRowGroups\}/);
  assert.match(releases, /requirement-iteration-header release-iteration-header/);
  assert.match(releases, /HierarchyQuickInsights/);
  assert.match(releases, /requirement-catalog-card release-story-tile/);
  assert.match(releases, /sprint-create-dialog sprint-new-dialog release-create-dialog/);
  assert.match(releases, /included by Sprint/);
  assert.match(readiness, /requestedReleaseId/);
  assert.match(readiness, /releaseContext\.requirements/);
  assert.match(readiness, /disabled=\{isReleaseScopeLocked\}/);
  assert.match(readiness, /setRelease\(deepLinkedRelease\)/);
  assert.match(issues, /autoModuleIds/);
  assert.match(issues, /autoRequirementIds/);
  assert.match(completionGuard, /Completion blocked/);
  assert.match(completionGuard, /Close and review Stories/);
  const openProjectHandler = projects.slice(projects.indexOf("const openPortfolioProject"), projects.indexOf("const openPortfolioProjectPath"));
  assert.ok(openProjectHandler.indexOf("setFocusedProjectId(item.project.id)") < openProjectHandler.indexOf("setSelectedProjectId(item.project.id)"));
  assert.doesNotMatch(releases, /window\.confirm/);
  assert.match(api, /requirementReleases:/);
  assert.match(api, /generateNotes/);
  assert.match(api, /replaceRelatedRequirements/);
  assert.match(stories, /qaScopedStories = workspaceMode === "stories"/);
  assert.match(stories, /Backlog Stories are excluded/);
  assert.match(stories, /StoryMetricFact/);
  assert.match(stories, /\/testops\?process=/);
  assert.match(types, /specification_format\?: "gherkin" \| "speckit"/);
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

  assert.match(page, /const primaryRequirementId = bugDraft\?\.requirementIds\[0\] \|\| requestedRequirementId/);
  assert.match(page, /beginCreateCase\(primarySuiteId, primaryRequirementId, \{[\s\S]*bugDraft\?\.release \|\| deliveryPrefill\.release,[\s\S]*bugDraft\?\.sprint \|\| deliveryPrefill\.sprint/);
  assert.match(page, /resolveDeliveryScopePrefill/);
  assert.match(page, /setProjectId\(requestedProjectId\)/);
  assert.match(page, /requirement_id: requirementId/);
});

test("project tiles present exact delivery scope in Stories, Modules, Cases, Bugs order", async () => {
  const [page, types] = await Promise.all([
    readSource("../src/pages/ProjectsPage.tsx"),
    readSource("../src/types.ts")
  ]);
  const metaGrid = page.slice(page.indexOf('<div className="tile-card-facts project-tile-metrics"'), page.indexOf('</div>', page.indexOf('<div className="tile-card-facts project-tile-metrics"')));

  assert.ok(metaGrid.indexOf("Stories") < metaGrid.indexOf("Modules"));
  assert.ok(metaGrid.indexOf("Modules") < metaGrid.indexOf("Test cases"));
  assert.ok(metaGrid.indexOf("Test cases") < metaGrid.indexOf("Bugs"));
  assert.match(metaGrid, /TileCardMetric/);
  assert.match(metaGrid, /item\.requirementCount/);
  assert.match(metaGrid, /item\.moduleCount/);
  assert.match(metaGrid, /item\.testCaseCount/);
  assert.match(metaGrid, /item\.bugCount/);
  assert.match(types, /story_count\?: number \| null;[\s\S]*module_count\?: number \| null;[\s\S]*case_count\?: number \| null;[\s\S]*bug_count\?: number \| null;/);
});

test("Story and test-case history lead with comparable execution-health evidence", async () => {
  const [history, stories, testCases, modalStyles] = await Promise.all([
    readSource("../src/components/TraceabilityRunHistory.tsx"),
    readSource("../src/pages/RequirementsPage.tsx"),
    readSource("../src/pages/TestCasesPage.tsx"),
    readSource("../src/modal-system.css")
  ]);

  for (const signal of ["Recent pass rate", "Movement", "Current streak", "Median duration", "Outcome timeline", "Previous 5", "Recent 5"]) {
    assert.match(history, new RegExp(signal));
  }
  assert.match(history, /currentWindow = finalized\.slice\(0, 5\)/);
  assert.match(history, /previousWindow = finalized\.slice\(5, 10\)/);
  assert.match(history, /onClick=\{\(\) => openRun\(row\)\}/);
  assert.match(stories, /StoryDetailSectionContext/);
  assert.match(modalStyles, /\.story-detail-section-context/);
  assert.match(modalStyles, /\.execution-health-timeline/);
  const testHistoryPanel = testCases.slice(testCases.indexOf('activeTestCaseDetailTab === "history"'), testCases.indexOf('activeTestCaseDetailTab === "defects"'));
  assert.ok(testHistoryPanel.indexOf("TraceabilityRunHistory") < testHistoryPanel.indexOf("TestCaseVersionHistory"));
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
  assert.match(styles, /\.projects-command-card--evidence \.projects-command-insight \{[\s\S]*width: min\(100%, 29rem\);[\s\S]*max-width: 29rem;[\s\S]*justify-self: end;/);
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

test("planning dates, simplified Sprint creation, and rich-text links retain the refined authoring contract", async () => {
  const [stories, releases, releaseStyles, editor] = await Promise.all([
    readSource("../src/pages/RequirementsPage.tsx"),
    readSource("../src/pages/ReleasesPage.tsx"),
    readSource("../src/pages/ReleasesPage.css"),
    readSource("../src/components/RichTextEditor.tsx")
  ]);

  assert.match(stories, /label="Dev Completion Target Date"><input type="date"/);
  assert.match(stories, /label="QA Completion Target Date"><input[^>]*type="date"/);
  assert.match(stories, /label="Start date">[\s\S]*type="date"/);
  assert.match(stories, /queryKey: \["sprint-backlog-picker", projectId\][\s\S]*unassigned: true/);
  assert.match(stories, /const selectedStoryIds = \[\.\.\.new Set\(sprintDraftRequirementIds/);
  assert.match(stories, /aria-label="Filter backlog Stories by status"/);
  assert.match(stories, /<GherkinEditor featureTitle=\{createDraft\.title/);
  assert.match(stories, /<SpecKitEditor onChange=/);
  assert.match(stories, /<optgroup label="HelloTest releases">/);
  assert.match(stories, /createStorySprintOptions\.map/);
  assert.match(stories, /story-related-create-actions[\s\S]*Link related Stories/);
  assert.match(stories, /StorySpecificationFormatSwitch[\s\S]*role="tablist"/);
  assert.match(stories, /label: "Gherkin"/);
  assert.match(stories, /label: "Spec Kit"/);
  assert.match(stories, /className=\{isSelected \? "story-specification-tab is-active"/);
  assert.match(stories, /sprint-story-filter-trigger[\s\S]*IconFilter/);
  assert.doesNotMatch(stories, /sprint-link-related-stories/);
  assert.match(releases, /dateOnlyToMidnightIso/);
  assert.match(releases, /const openEditRelease/);
  assert.match(releases, /sprint_ids: draft\.sprintIds/);
  assert.match(releases, /requirement_ids: draft\.requirementIds/);
  assert.match(releases, /releaseDateRangeLabel\(release\.plan_date, release\.target_date\)/);
  assert.match(releases, /release\.sprint_ids\.length \? <span>/);
  assert.match(releases, /release-ribbon-description/);
  assert.match(releases, /useDialogFocus<HTMLFormElement>/);
  assert.equal((releases.match(/target_date_label: "Release target date"/g) || []).length, 1);
  assert.match(releaseStyles, /\.release-ribbon-description[\s\S]*text-overflow: ellipsis/);
  assert.match(releaseStyles, /\.release-create-grid \.form-field-required-marker[\s\S]*color: #c9372c/);
  assert.match(editor, /document\.createElement\("a"\)/);
  assert.match(editor, /pendingRange\.insertNode\(anchor\)/);
  assert.doesNotMatch(editor, /execCommand\("createLink"/);
});

test("test data authoring uses an iteration grid and module health loads before expansion", async () => {
  const [testCases, testData, styles, modalStyles] = await Promise.all([
    readSource("../src/pages/TestCasesPage.tsx"),
    readSource("../src/pages/TestEnvironmentPage.tsx"),
    readSource("../src/styles.css"),
    readSource("../src/modal-system.css")
  ]);

  assert.doesNotMatch(testCases, /function DataSetCreationModal/);
  assert.match(testCases, /<DataSetForm/);
  assert.match(testCases, /function TestDataSetPickerDialog/);
  assert.match(testCases, /No Data Sets Defined/);
  assert.match(testCases, /type="radio"/);
  assert.match(testCases, /setLinkedDataSetDraftIds\(\[created\.id\]\)/);
  assert.match(testCases, /setLinkedDataSetDraftIds\(\[dataSetLinkDraftId\]\)/);
  assert.match(testData, /Data file import/);
  assert.match(testData, /Available data utilities/);
  assert.match(testData, /function DataTableEditor/);
  assert.match(testData, /function KeyValueEditor/);
  assert.match(testCases, /const moduleMetricHeaders = useMemo/);
  assert.match(testCases, /moduleMetricHeaders\.flatMap/);
  assert.doesNotMatch(testCases, /isCollapsed \|\| !modulePageState \|\| isInitialLoading/);
  assert.match(testCases, /const hasCompleteModuleMetrics = \(moduleId: string\)/);
  assert.equal((testCases.match(/\? renderDeferredModuleMetrics\(moduleHealth\.unassigned\.count\)\s*: renderModuleMetrics\(moduleHealth\.unassigned\)/g) || []).length, 2);
  assert.doesNotMatch(testCases, /isUnassignedModuleExpanded[\s\S]{0,120}renderDeferredModuleMetrics\(moduleHealth\.unassigned\.count\)/);
  assert.match(styles, /\.resource-sheet/);
  assert.match(modalStyles, /\.test-data-set-picker-dialog/);
  assert.match(modalStyles, /\.test-case-data-set-inline-empty/);
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
  assert.match(page, /Preview all · 3s/);
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
