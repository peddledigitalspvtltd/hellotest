import { sourceFile } from "./helpers/sourceFile.mjs";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("workspace pages use the canonical heading and mature description block", async () => {
  const pageFiles = [
    "AdminSpacePage",
    "AgenticWorkflowsPage",
    "AutomationPage",
    "DesignPage",
    "ExecutionsPage",
    "IntegrationsPage",
    "IssuesPage",
    "KnowledgeRepoPage",
    "NotificationsPage",
    "PeoplePage",
    "ProjectsPage",
    "ReleasesPage",
    "RequirementsPage",
    "SettingsPage",
    "SharedStepsPage",
    "SupportPage",
    "TestCasesPage",
    "TestEnvironmentPage",
    "TestOpsPage"
  ];
  const sources = await Promise.all(pageFiles.map((name) => readFile(sourceFile(`${name}.tsx`, "pages"), "utf8")));

  for (const [index, source] of sources.entries()) {
    assert.match(source, /<PageHeader/ , `${pageFiles[index]} must render the canonical page header`);
    assert.match(source, /description=/, `${pageFiles[index]} must provide descriptive page copy`);
  }
});

test("the shared page header remains visible in the final stylesheet authority", async () => {
  const [component, styles] = await Promise.all([
    readSource("../src/shared/components/PageHeader.tsx"),
    readSource("../src/styles.css")
  ]);

  assert.match(component, /<header className=\{\["page-header"/);
  assert.doesNotMatch(
    styles,
    /\.page-header,\s*\.page-header\.card,\s*\.page-header--no-actions\s*\{\s*display:\s*none\s*!important;/,
    "the canonical page header must not be hidden by a global legacy rule"
  );
});

test("Projects expands its title and description in the canonical page header", async () => {
  const projects = await readSource("../pages/ProjectsPage.tsx");

  assert.match(projects, /<PageHeader[\s\S]{0,300}projects-page-header[\s\S]{0,300}title="Project Overview"[\s\S]{0,300}description="Create and govern project workspaces/);
  assert.match(projects, /<PageHeader[\s\S]*<section className="projects-command-card projects-command-card--evidence"/);
  assert.doesNotMatch(projects, /<PageHeaderText/);
});

test("page identity remains visible when catalog pages open focused record workspaces", async () => {
  const guardedPages = [
    ["ProjectsPage", "{!focusedProject && portfolioAnalyticsQuery.data ? ("],
    ["RequirementsPage", "{!isRequirementWorkspaceOpen ? ("],
    ["TestCasesPage", "{!isCaseWorkspaceOpen ? ("],
    ["IssuesPage", "{!(isCreating || selectedItem) ? ("]
  ];

  for (const [pageName, catalogGuard] of guardedPages) {
    const source = await readFile(sourceFile(`${pageName}.tsx`, "pages"), "utf8");
    assert.ok(source.indexOf("<PageHeader") < source.indexOf(catalogGuard), `${pageName} header must render outside its catalog-only guard`);
  }

  const [sharedSteps, suites, environments] = await Promise.all([
    readSource("../../../testing/frontend/pages/SharedStepsPage.tsx"),
    readSource("../../../testing/frontend/pages/DesignPage.tsx"),
    readSource("../../../testing/frontend/pages/TestEnvironmentPage.tsx")
  ]);
  assert.doesNotMatch(sharedSteps, /\{!isSharedGroupWorkspaceOpen \? \([\s\S]{0,120}<PageHeader/);
  assert.doesNotMatch(suites, /\{showSuiteTilesHeader \? \([\s\S]{0,120}<PageHeader/);
  assert.doesNotMatch(environments, /\{!isEnvironmentWorkspaceOpen \? \([\s\S]{0,120}<PageHeader/);
});

test("Product Management, Test Authoring, Test Environment, and Defects expose mature page identity", async () => {
  const [product, cases, sharedSteps, suites, environments, bugs] = await Promise.all([
    readSource("../../../manual/frontend/pages/RequirementsPage.tsx"),
    readSource("../../../testing/frontend/pages/TestCasesPage.tsx"),
    readSource("../../../testing/frontend/pages/SharedStepsPage.tsx"),
    readSource("../../../testing/frontend/pages/DesignPage.tsx"),
    readSource("../../../testing/frontend/pages/TestEnvironmentPage.tsx"),
    readSource("../../../testing/frontend/pages/IssuesPage.tsx")
  ]);

  assert.match(product, /eyebrow="Product Management"/);
  assert.match(suites, /eyebrow="Test Plan"/);
  for (const source of [cases, sharedSteps]) assert.match(source, /eyebrow="Test Authoring"/);
  assert.match(environments, /const currentViewEyebrow = "Test Environment"/);
  assert.match(bugs, /title="Defects"[\s\S]{0,180}description="Capture, reproduce, triage, and resolve Defects/);
});

test("multi-route workspaces expose a page-specific title instead of a generic shell label", async () => {
  const [automation, testOps, testEnvironment] = await Promise.all([
    readSource("../../../automation/frontend/pages/AutomationPage.tsx"),
    readSource("../src/platform/pages/TestOpsPage.tsx"),
    readSource("../../../testing/frontend/pages/TestEnvironmentPage.tsx")
  ]);

  for (const title of ["Automation", "Object Repository"]) assert.match(automation, new RegExp(`title: "${title}"`));
  for (const title of ["Batch Process", "OPS Telemetry", "Automation Builder"]) assert.match(testOps, new RegExp(`title: "${title}"`));
  for (const title of ["Test Environments", "Test Configurations", "Test Data"]) assert.match(testEnvironment, new RegExp(`"${title}"`));
});
