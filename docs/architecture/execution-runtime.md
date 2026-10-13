# Case execution and parameter policy

A run freezes its cases, steps, environment, configuration, and selected test data. Later authoring edits do not change that run. A rerun creates a new snapshot and materializes generator templates again.

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

New attachments belong to an execution result and therefore to an exact case/data-row attempt. Step evidence also records the frozen step ID. Large supported static images are compressed in the browser when that produces a smaller file; small images and animations retain their bytes. Backend object storage stores the files, with compression where useful. Result logs retain attachment IDs and metadata, not embedded file bytes.

Older run-level files remain under Earlier run attachments. Earlier case/step references stay readable without guessing which case an unscoped historical file belonged to. Resetting a case does not delete earlier evidence; open its saved attempt from History.
