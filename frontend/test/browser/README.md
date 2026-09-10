These optional browser regressions use an existing Playwright installation and
Chrome/Chromium. They do not require a backend or signed-in account. Component
tests create isolated Vite fixtures and remove them after each test.

Start the frontend with `npm run dev`, then run from `frontend`:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright-core \
CHROME_EXECUTABLE=/path/to/chrome \
node --test test/browser/*.test.mjs
```

Omit those environment variables when Playwright and its bundled browser are
already available. `VITE_TEST_URL` defaults to `http://127.0.0.1:5173`.

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
