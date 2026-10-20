# @hellotest/automation

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

Edit section and Edit instructions split JavaScript into complete statements or blocks, with selection, copy, paste, insert, reorder and delete controls. Loops, conditionals and multiline literals remain intact. Invalid drafts remain editable instead of being silently rewritten. Expanded Instructions and Gherkin present readable actions such as Click, Type and Press with repository field names and parameter references. Source retains the executable statements; Full source adds the complete Playwright wrapper and data bindings.

`backend/lib/automationBrowserAgent.js` owns the bounded LLM/browser conversation. `testengine/backend/src/lib/automationMcp.ts` provides a Playwright-powered MCP server at `/api/v1/automation/mcp`. This is HelloTest's restricted browser tool server, not a bundled copy of Microsoft's Playwright MCP package. In interactive actor mode the LLM chooses tools, MCP returns observed results, and the host compiles confirmed operations into executable Playwright source. Source-only generation retains the model-authored code path. Browser navigation, snapshots and locator checks run in isolated sessions. Click/fill/keyboard/select tools and non-read HTTP requests require the explicit interaction option, which may submit forms in the target application.

The configurable `automationBrowserAgent.actor` instruction selects the actor
protocol. `stage: "act"` proposals are independent of optional model source;
`section_complete: true` asks the host to compile/check/save the current section.
Only real current-section operations in a protected host ledger can contribute
source. A failed check cannot be cleared by a completion flag. Successful
submissions are reconciled on retries; intentional repeated actions use explicit
cumulative `occurrence` ordinals. Fresh control snapshots detect same-URL dialogs
and form transitions before another mutation. Configured test/suite inputs are
checked before opening the interactive browser; missing values remain named
dependencies. The [R&D record](../../docs/research/automation.md#automation-engineer-rd--16-october-2026)
describes the upstream review and recorded-source tests.

Private model inputs retain scoped references such as `@t.password`, resolved
inside the authorized tool wrapper. Display redaction placeholders cannot be
typed as credentials by mistake: validation stops them before MCP dispatch and
returns safe reference feedback for correction. Redundant navigation to the
already-ready current URL is skipped unless an explicit reload is requested;
failed navigation invalidates earlier snapshots and expected-result checks.

Observed link destinations retain browser base-URL semantics and must pass the
same origin and privacy checks before navigation. Truncated or credential-bearing
destinations cannot authorize a route. Public input literals can become reusable
parameter references only through the active authored action's exact binding;
retained-value checks additionally require an explicit expected-result binding
and that field's confirmed fill. Separately authored fixed expectations stay fixed.

Text assertions distinguish visible `innerText` from snapshot `textContent`.
Complete alert-only visible-text evidence can identify a message/container
mismatch before spending an assertion timeout. Correction preserves authored
clauses and literals; diagnostic IDs never become required outcomes implicitly.
The actor must choose its corrected check explicitly. Repeating an identical
unsupported proposal on unchanged evidence stops after one correction opportunity
without another browser check or semantic review.

One unchanged full-page refresh remains available for observation. Further
identical reads receive correction feedback and then stop; native checks/waits
and scoped inspection remain available. Verification recognizes the compiler's
exact polling assertions through full AST recompilation, including scoped keys
with spaces or escaped characters. Equivalent reference spellings retain the
same completed-action proof; literal input values remain exact.

Snapshot locators are grounded in the real captured node: Playwright supplies
accessible names, and candidates must resolve uniquely to that node. DOM label
decorations such as an `aria-hidden` required marker do not become role names.
Failed assertions or non-unique validations refresh evidence; repeated
unsuccessful checks on unchanged evidence are stopped before dispatch. Budget
failures retain the actual browser cause and permit only one completion-only
model turn with no further browser operations. Optional screenshots have a
separate bounded allowance. Build Error records merge the same operation across
durable history, events and outcomes while preserving distinct failed checks.

A build includes the manual steps and expected results, group/shared-group references, the repository, selected environment/configuration/data, knowledge and accessible linked/related story titles, descriptions and acceptance criteria. Story evidence is checked against both permission and feature availability. Browser and linked manual builds request one current section at a time, preserving manual order and preceding automation-only setup. Each section has at most three correction attempts within the shared case deadline and browser-tool budget. A validated section commits to Plan immediately; the case stays incomplete until every section, manual coverage mapping and final output constraint validates. Later dependency or provider failures preserve committed sections. Every save rechecks the case, manual links, source steps, parameters and reviewed Start URL under database locks. Changes made during generation cause a conflict instead of being overwritten. Generated code on a shared-group instance does not publish changes to the shared definition. Review and execute the result before approving it.

### Case intent, data and missing steps

The interactive actor receives a bounded journey containing the case intent, current
section, nearby sections and the status of preceding work. Full authorized section
text is available by exact ID within the existing context-disclosure allowance.
Earlier saved source is distinguished from browser work confirmed in this build.

A missing UI prerequisite can be proposed as one observed same-origin link, tab or
explicit non-submit disclosure. A separate bounded review checks the complete case
intent and authored order before dispatch. Approval is tied to the current native
snapshot and target; normal access, origin, data, actionability, deadline and tool
budgets still apply. This can fill an omitted navigation step. It cannot invent test
data, submit an extra business operation, execute a later authored step early or
change the expected result. Every recorded interaction must be accounted for by
the final semantic review. Unsupported or inaccurate flows stop with a specific
prerequisite or expected-result issue while retaining earlier saved sections.

Case parameter discovery uses actual references and supported JavaScript syntax;
unrelated suite defaults, imports and string literals do not become case inputs.
Manual-to-automation creation flushes parameter edits and dataset choices first.
Explicit overrides, including blanks, retain their precedence and remain editable
in automation. Without an effective linked dataset, Test Data provides a separate
collapsible Test Params panel; a linked dataset includes that panel once.

### Objects saved with generated instructions

Each browser-confirmed section stages a protected manifest of the observed targets
actually used by its compiled instructions. After the Plan source commits, those
bindings synchronize idempotently into the existing object repository. Permission
or storage issues leave an explicit pending receipt; they do not replay completed
browser actions or erase the saved section. Curated repository locators are retained.
Exact source and route context determine whether an inline instruction may display
a generated repository binding; an edited source does not inherit old evidence.

Canonical compiler polling remains a native **Poll until condition** instruction.
Existing arbitrary callbacks display as **Run custom code poll** and require source
review. This label does not grant the browser actor an arbitrary-code tool or add a
second polling runtime.

Engineer activity retains earlier builds in scoped, paginated history. Section and linked manual-step progress distinguishes queued work, confirmed browser actions, expected-result checks, validated instructions, saved Plan instructions and work needing attention. Validation or a coverage mapping is generation accounting, never a passing execution receipt. Unchanged source steps are matched by their complete action/expected-result pair and runtime; unmatched linked steps require explicit model coverage mappings within the bounded completion loop. Missing coverage prevents the case becoming ready. Prepared automation IDs are registered with the activity before completion so partial builds remain discoverable from the automation case.

The restricted Playwright MCP server supplies accessible browser evidence and an optional bounded viewport screenshot. Screenshot capture or storage failure continues with text evidence and does not restart browser interactions or consume a completion attempt. Image bytes remain in a protected transaction artifact, outside model text transcripts and activity logs; previews require the same scoped automation permissions as the activity. Browser observation and generated instructions remain unverified until a separate TestEngine execution returns its result.

Build tools offer an explicit **After generating** choice: save only, run the saved web test in fresh Chromium, or run with one bounded locator repair. Native and Playwright Test CLI verification are available; both use the same closed program interpreter and frozen inputs. Browser authoring uses Playwright MCP. The CLI lane runs the pinned Playwright Test runner, rather than accepting shell commands from the model or adding a second browser-authoring transport. Verification requires local execution and run creation permissions and repeats application actions with the same frozen inputs. Only a failed interactive locator lookup before any completed interaction can trigger automatic repair. Assertion locators, predicates, values and navigation remain byte-identical; a repaired action must pass those original oracles before saving. The separate Verification tab records the tested source fingerprint and execution driver. Unsupported programs and unknown outcomes remain unverified. See [the architecture decision](../../docs/research/automation-engineer-agent.md#integrated-verification-and-bounded-repair--17-october-2026).

Prompt-only cases first enter a dedicated manual-flow planning phase. Its mutually exclusive plan and read-only inspection contracts omit executable-source instructions. A host-validated planning contract requires every authored parameter reference to stay symbolic, including public and empty inputs; privacy-filtered values are supplied separately. Literal values or equal-valued references from another scope cannot discharge that contract. The generator receives the host-selected active section, compact observed targets and an explicit decision contract. Positive element checks and interactions require a current host-validated target; guessed locators receive feedback before MCP dispatch, with repeated unchanged proposals stopped. Fresh host snapshots are registered before the next operation in the same batch; only confirmed MCP operations become source. Rebuilds retain existing assertions through a host-issued closed-source contract. Missing terminal checks can run deterministically after the original action sequence is confirmed; earlier checkpoints keep their original order, and unavailable source requires review. These checks share existing budgets and cannot replay actions. Independent outcome review precedes saving. Native validity alone cannot satisfy an explicit requirement for no field errors. A passing verification receipt must account for every operation and assertion. The healer cannot alter data or expected outcomes, and cannot replay completed interactions. Its privacy-filtered diagnostic snapshot is capped at 16,000 characters, marks omitted targets, and resolves only the opaque references actually shown; unavailable target evidence blocks repair without a model call.

Stock phase instructions are compacted without changing custom AI Controls instructions. Prior-section successful checks become historical summaries while full host receipts are retained. Provider-rejected HTTP 429 requests with a short explicit reset may retry twice within the original model deadline while retaining the browser session. The longest valid provider wait applies, with up to one second of safety inside the existing 60-second cap; unrelated unexhausted resource resets are ignored. Cancellation stops the wait. Authentication, exhausted quota and requests larger than the provider limit fail without retry; a capacity failure after a confirmed interaction cannot automatically requeue the whole case. Closed automation contracts never use generic context truncation to recover from a provider size error. Model choice remains explicit, with no silent fallback to a larger model.

An HTTP 200 model response can still be an incomplete build. Comments such as “check the inbox manually” do not implement a section. When a real mailbox, external source or required parameter is unavailable, generation can return structured `blocked_steps` with the affected section and the needed context. Activity reports the dependency and retains completed Plan sections with incomplete case status. Provide the authorized inbox URL/API and access references before rebuilding; an OTP value alone does not prove email delivery or inbox inspection. Newly generated cross-origin navigation must have supplied or observed URL evidence, so the model cannot substitute an invented mailbox URL. Private verification-code values remain parameter references in model context. Read-only browser inspection respects the user's interaction selection and never establishes an execution pass.

Saved-check order hints help the generator avoid redundant terminal checks during rebuilds. They require privacy projection, retain symbolic bindings, omit literal expected values, and fit within 2,000 bytes. They never establish current locator authority or a passing check; host verification still requires actual receipts in the original order.

**Perform steps in browser** is the visible default for a new Engineer build.
Explicitly choosing **Generate source only** keeps browser interaction disabled.
In interactive mode, a code-only response cannot complete the current section:
the host requires actual MCP action receipts and a satisfied `browser_assert`
after the last action for its expected result. The typed assertion tool supports
visibility, text, input values, checked/enabled states, counts, URL and title.
A later failed check invalidates earlier successful checks for that section;
changing code alone cannot clear it. A corrected real check must succeed after
the failure before generation can advance.
Assertions resolve authorized private parameter references inside the wrapper;
receipts omit expected and actual values. Accessibility locators and retrying
assertions follow the [Playwright actionability model](https://playwright.dev/docs/actionability).
Provider errors after actions do not automatically requeue the whole case and
repeat a submission. Confirmed invalid MCP arguments are safe correction feedback;
an unknown action outcome stops the session.

Browser startup has a separate recovery path: only a confirmed startup failure
with `action_outcome: not_attempted` and `retry_safe: true` receives one immediate
retry, before model generation. Exhausting that retry reports a browser setup
failure and does not multiply retries through the job queue. Application load,
authorization and unknown-outcome failures do not use this recovery. Worker
containers use an init process to reap exited Chromium children. Launch diagnostics
retain both the summary and fatal tail within the existing error-size limit.
Interaction tools wait up to ten seconds, within their tool deadline, for an
absent element to attach before checking uniqueness and native actionability.
Ambiguous locators still fail immediately. A timeout before dispatch remains
`not_attempted`; it never becomes a completed click or submission.

The agent loop also stops the rest of a model's tool batch after a failed input
or check. An observed URL change pauses queued mutations until a fresh page
snapshot is available; read-only snapshots and expected-result checks can finish
in the same batch. A confirmed same-page reload keeps semantic locators usable.
When a corrected linear source repeats an exact action already completed in the
current section, host-only request stamps reconcile its original receipt without
another browser call. Changed targets/values, additional action instances,
navigation resets and unsupported control flow still require real execution.
A failed expected-result check must be followed by a successful real check before
the section can be saved. Code-only revisions cannot clear that failure.
Supported linear programs also compare the exact targets, values and action order
against host-stamped execution receipts; matching only a tool's action count is
insufficient. Dynamic or unsupported source remains subject to the existing
program validator and interactive evidence checks without receipt reconciliation.
Candidate programs pass the shared syntax/runtime validator before their tools
are dispatched. For example, `page.locator('getByLabel(...)')` receives a specific
source correction instead of repeating a fill while waiting for the save-time
validator. Native Playwright expressions use `page.getByLabel(...)` directly.
A code-only model reply is not left waiting for the model to repeat itself in
tool-call syntax. A bounded AST adapter lowers supported complete linear web
programs into typed MCP actions and all supported assertions. It never evaluates
model JavaScript. The same catalog, permissions, parameter resolver, origin
checks, action receipts, deadlines and save gate apply. Unsupported code still
needs explicit valid tool requests. Native text-content and normalized-title
checks use dedicated MCP assertion modes so the build and TestEngine compare the
same conditions; a runner that lacks those modes reports an update requirement.
Context compression preserves the latest accessible
snapshot and typed locator candidates even when screenshots or validation feedback
follow it. The model receives the current page and the current section's confirmed
actions/checks separately; replaced DOM snapshots become historical receipts.
Discovery includes bounded visible headings, status text, table semantics and
text-bearing stable IDs so expected results can be checked as well as inputs.
These boundaries follow the observe/action/re-evaluate pattern reviewed
in [browser-use's agent loop](https://github.com/browser-use/browser-use/blob/ccd22fef47a1a36e0c4596fef5db73a5117b9d06/browser_use/agent/service.py);
HelloTest retains its existing permission checks, MCP tools and Plan persistence.

High-level manual actions describe goals rather than a fixed number of browser
commands. The configured `automationBrowserAgent.sectionIntent` guidance lets the
agent inspect and perform necessary observed intermediate navigation inside the
same section, then synthesize its complete source. The reviewed Start URL is an
entry point, not proof that the requested destination screen is open. Source
validation failures join the prominent current failure state and the bounded
previous draft; repeated invalid drafts request an inspect/action phase before
another source proposal. Explicit and source-derived requests share the same
12-request batch ceiling and unchanged per-section total budget. Oversized
batches receive correction feedback without executing any of their requests.
Saved source must retain executable expected-result assertions; checks used only
during development do not verify later TestEngine runs.
Host-confirmed navigation prerequisites must also remain in that source. This
includes control transitions on the same URL, detected from actual accessible
control snapshots. A source correction cannot silently omit the Sign up click
that made the form available in the development browser. Startup navigation is
distinct from these section prerequisites, and successful actions are reconciled
without replay. Synchronous string equality checks of awaited `inputValue()`
reads use the typed value assertion; numeric coercion and different matcher
semantics are rejected rather than approximated.

An empty automation case can start from an Agent brief or case description. The
configured `automationFlowPlanning.instructions` block plans manual actions and
expected results from the brief, Story/context evidence and read-only browser
inspection. Draft manual sections save atomically against the original case,
linked-source and parameter baselines. Their executable instructions then follow
the same sequential execution and Plan-save pipeline. Planning traces retain the
separate `flow_plan` scope and do not masquerade as section generation or a run.

Build tools show a full-width Automation Engineer workspace for each build. The
agent brief stays above it. The current step shows its action, expected result
and authorized resolved test data. Future rows show anonymous wave placeholders
with reduced-motion support. A `performed_generated_saved` frontier advances only
after the current section's actual browser checks, validated code and durable
Plan-save receipt; a preview alone cannot unlock another step. Generation follows it
into view. Earlier steps remain available for review; selecting the current
active row resumes following. Cases without a linked manual case use their saved
sections.

The selected step has **Browser activity** and **Build Error** tabs beside
Instructions, Source and model payloads. Browser activity contains its interaction
mode, confirmed action/check outcomes and observed page title. Activity for a
different step is not attributed to the selected step. Typed failures persist
with their section, are marked
resolved after a successful save, and do not mark future queued work as failed.
Case-wide setup failures remain separate when no section can be identified.
Resolved data labels come from the immutable build snapshot; missing values,
private values and generators deferred until build are identified explicitly.

Linked builds send only the current section as the requested output, with the
complete resolved manual specification retained as background context. A draft
returned with browser tool requests is published only after those current actions
finish and optional post-action evidence is captured. A failed or uncertain action
cannot silently advance the step or be replayed as a generation retry. The same
validator checks each section before saving and the complete case before marking it ready.
AI Controls owns the existing configurable completion and browser-response
instructions; published custom instructions remain authoritative.

The interactive goal-review contract distinguishes manual expected-result prose
from exact rendered text. It asks the actor to inspect visible validation alerts
and current targets before choosing an outcome check. A grounded `section_issue`
can stop an unmet prerequisite or conflicting expected result for review, without
changing the manual plan or saving an unsupported assertion. Two failed checks
with the same mode and target on unchanged state exhaust that check's allowance,
including attempts that merely rewrite its expected text. One recovery-feedback
opportunity remains; repeating the rejected check stops with
`AUTOMATION_BROWSER_CHECK_STALLED` before additional browser/model calls. Actual
page changes, corrected targets and completed actions remain eligible for checks.
Transition-capable actions refresh the page before dependent locator checks, and
the host compiles only confirmed actions and satisfied assertions.

Interactive builds review every active section and linked manual obligation
against the protected browser operation ledger before preview/save. A successful
check of an unrelated heading cannot establish the requested business result.
`automationSemanticReview` validates exact obligation identities, supported action
and assertion indexes and their order. Its assessment of meaning remains model
assisted; a separate TestEngine run establishes execution pass/fail. At most two
distinct reviews share the section's combined model/deadline budget, and unchanged
rejected evidence stops without another review or repeated action. Invalid or
unavailable review cannot save the unfinished section.

Saving also preserves existing Plan assertions. Input-value assertions may use an
exact reviewed parameter in place of its equivalent frozen literal; different
bindings, matcher changes and business-result constants remain distinct. If Plan
validation rejects recorded source, repeating the same completion stops with
`AUTOMATION_RECORDED_SECTION_VALIDATION_STALLED` before another review or save.
The original validation cause remains visible when the section allowance ends.

Manual coverage validates before writes; accepted source cannot be changed by
later completion responses. Exact manual mappings that contradict Plan order fail
before browser work. Coverage-only and final metadata repair retain instructions
without reopening the browser, and final schema repair has its own bounded
allowance. Every supported builder profile has the managed phase contracts;
review and metadata calls have distinct trace scopes. Redaction cannot turn a
validated executable selector or native option value into a different executable
value.

The actor receives each complete current requirement once, with obligation IDs
joining the active section, manual sources and execution contract. An exact
host-side comparison falls back to the full contract if this projection differs.
`automationActorContext` retains the full authorized task
snapshot and serves bounded exact context requests on existing model turns;
requests pause accompanying browser actions. Fixed data stays available through
scoped references. Activity reports selected/original task sizes as characters,
without estimating provider tokens. Goals above 48,000 UTF-8 bytes fail before
the actor or browser acts; expected-result clauses are never truncated.

Validated test-ID contracts are preferred over changing accessible names when
binding current browser references. The backend build download and UI export
share a standalone Playwright Test emitter, including fixtures, parameters,
repository bindings and executable API steps. Version-bound generation manifests
let preview reads distinguish current source/specification assessments from
historical evidence after Plan edits. These mechanisms do not turn development
review into a passing test run.

The right panel pairs Instructions/Source with actual browser evidence. Observation
artifacts identify their active section/manual step; an observation from another
step or a legacy generation phase is labeled accordingly. Screenshots are optional
evidence, not a video stream. Accessibility evidence remains useful when an image
cannot be captured. Neither a generated draft nor an observation is a passing run.

History and section progress remain available. Select **Model request** or
**Model response** beside Instructions and Source to inspect the model call that
produced a selected draft. Sequential calls identify the section attempt and its
correction number; legacy calls retain their complete-case scope. The pane
requires existing trace access.
Retry unfinished cases appears in the workspace header, and missing context is a
collapsed disclosure. Detailed events remain retained on the server for diagnosis.
Refreshing restores the saved activity and its
immutable preview artifacts; older activities without retained source previews
cannot reconstruct those drafts. Source previews and browser evidence require
current project membership and all automation build, view, source-view and AI
permissions, including generic artifact downloads. Durable jobs remain internal
execution infrastructure; these activities do not duplicate entries in Batch
processes. Generated code is explicitly unverified until it is executed. Retry
targets include unfinished cases only.

Linked manual-case parameter values are live defaults for automation. The primary
manual case wins conflicting defaults; explicit automation overrides, including
empty strings, take precedence. Editing an inherited value saves an automation
override; resetting removes it so future source edits flow through. The API keeps
`parameter_values` as authored overrides and returns inherited/effective values
separately only with test-data access. Engineer/Repair context, new run snapshots
and Full source use the effective values; existing frozen runs retain their data.
Each build materializes effective parameters once, including random generators
and aliases, using the selected test-data layers and permissions. Public values
replace tokens in model context, manual actions, expected results and the step
workspace. The same frozen map supplies browser inputs and assertions. The first
completed section saves public generated case values as versioned automation
defaults in the same transaction as its instructions. Later saves reuse those
values without creating another random value or duplicate data history. A failed
transaction saves neither its section nor new defaults; earlier committed sections
remain available. Source manual templates stay unchanged, and static inherited
defaults stay live.
Private values retain parameter references and are bound inside the trusted tool
wrapper; nonempty private values are excluded from public defaults and display
artifacts. Build Tools reviews unset inputs before queueing a build. Leave them
blank to use real empty strings for one case, or enter automation overrides.
**Review data & build** also opens the dialog for configured public inputs.
Configured private bindings and generators stay protected. Legacy `@name` uses
an existing run binding, otherwise its inherited `t.name`; explicit scopes stay
exact. The host records that choice as a scoped reference for replay.

The parameter plan uses the same authorized source resolution as generation.
Its opaque receipt detects changes to the manual specification, linked data or
selected resources before browser work and at save. Accepted sections save
reviewed edits and missing-input empty defaults atomically as case overrides;
inherited defaults stay live. Reviewed override names in
`test_data_options.parameter_overrides` preserve their priority over selected
default sources during runs and exports. Explicit run inputs and captures retain
their existing precedence and shared-step protection still applies.
Name-only `private_parameter_names` metadata preserves private classification
when a reviewed value outlives its original source. Linked private defaults and
aliases remain excluded from public previews and standalone defaults.

An automation case without its own data-set mapping inherits the primary linked
manual mapping for build, new-run snapshots, parameter review and export. Its
own mapping always wins, and an invalid selected mapping fails visibly. Existing
run snapshots retain their frozen case layer. An empty input does not relax the
manual expected result or invent a passing outcome.

Resolved step labels are retained in a protected, immutable build-data artifact;
activity metadata carries only its ID. Reading it requires the existing source
permissions plus `data.view`, including generic artifact downloads. The workspace
hides cached values when access changes and falls back to authored references if
the optional artifact is unavailable. It does not regenerate random data while
rendering or refreshing an activity.

Creating automation from a manual case's Automation Cases tab waits for pending
Test Params edits to save before opening the creation dialog. That save uses the
manual revision and leaves unrelated drafts untouched. A failed save keeps the
manual case open. The creation URL is consumed once, so a successful creation or
cancellation cannot reopen the dialog while navigation settles.

Completion feedback includes the names of bound, authorized runtime parameters.
A parameter-only missing-context report that contradicts those bindings is
corrected within the existing completion budget. Authored unset inputs are bound
to empty strings; unknown model-invented references and actual mailbox or other
source dependencies remain gaps. Supplying a code does not
establish that an inbox was checked.

Source presents collapsible named sections with region markers and their saved
programs; API Source displays the authoritative request as JSON. Full source generates
a standalone Playwright TypeScript `.spec.ts` with imports, its own test wrapper,
repository bridge, resolved case/suite/data-set values and environment references
for sensitive values. Each section identifies its saved source. The export applies
the selected action, navigation and assertion timeouts and capture settings, and
attaches compressed JPEG screenshots through Playwright's reporter. Known imports/wrappers are normalized;
required custom helper files and packages are listed explicitly. App-only imports,
unsupported hooks and native mobile programs produce clear export diagnostics.
The generated setup comments describe the required npm packages and run command.

Each section's browser loop permits eight model turns and defaults to twelve tool
calls. The case budget scales with its web sections, capped at 400 calls, rather
than sharing ten calls across an entire case. `AUTOMATION_BUILDER_BROWSER_CALLS_PER_SECTION`
sets a bounded 6–30 call allowance. The case deadline scales from four minutes by
section count, capped at thirty minutes; `AUTOMATION_BUILDER_CASE_TIMEOUT_MS`
can set that bounded deadline. Individual provider, tool and section deadlines
still apply. Sessions expire after five idle minutes, refreshed by requests.
TestEngine admits at most two MCP browser sessions per process. The existing
TestEngine shared secret protects every request. Remote inspection retains its
egress/private-network policy and selected-origin boundary. Private targets need
an exact `RECORDER_ALLOWED_PRIVATE_HOSTS` entry. The standard image includes
Chromium; native development can set `PLAYWRIGHT_EXECUTABLE_PATH`.

Browser automation creation, Engineer generation and retries require a valid
HTTP(S) Start URL. The reviewed URL is stored with the automation case through
normal revision history; generation uses an explicitly supplied URL or that saved
value, preserving its path and query. It never chooses an Engineer target from an
environment, existing script, repository example or reference link. API and native
mobile cases remain exempt; mixed cases containing web steps require a URL.
Queued builds freeze the reviewed target for each case. A later target edit stops
the job with a conflict, preserving the newer URL and existing instructions.
Legacy browser jobs without a captured
target must be resubmitted with a URL. The activity records the entry source.

Web repository context is restricted to screens from the selected target origin.
Unrelated application-wide recordings and unlocated web screens are excluded.
Retrieved links and parameter values do not grant permission to navigate to other
origins; additional user-supplied navigation context and actual browser redirects
are handled separately. This prevents a saved signup example from changing the
application being automated.

MCP navigation waits for the document load event, usable page content, loading
indicators to clear and a stable rendered interface before returning evidence.
The bounded readiness check allows background polling once the interface settles;
it does not depend on a permanently idle network. Failed navigation or unfinished
loading blocks follow-up browser actions. Post-action readiness failures retain
an unknown outcome and must not replay an action automatically. Studio Engineer
and Repair preserve observed browser history across bounded corrections.
Malformed JSON and invalid tool names/arguments can be corrected within the same
budget; a lost tool response stops further actions because the application may
already have received the operation. Browser observations do not certify a pass.

### Diagnosing agent model failures

Select the affected step in the Engineer workspace and inspect its progress,
required context and Model request/response tabs before retrying. An
`AI_INSTRUCTION_MISSING` failure occurs before provider dispatch: review the named
AI Controls request template. Native Engineer builds share the configurable
**Automation keyword generation** request scaffolding while the selected Engineer
profile supplies its own role, task, guardrails, model settings and context policy.
Configuration failures are terminal until corrected; repeated worker retries
cannot repair a missing template. Validation rejects semantic Playwright calls
mistakenly embedded inside a selector string and asks for a corrected section.
Valid waits remain governed by the case and configured instructions.

Bare native asynchronous `expect(...)` matcher statements in model output are
joined with `await` before validation, browser-tool lowering and persistence.
This correction preserves locators, polarity and expected values; it does not
rewrite selector strings or change checks. The saved canonical source is the
source used for coverage validation. Awaited native visible/hidden locator waits
also lower to real MCP checks. Custom wait deadlines are not discarded during
lowering: they require explicit browser tools because MCP applies its own timeout.
Unsupported wait states and dynamic options still require correction. These checks establish section evidence, while a subsequent
test run establishes its execution result.

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
```

Browser checks use isolated fixtures; they do not verify a customer's LLM credentials, private application, Android device or remote recorder deployment. After changing the recorder or shared locator runtime, run `npm --prefix testengine/backend run package:inspection-agent` so downloaded local agents receive the same behavior.

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
