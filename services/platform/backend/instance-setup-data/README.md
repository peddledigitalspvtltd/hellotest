# Instance setup data

This directory is the reviewed, repository-owned source for the Admin **Instance
setup → Module sample data** installer. Installation reads these files; it does
not generate Stories, shift dates, call an LLM, or invent replacement content.

`manifest.json` identifies dataset `hellotest-instance-v1`, version 7. It lists
the selectable modules and each object file in dependency order. The dataset
contains 2,240 relational records and 7 workspace role presets across 135 files.
The authored calendar spans August–October 2026, including completed and overdue work. Fixed dates are
intentional: time-window metrics reflect the saved dates as these examples age.

`schema-setup/` holds database bootstrap SQL, separately from the sample dataset. It is excluded from the manifest and explicitly rejected by the sample installer. See [schema setup](schema-setup/README.md).

## Contents

| Folder | Objects and relationships |
| --- | --- |
| `workspace_roles` | Seven role presets, stable role IDs and explicit permission codes |
| `workspace` | HelloTest Launchpad project and Web, API and Mobile applications |
| `planning` | Stories, acceptance criteria, Gherkin, priorities, tags, teams, estimates, Sprint and Release metadata, Story relations and Release membership |
| `design` | Modules, suites, cases, shared steps, case versions and Story/module/suite links |
| `environments` | Environments, configurations, dataset columns/rows and case dataset links |
| `issues` | Defects, their Story/case relationships, history, comments and a converted regression case |
| `execution` | Saved runs, suite links, frozen case/step snapshots, dataset iterations, outcomes, timing, defect evidence and comments |
| `knowledge` | Authored documents, sources, checksums, searchable chunks, indexing metadata and collection/access links |
| `automation` | Object repository examples, automated API cases, requests/assertions and manual-case links |
| `agents` | Draft HelloTest workflows and clearly labeled synthetic completed, needs-review and failed history |
| `ai_templates` | Shared prompt library covering Story creation/completion, Test Case generation/improvement and Defect creation |
| `chatbot` | Authored example conversations with readable responses and provider-unavailable recovery |
| `dashboards` | Six connected dashboard definitions with metric and chart metadata |
| `integrations` | Ten inactive, credential-free integration examples |
| `testops` | Disabled schedule, sample activity, downloadable reference artifacts and a read notification |
| `reference` | Feature blueprint, detailed Story reference and `coverage.json` mapping every published feature to examples or explicitly reserved/live-only behavior |

The core feature blueprint describes 59 Stories, including 10 Backlog Stories,
7 Sprints and 3 Releases. Commerce and metric walkthrough objects provide
additional, separately versioned examples. Coverage gaps and mixed outcomes
are deliberate so metric cards can explain covered/uncovered Stories, Dev and
QA completion, passing/failed/blocked/skipped results and open Defects.

The `v5_*.json` files add a small, connected data-inheritance walkthrough using
new `sample-v5-data-*` IDs. They include four datasets, one linked shared group
with exactly one data row, a suite, two cases, and a two-row frozen run. One
manual case is pending review. Both cases protect shared defaults at case
level; the suite protects shared data while overriding case data; the saved
run explicitly permits case, suite and shared-data overrides. Its first row
has a synthetic failed shared step linked directly to an open Defect through
`execution_results.step_defects`, and its second row passes. The four dataset
parents live in the design module so selecting test design never introduces
a circular dependency with the environments module.

The `v6_*.json` files add a cohesive HelloTest walkthrough with short Sprint
names (`Core S1`, `AI S2`, `Ops S3`), short Release names (`HT Core`, `HT AI`,
`HT Ops`) and short versions (`6.0`, `6.1`, `6.2`). Eight Stories cover every
priority from P1 through P5 and include Dev Done, QA Done, active and blocked
delivery states. Three application-scoped modules, suites, shared precondition
groups, environments, configurations, matching datasets and runs retain their
links through frozen snapshots. The eight results deliberately include passed,
failed, blocked and skipped outcomes. Six Defects span severity, priority and
workflow states and link to their Story, module, suite, case and exact run.

Execution results, readiness reviews and activity records are clearly marked
as **synthetic examples**. Installation does not claim real code reviews,
Product Owner approval, CI outcomes, AI output or production execution.
Integrations remain inactive, schedules disabled and workflow definitions remain drafts. Saved agent/chat history is authored sample evidence, not a claim that a provider ran.

## Capability coverage (v7)

The `capability_*.json` files connect **all 59 HelloTest feature Stories** to
acceptance-criteria Test Cases, local step groups, shared preconditions, a
capability module and suite. A three-row role dataset uses matching parameters
across cases, shared groups, environment, configuration, suites and frozen runs.
Three dated runs contain 243 synthetic results; selected cases remain unexecuted
to exercise pending-work metrics. Eight additional Defects retain exact Story,
module, suite, case, run and failing-step links. Shared-step failure clusters
span multiple cases and have linked open Defects.

Additional planning records include Dev Done, QA Done, active and ungroomed
Stories, a closed Sprint, an overdue active Sprint, and a future Sprint. Short
Release names and versions include released, overdue in-progress and planned
work. Existing examples remain installed: dataset upgrades only insert missing
stable IDs and do not overwrite customer edits or customized role grants.

`reference/coverage.json` is the machine-checked coverage inventory. The
PostgreSQL integration check runs the same Story, case, release, shared-step
and dashboard metric readers used by the application. It verifies covered and
uncovered Stories, slippage, failed/blocked cases, mixed outcomes, pending work,
multiple trend dates and overdue Releases.

Live engine heartbeats, running jobs, infrastructure health, provider responses,
OPS alerts and telemetry require real connected services. Setup does not create
fake active workers, queue jobs, enable schedules or supply working credentials.
Fixed sample dates will leave short rolling dashboard windows as time passes;
select their authored date range to inspect the historical trend.

Schema setup always initializes the permission catalog, base Admin/Member roles
and seven persona roles before sample installation. Existing role grants are
preserved, including intentionally empty roles. Sample project installation
adds active administrators as members dynamically; suspended administrators are
excluded. Schema setup remains separate from optional sample content.

## File contract and installation identities

Each object file has this shape:

```json
{
  "schema_version": 1,
  "records": [{ "id": "a-stable-sample-id", "other_column": "saved value" }]
}
```

The corresponding manifest entry declares `key`, `module`, relative `path`,
database `table`, identity `keys`, prerequisite file keys in `depends_on`,
`record_count` and the SHA-256 digest of the exact UTF-8 file bytes. Role presets
use `kind: "role_presets"` because permission codes resolve to the workspace's
existing permission rows; they are not SQL rows to insert directly.

JSON preserves arrays, objects, booleans and numbers. Some database columns,
such as execution logs and artifact content, intentionally contain JSON encoded
inside strings. Installation must preserve that distinction.

`__SETUP_ACTOR_ID__` is the only runtime value token. Bind it to the authorized
installer's user ID recursively in values, arrays, object keys and encoded JSON
strings. It appears in creator/owner/assignee fields and saved synthetic review
metadata. No real user's ID, credentials or private workspace data is stored
here. The installer separately adds missing memberships for active workspace
administrators after the project and applications exist.

Project/application anchors and all versioned object IDs remain stable across
installations. Display IDs are explicitly authored for every object that has a
short ID. Existing rows, their dates, content and relationships must be retained.
Existing role names retain their current IDs and grants; the static preset ID
is used only when that role does not exist. An identity/scope conflict is an
installation error, not permission to overwrite customer data.

Tables can appear in more than one module. For example, the Defects module's
converted case depends on its Defect, while the Automation module's case links
to an earlier manual case. Do not merge all same-table files ahead of their
parents. Read the manifest in order and respect module prerequisites.

## Editing and validation

1. Author or update the relevant JSON object file. Use immutable, namespaced
   IDs for new examples and retain intentional coverage gaps.
2. Include all referenced parents, native Sprint/Release IDs, relation rows,
   JSON links and snapshot metadata. Keep links inside their project and app.
3. Update the manifest count and SHA-256 digest for changed files. Add all
   referenced object files to `depends_on`, ordered before their consumers.
4. If the source-reviewed Markdown changes, update its stored artifact and
   knowledge document/source checksums, character counts and chunk offsets,
   together with the copy in `reference/`.
5. Run `node services/platform/backend/instance-setup-data/verify.cjs` from the repository root,
   then run the API sample-data PostgreSQL integration tests against a
   disposable database. The verifier performs no writes and needs no service.

The offline verifier checks file integrity/counts, manifest ordering, duplicate
identities, PostgreSQL foreign keys, JSON/object links, actor tokens, project/app
scope, short-ID collisions, blueprint counts and knowledge content offsets.
The integration tests additionally validate real database constraints and
installation/retry behavior. Neither check substitutes for reviewing changes
to the feature's acceptance criteria against the application.

Installation retries must reuse these exact records. Missing, malformed or
checksum-mismatched files must produce actionable errors; there is no runtime
fallback to regenerated data. A batch-to-row retry may isolate a failing record
without replacing the dataset or relaxing its relationships.
