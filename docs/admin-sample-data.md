# Module sample data

Administration → Instance setup provides 12 selectable groups, 283 versioned sample records and 64 feature examples. All records describe a synthetic Commerce Launchpad across Customer Portal, Commerce API and Mobile Experience.

Choose Full product, QA essentials or AI & automation, or search and select individual modules. The preview includes dependencies and missing-record counts. Installation requires a workspace administrator. Disabled feature flags remain disabled.

| Module | Records | Feature coverage |
| --- | ---: | --- |
| Projects & applications | 4 | Project scope, Application selection, Administrator access |
| Stories, sprints & releases | 17 | Backlog, Active and future sprints, Release scope, Story relationships, Acceptance criteria |
| Test design & shared steps | 95 | Modules, Suites, Gherkin steps, Preconditions, Parameters, Shared groups, Story traceability, Version history |
| Environments, data & configuration | 17 | Environments, Configuration profiles, Data rows, Case data links, Parameter overrides |
| Bugs & collaboration | 22 | Root causes, Bug history, Comments, Case and story links, Convert to test case |
| Runs & case execution | 75 | Suite runs, Case results, Step snapshots, Run context, Data iterations, Duration, Defect evidence, Lifecycle history |
| Knowledge repository | 22 | Collections, Sources, Documents, Lexical retrieval, Case links, Ask AI context |
| Object repository & API tests | 7 | Object screens, Field locators, API requests, Assertions, Automation links, Mobile selectors |
| Agents & prompt templates | 6 | Workflow canvas, Specialist selection, Manual triggers, Review outputs, Prompt templates |
| Dashboards & release readiness | 3 | Executive dashboard, Product dashboard, QA dashboard, Coverage gaps, Run trends, Release readiness |
| Integration setup examples | 10 | Provider configuration, Connection testing setup, Inactive examples |
| Schedules & activity | 5 | Run schedules, Assignment scope, Activity timeline, Read notifications |

## Installation guarantees

- Modules form an explicit dependency graph. Empty, malformed and unknown selections are rejected. An omitted selection installs all modules.
- Inserts use deterministic versioned identities and preserve existing content. Version 2 keeps the existing project/application anchors and retains the original demo records separately. It never appends new outcomes to a legacy demo run.
- Installation and audit logging share one transaction. A PostgreSQL advisory lock serializes simultaneous installs, with batched inserts and bounded catalog reads.
- Counts come from exact sample keys in the database. Deleting a sample makes the module partial; reinstalling restores missing records without resetting edits. Conflicting record ownership aborts the transaction.
- Sample execution evidence is labeled as illustrative. No browser, device, job or external service is invoked by installation.
- Knowledge chunks have real PostgreSQL lexical indexes and project-scoped read bindings; no generated embeddings or fabricated model responses are stored.
- All ten integration examples are inactive and credential-free. Schedules are disabled; agent workflows are manual drafts. External services need the administrator's own configuration.

## Implementation and validation

The catalog, deterministic record definitions and transactional installer live in backend/api/src/services/sampleData. The admin UI is frontend/src/admin/SampleDataSetup.tsx.

The opt-in PostgreSQL integration test backend/api/test/integration/adminSamples.postgres.test.js requires ADMIN_SAMPLES_POSTGRES=1 and an empty DATABASE_URL whose database name starts with agent_verify_admin_samples_. It initializes the application schema and verifies rollback, full/partial/concurrent installation, preservation of legacy and edited records, case/run associations, timing, step logs, native knowledge retrieval, feature flags and inactive services. Never point it at an existing workspace database.

The browser test frontend/test/browser/adminSampleData.test.mjs runs against ADMIN_TEST_URL (default http://127.0.0.1:5180), using isolated API fixtures. It covers load/install retries, dependency selection, search, keyboard controls and responsive layouts from 320px to 1440px.
