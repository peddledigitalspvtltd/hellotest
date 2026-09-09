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
same-turn pending recovery, Stop/resume, draft preservation, model failure with
reviewable evidence, and responsive layouts down to 320px. It removes its
temporary Vite fixtures after the test. Set `BROWSER_SCREENSHOT_DIR` to an
existing directory to capture the assistant, Gherkin, and run states.
