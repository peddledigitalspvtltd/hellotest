# Module sample data

Administration → Instance setup provides 13 selectable groups. Version 6 reads 715 content records and seven conservatively managed role presets from 105 committed object files in [`backend/instance-setup-data`](../backend/instance-setup-data/README.md). It combines a source-reviewed HelloTest feature backlog with connected HelloTest and synthetic Commerce Launchpad examples across Web, API and Mobile applications.

Choose Full product, People & access, QA essentials or AI & automation, or search and select individual modules. The preview includes dependencies, missing-record counts, project description, application scopes and membership behavior. Installation requires a workspace administrator. Disabled feature flags remain disabled.

## Workspace roles

Workspace roles are a selectable module under **People & access** within **Module sample data**. The People & access preset selects only that module; Full product includes it with the content modules. Installing roles alone creates no project, application or membership. Content-only selections do not implicitly reinstall roles. Schema validation still ensures the standard role foundation.

The module expands to show permissions and marks existing customized roles. Repeating setup creates missing presets while preserving existing grants, including intentionally empty roles, and does not change user assignments.

| Role | Responsibility |
| --- | --- |
| Product Owner | Stories, Backlog, Sprints and Releases; delivery insights and evidence |
| QA Lead | Test design, plans, quality gates, execution, schedules and reporting |
| QA Member | Manual test authoring, suites, execution, results and Defect collaboration |
| Automation Engineer | Automation assets, repositories, code, local/remote runs and execution resources |
| AI Engineer | Project AI workflows, knowledge, prompt templates and generated test/automation drafts |
| Reporter | Create Defects, add comments and attachments, and read linked project evidence |
| Viewer | Read project planning, coverage, runs and evidence |

These presets grant no workspace administration or access-management permissions. Feature availability continues to apply to every grant. Reporter uses `feedback.create`; it cannot edit or delete existing Defects. Existing roles with `feedback.manage` retain their reporting capability.

The reviewed setup role definitions and permission codes live in `backend/instance-setup-data/workspace_roles`. Runtime role creation and schema setup continue to use `backend/api/src/security/rolePresets.catalog.js`; dataset validation checks that the authored presets agree with that foundation.

| Module | Records | Feature coverage |
| --- | ---: | --- |
| Workspace roles | 7 presets | Product Owner, QA Lead, QA Member, Automation Engineer, AI Engineer, Reporter, Viewer |
| Projects & applications | 4 | Project scope, Application selection, Administrator access |
| Stories, sprints & releases | 198 | HelloTest acceptance backlog, short Sprint and Release plans, Dev Done and QA Done milestones, dependencies and acceptance criteria |
| Test design & shared steps | 220 | Modules, Suites, Gherkin steps, Preconditions, Parameters, Shared groups, Story traceability, Version history |
| Environments, data & configuration | 31 | Environments, Configuration profiles, matching Data rows, Case data links, Parameter overrides |
| Defects & collaboration | 31 | Root causes, Defect history, Comments, Case and story links, Convert to test case |
| Runs & case execution | 160 | Multiple Suite runs, mixed Case results, Step snapshots, frozen context, Data iterations, Defect evidence and Lifecycle history |
| Knowledge repository | 34 | Collections, sources, documents, lexical retrieval, case links, authored HelloTest feature reference and Ask AI context |
| Object repository & API tests | 7 | Object screens, Field locators, API requests, Assertions, Automation links, Mobile selectors |
| Agents & prompt templates | 6 | Workflow canvas, Specialist selection, Manual triggers, Review outputs, Prompt templates |
| Dashboards & release readiness | 6 | Executive dashboard, Product dashboard, QA dashboard, Coverage gaps, Run trends, Release readiness |
| Integration setup examples | 10 | Provider configuration, Connection testing setup, Inactive examples |
| Schedules & activity | 8 | Run schedules, assignment scope, activity timeline, read notifications, downloadable HelloTest JSON/Markdown artifacts |

## Reusable HelloTest acceptance backlog

The [portable feature blueprint](product/hellotest-feature-blueprint.json) and [detailed story catalog](product/hellotest-feature-stories.md) contain **59 stories, seven sprints and three illustrative releases**. Ten stories deliberately remain unscheduled in Backlog. Every story includes a specific title, user outcome, behavior description, acceptance criteria, failure/scope boundary, labels, priority, effort, team and source references. Scheduled stories have native iteration IDs, matching sprint/release stamps, and ordered Dev/QA target dates. Backlog stories retain explicit release scope without invented sprint dates.

The inventory maps every entry in `frontend/src/lib/workspaceCapabilities.ts` and accounts for every feature flag. Test Plans and Quality Gates are explicitly identified as catalog-only flags because their standalone pages are not routed; the blueprint does not invent these screens. AI-authored content was reviewed against local implementation, including recorder behavior, and does not claim that a live model or test run executed.

Installation creates parent Sprint and Release records before Stories, then connects release scope and story dependencies. Assignee fields bind the `__SETUP_ACTOR_ID__` token to the installing administrator. Original Dev/QA assignments remain unset instead of inventing team members. Sprint effort equals the sum of its sample story estimates. Dates are fixed in the versioned files, with an authored calendar starting on September 20, 2026; installation never shifts them to the current day. This calendar is illustrative and does not represent announced HelloTest release commitments. Time-window metrics reflect those stored dates as the examples age.

The installation source is the reviewed JSON dataset and its `reference/` artifacts. Source-review references and developer export helpers remain available alongside the feature blueprint, but setup does not execute a content generator. Installing Knowledge adds a project-scoped lexical reference; installing Schedules & activity makes the authored artifacts downloadable through TestOps. Neither action invokes an external AI provider.

## Repository file contract

`backend/instance-setup-data/manifest.json` identifies the dataset and version, selectable module metadata, module dependencies and an ordered list of object files. Each file entry includes its stable key, relative path, module, database table and identity columns (or the role-preset kind), prerequisite file keys, record count and SHA-256 checksum. JSON object files retain native arrays, nested metadata, explicit short IDs, relation rows and stable sample identities.

The installer validates the manifest and selected files before inserting content. It rejects unknown modules, dependency cycles, invalid paths, malformed JSON, checksum/count mismatches, duplicate identities and broken relationships. Files are processed in dependency order rather than grouped solely by table: a table can have records in more than one module with different parents.

Treat a published dataset as immutable. Review edits as a new dataset version, retain stable IDs for existing examples, update affected checksums and counts, and publish the manifest and files together. Run `node backend/instance-setup-data/verify.cjs` before packaging. A missing or corrupt file is an actionable setup failure; the application never substitutes newly generated Stories, dates or fallback content.

## Progress, retries and recovery

The admin action queues a durable PostgreSQL receipt instead of holding a request open for the entire installation. `POST /admin-portal/setup/sample-data` accepts selected modules and returns `202` with `{ running, job }`. The UI polls `GET /admin-portal/setup/sample-data/status?job_id=...`; omitting the ID restores an active job or the latest receipt after a reload. `POST /admin-portal/setup/sample-data/:jobId/retry` resumes a failed receipt.

Each receipt records the dataset version and manifest hash, requested and dependency modules, current phase/file, per-file attempts and inserted/existing counts, timestamps, errors and the final result. Phases are validating, installing and verifying. The UI reports setup as passed only after every selected file completes, final verification succeeds, missing administrator memberships are handled and the audit write succeeds.

Each file and its progress receipt (including inserted-record and administrator-membership counts) commit in the same database transaction. If a later file fails, earlier completed files remain available and the failed file rolls back. Completed checkpoints are reverified before being skipped on retry. Transient database failures have bounded retries and smaller batch fallback; changing the batch size does not alter the source data or relax relational constraints. Worker recovery is also bounded, with a manual retry available after repeated interruptions. A workspace-wide admission guard and PostgreSQL advisory worker lock prevent double clicks or API replicas from running duplicate installations concurrently.

Restarting the API preserves the job and checkpoints; the next worker resumes them. Explicit retry requires the same manifest hash. If the repository dataset changed, start a new setup so the new files receive full validation; saved records remain protected by their stable identities. A final verification or audit failure leaves a failed receipt with no success result, even if prior files are already committed.

## Installation guarantees

- Modules form an explicit dependency graph. Empty, malformed and unknown selections are rejected. An omitted selection installs all modules.
- Inserts use authored, deterministic versioned identities and preserve existing content. Version 6 retains existing project/application anchors and earlier commerce/feature examples, including the separately identified relational metric examples. It never appends new outcomes to a legacy demo run.
- Workspace creation uses the canonical detailed project description and application definitions. All active workspace administrators receive missing Admin memberships, including the installing administrator. Workspace administrator status follows the same account flag used by authentication; suspended accounts and users who only hold an Admin role within another project are excluded. Existing project descriptions, application edits, member roles and custom grants remain unchanged. Repeat setup adds newly eligible administrators without replacing existing memberships. Roles-only installation remains project-free.
- Files use bounded inserts in separate transactions, with durable progress and final verification/audit before success. One failed file does not erase earlier committed files; its own partial inserts roll back.
- Counts come from exact sample keys in the database. Deleting a sample makes the module partial; reinstalling restores missing records without resetting edits. Conflicting record ownership fails setup without overwriting the conflicting row.
- Sample execution evidence is labeled as illustrative. No browser, device, job or external service is invoked by installation.
- Knowledge chunks have real PostgreSQL lexical indexes and project-scoped read bindings; no generated embeddings or fabricated model responses are stored.
- All ten integration examples are inactive and credential-free. Schedules are disabled; agent workflows are manual drafts. External services need the administrator's own configuration.
- Sample projects can be deleted and recreated through the normal project/setup flows. Project deletion uses a durable background job and bounded database batches to remove scoped Knowledge, AI jobs, workflows, product records and activity. Workspace roles and unrelated projects are retained; durable object cleanup runs after database deletion.

## Implementation and validation

Committed records and their manifest live in `backend/instance-setup-data`. The file loader, catalog and transactional installer live in `backend/api/src/services/sampleData`; `backend/api/src/services/instanceSetup.service.js` owns the durable job lifecycle. The admin UI is `frontend/src/admin/SampleDataSetup.tsx`. Dataset and blueprint validation check capability/flag coverage, source provenance, checksums, acyclic dependencies, exact metadata relationships, date/effort consistency, portable exports and knowledge passage offsets.

The opt-in PostgreSQL integration test `backend/api/test/integration/adminSamples.postgres.test.js` requires `ADMIN_SAMPLES_POSTGRES=1` and an empty `DATABASE_URL` whose database name starts with `agent_verify_admin_samples_`. It initializes the application schema and verifies installation, preservation of legacy and edited records, role creation and customization, deletion/reinstallation, case/run associations, timing, step logs, native knowledge retrieval, feature flags and inactive services. Membership checks cover all active workspace administrators, suspended and project-only exclusions, newly promoted administrators, and exact preservation of existing project/application rows and membership roles. Never point it at an existing workspace database.

The separate `backend/api/test/integration/instanceSetupJobs.postgres.test.js` uses `INSTANCE_SETUP_JOBS_POSTGRES=1` and a disposable database named `agent_verify_instance_setup_*`. It verifies concurrent admission, cross-process ownership, checkpoint recovery, bounded retries, incomplete-file/audit failure handling, shutdown and active-receipt restoration. Route tests verify administrator protection, accepted responses and uncached status polling. `instanceSetupInstaller.postgres.test.js` additionally runs the actual installer and job together against a disposable `agent_verify_instance_installer_*` database (`INSTANCE_SETUP_INSTALLER_POSTGRES=1`), checking corrupt-file preflight, smaller-batch retry, receipt counts, audit recovery, indirect ownership, JSON references and final verification failures.

The browser test frontend/test/browser/adminSampleData.test.mjs runs against ADMIN_TEST_URL (default http://127.0.0.1:5180), using isolated API fixtures. It covers load/install retries, dependency selection, search, keyboard controls and responsive layouts from 320px to 1440px.

The retained metric walkthrough is separate from the source-reviewed feature backlog. It includes six synthetic Stories (including distinct Dev Done/QA Done and covered/uncovered backlog examples), six Test Cases, a native Sprint/Release-linked run with passed/failed/blocked/skipped outcomes, two linked Defects, and explicit synthetic readiness reviews. Traceability, Delivery and Defect Triage dashboards each contain eight joined widgets. Every sample entity that supports display IDs supplies a stable short ID; repeated setup leaves existing IDs and edits untouched. No historical backlog completion is invented: the normal database history records setup additions from installation time.

Version 5 also includes a separate data-inheritance walkthrough with four datasets, a shared group linked to one row, a suite, two cases and a two-row frozen run. One case is pending review. Explicit case/suite/run override policies illustrate protected shared defaults and permitted higher-level overrides. A failed shared step links directly to an open Defect through saved step evidence. These records have distinct versioned IDs and do not change earlier examples.

Version 6 adds a connected HelloTest delivery walkthrough. `Core S1`, `AI S2` and `Ops S3` map to `HT Core`, `HT AI` and `HT Ops`, using short versions `6.0`, `6.1` and `6.2`. Eight Stories cover priorities P1–P5 and include Dev Done and QA Done outcomes with ownership, estimates, targets, labels and acceptance metadata. Three modules and suites reuse shared precondition groups across eight parameterized cases. Their environments, configurations and datasets use matching parameter names and are frozen into three runs. Passed, failed, blocked and skipped results feed six Defects with varied severity, priority and status. Each Defect links to its Story, module, suite, case and run, while native Story/case and Defect relation tables preserve traceability.

A new unassigned user receives the HelloTest setup project on verified signup or first login using the existing member role. Existing project assignments and customized role permissions are retained. First-login assignment and the login timestamp commit together, so a transient failure remains retryable. Suspended users and projects being deleted are excluded. An unrelated private project is never selected as a fallback.

## Docker packaging

All API builds use `backend/` as their build context so the canonical dataset ships with the API at `/app/instance-setup-data`. The local, full-stack and backend-only Compose files use `backend/Dockerfile`; the root `hellotest.sh` image build already uses that context.

For a direct image build from the repository root:

```sh
docker build -t hellotest-backend:local backend
```

The compatibility Dockerfile under `backend/api/` uses the same parent context:

```sh
docker build -f backend/api/Dockerfile -t hellotest-backend:local backend
```

Do not build with `backend/api/` as the context: Docker cannot include its sibling dataset directory. Native Node development resolves the repository's `backend/instance-setup-data` automatically. An explicitly configured `HELLOTEST_INSTANCE_SETUP_DATA_DIR` must contain the complete versioned manifest and files, and is subject to the same integrity checks.
