# HelloTest core feature and acceptance-story blueprint

Reusable acceptance backlog for the current implemented product. Demo releases and sprint dates are illustrative planning metadata, not production commitments or executed test results.

60 acceptance stories · 7 sprints · 3 illustrative releases

Authored with AI assistance and reviewed against repository sources. No model response, test execution or production release is fabricated by installation.

## Setup order

1. project
2. applications
3. missing active-administrator memberships
4. sprints
5. releases
6. stories
7. release scope
8. story dependencies

## Releases

| Release | Fix version | State | Relative dates |
| --- | --- | --- | --- |
| HelloTest Foundation · sample | demo-foundation-1.0 | in_progress | Day -6 to 21 |
| HelloTest Quality Delivery · sample | demo-quality-1.0 | planned | Day 22 to 63 |
| HelloTest Intelligence & Operations · sample | demo-intelligence-1.0 | planned | Day 64 to 91 |

## Sprints

| Sprint | State | Relative dates | Goal |
| --- | --- | --- | --- |
| HT 01 · Workspace foundations | active | Day -6 to 7 | Create a correctly scoped project, applications and membership; verify permission-aware navigation. |
| HT 02 · Product planning | future | Day 8 to 21 | Author actionable stories and preserve canonical Sprint and Release assignments through CRUD operations. |
| HT 03 · Reusable test design | future | Day 22 to 35 | Build traceable cases, shared steps, suites and data-driven environment configurations. |
| HT 04 · Execution and triage | future | Day 36 to 49 | Capture reproducible run evidence, correct final outcomes and actionable defect relationships. |
| HT 05 · Automation delivery | future | Day 50 to 63 | Review executable assets, locator bindings and configured local, remote and mobile execution. |
| HT 06 · Grounded intelligence | future | Day 64 to 77 | Curate permission-scoped knowledge and review AI outputs with provenance and recovery states. |
| HT 07 · Quality and operations | future | Day 78 to 91 | Validate metric methodology, readiness evidence, background recovery and repeatable administrator setup. |

Dates are fixed relative to the authored dataset date, 2026-09-20. Installation and retries retain these dates; existing saved records are never rewritten.

## Feature inventory and detailed stories

### Workspace foundations

#### project-applications: Create a project with explicit application scopes

As a workspace administrator, I want to create a described project with Web, API and mobile application scopes so work stays organized.

Project visibility, description and application platform define the workspace context. Application selection must remain within the chosen project.

- Status: ready; priority: P1; effort: 5 story points.
- Sprint: HT 01 · Workspace foundations. Release: HelloTest Foundation · sample; fix version: demo-foundation-1.0.
- Team: HelloTest Platform. Labels: sample, hellotest-core, workspace.
- Sources: `services/platform/frontend/src/platform/components/AppShell.tsx`, `services/platform/backend/routes/projects.routes.js`, `services/platform/backend/src/security/permissions.catalog.js`.

Acceptance criteria:

- Save the project name, description and visibility and show the same values after reopening.
- Create Web, API and unified mobile applications under the new project.
- Changing the project clears an application selection belonging to the previous project.

Boundary: Reject missing names and cross-project application references; do not change another project.

#### membership-roles: Apply project membership and workspace role grants accurately

As a workspace administrator, I want to assign existing members appropriate project roles so access matches responsibility.

Membership determines project access; workspace role presets provide Product Owner, QA, Automation, AI, Reporter and Viewer responsibilities. Sample setup must preserve customized grants.

- Status: ready; priority: P1; effort: 5 story points.
- Sprint: HT 01 · Workspace foundations. Release: HelloTest Foundation · sample; fix version: demo-foundation-1.0.
- Team: HelloTest Platform. Labels: sample, hellotest-core, workspace.
- Sources: `services/platform/frontend/src/platform/components/AppShell.tsx`, `services/platform/backend/routes/projects.routes.js`, `services/platform/backend/src/security/permissions.catalog.js`.

Acceptance criteria:

- A member receives only the operations allowed by their assigned role and enabled features.
- Reinstalling role presets creates missing roles without replacing intentionally customized grants.
- Project setup adds every active workspace administrator whose membership is absent and preserves every existing member role.

Boundary: An authenticated non-administrator cannot modify workspace roles or add privileged membership.

#### navigation-scope: Navigate available capabilities without leaking project scope

As a project member, I want to find authorized product areas and retain valid project context across navigation.

The workspace navigator combines capabilities, feature availability and project permissions. Restricted, disabled and missing-project states must remain distinguishable.

- Status: ready; priority: P1; effort: 5 story points.
- Sprint: HT 01 · Workspace foundations. Release: HelloTest Foundation · sample; fix version: demo-foundation-1.0.
- Team: HelloTest Platform. Labels: sample, hellotest-core, workspace.
- Sources: `services/platform/frontend/src/platform/components/AppShell.tsx`, `services/platform/backend/routes/projects.routes.js`, `services/platform/backend/src/security/permissions.catalog.js`.

Acceptance criteria:

- Search finds Stories, Runs, Knowledge and other enabled capabilities using their labels and keywords.
- Links requiring a project explain that a project must be selected.
- A project switch prevents cached lists or counts from the previous project appearing as current data.

Boundary: A direct URL must enforce the same permissions as the navigation control.

#### authentication: Maintain authenticated sessions and recover expired access

As a workspace user, I want to sign in and recover an expired session without losing authorization boundaries.

Authentication controls protected workspace APIs and pages. Session expiry must result in a clear sign-in path without treating a failed request as a successful save.

- Status: ready; priority: P2; effort: 5 story points.
- Sprint: HT 01 · Workspace foundations. Release: HelloTest Foundation · sample; fix version: demo-foundation-1.0.
- Team: HelloTest Platform. Labels: sample, hellotest-core, workspace.
- Sources: `services/platform/frontend/src/platform/components/AppShell.tsx`, `services/platform/backend/routes/projects.routes.js`, `services/platform/backend/src/security/permissions.catalog.js`, `services/platform/backend/routes/auth.routes.js`.

Acceptance criteria:

- Valid configured credentials establish a session for the correct workspace user.
- Protected APIs reject unauthenticated requests and the UI presents a recoverable authentication state.
- Signing out clears the active session and prevents access through stale authenticated UI state.

Boundary: Invalid or expired credentials must not expose project records or admin content.

#### project-deletion: Delete large projects with recoverable background progress

As a project administrator, I want to delete project-owned records and stored files without holding the UI request open.

Deletion uses a durable job receipt, bounded SQL batches and post-commit storage cleanup. The requester can continue monitoring after project membership disappears.

- Status: ready; priority: P1; effort: 8 story points.
- Sprint: HT 01 · Workspace foundations. Release: HelloTest Foundation · sample; fix version: demo-foundation-1.0.
- Team: HelloTest Platform. Labels: sample, hellotest-core, workspace.
- Sources: `services/platform/frontend/src/platform/components/AppShell.tsx`, `services/platform/backend/routes/projects.routes.js`, `services/platform/backend/src/security/permissions.catalog.js`, `services/platform/backend/services/projectDeletion.service.js`.

Acceptance criteria:

- A confirmed deletion returns an accepted receipt and subsequent requests show the same active job.
- Navigation, reload and API restart preserve progress and allow cleanup failures to be retried.
- Unrelated and shared data is retained, and SQL failures roll back project record changes.

Boundary: Conflicting cross-project references stop the job safely; never show completion while stored-file cleanup remains.

#### regional-settings: Persist workspace preferences and regional presentation

As a workspace user, I want to use supported language, time and display preferences consistently.

Settings and regional controls influence labels and formatting without rewriting stored delivery dates or identifiers. Governed defaults remain separate from personal choices.

- Status: draft; priority: P2; effort: 3 story points.
- Sprint: Backlog (not scheduled). Release: HelloTest Foundation · sample; fix version: demo-foundation-1.0.
- Team: HelloTest Platform. Labels: sample, hellotest-core, workspace.
- Sources: `services/platform/frontend/src/platform/components/AppShell.tsx`, `services/platform/backend/routes/projects.routes.js`, `services/platform/backend/src/security/permissions.catalog.js`, `services/platform/frontend/src/platform/components/RegionalPreferencesDialog.tsx`.

Acceptance criteria:

- A supported language preference is retained after reload.
- Dates display using the selected regional preference while saved timestamps stay consistent.
- Changing an allowed preference leaves project membership and feature availability unchanged.

Boundary: Unsupported localization values fall back safely instead of breaking page rendering.

### Product management

#### story-authoring: Author stories with actionable specifications and ownership

As a Product Owner, I want to capture a precise story, acceptance criteria, labels and delivery ownership.

Stories support Gherkin or Spec Kit specifications alongside title, description, priority, status, effort, assignee, original Dev/QA and delivery dates.

- Status: ready; priority: P1; effort: 5 story points.
- Sprint: HT 02 · Product planning. Release: HelloTest Foundation · sample; fix version: demo-foundation-1.0.
- Team: HelloTest Product. Labels: sample, hellotest-core, planning.
- Sources: `services/manual/frontend/pages/RequirementsPage.tsx`, `services/manual/frontend/pages/ReleasesPage.tsx`, `services/manual/backend/services/requirement.service.js`, `services/manual/backend/services/requirementRelease.service.js`.

Acceptance criteria:

- Creating and reopening a story preserves its title, description, labels and specification format.
- Assignee, story points and Dev/QA ownership use current available members and permitted values.
- Acceptance criteria describe observable outcomes and remain readable in the story detail.

Boundary: Reject an empty title and invalid project references without discarding the user draft.

#### backlog-planning: Prioritize unscheduled stories and move them into a sprint

As a Product Owner, I want to organize the backlog and schedule selected stories without creating duplicates.

Backlog is the unscheduled view of the same story records. Moving work changes canonical iteration membership rather than copying stories.

- Status: ready; priority: P1; effort: 5 story points.
- Sprint: HT 02 · Product planning. Release: HelloTest Foundation · sample; fix version: demo-foundation-1.0.
- Team: HelloTest Product. Labels: sample, hellotest-core, planning.
- Sources: `services/manual/frontend/pages/RequirementsPage.tsx`, `services/manual/frontend/pages/ReleasesPage.tsx`, `services/manual/backend/services/requirement.service.js`, `services/manual/backend/services/requirementRelease.service.js`.

Acceptance criteria:

- Unscheduled stories appear in Backlog while scheduled stories appear under their sprint.
- Moving a selected story into an available sprint persists its iteration ID and visible sprint name.
- Removing a story from a sprint returns it to Backlog and refreshes affected counts.

Boundary: A filtered or paginated view must not silently move stories that were not selected.

#### sprint-lifecycle: Plan sprint goals, dates, ownership and lifecycle

As a delivery lead, I want to create and manage iterations with clear goals and correctly linked stories.

Sprints have description, goal, labels, owner, effort and start/end dates with future, active and closed lifecycle states. Stories and sprint metrics derive from canonical membership.

- Status: ready; priority: P1; effort: 5 story points.
- Sprint: HT 02 · Product planning. Release: HelloTest Foundation · sample; fix version: demo-foundation-1.0.
- Team: HelloTest Product. Labels: sample, hellotest-core, planning.
- Sources: `services/manual/frontend/pages/RequirementsPage.tsx`, `services/manual/frontend/pages/ReleasesPage.tsx`, `services/manual/backend/services/requirement.service.js`, `services/manual/backend/services/requirementRelease.service.js`.

Acceptance criteria:

- Save a sprint goal, dates, labels, owner and effort and retain them after editing.
- Story creation from the Sprint view selects the current available sprint by native ID.
- Starting or closing a sprint updates its visible state and retains story traceability.

Boundary: A sprint from another project cannot be assigned to the story; invalid date order must be rejected.

#### release-scope: Create release milestones with explicit and sprint-inherited scope

As a release manager, I want to plan a release version and target date while keeping its story scope accurate.

Releases contain a unique project milestone, fix version, description, target information and linked sprints. Scope can include manually selected stories and stories inherited through sprints.

- Status: ready; priority: P1; effort: 8 story points.
- Sprint: HT 02 · Product planning. Release: HelloTest Foundation · sample; fix version: demo-foundation-1.0.
- Team: HelloTest Product. Labels: sample, hellotest-core, planning.
- Sources: `services/manual/frontend/pages/RequirementsPage.tsx`, `services/manual/frontend/pages/ReleasesPage.tsx`, `services/manual/backend/services/requirement.service.js`, `services/manual/backend/services/requirementRelease.service.js`.

Acceptance criteria:

- Create a release with fix version, plan date, target date, description and lifecycle state.
- Link a sprint and include its stories exactly once alongside manually selected stories.
- Changing a story release preserves unrelated release scope and refreshes release totals.

Boundary: Do not include another project’s story or count the same story twice through manual and inherited scope.

#### delivery-selectors: Use available sprints and releases consistently across story dialogs

As a Product Owner, I want to select the same valid delivery metadata from Stories, Backlog and Sprint creation and edit dialogs.

Local project sprints and releases are the canonical options. Imported metadata may supplement choices but must not replace a native iteration ID with a legacy label.

- Status: ready; priority: P1; effort: 8 story points.
- Sprint: HT 02 · Product planning. Release: HelloTest Foundation · sample; fix version: demo-foundation-1.0.
- Team: HelloTest Product. Labels: sample, hellotest-core, planning.
- Sources: `services/manual/frontend/pages/RequirementsPage.tsx`, `services/manual/frontend/pages/ReleasesPage.tsx`, `services/manual/backend/services/requirement.service.js`, `services/manual/backend/services/requirementRelease.service.js`.

Acceptance criteria:

- All three entry points show available native sprints and releases for the selected project.
- Creating or editing a story saves the selected iteration and release scope atomically.
- Reopening a story retains a historical current value while new selections remain project-valid.

Boundary: Loading errors must not appear as an empty catalog, and project switches must discard stale options.

#### story-traceability: Relate stories to test cases, defects and dependencies

As a QA Lead, I want to inspect the evidence and dependencies associated with each story.

Story links connect acceptance intent to test cases, Defects and related stories. Traceability counts represent unique linked records, not execution completion.

- Status: ready; priority: P2; effort: 5 story points.
- Sprint: HT 02 · Product planning. Release: HelloTest Foundation · sample; fix version: demo-foundation-1.0.
- Team: HelloTest Product. Labels: sample, hellotest-core, planning.
- Sources: `services/manual/frontend/pages/RequirementsPage.tsx`, `services/manual/frontend/pages/ReleasesPage.tsx`, `services/manual/backend/services/requirement.service.js`, `services/manual/backend/services/requirementRelease.service.js`.

Acceptance criteria:

- Link an existing project test case and show it in story detail and coverage counts.
- Add a related story or dependency and retain its type and navigation target.
- Unlinking a case updates the story tile and relevant product metrics.

Boundary: Duplicate links must not inflate coverage and unrelated-project evidence must not be attachable.

#### story-import-sync: Import and synchronize stories while retaining delivery metadata

As a Product Owner, I want to bring external requirements into the project with reviewable mappings.

Story import and configured tracker synchronization retain source references and map supported fields. Imported labels must not be mistaken for canonical local sprint or release IDs.

- Status: draft; priority: P2; effort: 5 story points.
- Sprint: Backlog (not scheduled). Release: HelloTest Foundation · sample; fix version: demo-foundation-1.0.
- Team: HelloTest Product. Labels: sample, hellotest-core, planning.
- Sources: `services/manual/frontend/pages/RequirementsPage.tsx`, `services/manual/frontend/pages/ReleasesPage.tsx`, `services/manual/backend/services/requirement.service.js`, `services/manual/backend/services/requirementRelease.service.js`, `services/manual/frontend/lib/requirementImport.ts`, `services/integration/backend/routes/projectSync.routes.js`.

Acceptance criteria:

- Preview supported imported fields and map title, description, priority and external reference.
- Preserve an existing local sprint association when its source metadata is unchanged.
- Show actionable errors for invalid rows without presenting a partial failure as full success.

Boundary: Do not create duplicate stories on a supported repeat import or overwrite unrelated local edits without the chosen sync behavior.

#### story-ai-design: Review AI-assisted story refinement and proposed test coverage

As a Product Owner, I want to use project-grounded suggestions to improve acceptance criteria before saving them.

The story AI workspace helps refine requirements and generate reviewable design artifacts using a configured provider and permitted context. Suggestions are drafts until accepted.

- Status: ready; priority: P2; effort: 8 story points.
- Sprint: HT 02 · Product planning. Release: HelloTest Foundation · sample; fix version: demo-foundation-1.0.
- Team: HelloTest Product. Labels: sample, hellotest-core, planning.
- Sources: `services/manual/frontend/pages/RequirementsPage.tsx`, `services/manual/frontend/pages/ReleasesPage.tsx`, `services/manual/backend/services/requirement.service.js`, `services/manual/backend/services/requirementRelease.service.js`.

Acceptance criteria:

- Supply story context and request a review using the configured project-compatible AI integration.
- Display proposed acceptance criteria, gaps and test design so the user can inspect them.
- Apply selected changes only after the user chooses the generated content to retain.

Boundary: Provider failure or missing configuration leaves the original story intact and exposes a retryable explanation.

### Test design and data

#### structured-cases: Author structured test cases with ordered steps and expected results

As a QA Member, I want to create reproducible test cases linked to the correct application and story.

A case records title, description, type, priority, lifecycle, author and ordered actions with expected results. Case links and module/suite context must survive editing.

- Status: ready; priority: P1; effort: 5 story points.
- Sprint: HT 03 · Reusable test design. Release: HelloTest Quality Delivery · sample; fix version: demo-quality-1.0.
- Team: HelloTest Quality. Labels: sample, hellotest-core, design.
- Sources: `services/testing/frontend/pages/TestCasesPage.tsx`, `services/testing/frontend/pages/DesignPage.tsx`, `services/testing/frontend/pages/SharedStepsPage.tsx`, `services/testing/frontend/pages/TestEnvironmentPage.tsx`.

Acceptance criteria:

- Create a case in the selected application with actionable steps and explicit expected results.
- Reorder, add and remove steps and retain the saved order after reopening.
- Associate the case with a story and show the same link in both directions.

Boundary: Editing one case must not mutate another case’s independent steps or application scope.

#### gherkin-authoring: Preserve Gherkin Features, Backgrounds and Scenario Outlines

As a QA Member, I want to express behavior in readable Gherkin with reusable parameters and examples.

Gherkin authoring preserves feature-level context and behavior steps. Dataset examples and parameter placeholders must remain aligned with the saved structured representation.

- Status: ready; priority: P2; effort: 5 story points.
- Sprint: HT 03 · Reusable test design. Release: HelloTest Quality Delivery · sample; fix version: demo-quality-1.0.
- Team: HelloTest Quality. Labels: sample, hellotest-core, design.
- Sources: `services/testing/frontend/pages/TestCasesPage.tsx`, `services/testing/frontend/pages/DesignPage.tsx`, `services/testing/frontend/pages/SharedStepsPage.tsx`, `services/testing/frontend/pages/TestEnvironmentPage.tsx`.

Acceptance criteria:

- Save Feature, Background and Scenario content and reopen it without losing step meaning.
- A scenario with example rows is represented as a Scenario Outline with matching placeholders.
- Switching supported views keeps preconditions distinct from scenario actions.

Boundary: Do not expose resolved sensitive parameter values inside visible Gherkin text.

#### shared-steps: Reuse shared step groups without losing parameter boundaries

As a QA Lead, I want to maintain common behavior once and reuse it across test cases.

Shared groups support structured and Gherkin content plus parameters. References must preserve local case behavior and the source group identity.

- Status: ready; priority: P2; effort: 5 story points.
- Sprint: HT 03 · Reusable test design. Release: HelloTest Quality Delivery · sample; fix version: demo-quality-1.0.
- Team: HelloTest Quality. Labels: sample, hellotest-core, design.
- Sources: `services/testing/frontend/pages/TestCasesPage.tsx`, `services/testing/frontend/pages/DesignPage.tsx`, `services/testing/frontend/pages/SharedStepsPage.tsx`, `services/testing/frontend/pages/TestEnvironmentPage.tsx`.

Acceptance criteria:

- Create a shared group and insert its reference into more than one case.
- Keep group parameters available for case or run overrides.
- Show the reusable group name and behavior consistently when reopening linked cases.

Boundary: Deleting or changing a reference must not delete independent steps belonging to another case.

#### suite-modules: Organize cases into modules and reusable ordered suites

As a QA Lead, I want to assemble a repeatable execution scope from existing cases.

Modules organize test design; suites select execution membership. Stored membership and order must agree with the run scope produced from the suite.

- Status: ready; priority: P2; effort: 5 story points.
- Sprint: HT 03 · Reusable test design. Release: HelloTest Quality Delivery · sample; fix version: demo-quality-1.0.
- Team: HelloTest Quality. Labels: sample, hellotest-core, design.
- Sources: `services/testing/frontend/pages/TestCasesPage.tsx`, `services/testing/frontend/pages/DesignPage.tsx`, `services/testing/frontend/pages/SharedStepsPage.tsx`, `services/testing/frontend/pages/TestEnvironmentPage.tsx`.

Acceptance criteria:

- Create a module, associate existing cases and create a new case in that module.
- Build a suite from filtered case candidates without duplicating membership.
- Persist supported module and case ordering and use it when creating the run.

Boundary: A hidden case outside the active selection must not be added merely because it matches a broad filter.

#### case-review-versioning: Retain case revision history and review ownership

As a QA Lead, I want to review changed test content and compare saved revisions.

Case history preserves prior snapshots and change summaries. Review and author metadata provide accountability without inventing execution evidence.

- Status: draft; priority: P2; effort: 5 story points.
- Sprint: Backlog (not scheduled). Release: HelloTest Quality Delivery · sample; fix version: demo-quality-1.0.
- Team: HelloTest Quality. Labels: sample, hellotest-core, design.
- Sources: `services/testing/frontend/pages/TestCasesPage.tsx`, `services/testing/frontend/pages/DesignPage.tsx`, `services/testing/frontend/pages/SharedStepsPage.tsx`, `services/testing/frontend/pages/TestEnvironmentPage.tsx`.

Acceptance criteria:

- Save a meaningful case change with a new revision and reviewable snapshot.
- Inspect an earlier revision while the current editable version remains available.
- Retain case author and reviewer metadata through supported updates.

Boundary: History views must not silently overwrite the current version or attribute changes to a different actor.

#### case-import-export: Round-trip supported test case imports and exports

As a QA Member, I want to reuse case definitions across supported files without losing ordered behavior.

Import/export covers supported case fields and step structures. Users must be able to review mapping and row-level errors before trusting the imported scope.

- Status: draft; priority: P2; effort: 5 story points.
- Sprint: Backlog (not scheduled). Release: HelloTest Quality Delivery · sample; fix version: demo-quality-1.0.
- Team: HelloTest Quality. Labels: sample, hellotest-core, design.
- Sources: `services/testing/frontend/pages/TestCasesPage.tsx`, `services/testing/frontend/pages/DesignPage.tsx`, `services/testing/frontend/pages/SharedStepsPage.tsx`, `services/testing/frontend/pages/TestEnvironmentPage.tsx`.

Acceptance criteria:

- Export selected cases with their supported metadata and ordered steps.
- Import a supported file into the intended application and validate required fields.
- Report invalid rows and accepted records accurately.

Boundary: Reject unsupported or malformed input without reporting uncreated cases as successfully imported.

#### environment-targets: Configure environment targets and scoped variables

As a QA Lead, I want to define repeatable application endpoints without editing each test case.

Environment configuration stores a base URL and variables within project/application scope. Run creation selects permitted environments and freezes the chosen context.

- Status: ready; priority: P2; effort: 5 story points.
- Sprint: HT 03 · Reusable test design. Release: HelloTest Quality Delivery · sample; fix version: demo-quality-1.0.
- Team: HelloTest Quality. Labels: sample, hellotest-core, design.
- Sources: `services/testing/frontend/pages/TestCasesPage.tsx`, `services/testing/frontend/pages/DesignPage.tsx`, `services/testing/frontend/pages/SharedStepsPage.tsx`, `services/testing/frontend/pages/TestEnvironmentPage.tsx`.

Acceptance criteria:

- Create and edit an environment with a name, base URL, description and variables.
- Run configuration lists environments available to the selected application.
- A saved run retains the environment snapshot after the live environment changes.

Boundary: Variables from an unrelated application must not leak into the selected run.

#### configuration-profiles: Select browser and mobile configuration profiles

As a Automation Engineer, I want to reuse execution target settings across runs.

Profiles describe supported browser, platform, mobile OS/version and configuration variables. Selection must remain compatible with application scope and configured engine support.

- Status: ready; priority: P2; effort: 5 story points.
- Sprint: HT 03 · Reusable test design. Release: HelloTest Quality Delivery · sample; fix version: demo-quality-1.0.
- Team: HelloTest Quality. Labels: sample, hellotest-core, design.
- Sources: `services/testing/frontend/pages/TestCasesPage.tsx`, `services/testing/frontend/pages/DesignPage.tsx`, `services/testing/frontend/pages/SharedStepsPage.tsx`, `services/testing/frontend/pages/TestEnvironmentPage.tsx`.

Acceptance criteria:

- Save a named browser or mobile profile with its supported properties.
- Select the profile during run setup and retain its snapshot in run evidence.
- Keep configuration variables distinct from environment and case values.

Boundary: An unavailable device or unsupported target must produce an actionable state rather than a fabricated successful execution.

#### datasets-parameters: Link datasets and apply parameter precedence consistently

As a QA Member, I want to run the same scenario with explicit input rows and predictable overrides.

Datasets contain named columns and rows and can be linked to cases or runs. Execution preserves the selected input row and the parameter scopes used to resolve it.

- Status: ready; priority: P2; effort: 8 story points.
- Sprint: HT 03 · Reusable test design. Release: HelloTest Quality Delivery · sample; fix version: demo-quality-1.0.
- Team: HelloTest Quality. Labels: sample, hellotest-core, design.
- Sources: `services/testing/frontend/pages/TestCasesPage.tsx`, `services/testing/frontend/pages/DesignPage.tsx`, `services/testing/frontend/pages/SharedStepsPage.tsx`, `services/testing/frontend/pages/TestEnvironmentPage.tsx`.

Acceptance criteria:

- Create a table dataset and link it to a permitted case or run.
- Resolve configuration, suite, case and row inputs according to the supported precedence.
- Retain each dataset row identity and snapshot with its execution result.

Boundary: Missing required input must be visible and one row’s values must not overwrite another row’s results.

#### ai-authoring-data: Review AI case mapping, step rephrase and synthetic data drafts

As a QA Member, I want to accelerate authoring with reviewable suggestions and generated sample inputs.

Configured AI can help map cases, rephrase steps or rich text and propose synthetic dataset rows. Accepted content still uses ordinary validation and saving paths.

- Status: draft; priority: P2; effort: 5 story points.
- Sprint: Backlog (not scheduled). Release: HelloTest Quality Delivery · sample; fix version: demo-quality-1.0.
- Team: HelloTest Quality. Labels: sample, hellotest-core, design.
- Sources: `services/testing/frontend/pages/TestCasesPage.tsx`, `services/testing/frontend/pages/DesignPage.tsx`, `services/testing/frontend/pages/SharedStepsPage.tsx`, `services/testing/frontend/pages/TestEnvironmentPage.tsx`.

Acceptance criteria:

- Show generated case or step suggestions before replacing authored content.
- Generate synthetic data matching requested columns without claiming it is production data.
- Allow selected suggestions to be accepted while retaining other authored fields.

Boundary: A provider error must retain the original draft and must not insert fabricated completion evidence.

### Execution and defects

#### run-planning: Create a run from authorized suites and explicit delivery context

As a QA Lead, I want to prepare a run with the intended cases, assignees and release scope.

Run setup combines suite/case selection, assignments, environment, configuration, data and optional Release, Sprint and Build fields.

- Status: ready; priority: P1; effort: 5 story points.
- Sprint: HT 04 · Execution and triage. Release: HelloTest Quality Delivery · sample; fix version: demo-quality-1.0.
- Team: HelloTest Quality. Labels: sample, hellotest-core, execution.
- Sources: `services/testing/frontend/pages/ExecutionsPage.tsx`, `services/testing/frontend/pages/IssuesPage.tsx`, `services/testing/backend/services/executionSchedule.service.js`, `services/platform/backend/src/utils/finalizedCaseMetrics.js`.

Acceptance criteria:

- Select suites or cases from the intended application and show the exact planned case scope.
- Save assignees and delivery context along with environment, configuration and data choices.
- Open the created run and retain its planned case order and assignments.

Boundary: An empty or unauthorized execution scope must not be reported as a successful run.

#### frozen-evidence: Record manual case and step outcomes against frozen run snapshots

As a QA Member, I want to capture repeatable evidence while cases continue to evolve.

Runs snapshot selected cases, steps and input context. Manual outcomes, notes, attachments and defects belong to the saved run evidence, not a moving case definition.

- Status: ready; priority: P1; effort: 5 story points.
- Sprint: HT 04 · Execution and triage. Release: HelloTest Quality Delivery · sample; fix version: demo-quality-1.0.
- Team: HelloTest Quality. Labels: sample, hellotest-core, execution.
- Sources: `services/testing/frontend/pages/ExecutionsPage.tsx`, `services/testing/frontend/pages/IssuesPage.tsx`, `services/testing/backend/services/executionSchedule.service.js`, `services/platform/backend/src/utils/finalizedCaseMetrics.js`.

Acceptance criteria:

- Display the saved step sequence even after the source case is edited.
- Record allowed passed, failed, blocked or skipped outcomes with notes and evidence.
- Reopen the result and retain the selected outcome, executor and lifecycle timestamps.

Boundary: An unfinished case must remain unfinished; unsaved or failed outcome writes must not appear finalized.

#### dataset-outcomes: Calculate final case outcomes across dataset iterations

As a QA Lead, I want to interpret run results without counting retries or data rows as extra cases.

A case may have multiple data-row attempts. Case and run metrics must use the supported finalized-outcome policy and preserve individual iteration evidence.

- Status: ready; priority: P1; effort: 8 story points.
- Sprint: HT 04 · Execution and triage. Release: HelloTest Quality Delivery · sample; fix version: demo-quality-1.0.
- Team: HelloTest Quality. Labels: sample, hellotest-core, execution.
- Sources: `services/testing/frontend/pages/ExecutionsPage.tsx`, `services/testing/frontend/pages/IssuesPage.tsx`, `services/testing/backend/services/executionSchedule.service.js`, `services/platform/backend/src/utils/finalizedCaseMetrics.js`.

Acceptance criteria:

- Retain separate row keys, input snapshots and outcomes for data-driven attempts.
- Count each case once in case-level metrics while iteration-level details remain inspectable.
- Exclude unfinished attempts from completed-result denominators.

Boundary: A later retry or multiple passed rows must not inflate unique case totals or mask a relevant failed outcome.

#### scheduled-runs: Manage disabled, future and recurring run schedules

As a QA Lead, I want to repeat a validated execution scope at the intended time.

Schedules retain project/application, suite selection, execution context, assignees and cadence. Installation examples remain disabled until explicitly configured.

- Status: ready; priority: P2; effort: 5 story points.
- Sprint: HT 04 · Execution and triage. Release: HelloTest Quality Delivery · sample; fix version: demo-quality-1.0.
- Team: HelloTest Quality. Labels: sample, hellotest-core, execution.
- Sources: `services/testing/frontend/pages/ExecutionsPage.tsx`, `services/testing/frontend/pages/IssuesPage.tsx`, `services/testing/backend/services/executionSchedule.service.js`, `services/platform/backend/src/utils/finalizedCaseMetrics.js`.

Acceptance criteria:

- Create a schedule with scope, cadence and execution context.
- Enable or disable the schedule explicitly and show its next and last run state.
- Record claim or execution failures so repeated work can be investigated.

Boundary: Disabled schedules and projects being deleted must not be claimed for new work.

#### execution-analysis-reports: Inspect execution reports and AI-assisted failure analysis

As a QA Lead, I want to investigate failed runs using saved results rather than assumptions.

Reports and analysis use the permitted run scope, saved result evidence and configured AI capability. Exported outcomes must agree with visible finalized metrics.

- Status: draft; priority: P2; effort: 5 story points.
- Sprint: Backlog (not scheduled). Release: HelloTest Quality Delivery · sample; fix version: demo-quality-1.0.
- Team: HelloTest Quality. Labels: sample, hellotest-core, execution.
- Sources: `services/testing/frontend/pages/ExecutionsPage.tsx`, `services/testing/frontend/pages/IssuesPage.tsx`, `services/testing/backend/services/executionSchedule.service.js`, `services/platform/backend/src/utils/finalizedCaseMetrics.js`.

Acceptance criteria:

- Filter a run report and inspect linked result details and evidence.
- Export a supported report with the same scope and outcome methodology.
- If AI analysis is configured, distinguish cited findings from suggestions and missing evidence.

Boundary: Provider failure or missing evidence must not be presented as a confirmed root cause.

#### bug-lifecycle: Capture and triage Defects with severity, ownership and history

As a QA Member, I want to record actionable defects and follow their resolution.

Defects capture description, type, severity, priority, status, root cause, regression information and delivery/environment context. History preserves the investigation trail.

- Status: ready; priority: P1; effort: 5 story points.
- Sprint: HT 04 · Execution and triage. Release: HelloTest Quality Delivery · sample; fix version: demo-quality-1.0.
- Team: HelloTest Quality. Labels: sample, hellotest-core, execution.
- Sources: `services/testing/frontend/pages/ExecutionsPage.tsx`, `services/testing/frontend/pages/IssuesPage.tsx`, `services/testing/backend/services/executionSchedule.service.js`, `services/platform/backend/src/utils/finalizedCaseMetrics.js`.

Acceptance criteria:

- Create a Defect with reproduction details, expected/actual behavior and severity.
- Update supported triage fields and show the resulting status and history.
- Retain ownership, environment, build and fixed-version context after reopening.

Boundary: Reporter access allows permitted creation but must not implicitly grant edit or delete access to existing Defects.

#### bug-collaboration: Review duplicate Defects and linked evidence before creating another

As a QA Member, I want to find related defects and collaborate using scoped comments and attachments.

Duplicate review uses selected case/module context. Story, case, suite and run relationships let investigators reach supporting evidence without losing source scope.

- Status: ready; priority: P2; effort: 5 story points.
- Sprint: HT 04 · Execution and triage. Release: HelloTest Quality Delivery · sample; fix version: demo-quality-1.0.
- Team: HelloTest Quality. Labels: sample, hellotest-core, execution.
- Sources: `services/testing/frontend/pages/ExecutionsPage.tsx`, `services/testing/frontend/pages/IssuesPage.tsx`, `services/testing/backend/services/executionSchedule.service.js`, `services/platform/backend/src/utils/finalizedCaseMetrics.js`.

Acceptance criteria:

- Review duplicate candidates and deliberately choose an existing Defect or continue with a new one.
- Link impacted stories and test evidence from the current project.
- Save comments and permitted attachments and display them on the same Defect.

Boundary: A similar title is a candidate, not proof of duplication; unauthorized evidence must remain inaccessible.

#### bug-regression-ai: Turn Defect findings into reviewed regression coverage

As a QA Lead, I want to create a regression test from a defect and review AI triage suggestions.

Defect-to-case conversion maps supported defect details into an editable test draft. Configured AI assistance can help draft or triage without replacing human review.

- Status: draft; priority: P2; effort: 5 story points.
- Sprint: Backlog (not scheduled). Release: HelloTest Quality Delivery · sample; fix version: demo-quality-1.0.
- Team: HelloTest Quality. Labels: sample, hellotest-core, execution.
- Sources: `services/testing/frontend/pages/ExecutionsPage.tsx`, `services/testing/frontend/pages/IssuesPage.tsx`, `services/testing/backend/services/executionSchedule.service.js`, `services/platform/backend/src/utils/finalizedCaseMetrics.js`.

Acceptance criteria:

- Create a test draft containing relevant Defect details and a source-Defect link.
- Choose the target application and review steps and expected results before saving.
- Keep AI suggestions distinguishable from confirmed severity, root cause and outcome fields.

Boundary: Conversion must not close the Defect or claim the resulting test passed.

### Automation and mobile

#### automation-coverage: Link executable automation to its manual coverage

As a Automation Engineer, I want to maintain traceability between manual intent and executable cases.

Automation status and manual-to-automation links describe coverage readiness. An executable counterpart must retain its application scope and source case relationship.

- Status: ready; priority: P2; effort: 5 story points.
- Sprint: HT 05 · Automation delivery. Release: HelloTest Quality Delivery · sample; fix version: demo-quality-1.0.
- Team: HelloTest Automation. Labels: sample, hellotest-core, automation.
- Sources: `services/automation/frontend/pages/AutomationPage.tsx`, `services/automation/backend/routes/engine.routes.js`, `services/automation/backend/routes/localAgent.routes.js`, `services/agentic/backend/routes/repositoryAgents.routes.js`.

Acceptance criteria:

- Create or select an automated case linked to the intended manual case.
- Keep primary and additional coverage links distinct without duplicating counts.
- Show automation status separately from test execution results.

Boundary: An automation link alone must not be interpreted as a passed run or complete acceptance coverage.

#### builder-step-code: Review executable assets and step-level code before running

As a Automation Engineer, I want to inspect generated or authored automation and maintain reusable assets.

The automation workspace exposes supported assets, builder operations and step-level code. Feature controls independently govern previews and saved code views.

- Status: ready; priority: P2; effort: 8 story points.
- Sprint: HT 05 · Automation delivery. Release: HelloTest Quality Delivery · sample; fix version: demo-quality-1.0.
- Team: HelloTest Automation. Labels: sample, hellotest-core, automation.
- Sources: `services/automation/frontend/pages/AutomationPage.tsx`, `services/automation/backend/routes/engine.routes.js`, `services/automation/backend/routes/localAgent.routes.js`, `services/agentic/backend/routes/repositoryAgents.routes.js`.

Acceptance criteria:

- Review the supported generated or saved code associated with an automated case or step.
- Keep case and reusable asset identities stable through supported edits.
- Honor separate feature availability for builder, assets and step-code operations.

Boundary: Do not show unexecuted generated code as a verified passing automation result.

#### api-requests: Configure API requests, validations and captured parameters

As a Automation Engineer, I want to test API contracts using reviewable request definitions.

API steps store method, URL, headers, body mode, validations and captures. Preview validates configured requests and returns observed response information.

- Status: ready; priority: P2; effort: 5 story points.
- Sprint: HT 05 · Automation delivery. Release: HelloTest Quality Delivery · sample; fix version: demo-quality-1.0.
- Team: HelloTest Automation. Labels: sample, hellotest-core, automation.
- Sources: `services/automation/frontend/pages/AutomationPage.tsx`, `services/automation/backend/routes/engine.routes.js`, `services/automation/backend/routes/localAgent.routes.js`, `services/agentic/backend/routes/repositoryAgents.routes.js`.

Acceptance criteria:

- Save request method, URL, headers and supported body settings and reopen them unchanged.
- Define status or supported payload assertions and capture selected response values.
- Run an explicitly requested preview and display the actual result or actionable failure.

Boundary: Missing credentials, invalid targets and request timeouts must not be reported as successful assertions.

#### object-repository: Curate stable object bindings with locator provenance

As a Automation Engineer, I want to reuse reliable page and screen objects across automated steps.

Objects retain screen/page intent, names, locators, platform metadata, source and confidence. Reuse should preserve why a binding was chosen.

- Status: ready; priority: P2; effort: 5 story points.
- Sprint: HT 05 · Automation delivery. Release: HelloTest Quality Delivery · sample; fix version: demo-quality-1.0.
- Team: HelloTest Automation. Labels: sample, hellotest-core, automation.
- Sources: `services/automation/frontend/pages/AutomationPage.tsx`, `services/automation/backend/routes/engine.routes.js`, `services/automation/backend/routes/localAgent.routes.js`, `services/agentic/backend/routes/repositoryAgents.routes.js`.

Acceptance criteria:

- Create or review a named object with platform-appropriate locator information.
- Inspect confidence, source and fallback bindings before selecting the object.
- Reuse the object in supported case automation without losing the source relationship.

Boundary: Low-confidence or duplicate candidates must not silently replace a reviewed stable binding.

#### step-recorder: Capture browser actions and review saved automation steps

As a Automation Engineer, I want to record a supported interaction flow and review the resulting saved plan.

Step-level recording connects a configured recording environment to case authoring and object bindings. Finishing recording saves supported captured steps; the updated plan can then be reviewed and edited.

- Status: ready; priority: P2; effort: 5 story points.
- Sprint: HT 05 · Automation delivery. Release: HelloTest Quality Delivery · sample; fix version: demo-quality-1.0.
- Team: HelloTest Automation. Labels: sample, hellotest-core, automation.
- Sources: `services/automation/frontend/pages/AutomationPage.tsx`, `services/automation/backend/routes/engine.routes.js`, `services/automation/backend/routes/localAgent.routes.js`, `services/agentic/backend/routes/repositoryAgents.routes.js`.

Acceptance criteria:

- Start an explicitly requested recording session in the selected case context.
- Finish recording and persist the supported captured actions in their recorded order.
- Open the updated automation plan to inspect and edit generated steps and locator bindings.

Boundary: A disconnected recorder must expose recovery state and must not claim missing interactions were captured.

#### local-execution: Run supported automation locally and retain its evidence

As a Automation Engineer, I want to execute against a configured local agent and review saved results.

Local execution connects the selected case and context to the configured desktop/Playwright runner. Local Runs exposes recorded attempts and their outcomes.

- Status: ready; priority: P2; effort: 5 story points.
- Sprint: HT 05 · Automation delivery. Release: HelloTest Quality Delivery · sample; fix version: demo-quality-1.0.
- Team: HelloTest Automation. Labels: sample, hellotest-core, automation.
- Sources: `services/automation/frontend/pages/AutomationPage.tsx`, `services/automation/backend/routes/engine.routes.js`, `services/automation/backend/routes/localAgent.routes.js`, `services/agentic/backend/routes/repositoryAgents.routes.js`.

Acceptance criteria:

- Confirm local runner availability and the intended case scope before execution.
- Track run progress and retain actual outcomes, timing and available evidence.
- Open the recorded local run from the Runs workspace.

Boundary: An offline agent must fail clearly rather than leaving the UI waiting indefinitely or fabricating a run result.

#### remote-parallel: Dispatch remote automation with bounded parallel execution

As a Automation Engineer, I want to execute supported suites on configured workers without duplicate claims.

Remote dispatch and parallel execution use configured engine capabilities. Worker ownership, progress and callbacks must remain associated with the correct project and run.

- Status: ready; priority: P2; effort: 8 story points.
- Sprint: HT 05 · Automation delivery. Release: HelloTest Quality Delivery · sample; fix version: demo-quality-1.0.
- Team: HelloTest Automation. Labels: sample, hellotest-core, automation.
- Sources: `services/automation/frontend/pages/AutomationPage.tsx`, `services/automation/backend/routes/engine.routes.js`, `services/automation/backend/routes/localAgent.routes.js`, `services/agentic/backend/routes/repositoryAgents.routes.js`.

Acceptance criteria:

- Select an available remote engine and persist the intended execution context.
- Dispatch supported parallel work while retaining unique case/attempt identities.
- Reflect progress, terminal outcomes and failure details from the actual worker callbacks.

Boundary: Retries must not double-count attempts; unavailable workers must produce an observable recoverable state.

#### android-appium: Use configured Android and Appium execution targets

As a Automation Engineer, I want to validate mobile behavior with an available supported device.

Mobile execution depends on the configured mobile engine, Appium and device availability. Configuration and locator strategy must remain compatible with the chosen mobile target.

- Status: ready; priority: P2; effort: 5 story points.
- Sprint: HT 05 · Automation delivery. Release: HelloTest Quality Delivery · sample; fix version: demo-quality-1.0.
- Team: HelloTest Automation. Labels: sample, hellotest-core, automation.
- Sources: `services/automation/frontend/pages/AutomationPage.tsx`, `services/automation/backend/routes/engine.routes.js`, `services/automation/backend/routes/localAgent.routes.js`, `services/agentic/backend/routes/repositoryAgents.routes.js`.

Acceptance criteria:

- Choose a supported Android configuration and inspect available device/session state.
- Execute a supported mobile case using platform-appropriate locators.
- Retain actual device execution results and diagnostic evidence.

Boundary: No connected device or an unsupported platform must yield an actionable error, not simulated evidence.

#### repository-specialists: Generate reviewable automation artifacts from selected source

As a Automation Engineer, I want to inspect repository-derived objects, API tests and knowledge before reuse.

Repository agents accept supported source inputs and generate bounded review artifacts. Source provenance and configured AI/runtime requirements remain visible.

- Status: ready; priority: P2; effort: 8 story points.
- Sprint: HT 05 · Automation delivery. Release: HelloTest Quality Delivery · sample; fix version: demo-quality-1.0.
- Team: HelloTest Automation. Labels: sample, hellotest-core, automation.
- Sources: `services/automation/frontend/pages/AutomationPage.tsx`, `services/automation/backend/routes/engine.routes.js`, `services/automation/backend/routes/localAgent.routes.js`, `services/agentic/backend/routes/repositoryAgents.routes.js`.

Acceptance criteria:

- Select supported repository or archive input and an intended project/application.
- Track the analysis job and inspect the generated objects, API tests or knowledge candidates.
- Save accepted outputs with source provenance and retain failures for investigation.

Boundary: A source scan or generated candidate must not be presented as an executed, passing test.

### Knowledge and AI

#### knowledge-ingestion: Ingest supported project evidence and supplied content into knowledge

As a AI Engineer, I want to curate reusable sources for grounded assistance.

Knowledge supports selected project records, supplied text, supported files and URLs. Extraction, revision and indexing state show when a source is actually searchable.

- Status: ready; priority: P1; effort: 8 story points.
- Sprint: HT 06 · Grounded intelligence. Release: HelloTest Intelligence & Operations · sample; fix version: demo-intelligence-1.0.
- Team: HelloTest Intelligence. Labels: sample, hellotest-core, intelligence.
- Sources: `services/knowledge/frontend/pages/KnowledgeRepoPage.tsx`, `services/agentic/frontend/pages/AgenticWorkflowsPage.tsx`, `services/knowledge/backend/services/knowledgeProductCatalog.service.js`, `services/integration/backend/routes/aiPromptTemplates.routes.js`.

Acceptance criteria:

- Add a supported source with title, project scope and collection association.
- Show processing, extraction failure and retry states without marking unindexed content as ready.
- Retain document/source provenance and citations for indexed content.

Boundary: Images require supplied captions and audio/video require transcripts; do not invent extracted content.

#### knowledge-search: Search versioned knowledge within authorized project scope

As a AI Engineer, I want to retrieve relevant source passages with inspectable citations.

Retrieval uses available lexical and semantic indexing, source versions and access bindings. Collection filters must retain project-level security.

- Status: ready; priority: P1; effort: 5 story points.
- Sprint: HT 06 · Grounded intelligence. Release: HelloTest Intelligence & Operations · sample; fix version: demo-intelligence-1.0.
- Team: HelloTest Intelligence. Labels: sample, hellotest-core, intelligence.
- Sources: `services/knowledge/frontend/pages/KnowledgeRepoPage.tsx`, `services/agentic/frontend/pages/AgenticWorkflowsPage.tsx`, `services/knowledge/backend/services/knowledgeProductCatalog.service.js`, `services/integration/backend/routes/aiPromptTemplates.routes.js`.

Acceptance criteria:

- Search indexed content and show source/document references with matching passages.
- Respect selected collections and current source revisions.
- Use the supported deterministic fallback when configured embeddings are unavailable.

Boundary: Cross-project or unauthorized source passages must never appear in search results.

#### ask-hellotest: Answer project questions with current evidence and explicit gaps

As a project member, I want to ask HelloTest for product guidance and project analysis backed by citations.

The assistant combines permitted live project facts with relevant knowledge and product guidance. Provider outages retain deterministic evidence-backed fallback behavior.

- Status: ready; priority: P2; effort: 8 story points.
- Sprint: HT 06 · Grounded intelligence. Release: HelloTest Intelligence & Operations · sample; fix version: demo-intelligence-1.0.
- Team: HelloTest Intelligence. Labels: sample, hellotest-core, intelligence.
- Sources: `services/knowledge/frontend/pages/KnowledgeRepoPage.tsx`, `services/agentic/frontend/pages/AgenticWorkflowsPage.tsx`, `services/knowledge/backend/services/knowledgeProductCatalog.service.js`, `services/integration/backend/routes/aiPromptTemplates.routes.js`.

Acceptance criteria:

- Distinguish product guidance, current project facts and analytical recommendations.
- Return citations or evidence gaps for factual project claims.
- Resolve follow-up context while retrieving fresh permitted evidence for the current question.

Boundary: Missing or conflicting evidence must not become an invented project fact or unsupported completion claim.

#### workflow-canvas: Compose specialist workflows with validated steps and outputs

As a AI Engineer, I want to build a reusable manual workflow from supported specialists.

Workflow definitions contain triggers, agent steps, context scopes, edges and outputs. Drafts are not executed by sample installation.

- Status: ready; priority: P2; effort: 5 story points.
- Sprint: HT 06 · Grounded intelligence. Release: HelloTest Intelligence & Operations · sample; fix version: demo-intelligence-1.0.
- Team: HelloTest Intelligence. Labels: sample, hellotest-core, intelligence.
- Sources: `services/knowledge/frontend/pages/KnowledgeRepoPage.tsx`, `services/agentic/frontend/pages/AgenticWorkflowsPage.tsx`, `services/knowledge/backend/services/knowledgeProductCatalog.service.js`, `services/integration/backend/routes/aiPromptTemplates.routes.js`.

Acceptance criteria:

- Create a workflow from supported node kinds and valid connections.
- Select specialist agents and explicit context/output keys.
- Save a draft and run it only through an authorized explicit action.

Boundary: Invalid graphs or unsupported specialist IDs must be rejected before dispatch.

#### workflow-history: Inspect workflow attempts and per-step recovery states

As a AI Engineer, I want to understand which workflow steps completed and why an attempt failed.

Workflow history retains attempts, step outcomes and generated review artifacts. Observed execution state remains distinct from the editable workflow definition.

- Status: ready; priority: P2; effort: 5 story points.
- Sprint: HT 06 · Grounded intelligence. Release: HelloTest Intelligence & Operations · sample; fix version: demo-intelligence-1.0.
- Team: HelloTest Intelligence. Labels: sample, hellotest-core, intelligence.
- Sources: `services/knowledge/frontend/pages/KnowledgeRepoPage.tsx`, `services/agentic/frontend/pages/AgenticWorkflowsPage.tsx`, `services/knowledge/backend/services/knowledgeProductCatalog.service.js`, `services/integration/backend/routes/aiPromptTemplates.routes.js`.

Acceptance criteria:

- Open a workflow attempt and inspect its recorded step statuses and outputs.
- Retain errors and timing when a configured provider or step fails.
- Associate each output with its originating attempt rather than overwriting prior evidence.

Boundary: An interrupted step must not appear completed merely because the workflow definition contains an output node.

#### prompt-governance: Reuse prompt templates and governed AI provider mappings

As a AI Engineer, I want to apply consistent prompts through administrator-approved integrations.

Prompt templates retain scope, tags and applicable entities. Provider mappings select a configured project-compatible integration; credentials remain governed configuration.

- Status: draft; priority: P2; effort: 5 story points.
- Sprint: Backlog (not scheduled). Release: HelloTest Intelligence & Operations · sample; fix version: demo-intelligence-1.0.
- Team: HelloTest Intelligence. Labels: sample, hellotest-core, intelligence.
- Sources: `services/knowledge/frontend/pages/KnowledgeRepoPage.tsx`, `services/agentic/frontend/pages/AgenticWorkflowsPage.tsx`, `services/knowledge/backend/services/knowledgeProductCatalog.service.js`, `services/integration/backend/routes/aiPromptTemplates.routes.js`.

Acceptance criteria:

- Save a prompt template with a clear purpose, scope and applicable entities.
- Resolve the active configured provider/model for an allowed prompt key.
- Respect disabled AI feature controls even when a prompt template exists.

Boundary: Do not embed real provider credentials in reusable sample prompts or claim a live model response when none ran.

#### browser-quality-agents: Execute reviewed browser quality checks with traceable evidence

As a Quality Engineer, I want to run reviewed web, security, performance, accessibility and visual checks against an explicitly scoped application.

A typed browser plan is reviewed before execution. Durable scoped jobs return recorded stages, measured metrics, findings and authenticated screenshot artifacts. Findings can become reviewed Defects and visual captures can become explicitly approved baselines.

- Status: ready; priority: P2; effort: 8 story points.
- Sprint: HT 06 · Grounded intelligence. Release: HelloTest Intelligence & Operations · sample; fix version: demo-intelligence-1.0.
- Team: HelloTest Intelligence. Labels: sample, hellotest-core, intelligence, quality-agents.
- Sources: `services/agentic/frontend/quality/QualityAgentLab.tsx`, `services/agentic/backend/services/qualityAgents.service.js`, `testengine/backend/src/lib/qualityAgents/runtime.ts`.

Acceptance criteria:

- Select one of five default agents, a scoped target URL and bounded browser settings; review concrete journey steps before running a web goal.
- Inspect actual execution stages, measurements, findings and screenshots; stop a queued or running job without late responses replacing its cancelled state.
- Compare matching visual captures against a human-approved baseline; preserve viewport, target, masks, reviewer and screenshot integrity.
- Review and edit a finding-derived Defect draft before saving through the authorized Defects API.

Boundary: Missing browser infrastructure or incomplete steps block execution. Passive security, single-navigation performance and automated accessibility checks disclose their limits; an unapproved visual capture cannot claim a passed regression.

### Insights and operations

#### quality-analytics: Explain quality metrics with consistent scope and denominators

As a QA Lead, I want to assess coverage, execution outcomes and automation readiness using current evidence.

Quality analytics aggregates authorized project records. Unique traceability, finalized execution outcomes and readiness signals answer different questions and must be labeled clearly.

- Status: ready; priority: P1; effort: 8 story points.
- Sprint: HT 07 · Quality and operations. Release: HelloTest Intelligence & Operations · sample; fix version: demo-intelligence-1.0.
- Team: HelloTest Platform. Labels: sample, hellotest-core, operations.
- Sources: `services/dashboard/frontend/pages/OverviewPage.tsx`, `services/platform/frontend/src/platform/pages/TestOpsPage.tsx`, `services/platform/frontend/admin/AdminApp.tsx`, `services/platform/frontend/pages/AdminSpacePage.tsx`.

Acceptance criteria:

- Show total and covered story counts using distinct project stories and valid links.
- Use finalized outcomes for pass-rate denominators and display empty evidence clearly.
- Expose methodology or drill-down evidence so the user can assess each metric.

Boundary: Zero evidence must not imply a 100% pass rate, and duplicate joins must not inflate coverage.

#### custom-dashboards: Build reusable Executive, Product and QA dashboards

As a project lead, I want to compose a dashboard from supported widgets and saved filters.

Custom dashboards preserve layouts, widget configuration and supported data sources. Templates provide starting points while evidence remains project-scoped.

- Status: ready; priority: P2; effort: 5 story points.
- Sprint: HT 07 · Quality and operations. Release: HelloTest Intelligence & Operations · sample; fix version: demo-intelligence-1.0.
- Team: HelloTest Platform. Labels: sample, hellotest-core, operations.
- Sources: `services/dashboard/frontend/pages/OverviewPage.tsx`, `services/platform/frontend/src/platform/pages/TestOpsPage.tsx`, `services/platform/frontend/admin/AdminApp.tsx`, `services/platform/frontend/pages/AdminSpacePage.tsx`.

Acceptance criteria:

- Create a dashboard from a supported template or configured widgets.
- Save layout and filter changes and retain them after reopening.
- Calculate displayed widget values from the selected permitted data scope.

Boundary: A saved template or empty widget must not invent project outcomes.

#### release-readiness: Review release readiness from traceability, execution and Defect risk

As a release manager, I want to inspect release evidence before making a delivery decision.

Readiness relates release scope to linked cases, execution results and unresolved defects. The page presents the evidence and its limitations rather than replacing human approval.

- Status: ready; priority: P1; effort: 5 story points.
- Sprint: HT 07 · Quality and operations. Release: HelloTest Intelligence & Operations · sample; fix version: demo-intelligence-1.0.
- Team: HelloTest Platform. Labels: sample, hellotest-core, operations.
- Sources: `services/dashboard/frontend/pages/OverviewPage.tsx`, `services/platform/frontend/src/platform/pages/TestOpsPage.tsx`, `services/platform/frontend/admin/AdminApp.tsx`, `services/platform/frontend/pages/AdminSpacePage.tsx`.

Acceptance criteria:

- Select the intended release and show its explicit and sprint-inherited story scope.
- Inspect uncovered stories, relevant outcomes and open Defect risk with drill-down links.
- Retain consistent scope when refreshing or moving between readiness sections.

Boundary: Missing tests or stale results must remain visible; a count alone cannot certify a release as safe.

#### product-metrics: Keep Stories, Backlog, Sprint and Release cards mathematically consistent

As a Product Owner, I want to trust product metric cards and story tile counts after every change.

Product metrics use the same status normalization, unique story scope and traceability rules across lists and tiles. Full-scope totals must remain independent of loaded pagination.

- Status: ready; priority: P1; effort: 8 story points.
- Sprint: HT 07 · Quality and operations. Release: HelloTest Intelligence & Operations · sample; fix version: demo-intelligence-1.0.
- Team: HelloTest Platform. Labels: sample, hellotest-core, operations.
- Sources: `services/dashboard/frontend/pages/OverviewPage.tsx`, `services/platform/frontend/src/platform/pages/TestOpsPage.tsx`, `services/platform/frontend/admin/AdminApp.tsx`, `services/platform/frontend/pages/AdminSpacePage.tsx`.

Acceptance criteria:

- Count active, completed, covered and release-scoped stories using their documented definitions.
- Deduplicate legacy and explicit case mappings and sprint-inherited release membership.
- Refresh affected metrics after create, edit, move, link, unlink or delete operations.

Boundary: Filtered and global totals must be labeled correctly; textual status aliases must not produce conflicting completion counts.

#### background-jobs: Monitor background work and download reusable artifacts

As a project member, I want to follow long operations without keeping the initiating request open.

TestOps exposes permitted background transactions, progress, events and artifacts from imports, AI and automation. Management controls are governed separately from read access.

- Status: ready; priority: P2; effort: 5 story points.
- Sprint: HT 07 · Quality and operations. Release: HelloTest Intelligence & Operations · sample; fix version: demo-intelligence-1.0.
- Team: HelloTest Platform. Labels: sample, hellotest-core, operations.
- Sources: `services/dashboard/frontend/pages/OverviewPage.tsx`, `services/platform/frontend/src/platform/pages/TestOpsPage.tsx`, `services/platform/frontend/admin/AdminApp.tsx`, `services/platform/frontend/pages/AdminSpacePage.tsx`.

Acceptance criteria:

- View progress and terminal state for an operation within the authorized project.
- Inspect recorded events and download available generated artifacts.
- Navigate away and return without confusing an unfinished job with success.

Boundary: A polling failure must remain retryable and must not trigger duplicate destructive work.

#### telemetry-traces: Investigate operational health and distributed request traces

As a operations engineer, I want to follow a failing request across available service diagnostics.

Operational pages expose configured telemetry and trace information. Missing collectors or unavailable evidence must be presented accurately.

- Status: draft; priority: P2; effort: 5 story points.
- Sprint: Backlog (not scheduled). Release: HelloTest Intelligence & Operations · sample; fix version: demo-intelligence-1.0.
- Team: HelloTest Platform. Labels: sample, hellotest-core, operations.
- Sources: `services/dashboard/frontend/pages/OverviewPage.tsx`, `services/platform/frontend/src/platform/pages/TestOpsPage.tsx`, `services/platform/frontend/admin/AdminApp.tsx`, `services/platform/frontend/pages/AdminSpacePage.tsx`.

Acceptance criteria:

- Inspect supported operational metrics and their selected time/scope filters.
- Open an available trace and relate its service spans and errors.
- Show a useful unavailable state when the configured telemetry backend cannot respond.

Boundary: Never fabricate trace spans or healthy metrics when the collector is unavailable.

#### notifications: Review relevant notifications and retain read state

As a project member, I want to see updates for work I can access and navigate to their context.

Notifications provide user-scoped activity with read state and destination links. Counts and unread indicators must reflect the actual permitted records.

- Status: ready; priority: P2; effort: 3 story points.
- Sprint: HT 07 · Quality and operations. Release: HelloTest Intelligence & Operations · sample; fix version: demo-intelligence-1.0.
- Team: HelloTest Platform. Labels: sample, hellotest-core, operations.
- Sources: `services/dashboard/frontend/pages/OverviewPage.tsx`, `services/platform/frontend/src/platform/pages/TestOpsPage.tsx`, `services/platform/frontend/admin/AdminApp.tsx`, `services/platform/frontend/pages/AdminSpacePage.tsx`.

Acceptance criteria:

- List the signed-in user’s available notifications with meaningful titles and context.
- Mark a notification read and retain that state after reload.
- Open an authorized target or show a clear unavailable destination if its record was removed.

Boundary: A user must not read or modify another user’s notifications.

#### instance-setup: Install selected sample modules in dependency order without resetting edits

As a workspace administrator, I want to set up a usable learning workspace with connected sample records.

Instance setup offers module previews and explicit dependency selection. Project/apps and missing active-administrator memberships precede sprint/release/story records; installation is transactional and repeatable.

- Status: ready; priority: P1; effort: 5 story points.
- Sprint: HT 07 · Quality and operations. Release: HelloTest Intelligence & Operations · sample; fix version: demo-intelligence-1.0.
- Team: HelloTest Platform. Labels: sample, hellotest-core, operations.
- Sources: `services/dashboard/frontend/pages/OverviewPage.tsx`, `services/platform/frontend/src/platform/pages/TestOpsPage.tsx`, `services/platform/frontend/admin/AdminApp.tsx`, `services/platform/frontend/pages/AdminSpacePage.tsx`, `services/platform/frontend/admin/SampleDataSetup.tsx`, `services/platform/backend/services/sampleData/index.js`.

Acceptance criteria:

- Select People & access independently to install missing role presets without creating a project.
- Install planning dependencies before stories and preserve their sprint/release relationships.
- Reinstall only missing sample records while keeping edited content, roles and membership grants.

Boundary: Audit or ownership conflicts roll back installation; setup must not enable external services or execute sample workflows.

#### feature-dropdown-governance: Govern feature availability and domain dropdown values

As a workspace administrator, I want to control supported capabilities and metadata choices consistently.

Feature flags and domain metadata shape available actions and permitted choices. Existing values require safe display even when the selectable catalog changes.

- Status: ready; priority: P2; effort: 5 story points.
- Sprint: HT 07 · Quality and operations. Release: HelloTest Intelligence & Operations · sample; fix version: demo-intelligence-1.0.
- Team: HelloTest Platform. Labels: sample, hellotest-core, operations.
- Sources: `services/dashboard/frontend/pages/OverviewPage.tsx`, `services/platform/frontend/src/platform/pages/TestOpsPage.tsx`, `services/platform/frontend/admin/AdminApp.tsx`, `services/platform/frontend/pages/AdminSpacePage.tsx`, `services/platform/backend/services/featureFlag.service.js`, `services/platform/backend/routes/domainMetadata.routes.js`.

Acceptance criteria:

- Changing a feature setting updates availability without granting missing permissions.
- Configure supported dropdown values and expose them in the relevant forms.
- Retain a historical record value while clearly separating it from new allowed selections.

Boundary: A disabled feature must remain disabled after sample installation or direct API access.

#### integrations-api-keys: Configure provider integrations and scoped API keys

As a workspace administrator, I want to connect approved services with explicit access boundaries.

Integration setup supports configured providers and connection checks. API keys retain their permitted routes/scopes and must not bypass ordinary project authorization.

- Status: ready; priority: P1; effort: 5 story points.
- Sprint: HT 07 · Quality and operations. Release: HelloTest Intelligence & Operations · sample; fix version: demo-intelligence-1.0.
- Team: HelloTest Platform. Labels: sample, hellotest-core, operations.
- Sources: `services/dashboard/frontend/pages/OverviewPage.tsx`, `services/platform/frontend/src/platform/pages/TestOpsPage.tsx`, `services/platform/frontend/admin/AdminApp.tsx`, `services/platform/frontend/pages/AdminSpacePage.tsx`.

Acceptance criteria:

- Create or edit an integration using its supported endpoint and provider settings.
- Run an explicit connection check and show the actual observed result.
- Issue or revoke a scoped API key and enforce its restrictions on protected routes.

Boundary: Sample examples remain inactive and credential-free; never expose stored secrets in catalogs or artifacts.

#### admin-audit-security: Separate administrator access and retain setup audit activity

As a workspace administrator, I want to review sensitive administration changes and security settings.

The admin portal governs administrator access, setup, feature availability and audit/security views. Product project roles alone do not grant workspace administration.

- Status: ready; priority: P2; effort: 5 story points.
- Sprint: HT 07 · Quality and operations. Release: HelloTest Intelligence & Operations · sample; fix version: demo-intelligence-1.0.
- Team: HelloTest Platform. Labels: sample, hellotest-core, operations.
- Sources: `services/dashboard/frontend/pages/OverviewPage.tsx`, `services/platform/frontend/src/platform/pages/TestOpsPage.tsx`, `services/platform/frontend/admin/AdminApp.tsx`, `services/platform/frontend/pages/AdminSpacePage.tsx`.

Acceptance criteria:

- Protect administrator pages and mutation APIs with workspace administrator checks.
- Record an audit entry for a committed setup or supported administration change.
- Review actor, target and outcome without exposing secret configuration values.

Boundary: An audit failure during transactional setup must not leave a partially installed workspace.

#### support-guidance: Find support guidance without changing workspace data

As a workspace user, I want to reach help for product workflows and configuration issues.

The Support page provides the available help surface. Guidance should identify the current product area and preserve the user’s project context.

- Status: draft; priority: P2; effort: 3 story points.
- Sprint: Backlog (not scheduled). Release: HelloTest Intelligence & Operations · sample; fix version: demo-intelligence-1.0.
- Team: HelloTest Platform. Labels: sample, hellotest-core, operations.
- Sources: `services/dashboard/frontend/pages/OverviewPage.tsx`, `services/platform/frontend/src/platform/pages/TestOpsPage.tsx`, `services/platform/frontend/admin/AdminApp.tsx`, `services/platform/frontend/pages/AdminSpacePage.tsx`, `services/platform/frontend/src/platform/pages/SupportPage.tsx`.

Acceptance criteria:

- Open Support from the workspace navigation.
- Read available guidance without requiring unrelated project write permissions.
- Return to the previous product area with the selected project intact.

Boundary: Reading help must not initiate an external support request or transmit project data.

## Catalog-only flags

- `hellotest.manual.plans`: Reserved feature flag; no standalone Test Plans page is registered in the current frontend router. Suites and run planning are covered separately.
- `hellotest.manual.quality_gates`: Reserved feature flag; no standalone Quality Gates page is registered in the current frontend router. Quality assistance and readiness are covered separately.
