# @hellotest/automation

The [5 November platform review](../../docs/research/automation-platform-review-2026-11-05.md)
documents implemented authoring, recorder, Engineer and suite execution fixes,
verification evidence and the current capability boundaries.

Automation authoring, object repository, recorder controls and TestEngine dispatch/callbacks.

- `frontend/`: screens, components, hooks and the owning API client. `entry.ts` exposes lazy release views.
- `backend/`: API routes, use cases and owning workers. `server.cjs` starts this profile through the shared runtime.
- `test/`: focused backend, frontend and browser checks where available.
- `package.json`: explicit npm exports/code dependencies and `hellotest` product prerequisites/feature ownership.
- `dist/ui/`: generated UI manifest and assets; never commit these files.

From the repository root:

```sh
npm run dev --workspace @hellotest/automation
npm run dev:api --workspace @hellotest/automation
npm test --workspace @hellotest/automation
npm run build --workspace @hellotest/automation
```

Run `npm run setup` first. Development uses the shared shell; the API requires configured foundation infrastructure. Cross-owner imports use declared `@hellotest/...` exports. This private workspace still depends on repository runtime adapters and the shared schema.

Read [CONTRIBUTING](../../CONTRIBUTING.md) for setup/debugging and [capability packaging](../../docs/architecture/capability-packaging.md) for selection, flags, permissions and release compatibility.

For the package map, service communication, context assembly and browser/code
generation loop, read the [Automation Engineer implementation](../../docs/architecture/automation-workflow.md#automation-engineer-implementation).

## Automation authoring and execution

Manual cases use `TC_` identifiers; standalone automation cases use `AT_` identifiers.
Creating automation from a manual case creates a separate record and links it to
the manual specification. Case type cannot change in place. The schema upgrade
retains old automation display IDs as lookup aliases. Suites can include manual,
automation or both kinds, with independent selections and case-type filters.

Catalog selection supports deleting selected automation cases, including the
current filtered Select all selection. Up to 10,000 explicit IDs are validated
and removed in one audited transaction; a mixed, stale or busy selection removes
nothing. Unclaimed builds that have never started can be cancelled atomically with
deletion; claimed builds and active execution attempts stay protected. Deletion removes current manual links and live suite/module membership,
refreshes coverage and preserves manual definitions, reusable assets and frozen
run evidence. Schema version 8 also preserves completed worker receipts. Retrying
the same committed selection returns its original receipt.

Stale direct-local activity is reconciled only against a healthy authenticated
matching runner after the dispatch acknowledgement window. Missing attempts retain
an abandoned receipt without inventing a passing result; finished attempts can
still deliver real historical evidence. An unreachable or active runner remains
protected from deletion.

Linked execution outcomes are read-only coverage receipts backed by the source
automation result. They do not insert manual step evidence. Manual history and
status expose the source automation identity; opening evidence selects that source
case. Pending manual slots in the same run may receive compatible linked coverage;
active or finalized manual attempts keep their own evidence. Missing data rows or
blocked source outcomes cannot become a passing manual result.

The Build tab has two entry points: **Build with automation agent** and **Record & playback**. Both produce editable case steps. Keyword authoring and executable Playwright JavaScript statements remain available in the step plan. Web sections support JavaScript bodies, single supported Playwright `test()`/`it()` entry points and function/module entry points through the runtime adapter. Generation normalizes supported entry points into awaited section programs. Suite hooks and multiple independent tests are not section programs; configure before/after-test hooks in HelloTest, where selections are frozen with the run and retained by reruns. API sections execute their structured requests; saved JavaScript is a source reference, not a request override. Android/iOS sections retain the mobile runtime. Playwright does not execute native mobile programs.

A complete web recording replaces the automation case's web steps, including
copied manual descriptions and leftover rows. API and native sections retain
their contents. Linked manual cases and shared-group definitions remain separate.
Recording into a selected section replaces only that section's instructions.
Captured inputs can bind to existing or newly created `@t`, `@s`, and `@r`
parameters; private inputs require a parameter binding before saving. The suite
selection stays fixed during recording. Saving stops and flushes the capture,
and a failed save can be retried with corrected parameter selections. Parameter
edits during capture are allowed; concurrent changes to the step plan are rejected.

Use **Bind parameters** on a plan section to replace selected literal inputs and
expected values with configured `@r`, `@t`, or `@s` references. The binding editor
changes parsed data arguments, preserving selectors, comments and the remaining
program. Save the section; Instructions, Source and Gherkin then share those
bindings. Changing parameter defaults changes runtime data without rewriting code.
The **Secret** checkbox in automation Test Params masks a value in case previews
and saves its privacy marker, including inherited values without copying them
into overrides. Previously saved private values remain protected.

Saved semantic locators wrapped inside `page.locator("getByRole(...)")` use a
closed compatibility adapter before local and remote execution. It preserves
exact matching and explicit indexes and never chooses an implicit first match.
Case runs, console single-step retries and recorder readiness use the same
saved-source preparation. Run admission checks that every active section has
runnable instructions, valid syntax and a supported runtime. A prose expected
result does not require an inline assertion in each section. Frozen run and hook
snapshots retain their authored source; the engine receives the compatible copy
and executes its actual actions and assertions. Missing instructions and invalid
source still block admission. New AI builds keep their stricter expected-result
assertion quality checks. A recording is Ready when all its saved sections are
executable; execution does not invent checks for copied manual expectations.

The Automation Engineer also recognizes explicit API requests in unimplemented
Web defaults, such as `Send a POST request to @r.base_url/orders`. Saved Web
programs and native sections retain their runtime. An API-only build requires no
browser session or browser Start URL. Mixed builds preserve section order and
develop their API sections without invoking browser tools. Ambiguous actions
retain their saved runtime; choose API explicitly when the prose has no clear
request evidence.

Native API requests retain method, URL, repeated query parameters, headers,
cookies, string bodies, timeouts and redirect policy. Authentication uses an
authorized scoped `credential_reference`, for example `@r.api_token`, for bearer,
API-key, basic or OAuth access-token references. Basic references contain the
encoded credential; OAuth references use an already authorized access token and
do not perform an OAuth authorization/refresh flow. No server environment secret
is selected implicitly. Reported authentication headers/query values are masked.
Responses support status, header equality/presence, included/omitted body text,
JSON-path equality/existence/comparison, draft-07 JSON Schema and response-time
assertions. Invalid schemas, failed assertions and missing required capture paths
fail the step. Captures flow to later API or Web sections through scoped runtime
parameters. Missing API contracts or credentials remain explicit dependencies;
generation does not submit HTTP requests to discover or guess them.

`previewAutomationDraft` exposes the same native validation to workflow nodes
without saving cases or executing browser/HTTP actions. Its structural
`validation.status: passed` is separate from `verification_status: unverified`.
Acceptance creates an incomplete automation case for review. A passing real Test
Engine run establishes execution evidence. The `automationBuild.apiRuntime`
instruction is editable under Admin AI Controls.

Edit section and Edit instructions split JavaScript into complete statements or blocks, with selection, copy, paste, insert, reorder and delete controls. Loops, conditionals and multiline literals remain intact. Invalid drafts remain editable instead of being silently rewritten. Expanded Instructions and Gherkin present readable actions such as Click, Type and Press with repository field names and parameter references. Source retains the executable statements; Full source adds the complete Playwright wrapper and data bindings.

### Shared upstream Automation Engineer

Case Build and the Automation Engineer workflow node share
`automationUpstreamEngineer` and the actual pinned Microsoft `@playwright/mcp`
package. HelloTest MCP exposes the durable domain build operation; upstream
Playwright MCP owns browser tools, snapshots, locator generation and native
emitted action code. The host supplies the configured LLM, authorized current
requirements, selected scoped data, permissions, cancellation and guarded saves.

The host forwards case intent, active linked manual steps, selected resource
metadata, Story acceptance criteria, authorized repository hints and bounded
retrieved evidence. Dataset rows and private values use the existing scoped
parameter channel. Unrelated manual steps and full preceding source programs do
not accompany every browser decision. Repository hints do not replace live
browser observations.

Native mutation calls remain authoritative. Finalization binds parameters and
validates runnable assertions without replaying completed actions. A separate
LLM call maps final source to readable Instructions; hashes and ordered operation
identities prevent that display result from changing executable behavior.
The shared mapping stage also serves explicit offline source previews, which
open no browser and remain unverified. API-only/native cases keep their own
runtime contracts.

The obsolete custom web actor branch and its orphaned context, obligation,
parameter-binding and object-staging modules have been removed. Recorder and
explicit Repair retain their active shared browser/compiler helpers. They do
not form an alternate Automation Engineer build path.

Validated sections save progressively after source/manual/data version checks.
Native data expressions preserve raw generator templates for later Runs while
one resolved value remains fixed within the current attempt. Source-only
recovery uses matching protected native evidence and produces an unsaved,
unverified draft for the normal editor. Local/remote Runs execute frozen source
and data, including when cases are composed into a suite. A real passing Run is
separate from generation or browser inspection.

See the [current implementation and source map](../../docs/architecture/automation-workflow.md#automation-engineer-implementation)
for the two entry points, input policy, upstream transport and mapping stage.

### Diagnosing agent model failures

Select the affected step in the Engineer workspace and inspect its progress,
required context and Model request/response tabs before retrying. An
`AI_INSTRUCTION_MISSING` failure occurs before provider dispatch: review the named
AI Controls request template. The selected Engineer profile
supplies its configured model, role, guardrails and context policy.
Configuration failures are terminal until corrected; repeated worker retries
cannot repair a missing template. Validation rejects semantic Playwright calls
mistakenly embedded inside a selector string and asks for a corrected section.
Valid waits remain governed by the case and configured instructions.

Native asynchronous actions and assertions must be awaited. Source validation
returns executable-program feedback without replaying completed MCP actions.
Known runner-only assertions, ambiguous exact-record checks and misplaced locator
options receive bounded source-only correction. Display mapping has its own
phase and cannot change the program. A later Run establishes pass/fail.

`SAVEPOINT can only be used in transaction blocks` after all sections validate is a persistence failure, not a model failure. Detached workers can retain an asynchronous transaction context after its creator commits. The shared PostgreSQL adapter now expires that context before cleanup, so subsequent worker reads and nested writes obtain live connections. Keep the original activity for diagnosis; the regression checks cover both commit and rollback against an isolated PostgreSQL database.

Each model attempt is correlated with the activity's session in the central LLM
trace store, including failed configuration/context preflight. Activity events
contain correlation/status metadata only. The model-call disclosure uses existing
trace permissions: operational access shows call metadata, and administrators can
inspect the sanitized request and response. Query tokens, sensitive header values,
credentials and hidden reasoning are redacted; capture size limits are explicit.
Unavailable trace storage or an activity log failure must not replay a model
request or discard an otherwise successful response. A successful provider
response still requires output validation, review and an actual execution receipt.

Browser operation receipts use host timestamps and retain the operation ID,
tool, assertion kind, outcome, typed failure code and elapsed milliseconds.
The activity ID and available request/trace IDs correlate them with the existing
protected evidence and model traces. Public action events discard arguments,
selectors, entered values and page-supplied messages before persistence. Terminal
receipts are immutable, and an action ID cannot complete a different tool.
Optional screenshot, startup-diagnostic and historical-preview storage outages
emit bounded classification-only warnings, rate limited per operation. Access
revocation, cancellation and lost worker leases remain fatal. Progress reduction
indexes case and manual-section relationships once per event instead of scanning
the entire plan for each row.

Screens with the same Page URL share one identity within their project and
application. Query values and URL fragments remain meaningful; blank URLs retain
name-based identity. Captures, imports and manual edits reuse that screen. Exact
duplicate fields retain redirects and provenance, while distinct fields remain
available with unique names. Reads project legacy duplicates without changing
stored records; writes reconcile them under a scoped transaction lock. Historical
Screen.Field references continue to work in playback, export and case Objects.
Exact current references take priority over historical aliases. Different URLs
retain stable distinct screen names. Explicit deletion removes the canonical
family so retired aliases cannot reappear. Saved object links remain valid; no
schema migration or automatic source-code rewrite is required.

Repository inspection and playback share `testengine/backend/src/lib/repositoryLocator.ts`. Locators do not silently select the first match. Use a unique selector, an explicit `.first()`/`.nth(n)`, or `selector >> nth=n`. The inspector builds selectors from captured attributes, optional parent scope and zero-based index; editing invalidates previous validation. Case Objects tabs show fields referenced by executable targets or pending keyword bindings and their associated screens. Historical capture ownership alone does not add an unused field. The tab reuses the repository screen and field editors, saving the same shared assets without leaving the case. Repository management permission controls editing; withheld source is reported as unknown bindings. Recordings display all retained actions in sequence.

Web recording saves use deterministic alignment and naming; model availability does not delay saving a captured plan. Existing persisted repository members retain their symbolic references. Newly captured members emit their observed native Playwright locators, so an optional repository-learning outage cannot make a saved plan depend on missing objects. Rebinding these instructions to a later repository change requires editing or rebuilding the instructions. Recorder previews mask private inputs and parameter aliases, including sensitive URL query values, while keeping the original capture available for explicit parameter binding.

The main-database `automation_recording_imports` receipt commits with full-plan or selected-section changes. Retrying the same owned recording returns its saved receipt, including after subsequent plan edits, without replaying browser actions or replacing newer instructions. Different capture/input selections for an already imported recording fail with a conflict. Initial imports require the original scoped start transaction. Selected-section imports retain their specification, replace the complete executable program and check the same locked plan fingerprint as complete captures. A copied expected result does not block an executable recording or manufacture an assertion; saved runtime checks still determine their own outcomes.

Awaited JavaScript operations report their actual line, status, duration and retry attempt. Loops can report multiple operations for the same line; other lines have no invented pass result. Native Playwright pages receive configured action/navigation timeouts; helper assertions retry within the assertion timeout. This complements Playwright actionability waits without imposing arbitrary sleeps on every instruction.

Dispatch validates and normalizes supported single entry points before compiling
the frozen section. TestEngine rejects recognizable detached asynchronous browser
operations before section side effects; await, return or join those operations.
This static check does not prove the behavior of arbitrary custom helper code.

Screenshots, videos, traces and console/network capture follow the frozen execution policy. Screenshots use compressed JPEG. Videos from all recorded pages are retained; optional FFmpeg transcoding selects a smaller WebM without upscaling and retains the original if compression is unavailable or unsuccessful. Collected screenshots, videos and traces upload as file-backed multipart objects into the actual result's attachment list, with run-scoped authorization, SHA-256 receipts and idempotent storage. The evidence panel refreshes during a live run and after its final revision.

Attachment limits still apply. If upload is unavailable, small files can use a bounded inline fallback (2 MiB per file, 4 MiB per bundle); larger files remain engine references with an explicit capture warning. A reference alone is not a stored attachment. Per-step line evidence is capped at 1,000 events. Trace and video recording require an engine-owned Playwright context; attached CDP contexts do not receive equivalent recording. Final collection/upload completes before the completion callback. Data iterations, preconditions, shared groups and before/after hooks continue through the existing dispatch/executor contracts.

Focused checks (after `npm run setup`):

```sh
node --test services/automation/test/backend/automationBrowserAgent.test.js
npm --prefix testengine/backend test
node --test testengine/backend/test/browser/automationMcpFlow.test.mjs testengine/backend/test/browser/automationPlaybackEvidence.test.mjs
node --test testengine/backend/test/browser/recorderRoundTrip.test.mjs
```

Browser checks use isolated fixtures; they do not verify a customer's LLM credentials, private application, Android device or remote recorder deployment. After changing the recorder or shared locator runtime, run `npm --prefix testengine/backend run package:inspection-agent` so downloaded local agents receive the same behavior.

`node scripts/checks/test-web-recorder-postgres.mjs` verifies recording replacement,
rollback, and linked manual/shared-step preservation in a disposable local
PostgreSQL database. It uses `WEB_RECORDER_TEST_DATABASE_URL` or the local deployment
database connection and removes its temporary database after the check.

The [workflow and runtime design](../../docs/architecture/automation-workflow.md) covers the authoring layout, context handoff, reuse and execution contracts, and current boundaries. Agent instructions are optional when a saved behavior plan is present. Native recorder selection follows the targeted step or unique native runtime in a mixed plan and preserves the other platforms when saving.

## Command workspace and run readiness

Automation cases open on the saved plan. The Capture, Generate, Review and Run rail keeps the next action visible; metadata, data profiles, hooks, objects and run evidence stay in secondary navigation. Creation starts with a behavior brief and method, with coverage/status/data in a disclosure. Build activity exposes observed phases and processed case counts. Generated sections can be compared against the saved source from before generation. A completed build is output to review, not a passed test.

Bulk commands use only explicitly selected cases. Build review checks the current saved behavior, and run review checks executable mappings and API request structure. Empty, retired, unsupported, entirely skipped or incomplete plans block dispatch. Unsaved sections must be saved or discarded. Checks re-read the exact selected IDs and application before dispatch; a changed revision, saved timestamp or step program requires another review. Runners whose role hides source retain run access: the engine checks their executable source without revealing it in the dialog.

Engine dispatch compiles each frozen JavaScript body without evaluating it before allocating eligible jobs. Missing or syntactically invalid bodies cannot be queued merely because the case summary says Ready. Runtime execution remains responsible for selector behavior, assertions, credentials, configuration and the target application's current state. Readiness is not a test outcome.

A failed remote start retains the already-created execution. Retry checks its durable status first and starts the same ID only if still queued; an already-started execution opens its evidence. Zero or partial engine handoff is shown as a recovery result, with the original run available to inspect. Batch build results retain every failed or unattempted case ID, including cases beyond the failure threshold. Retry reviews only unfinished targets and never regenerates successful cases. Returning from an open case to the catalog consumes the URL selection once, avoiding the previous close/reopen race. Draft sections now have an explicit Discard changes action.

Reproduce the focused checks after setup:

```sh
node --test services/automation/test/frontend/automationReadiness.test.mjs services/automation/test/backend/automationReadiness.test.js
npm run test:product-ux -- --filter automation
```

The browser checks exercise the actual page with mocked API responses: explicit selection, blocked empty plans, unsaved source preservation, a concurrent program change, remote-start recovery, exact unfinished build retries, guided creation, all four runtime editors/recorders, and narrow dark layouts. They do not substitute for live TestEngine, provider, device or application checks.
