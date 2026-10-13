# Sample-data setup

Administration → Instance setup installs the repository-owned dataset from [`instance-setup-data`](../../services/platform/backend/instance-setup-data/README.md). Version **8** contains **3,242 content records**, seven role presets and **166 object files** across 15 selectable modules. The manifest and native record files are the source of truth; setup never invokes an external model to regenerate them.

| Module | Declared records or presets |
| --- | ---: |
| Workspace roles | 7 |
| Projects & applications | 6 |
| Stories, sprints & releases | 283 |
| Test design & shared steps | 1614 |
| Environments, data & configuration | 103 |
| Defects & collaboration | 31 |
| Runs & case execution | 1105 |
| Knowledge repository | 34 |
| Object repository & API tests | 14 |
| Agents & prompt templates | 9 |
| Dashboards & release readiness | 6 |
| Integration setup examples | 10 |
| Schedules & activity | 13 |
| AI prompt templates | 8 |
| Ask HelloTest history | 6 |

## Feature and metadata coverage

The existing portable blueprint maps 60 implemented feature Stories to their acceptance cases, native modules/suites and source contracts. Version 8 adds a boundary case for each feature plus 20 connected metadata/native Stories, four Sprints, three Releases, five platform modules/suites and six reviewable executable readiness examples. Earlier records and stable identities remain available.

The expanded examples cover all declared application types (Web, API, Android, iOS and Unified), all ten default Story lifecycle states, all ten default Test Case purpose types, active/draft/ready/retired cases, both Structured and Gherkin authoring, Background/Scenario Outline examples, not-requested/pending/accepted/changes-requested review metadata and priorities P1–P5. Story ownership, effort, team, labels, specifications, acceptance criteria, delivery targets and direct/Sprint-inherited release scope are connected through native records.

Case steps have concrete actions and expected outcomes. Linked two-row datasets include explicit empty values, scoped case/suite/run tokens and Unicode examples. Native configuration profiles, environment snapshots, reusable preconditions, local/shared groups, object bindings and manual/automation links are retained. Complex automation proposals remain incomplete; executable readiness fixtures are separate cases.

Eight additional illustrative runs cover manual/local/remote modes, manual/CI/local triggers and scheduled transport metadata and queued/running/completed/failed/blocked/aborted/partial states. Their frozen cases, steps, configuration, environment and data rows agree with the recorded application and iteration identities. All eight result states are represented. Defects cover all 13 default bug types, ten lifecycle states, four severities and five priorities, with linked Story/module/suite/case/run context. Native Story, case and defect comments illustrate collaboration.

These outcomes and reviews are explicitly **synthetic**. No browser, device, model or production defect was observed during dataset authoring. Example endpoints use `.example.test`; native package/device values need review against configured providers. All five new Test Plans/schedules are disabled, so installation cannot dispatch recurring work. Physical attachments and provider credentials are not fabricated.

## Installation and recovery

The administrator selects modules and reviews dependencies/counts. `POST /admin-portal/setup/sample-data` returns an accepted durable `instance_setup_jobs` receipt. Status polling restores the active/latest receipt; the retry endpoint resumes verified checkpoints. Files execute in declared dependency order, each file and its checkpoint in one PostgreSQL transaction.

Checksums, record identities, actor placeholders, native relationships and project/application ownership are validated before writes. `ON CONFLICT DO NOTHING` preserves existing records, descriptions, assignments and customized grants. Active workspace administrators receive missing sample-project memberships; existing member roles remain unchanged. Roles-only installation creates no project. Feature settings are retained.

Success requires completed file checks, final relationship verification and the audit write. A failed file rolls back; completed files remain retryable through their original receipt. Dataset-version/hash changes reject an obsolete queued receipt instead of mixing versions. Fixed authored dates are illustrative and do not move with installation time.

## Authoring and validation

Publish changes as a new dataset version. Keep earlier IDs stable, update changed-file checksums/counts, and verify every selectable module's dependency plan. [`reference/coverage.json`](../../services/platform/backend/instance-setup-data/reference/coverage.json) records feature/metadata coverage; `verifyCoverage.cjs` compares the expanded examples with the native dropdown catalog and validates chronology, Sprint effort and frozen data-row identity.

```sh
node services/platform/backend/instance-setup-data/verify.cjs
```

The opt-in installer and job integration tests live in `services/platform/backend/test/integration/instanceSetupInstaller.postgres.test.js` and `instanceSetupJobs.postgres.test.js`. They require guarded disposable database names and exercise real schema/transactions, retries, checkpoints, audit failures and preservation. See [verification scope](verification.md).

## Packaging

The backend Dockerfile copies capability packages and the versioned dataset from the **repository root** build context:

```sh
docker build -f services/platform/backend/Dockerfile -t hellotest-backend:local .
```

Native development reads `services/platform/backend/instance-setup-data`; an explicit `HELLOTEST_INSTANCE_SETUP_DATA_DIR` must provide the complete reviewed manifest and files. Existing Docker images need rebuilding to contain a new dataset version; changing source files does not publish settings or reinstall live records.
