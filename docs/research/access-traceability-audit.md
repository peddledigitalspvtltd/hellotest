# Project access and delivery traceability audit

This pass inspected project/application/member authorization, Story traceability, Sprint/Release creation, suite hierarchy changes, and the Release-to-readiness navigation contract. It is a source and targeted behavioral audit. It does not claim browser coverage of every planning/run workflow or a live database penetration test. No live records, memberships, credentials, or feature flags were changed.

## Implemented corrections

| Finding and trigger | Resulting behavior | Source |
| --- | --- | --- |
| A member with Test Case access in one project could request unfiltered Story–case mappings or submit another project's Story ID. The route only inherited a generic permission check, and the replacement service checked record existence. | Non-admin reads require a Story/case filter. Read/update grants are checked against persisted ownership, including Story visibility. Both filters must share one project. Selected cases must have exactly one compatible project across current and legacy relationships. Invalid selections fail before deleting existing links. | `services/manual/backend/routes/requirementTestCases.routes.js`; `services/requirementTestCase.service.js`; `services/testCaseScope.service.js` |
| Story–Bug mapping endpoints had the same project-less permission pattern, and manual mapping accepted any existing Bug ID. Automatic links could also inherit foreign defect references. | Reads and replacements check the persisted Story/Bug project and both resources' permissions. Manual replacement validates the entire Bug batch before changes; automatic link derivation requires the Bug and Story project to match. | `services/manual/backend/routes/requirementDefects.routes.js`; `services/requirementDefect.service.js` |
| Suite parent validation rejected only a direct self-parent. A suite could move below a descendant, making a cycle; two reciprocal moves could both validate stale structure. | A recursive ancestor query rejects descendants and pre-existing cycles. A visited path terminates traversal even with damaged historical data. Parent changes acquire an application-scoped transaction lock before the suite row lock, serializing reciprocal moves. Ordinary edits do not acquire the hierarchy lock. | `services/testing/backend/services/testSuite.service.js` (`assertParentHierarchy`, `updateTestSuite`) |
| Creating a Sprint directly as `closed` or a Release directly as `released` bypassed the unfinished-Story rule enforced during updates. | Creation applies the existing completion policy before inserting delivery records or changing Story membership. Release checks include Stories inherited from selected Sprints. Planned records still accept unfinished Stories, and empty terminal records retain the prior update policy. | `services/manual/backend/services/requirementIteration.service.js`; `services/requirementRelease.service.js` |
| Legacy Release summaries and notes could expose derived case/run/Bug metrics with only delivery-read permission. A newer passing run from another Release could replace the selected Release's failure. Expanded Story tiles independently used project-wide results. | Aggregate/list/notes routes now require all six source-read grants through the standard feature/API-key-aware guard. Results match the persisted Release's exact normalized fix version, project and linked cases. Expanded Story tiles reuse the canonical release evidence endpoint and hide scores when evidence is unavailable or bounded. The Release list shows an explicit unavailable state and supports retry instead of zero-ready counts. | `services/manual/backend/routes/requirementReleases.routes.js`; `services/requirementRelease.service.js`; `services/manual/frontend/pages/ReleasesPage.tsx` |
| Moving a linked Test Data Set into another project or application left its old case/suite references intact. Case hydration could expose the moved dataset through its historical link. | Scope changes check all directly linked cases and suites inside a dataset-row-locked transaction and reject incompatible moves with `409 DATA_SET_SCOPE_CONFLICT` before saving any fields. Compatible project-shared transitions and ordinary edits remain valid. Case list/detail hydration independently filters dataset project/application ownership, retaining valid legacy suite and Story-only shared context. | `services/testing/backend/services/testDataSet.service.js`; `services/testCase.service.js` |

The mapping APIs retain existing response shapes. The OpenAPI entries now document scope, required grants, limits, and rejection semantics. Batch case scope resolution evaluates a 151-case selection with one scope query, avoiding an additional query per chosen case. The mutation still uses the existing transactional mapping writes.

## Existing protections and navigation inspected

- Application create/update/delete routes check `app_type.manage` against the application project's stored identity; scoped reads check `app_type.view`. Non-admin unfiltered application lists reject. `appType.service.updateAppType` does not accept a project reassignment.
- Project-member changes authorize the existing membership project and any requested destination. Membership assignment cannot confer the workspace administrator role onto a non-workspace-admin user (`projectMember.service.js`). This inspection does not replace role-matrix or concurrent-admin-removal testing.
- Native Sprint and Release membership validation already rejects Stories or Sprints from another project. This pass reused that existing policy.
- `ReleasesPage.openReleaseReadiness` links to the registered overview readiness view with `release_id` and the release fix version. `ReleaseReadinessDashboard` loads that exact Release and rejects context from a different active project. Story, run, and Bug links use their record IDs and registered destination routes. These cross-route navigation links were inspected in source; their full navigation journey was not browser-tested.

## Validation

`node --test` over the four new suites plus related existing authorization, release append, module/Story, and Sprint stamp contracts: **42 passed, zero failed or cancelled**.

New suites:

- `traceabilityScopeAuthorization.test.js` — 10 tests covering forged project hints, denied reads/writes, conflicting/foreign/missing/orphan cases, preserved existing data on rejection, valid clear/replace, and batched scope lookup.
- `storyDefectScopeAuthorization.test.js` — 7 tests covering persisted scope, mixed filters, independent Story visibility, foreign/missing Bug rejection, and valid mapping operations.
- `testSuiteHierarchy.test.js` — 7 tests covering self/descendant cycles, damaged ancestor chains, normal moves/clears, revisions, application isolation, and concurrent reciprocal requests with simulated transaction locks.
- `planningCreationCompletion.test.js` — 6 tests covering direct and Sprint-derived unfinished scope, accepted completion statuses, planned creation, and empty-scope policy.

HTTP tests execute actual Fastify route handlers with isolated permission/resource adapters. Service tests execute actual service code with deterministic persistence fixtures, including transactional ordering and lock behavior. They do not validate PostgreSQL locking under production traffic. `git diff --check` passed.

Final integrated repository results and deployment verification are recorded in [the run-data journey review](run-data-journey.md).

The legacy Release follow-up passed **36 affected backend tests**, including 10 new cohort/permission tests and the canonical readiness endpoint regressions; **36 affected frontend tests**; TypeScript; and `services/manual/test/browser/legacyReleaseReadiness.test.mjs`. The actual Release page browser test verifies denied evidence, recovery by retry, switching expanded Releases without borrowing the other version's results, partial-evidence disclosure, no aggregate requests without required grants, and disabled note generation. Screenshots were inspected at `/tmp/qaira-release-readiness-legacy/`; temporary browser fixtures were removed. The existing canonical readiness board and its evidence endpoint were unchanged.

The linked-dataset follow-up executed `test/integration/testDataSetScope.postgres.test.js` against a new disposable PostgreSQL database: **10 passed, zero skipped** (nine scenarios and the enclosing suite). It verifies real SQL rejection/rollback, suite-only and case links, compatible sharing/narrowing, unlinked moves, historical foreign data excluded from both list and detail responses, legacy contexts, and secret redaction. The database was dropped after verification; no live records were written. This does not claim concurrent link-creation coverage.

## Remaining verified boundaries

Runs currently persist a textual `release` token rather than a Release foreign key. Matching now uses the canonical stored fix version exactly, with trim/case normalization; it does not substitute similarly named releases or unrelated project runs. Renaming a fix version does not migrate historical run tags. The legacy weighted score and latest-result-per-case formula remain for API compatibility; the canonical readiness board remains the more detailed review for execution iterations and coverage boundaries. Automation coverage now recognizes the actual `ready` status and `automated=yes` flag. No score redesign is claimed here.

Older malformed cross-project mappings are rejected when adding conflicting case scope, but this pass does not migrate or repair existing data. Membership removals, role changes under concurrent requests, archived planning state, every application deletion dependency, browser navigation after changing project, and production database concurrency remain outside this targeted validation.

## Research basis

OWASP recommends checking authorization on every request, using the resource's actual relationships and attributes, denying unspecified access, and testing the permission matrix. The implementation applies that guidance at the mapping routes and repeats project consistency checks at the mutation boundary. [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html).
