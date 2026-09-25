# Run data and end-to-end product review

Reviewed 10 September 2026 against the existing application. This is an implementation review with targeted browser, API, and isolated PostgreSQL verification, not a certification that every product workflow is defect-free. Related findings are in [access and traceability](access-traceability-audit.md), [knowledge reliability](knowledge-reliability-review.md), and [HTML execution reports](execution-html-report.md).

## Parameter contract

| Reference / CSV column | Scope | Meaning |
| --- | --- | --- |
| `@email`, `email`, `r.email`, `@r.email` | Run | The default namespace for newly created runs |
| `t.expected`, `@t.expected` | Test case | A case-specific value |
| `s.tenant`, `@s.tenant` | Suite | A value in the case's selected suite context |

The same scope rules apply in frontend display, manual/API execution, and the web/mobile automation engine. Explicit namespaces stay distinct. A CSV can, when its scope override is enabled, deliberately replace a test or suite default by retaining its `t.` or `s.` prefix. Identical names with different scopes are separate columns. `@name` and `@r.name` are aliases in run CSV files and cannot both appear as separate columns. Suite CSV imports qualify unprefixed headers as `s.`; explicit `t.`, `s.`, and `r.` headers always retain their namespace.

Resolution order, from lowest to highest precedence:

1. Shared group defaults for the current shared step; its linked dataset row replaces its saved parameter defaults.
2. Explicit case defaults.
3. Inherited suite defaults, with child values replacing parent values.
4. Environment variables.
5. Configuration variables.
6. Explicit run parameters.
7. The selected data row, subject to the case, suite and run override options below.
8. Values captured by completed steps in the same execution context.

Legacy bare suite-default keys continue to mean suite values; bare case, environment, configuration, run-data, and captured keys use run scope for new runs. The parameter editor writes explicit canonical names. An empty cell is an explicit empty string. Omitting a column preserves its default; a blank cell does not. Parameter substitution replaces the complete token.

Existing runs receive a persisted `parameter_scope_default=t` marker through an additive migration. Newly created runs explicitly use `r`. Old references, data headers, parameter maps, and capture declarations are qualified in memory when read or executed. Frozen database evidence is not rewritten. Reruns retain the source run's scope policy.

## Test Case and Shared Step Group datasets

Updated 20 September 2026: structured and Gherkin Shared Step Groups use the same dataset section as Test Cases. New group links require exactly one table row; the group data editor prevents adding a second row. Existing legacy links retain their saved selected row until replaced. Key/value datasets also supply one iteration. Linking a group never multiplies case execution instances; the case, suite or run dataset still determines iteration count.

**Override Shared Groups Test Data** appears beside the Test Case dataset name before **Change**, and starts unchecked for new cases. Checked, case defaults and the linked case row can replace the shared group's data. Unchecked, shared steps retain their group's values while ordinary case steps continue to use the linked case row. The checkbox controls both saved case defaults and linked dataset values. Existing cases and frozen legacy runs retain their saved behavior. Suite and run **Shared Group Params Data** settings apply independently at their respective higher layers.

Shared defaults are frozen on each execution step, so two groups can both use `@login` with different values without overwriting each other. Changes to a group's selected row, dataset contents or defaults cannot rewrite an existing run. Reruns retain those frozen definitions and regenerate each group's generator templates once for all its steps. Secret key/value entries are redacted from public snapshots while internal execution uses the saved values.

**Download Test Params Template** uses the current structured or Gherkin draft and linked shared groups. Templates contain canonical parameter column names and an empty data row; they do not export saved values or secrets. The Test Case dataset summary keeps its compact layout instead of repeating every parameter below its description.

Verification includes isolated PostgreSQL checks for selected rows, case override policy, separate groups with identical parameter names, frozen reruns, unchanged instance counts and secret redaction; shared-step parameter resolution also has frontend, API, Test Engine and Android regression coverage.

## Suite/run data journey

Updated 20 September 2026: suite creation/editing, suite parameter dialogs, case/suite/run creation, scheduled runs, and queued-run editing share inline **Link Data Set**, **Create Data Set**, CSV import, and a template action at the top right. Creation offers an editable table with pagination; all rows remain accessible. Shared Step Group parameter dialogs also download their declared parameter columns.

Create Suite and Create Run expose a collapsible **Data Sets** section in the left configuration pane. Suites have separate **Test Case Params Data** and **Shared Group Params Data** override checkboxes. Runs also have **Suite Params Data**. These options start checked and apply to both saved defaults and datasets. Template discovery filters by actual parameter ownership, including legacy unscoped names, instead of relying only on column prefixes. Listing shows available application datasets; selection validates all required columns before linking. Invalid imports cannot be saved or submitted with the selected scope. Suite metadata and membership are saved atomically.

When an override is disabled, that lower layer retains its values. Other inherited data is retained, matching rows by index; one inherited row supplies defaults to every iteration. The highest selected scope determines the number of iterations. Multi-row inherited datasets must match its row count; otherwise preview and save return an actionable validation error before creating a run. These independent policies and each source data layer are stored in new immutable execution snapshots; legacy snapshots continue using their original resolver.

An edited suite supplies its native context separately from selected case membership. Removing a case from a draft cannot add it back through template discovery, and a case's unrelated primary suite cannot introduce data into that draft. Clearing the selected suite data inherits its parent without reviving the cleared link. Parameter and data updates invalidate the open preview.

Download the parameter template from suite creation/editing or run creation. The backend, rather than the visible/paginated case list, gathers all selected cases and descendant suites. The manifest collects saved defaults and actual input references in manual/Gherkin steps and API requests. Gherkin tags, comments, XML tags, and capture destinations that are only outputs are not mistaken for required inputs. Templates contain column names only, never secret/default values. Suite context queries load only selected suites and their ancestor chains, then fetch each authorized dataset once, avoiding an application-wide read for every template.

For a new suite, the template uses its currently selected cases. When editing a parent suite, it includes the immediate children and their descendants while respecting unsaved removals from the edited suite. Run creation expands selected suites recursively and deduplicates cases. In the run editor, the template retains the saved cases, steps and parameter names for existing scope; newly added suites use current authoring. Unchanged dataset IDs preserve their frozen rows and counts, while an explicit replacement or clear previews the updated data choice.

Example downloaded/filled CSV:

```csv
r.email,s.tenant,t.expected
first@example.test,tenant-a,approved
second@example.test,tenant-b,
```

Import the filled CSV directly in the same suite/run dialog, review its row count and parameter columns, name it, then choose **Save and select data**. It becomes a reusable Test Data record in the current project/application. Import handles quoted commas, quotes, multiline values, UTF-8 BOM and intentional whitespace. Invalid quoting, wrong row widths and ambiguous headers reject with an explanation. A failed save retains the preview for retry. Stale file reads and saves cannot attach data after the dialog changes project or unmounts.

Limits for this inline import: 5 MB CSV input, 500 columns, 5,000 nonempty rows, and a 3 MB expanded data payload to stay below the default 4 MB API request limit. Completely empty rows are ignored. CSV headers repeat in JSON row objects, so expansion is checked before allocating an oversized payload.

Execution data selection is independent of value precedence:

- A run dataset supplies rows to every selected case and replaces inherited suite/case datasets.
- Without a run dataset, a case uses the nearest linked suite/ancestor dataset.
- Without suite data, the existing case-linked dataset is used.
- Without data, a case executes once. Key/value data supplies one instance.

Two cases with a two-row dataset create four execution instances in one run. The identity includes the case, dataset and row index; each instance has its own result, lifecycle and clock. Starting, pausing, resuming or failing one row leaves the others unchanged. Run duration accumulates case activity and includes retries; it is not elapsed wall-clock time and may exceed it for parallel execution.

Run creation freezes selected steps, parameters, suite context and rows. Editing the source case or dataset does not change the run. Reruns reuse the frozen source data. Finished runs reject plan edits. One case appearing in multiple selected suites is still executed once per row, using the first selected suite's context; this preserves the existing case-deduplication contract rather than creating duplicate suite-specific instances.

Captured values are isolated by dataset ID and row index before propagation to later cases. Values from a different dataset or another data row are not exported into the current instance. Private test-scoped captures stay within the case.

## UI and access

The reusable data section appears in the suite editor, both run creation paths, and the run editor. It uses existing buttons, forms, dialogs and dataset records. It reports verified case/instance counts, inheritance, upload errors and retry states, with layouts checked at 320, 390 and 1440 pixels. Run-case context shows the frozen selected values and scope instead of offering a misleading case-only run template.

Dataset viewing/creation respect existing feature flags and project permissions. Explicitly selected environment/configuration/data resources require their corresponding read grants. Templates require case visibility and suite visibility when suites are selected. Project/application mismatches are rejected by the backend. Template names/counts describe the selected test scope; they do not expose dataset row values.

The new **Detailed report** action opens a standalone HTML report containing case-row results, attempts, suite/module summaries, context, evidence and filters. It uses existing authenticated report access and bounded evidence attachment reads. The supplied PowerShell script and its referenced report generator were inspected as design references; they were not executed. See the report review for security, accessibility, performance and export tests.

## Product coverage and verified boundaries

| Area | Review / resulting correction |
| --- | --- |
| Projects, applications, members | Inspected persisted ownership and role guards; new traceability tests prevent project hints from replacing real resource scope. Concurrent membership/last-admin removal is not newly certified. |
| Stories and modules | Corrected Story–case/Bug project boundaries and batch validation. Existing module navigation/metric contracts remain covered by the full frontend suite; no new module data model was introduced. |
| Sprints and Releases | Terminal-state creation now applies the same unfinished-Story policy as updates. Release evidence uses its exact version cohort, required source permissions and honest unavailable/partial states. |
| Cases and test data | Unified default parameter semantics, strict template import, preserved explicit scopes and legacy frozen evidence. |
| Suites | Persisted descriptions and datasets, inherited parent defaults/data, recursive selection, and cycle prevention including concurrent reciprocal parent moves. |
| Runs and case runs | Frozen case×row instances, data overrides, isolated captures, independent clocks, cumulative duration, rerun preservation, and finished-run edit guards. |
| Dashboard/readiness | Corrected legacy Release summaries and Story tiles. The existing canonical readiness board remains unchanged; this is not a wholesale analytics redesign. |
| Knowledge/agents/Ask AI | Canonical local indexing published before optional providers, bounded enrichment and total assistant time, configuration validation and cited retrieval fallback. |

Historical runs still identify Releases with text, so renaming a Release fix version does not migrate their tags. Existing malformed cross-project authoring relationships were not rewritten. Production load/concurrency, every destructive project/application dependency, and a complete browser traversal of every route remain outside this verification.

## Current hierarchy verification (20 September 2026)

- Full frontend suite: 565 tests passed. API suite: 1,044 passed and two optional integration tests skipped; additional runtime regressions passed after the final intermediate-layer row fix.
- Isolated PostgreSQL journeys verified strict shared-group rows, atomic Suite membership saves, missing-column rejection without partial Run writes, descendant Suite discovery, protected defaults, and frozen reruns.
- Browser checks covered Gherkin-to-Structured template downloads, the shared single-row editor, Suite/Run list validation, CSV retries and stale responses, 25-row editing, and desktop/mobile Create Run layouts.
- External execution-engine tests: 45 passed. Mobile execution-engine tests: 20 passed.

## Validation evidence

- TypeScript, the production frontend build and the automation-engine build passed.
- Final repository regression suites: API **717 passed, zero failed, one PostgreSQL-only skip**; frontend **413 passed**; automation engine **37 passed**. The skipped knowledge lifecycle suite passed separately against PostgreSQL (3 tests).
- `services/platform/backend/test/integration/runDataJourney.postgres.test.js`: real schema/runtime migration, suite inheritance, application isolation, frozen rows/steps, per-row lifecycle clocks, run overrides, reruns, legacy scope compatibility and finished-run rejection. Runs only with `RUN_DATA_POSTGRES=1` against a fresh `agent_verify_run_data_*` database, dropped after validation.
- `services/testing/test/browser/runDataSetup.test.mjs`: real components/providers with isolated API fixtures; downloads, parsing, save/retry, stale file/save races, disabled feature, unavailable queries and responsive layouts.
- `services/platform/backend/test/browser/executionHtmlReport.test.mjs`: standalone offline report filtering, details, print and responsive layout.
- Separate PostgreSQL dataset-scope suite: **10 passed**, covering compatible sharing, rejected cross-scope moves, historical foreign links, and secret redaction. Knowledge lifecycle and Release permission/cohort/browser tests are recorded in the related reviews.

## Verified local deployment

The updated main workspace is served at `http://localhost:8080`. API, frontend and all three automation workers are healthy; updated Docker images were persisted. Runtime configuration and the admin portal assets match their backups. Fingerprints across 19 existing tables matched after normalizing only the four expected display-label repairs described below. No records were created or removed, and credentials, memberships and feature flags were not changed.

A read-only smoke check against an existing run verified the new schema columns, retained legacy test scope, five saved cases/five instances, 12 template columns, and a 43 KB HTML report. No run execution or LLM request was triggered by this check.

Deployment exposed a pre-existing startup bug: the display-ID backfill restarted numbering from 1 for records without labels, colliding with assigned IDs. The corrected migration offsets new IDs above the existing maximum across Projects, Stories, Cases, Suites and Shared Groups, preserving all existing labels. It filled three previously missing suite labels and one shared-group label. A rolled-back check on the local database and eight additional isolated PostgreSQL tests verified collision avoidance, ordering, repeat startup and later imports. The failed startup migration rolled back transactionally before the fix was applied.

Database, source, frontend and worker backups were retained privately under `/tmp/qaira-run-data-backup-20260910`.
