# Release Readiness: evidence review redesign

Reference research: dated observations and verification counts describe the recorded review, not current acceptance. Use the current [verification runbook](../development/verification.md) for reproducible checks.


Date: 10 September 2026. Scope: the Release Readiness screen and its evidence model. This is implementation research and an expert review, not a usability study or a validated release-risk model.

## What the current screen actually did

I captured the existing production React component before making changes, using isolated, reproducible API fixtures with the full application styles. The Browser skill's documented initialization was retried and returned `Browser is not available: iab`; the captures and behavioral checks therefore use an isolated Playwright/Chrome session against Vite. No live records were changed.

[Before, desktop](screenshots/release-readiness/before-desktop.png) shows the same invented 39/100 readiness score twice alongside an 87% confidence score. In the fixture, the screen claimed all three cases were executed even though one was paused. A failing data row was hidden by a passing row for the same case. The full-height three-column layout split review actions from their details, duplicated navigation, and required nested scrolling. On mobile, the initial viewport ended before meaningful evidence appeared.

Source inspection identified additional failures:

- `status !== "running"` counted pending, paused, aborted and N/A rows as completed evidence.
- Case-only result deduplication erased different data rows and run contexts. Using modification timestamps to select attempts could revive an edited, older attempt after a reset.
- Loaded case metadata determined the planned denominator, allowing omitted case details to make completion look better.
- A foreign-project `release_id` could leave the evidence query permanently disabled while the screen continued loading.
- The first page of stories/cases/bugs was a permanent limit; the viewer could not request the next evidence page.
- Source permissions had no corresponding feature checks. Query keys did not distinguish authorization changes. The AI explanation could outlive the scope that requested it.

## Research that informed the implementation

Google's SRE guidance distinguishes indicators from objectives and recommends choosing a small number of indicators that communicate the relevant behavior. It also explains how aggregates can obscure important distributions. Applied here, that supports showing explicit numerators/denominators and individual failures instead of an unsupported composite release probability. The distinction between observations and configured approval criteria is our product inference, not a claim that Google prescribes this dashboard. [Google SRE: Service Level Objectives](https://sre.google/sre-book/service-level-objectives/)

The WAI-ARIA tabs pattern defines a tablist, selected tab/panel association, and directional/Home/End keyboard navigation. The new Review, Stories and Runs controls implement those semantics with real buttons and a single active panel. [W3C APG: Tabs Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)

Progressive disclosure keeps primary work visible while moving detailed explanation into an intentional secondary interaction. We applied that to the methodology and source-window descriptions; known problems and source limitations remain visible. [Nielsen Norman Group: Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/)

## Resulting product behavior

[After, desktop](screenshots/release-readiness/after-desktop.png), [mobile](screenshots/release-readiness/after-mobile.png) and [dark theme](screenshots/release-readiness/after-dark.png).

The screen now has a clear hierarchy: current project, applied release/sprint scope, observed review state, four evidence measures, then the action queue and evidence boundary. A compact sidebar explains the review checks and loaded sources. The page scrolls as one workspace; there are no independently scrolling evidence panes.

Scope is stored in the URL. Release/sprint controls accept explicit names and suggest observed values, so a release outside the first source page can still be requested. A verified `release_id` keeps the release's canonical story membership and resolves its fix version. A wrong-project or inaccessible release has a recoverable error instead of a permanent loading state. Changing scope clears the old AI explanation.

The action queue links directly to the affected bug, run or story using the application's existing record routes. It prioritizes known defects, then failed/blocked/paused runs and missing story evidence. Story and run views preserve their source identities. Checks are explicitly labeled observed conditions, not configured approval gates.

### Evidence definitions

- **Story coverage:** stories with linked test IDs divided by scoped stories. This does not claim every scenario is covered.
- **Cases assessed:** unique planned cases whose observed rows are all passed or failed and whose declared run rows are present. Planned IDs include story links, run snapshots and result IDs even when case details are unavailable.
- **Passing outcomes:** passed divided by passed plus failed, with an unavailable denominator displayed as a dash. Pending, running, paused, blocked, aborted and N/A are not assessed outcomes.
- **Open defects:** unresolved scoped or trace-linked defects, with critical/high counts visible.

Results are deduplicated by run, case, data set and data row, selecting the latest attempt by creation timestamp with a stable ID tiebreaker. Distinct runs remain separate, so their environments/configurations cannot silently overwrite one another. A historical failure inside the returned run window remains an observed review item; the screen does not imply it describes only the newest release candidate. Declared `expected_iterations` from frozen run snapshots prevents a single passed data row from completing a case when other planned rows have no result.

The backend agent corrected exact normalized release/sprint filtering, selects latest attempts before applying the result budget, derives activity timestamps from lifecycle evidence, and projects snapshot case IDs/expected iteration counts without exposing raw data values. See the endpoint documentation and backend tests for that contract.

There is no composite readiness or confidence score in this screen or its AI explanation. A clear review state is not release approval. Known critical defects and failures remain visible even when other evidence is absent.

### Boundaries, recovery and access

Initial source pages contain 100 records; **Load more evidence** retrieves additional cursor pages on demand, capped at ten pages per source. Run evidence remains bounded to ten recent runs and 300 latest row outcomes. API completeness flags and source notices prevent partial samples from clearing checks. Missing case details remain in the denominator and make the review provisional. Absent data is distinguished from unavailable sources.

Failed background refreshes retain previously loaded evidence and display a provisional recovery notice. Source requests require both their project permission and feature flag. The standalone dashboard requires `dashboard.view` and `hellotest.analytics.dashboards`. All source cache keys include the current user, role, status, project grants, workspace grants and feature snapshot. Revocation removes cached source evidence immediately.

**Explain release** requires quality-insight access and every source permission/feature required by the endpoint, including suites. Its dialog explicitly covers the whole selected release across all sprints; the dashboard's sprint filter is not silently attributed to the AI request. The response is tied to its release/project/authorization identity, and late responses cannot reopen a stale dialog. Explanations are read-only and the legacy heuristic score is hidden.

Interface copy is registered in the downloadable localization catalog in English and Spanish. Dates and counts use the shared regional preferences. Layout is checked at 1440, 1024, 768, 390 and 320 pixels; dark controls have scoped contrast overrides for the application's broad theme rules. Reduced-motion preferences disable the refresh animation.

## Verification

- Twelve executable model tests cover conflicting data rows, old-attempt edits, run boundaries, every unassessed status, missing planned rows, missing case metadata, empty denominators, exact release/sprint scope, trace-linked defects, incomplete samples and stale dates.
- Browser tests use the real component and production styles with isolated APIs. They cover keyboard tabs, exact drilldown routes, responsive layouts, dark theme, Spanish/regional formatting, pagination, refresh failure/retry, disabled sources, cross-project release links, stale AI completion and live role demotion while AI is pending.
- The existing management contract was updated to verify supported release context behavior instead of the removed header icon and old local-state variable names.
- TypeScript build checking is part of the final combined frontend validation.

Reproduction from the repository root:

```sh
node --experimental-strip-types --test services/dashboard/test/frontend/releaseReadiness.test.mjs services/platform/frontend/test/managementCrudContract.test.mjs
PLAYWRIGHT_MODULE="$PWD/testengine/backend/node_modules/playwright" CHROME_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' VITE_TEST_URL=http://127.0.0.1:5179 node --test services/platform/frontend/test/browser/releaseReadiness.test.mjs
```

Runtime captures for empty, restricted, recovery, run and localization views are in `/tmp/qaira-readiness-design`. They are fixture evidence, not production screenshots or field-research observations.
