# Case execution and parameter policy

## Paired local execution

Run local uses the browser-paired agent on `127.0.0.1:4311`. The API freezes the
run and encrypts its dispatch bundle, then returns a ten-minute authorization
bound to the owner, execution, browser origin and machine identity. The browser
passes only that grant to its paired agent. The agent makes outbound API calls
to claim the immutable native TestEngine plan and report signed results. No
API-to-laptop connection or shared engine credential is required.

Single cases and suites use the same native Playwright/API executor, frozen
parameters, hooks, data iterations, scheduling policy and result callback path.
Parallelism is bounded to eight local cases. Local browser runs reject mobile
steps explicitly. Remote workers keep their existing queue transport.

Paired runs inherit the project-effective Test Engine configuration, including
global settings when no project override exists. Timing, screenshots, console,
network and retention settings use that configuration. Local execution keeps
its headed Playwright session and per-dispatch callback credentials. Without a
configured integration, the local defaults remain available.

The agent saves a private receipt before executing. Retrying an uncertain
acknowledgment reconnects the same run. Restarting an interrupted agent reports
the interrupted attempt and never replays its steps automatically. Cancellation
is delivered directly when possible and polled from the API every two seconds;
revoked machine grants stop active work. Retained callback delivery can retry
for up to seven days while the owner and project remain authorized.

The API image builds its downloadable agent from the native engine source.
After an engine update, refresh the installed agent through Local agent setup;
its existing browser pairing can be preserved. For development, run
`npm --prefix testengine/backend run check:inspection-agent` to detect a stale
checked-in runtime bundle without rewriting it.

Saved Playwright code and instruction clicks share the engine's action and
navigation budgets. When native Playwright confirms that a click completed but
times out waiting for its pending main-document navigation, the engine waits
only for that existing navigation within the remaining navigation budget. It
never repeats the click or relaxes the saved assertions. Explicit click timeout,
`noWaitAfter`, and trial options retain native behavior. Navigation waits appear
in the step diagnostics.

Framed assertions share one readiness/assertion deadline and honor positive
authored timeout overrides. The final owner/document/origin check has a separate
bounded allowance; it cannot replace an ordinary assertion failure with a
one-millisecond locator timeout. Frame replacement and foreign documents still
stop execution.

For a grounded SPA route transition, saved native code waits for that same URL
with `page.waitForURL(..., { waitUntil: 'commit' })` before its exact URL and
business assertions. Omitting a wait timeout uses the engine's navigation
budget; the assertions retain their own budget. A successful submission response
alone does not prove the requested final page or business outcome.

Remote workers retry temporary heartbeat transport and service failures only
within their last confirmed lease, reserving one second before expiry. The next
application action waits for a positive control receipt. Explicit denial,
cancellation, or lease expiry stops execution; an uncertain progress report
does not trigger a replay of browser actions.

Healthy partial local progress remains `running` until the final callback,
including any After Test work. Failed or blocked sections remain visible, and
delayed progress cannot reopen a finished attempt.

A run freezes its cases, steps, environment, configuration, and selected test data. Later authoring edits do not change that run. A rerun creates a new snapshot and materializes generator templates again.

Suite scheduling overrides are frozen with each case in
`test_data_options.execution_policy`. Later suite edits do not change a planned
run. Cases without a suite override follow the run's serial/parallel settings;
reruns retain those run settings. Executable frozen cases are validated against
their saved source, so changing the authoring case's automation readiness does
not invalidate an earlier run.

## Parameters and test data

Parameter names retain their scope: `@t.email`, `@s.email`, and `@r.email` are distinct names. Unscoped declarations such as `@email` and Gherkin `<email>` mean `@t.email`. Bracket notation supports names containing spaces.

For the **same canonical name**, precedence from lowest to highest is:

1. Saved case defaults.
2. Saved suite values.
3. Run environment variables.
4. Run configuration variables.
5. Explicit run values, when supplied by the execution contract.
6. The selected frozen test-data row.
7. Captured execution output.

An explicit empty string overrides a lower-priority value. A missing key leaves the previous value in place. Explicit scope prefixes are preserved; unscoped suite keys default to `s`, environment/configuration keys to `r`, and test-data columns to `t`.

For example, declare `@t.email` in a case, download the parameter template from case/suite authoring or run planning, fill the `t.email` CSV column, import it under Test Data, and select it for the run. Each table row creates a separate case instance with its own result and clock. A run-selected dataset replaces the case-linked dataset for that run. Without run data, the case's linked dataset is used. The case workspace shows the selected row, effective values, missing declarations, and the source of each value. Templates contain column names and empty cells, never resolved values or secrets.

Captured test values remain within their case instance. Previous cases can supply suite captures only within the same suite, and run captures across the run. A sibling row of the currently opened case cannot supply its captures. Source values and generator templates marked secret are hidden in public snapshots; execution uses the frozen stored values internally.

Configuration is not a matrix expansion: the engine selects one compatible target from the frozen configuration. Mobile runs prefer the matching mobile OS, then the first mobile target. Other runs prefer the first browser target. The case workspace labels the configured target; for manual runs it is a configuration reference, not proof that a device/browser was used.

## Case lifecycle

Opening a case or attaching evidence never starts timing. Start the run, then explicitly start a case. Pause stops the clock; Resume adds another active segment. Pass, Fail, Blocked, N/A, and Aborted stop timing. Unexecuted creates a fresh pending attempt while preserving the earlier attempt, elapsed time, comments, and evidence in History. Starting a finalized case also creates a new attempt.

Clocks are persisted by the API, so navigation, refresh, and different browser sessions cannot reset or start them. Case status is per data row. Run and suite durations sum active case time across all attempts; pause gaps and browsing time are excluded. Bulk suite outcomes explicitly start/resume the affected attempts before recording their results. Finished runs lock lifecycle changes while preserving evidence access. Completion derives its verdict from saved outcomes: failures or blockers remain visible, and unfinished or aborted case instances produce a partially completed run.

Assignees resolve from run to suite to module to case. An explicit lower-level assignment wins; otherwise changes to the run assignee carry through the hierarchy.

## Evidence

New attachments belong to an execution result and therefore to an exact case/data-row attempt. Step evidence also records the frozen step ID. Large supported static images are compressed in the browser when that produces a smaller file; small images and animations retain their bytes. Backend object storage stores the files, with compression where useful. After a verified upload, result logs retain attachment IDs and metadata. If no storage receipt is available, bounded inline screenshot evidence can remain in the result; Defect AI admits those images under the current run/attachment permissions and image limits. Requested captures that fail produce diagnostics while preserving the test's actual outcome.

Older run-level files remain under Earlier run attachments. Earlier case/step references stay readable without guessing which case an unscoped historical file belonged to. Resetting a case does not delete earlier evidence; open its saved attempt from History.

## Case live view

Live Run View selects the exact case and data row's engine run. The authorized execution API issues a five-minute signed viewer grant scoped to that run and browser provider. Both engine viewer routes verify the grant; an active frame can renew it, while ended or unavailable browser sessions cannot renew it indefinitely. Expired links stop polling and direct the user to reopen Live Run View from the case. Public reverse-proxy prefixes are retained.

Concurrent viewers share bounded frame capture and replica lookup work. Hidden viewers pause polling. Viewer credentials are excluded from model context, request query logging and retained model traces. Deploy the application and Test Engine changes together so newly protected viewer routes receive the signed grant.
