These optional browser regressions use an existing Playwright installation and
Chrome/Chromium. They do not require a backend or signed-in account. Component
tests create isolated Vite fixtures and remove them after each test.

`testCaseDisplayId.test.mjs` checks readable Test Case IDs while details and
steps load, empty steps, legacy display IDs, and missing display IDs.

`splitActionMenus.test.mjs` compares rendered dropdown colors, typography,
corners, spacing, and item bounds with their parent split buttons across Test
Cases, Stories, Run, and Report Bug actions. It checks light/dark themes at
1440, 390, and 320px, import/AI actions, disabled controls, and menu dismissal.
Screenshots are saved in `/tmp/qaira-split-action-menus`.

Create-screen regressions (`createPickerForms.test.mjs`,
`createRunPicker.test.mjs`, and `testCasePicker.test.mjs`) check editable forms
while picker requests are delayed, 25-record paging, search beyond the first
page, retained selections and ordering, linked context, and local retries.
Run browser fixtures sequentially to avoid Vite reloads from another fixture.

`largeSelectionDialogs.test.mjs` stress-tests the real AppShell with 400 selected
cases from a 450-case catalog and 120 selected suites. It covers delayed names,
long titles, last-case reordering and focus, native picker scrolling, locked
background positions, and clearing selections. Header, footer, and backdrop
bounds are checked at 1440×900, 1024×650, 768×600, 390×700, 320×480, and 900×400,
with mobile light/dark screenshots in `/tmp/qaira-large-selection-dialogs`.

The project tile regression (`projectTileNavigation.test.mjs`) mounts the actual
Projects page inside AppShell. It checks first-click opening, uninterrupted page
state across project changes, keyboard and mobile opening, and enforcement of
workspace feature updates after a background refresh.

The workspace switcher regressions (`workspaceProjectSwitcher.test.mjs` and
`workspaceSwitcherShell.test.mjs`) use the repository's Playwright installation
and default to Vite on port 5179 (`BROWSER_TEST_BASE_URL` overrides it). They
verify project/application cache isolation, delayed responses across projects
and permission changes, atomic explicit selection, remembered values on errors,
retries, keyboard behavior, and dropdown bounds down to 320px. The real AppShell
fixture also verifies that Escape closes a nested dropdown before its mobile
drawer, forward/reverse Tab stays in the drawer, and an unrelated popover cannot
bypass dialog keyboard handling. All API calls and storage are isolated.

Start the frontend with `npm run dev`, then run from `services/platform/frontend`:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright-core \
CHROME_EXECUTABLE=/path/to/chrome \
node --test --test-concurrency=1 test/browser/*.test.mjs
```

Omit those environment variables when Playwright and its bundled browser are
already available. `VITE_TEST_URL` defaults to `http://127.0.0.1:5173`.

The shared loader test (`loadingState.test.mjs`) checks viewport centering in
scrolled and transformed containers at desktop and mobile sizes, concurrent
request handoff, cleanup, click-through controls, and reduced motion. It also
checks the admin stylesheet and captures light/dark screenshots in
`BROWSER_SCREENSHOT_DIR` (default `/tmp/qaira-loading-state`).
Browser clock checks verify the 160ms no-flash delay, two-second minimum visible
time, 180ms fade, and cancellation of dismissal when another request starts.
Ready content remains interactive while the compact indicator finishes.

The catalog regressions (`catalogScroll.test.mjs`, `catalogPages.test.mjs`,
`storyCatalogPages.test.mjs`, and `testCaseCatalogPage.test.mjs`)
verify 25-record pages, independent metrics, cached re-entry, server search,
off-page detail links, nested scroll detection, retained rows and scroll position,
and retry behavior without a blocking loader or automatic page draining. The Bugs,
Stories, Backlog, and Test Cases page tests mount the actual pages with isolated
APIs. Test Cases also verifies lazy Run options preserve delivery prefill.
Screenshots are saved in `/tmp/qaira-catalog-pages` and
`/tmp/qaira-test-case-catalog`. Run Vite browser tests sequentially so fixture cleanup
does not reload another test’s page.

The Product Management metrics test (`productMetricCards.test.mjs`) checks
Stories, Backlog, and Sprints against complete aggregate and per-record evidence
while only 25 rows are loaded. It verifies denominators, readiness rounding,
pending metrics, and missing execution evidence. The Release readiness test
(`legacyReleaseReadiness.test.mjs`) also checks shared-Story deduplication and
expanded Story metrics. Screenshots are saved in `/tmp/qaira-product-metrics`
and `/tmp/qaira-release-readiness-legacy`.

The workspace tests check the actual shared detail component with production
CSS across four viewport widths and both sidebar preferences. The Gherkin test
checks real preview/edit transitions, drag and position-based reordering, and
long parameter values in both editors and the parameters dialog.

The run-page scroll tests exercise wheel gestures over buttons, inputs, closed
selects, hierarchy rows, cases, logs, and analysis at desktop and mobile widths.
They run without Vite and ensure content panels use the page scrollbar while
notes remain editable.

The run catalog/details test mounts the actual `ExecutionsPage` with isolated
API, authentication, and router fixtures. It checks direct/suite grouping and
legacy links, finished-run edit locks, recorded defect and story metrics,
evidence flips and analysis review, resource dialogs, and page scrolling at
1440, 1024, 768, 390, and 320px. It also covers case workspace opening, canonical
legacy links, and long flipped evidence sharing the page scrollbar. The run configuration dialog test checks the
shared resource forms, frozen/deleted-source snapshots, permission-gated current
resource fallback, and responsive read-only behavior.

The run editor test verifies queued date and scope changes, retained direct case
selections and unavailable attachments, running/finished locks, permission-aware
mode choices, conflict reload, retryable failures, and responsive editing down
to 320px.

The run step views test (`runStepViews.test.mjs`) verifies Structured as the
default, switching to Gherkin or Coded without changing saved outcomes or
parameters, live permission and feature revocation, and layout at 320px and
390px. It also checks that switching formats makes no execution mutations.
The feature availability test (`featureAvailability.test.mjs`) verifies direct
links to administrator feature details, permission and dependency mappings,
browser history, and independent detail and toggle controls.

The admin setup test (`adminSampleData.test.mjs`) checks all seven role presets,
current versus default permissions, Reporter Bug creation access, and retention
of a customized role with no grants. It also covers missing-role installation,
repeat setup, sample dependencies, failed-request retries, and 320–1440px layouts.
Start `npm run dev:admin -- --port 5180`, or set `ADMIN_TEST_URL` for another port.
Screenshots are saved in `/tmp/qaira-admin-samples`; APIs are isolated fixtures.

The AI authoring regressions (`aiLlmDropdown.test.mjs` and
`storyAiWorkbench.test.mjs`) exercise the shared context toolbar, LLM selection,
and Story draft review with isolated API responses. They verify configured and
explicit provider choices without calling an LLM, plus the Story creation and
completion workbenches at desktop and mobile widths.

The assistant test uses isolated API fixtures to verify reported progress,
automatic model retries through the real SSE consumer with one final answer,
same-turn pending recovery, Stop during retry/resume, draft preservation, model failure with
reviewable evidence, and responsive layouts down to 320px. It removes its
temporary Vite fixtures after the test. Set `BROWSER_SCREENSHOT_DIR` to an
existing directory to capture the assistant, Gherkin, and run states.

The dashboard test checks preloaded views, creation, direct widget reordering,
save payloads, cached previews, evidence links, late AI responses after project
switches, page scrolling and editor bounds at 320–1440px. It also checks that
footer controls stay compact and visible, and captures light and dark layouts.
It defaults to Vite on port 5178; set `VITE_TEST_URL` to use another port. The
suite-drilldown test verifies project-scoped links across application selections,
including delayed responses from a previously selected project.

The integration connection test checks all saved provider editors and available
creation forms, catalog profile testing, masked credentials, draft changes,
limited/failed/retry outcomes and cancellation after profile or project changes.
It also captures light/dark layouts and checks panel bounds at 320–1440px without
writing integration settings. It defaults to Vite on port 5178; set
`VITE_TEST_URL` to use another port.

The repository agents test exercises all four agents, ZIP/GitHub request
transport, review and publication, permission boundaries, pagination and the
50-item selection limit. It verifies cancellation, retry, visibility-aware
polling, stale responses after scope changes, and published Knowledge document
links. Its isolated fixtures cover light/dark layouts at 320–1440px without
changing application data. It defaults to Vite on port 5178.

The agent workspace test checks the unified 14-agent library, search, categories,
pins and all 10 specialist workspaces. Real API request helpers are exercised
against intercepted HTTP responses for success, failure, cancellation, saved
review deep links and scope changes. It checks editable brief downloads,
evidence and limitations, read-only access, late response protection, recent
work, and preview-only workflow drafts with retained review provenance.
Screenshots cover desktop and 390px dark layouts, including the mobile context
menu; the selected review mode has a measured text contrast check. Workflow
preview persistence uses isolated API fixtures and does not execute tools.
It defaults to Vite on port 5178.

The Reporter permissions test opens the production Bugs page with a create-only
project role. It verifies creation, project-scoped assignees without a global
users request, read-only saved fields, blocked updates/deletes, and independent
comment/evidence controls. It uses isolated API fixtures and defaults to Vite
on port 5186.

The workspace capability test exercises shared optional catalogs with partial
project grants, disabled features, cached records, live enable/disable changes,
in-flight cancellation and session refresh failures. It also checks that losing
Knowledge access releases Smart Context without erasing the host form's draft.
The AppShell switcher test keeps Projects management disabled while verifying
membership-scoped project/application selection and mobile keyboard behavior.

`sharedStepOptionalFeatures.test.mjs` verifies Shared Step Group editing with
disabled optional features and partial project grants, retained application
scope, cancellation of pending Run history without losing the draft, and linked
Test Case previews without Run access. It uses isolated APIs on port 5186 by
default (`VITE_TEST_URL` overrides it).
