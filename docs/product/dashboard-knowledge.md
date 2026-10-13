# Dashboard, Ask AI and case-run experience

Updated 10 September 2026. This change builds on the existing run lifecycle,
parameter resolution and attachment work documented in
[execution-runtime-policy.md](../architecture/execution-runtime.md).

## Dashboard workflow

Executive, Product and QA views open with 7, 8 and 8 preloaded widgets. These
views require no model request or saved dashboard. Customize creates an editable
copy. The library contains 23 native widgets across release, product, execution
and coverage; automation coverage respects the automation feature permission.

Creation starts with a useful QA layout. Users can choose a different starting
point, search the library, add widgets, select any position or drag to reorder,
duplicate, configure and remove widgets. Focused, Balanced and Dense layouts
adapt to narrow screens. Build layout, Preview data and AI designer separate
arrangement from evaluation. Saving a layout retains its actual widget order.

Preview data is fetched on demand. Renaming a widget or changing its position,
accent or layout reuses evaluated data. Queries share a 60-second cache and do
not refresh merely because the window regains focus. Project and editor request
guards prevent late save, preview or AI responses from replacing a newer draft.

The batch evaluator loads project evidence once per request and release scope.
An equivalent seven-widget local sample dropped from 63 SQL reads to 9 and from
125,134 to 5,385 response bytes. This is a reduction in repeated work and payload,
not a claim about all production latency. Read-only checks of the three actual
presets on the local project used 9 reads each, returned 6.6–7.7 KB and took
3.3–5.1 ms after warm-up. Large-project load testing remains separate.

Metric explanations now match the calculations, including the different
components used for release confidence and evidence confidence. Unsupported
metrics fail explicitly. Legacy connected-work-tracker queries are reported as
unsupported instead of silently displaying native counts under that label.

Evidence rows open the correct story, bug, case, suite or run using the app's
actual routes. Suite links can resolve another application in the same project.
Group/filter drill-downs disclose when the destination list cannot apply the
widget's filters. Case outcome rows open the case definition when no run-attempt
identifier is available.

## Ask AI reliability

Transient model failures can retry automatically, up to three total attempts.
Generation and embedding calls use bounded retries with backoff, provider
Retry-After handling and cancellation. The default overall budget is 45 seconds;
an individual attempt is limited to 30 seconds and the remaining overall budget.
Retries count against the turn's model budget. Authentication failures, exhausted
quota, invalid model configuration and user cancellation stop immediately.

The chat shows the current retry attempt. Repeated progress events remain visible
without duplicating streamed events. A recovered operation emits one final answer
and persists one assistant turn. Stop preserves the question draft, and pending
turn recovery continues using the same turn identifier. Failure responses retain
reviewable retrieved evidence.

The latest saved OpenAI failure inspected locally reported
`MODEL_QUOTA_EXCEEDED`, with two usable citations. Restoring the provider quota or
selecting a working configured model is necessary for that provider to generate
answers. Retries cannot resolve exhausted quota. No provider credentials or
integration settings were changed, and a successful live provider answer was not
claimed from fixture tests.

## Case-run workspace

The case identity and primary execution controls now form a compact header.
Status, elapsed time and Start/Pause remain near the top. Report Bug stays
directly accessible; secondary actions use a keyboard-accessible More menu.
Overview, History, Logs and Attachments retain the minimal horizontal tab pattern.

Run context shows environment, data and configuration together, including the
selected data row. Effective parameters expand from a count button; unresolved
parameter warnings and the template action remain visible. Preconditions precede
the Gherkin steps. Step outcomes, comments and labeled evidence controls have a
clearer hierarchy. Existing lifecycle, attachment and parameter semantics remain
covered by regression tests.

## Review and verification

The review captured the existing entry and creation screens before changing
them. It found a dense creation form, repeated evaluation while arranging
widgets and insufficient emphasis on case execution controls. The resulting
screens were reviewed again in desktop, mobile and dark states. Final screenshot
review also caught mobile footer sizing and dark-theme contrast issues that were
corrected before deployment.

Browser checks mount the real components with production CSS and isolated API
fixtures; they do not use the user's login or modify project records. They cover
creation/save/preview caching, direct reordering, evidence routes, project-switch
races, suite deep links, case controls, scrolling, retry streaming and widths from
320 to 1440 pixels. The integrated application browser was unavailable in this
session, so these are component-browser checks rather than a claim of a signed-in
end-to-end production session.

Use [verification](../development/verification.md) and the [browser test instructions](../../services/platform/frontend/test/browser/README.md) to reproduce these checks against the current revision. Prior deployment snapshots and temporary screenshots are not current acceptance evidence.
