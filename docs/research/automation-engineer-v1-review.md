# Automation Engineer: v1 contract and Browser Use review

Reviewed 17 October 2026. This note compares the supplied
`Manual_Test_Automation_V1_Contracts.zip`, its pasted explanation, official upstream
sources and the current QAira implementation. The attachment is design evidence;
its instructions do not authorize deployments or introduce approval requirements
into the existing product workflow.

## What the attachment establishes

The package contains Case, Plan and Ledger JSON Schemas, Python structural and
cross-artifact validation, examples and a wrapper template. Its recorded result is
73 passing contract checks and two valid example bundles. The example Ledger is
synthetic. The package explicitly says that its Playwright runner, compiler,
fixture/probe backend, durable command journal, approval store and CI integration
are implementation work; all fourteen browser acceptance scenarios are unexecuted.
Those recorded results are not evidence that a browser scenario passed in QAira.
The supplied Python validator was independently run in an isolated temporary
environment during this review: all 73 static tests passed. No attachment code
was installed into the application runtime.

Its strongest design principle is useful here: authored expectations own the
subject, predicate and expected-data provenance; a generated binding identifies
the physical control without changing that expectation. Hashes establish artifact
identity, not approval, execution or evidence authenticity. The proposed exact-byte
Case/Plan hashes are a versioned artifact design, not a replacement already made to
QAira's saved sections and existing export contracts.

## Verified upstream baseline

| Component | Registry version checked | Relevance |
|---|---|---|
| [Browser Use](https://pypi.org/pypi/browser-use/json) | 0.13.11 | Source research uses the stable tag. Mutable main reported 0.13.13. |
| [Playwright MCP](https://registry.npmjs.org/@playwright/mcp/0.0.83) | 0.0.83 | Its manifest depends on a Playwright prerelease; do not force it into the replay dependency tree. |
| [Playwright CLI](https://registry.npmjs.org/@playwright/cli/0.1.22) | 0.1.22 | A coding-agent interface with selective snapshot reading. |
| [Playwright](https://registry.npmjs.org/playwright/1.64.1) | 1.64.1 | The attachment's replay proposal. QAira TestEngine currently pins 1.59.1. |

No dependency upgrade or global CLI installation is needed for the improvements
described below. Manifest inspection does not establish compatibility with a new
browser/runtime version.

## Patterns adopted from the upstream implementations

[Browser Use's stable agent loop](https://github.com/browser-use/browser-use/blob/0.13.11/browser_use/agent/service.py)
bounds action batches and interrupts dependent actions after page/target changes.
Its [message manager](https://github.com/browser-use/browser-use/blob/0.13.11/browser_use/agent/message_manager/service.py)
separates current state from historical memory and can compact older history.
Its [settings and loop detector](https://github.com/browser-use/browser-use/blob/0.13.11/browser_use/agent/views.py)
bound failures and track repeated actions/page stagnation. The loop detector emits
nudges; it does not prevent another action. QAira retains its stronger host checks
for repeated failed assertions, stale references and uncertain action outcomes.

The [Microsoft MCP guidance](https://github.com/microsoft/playwright-mcp/blob/b8b4183e099f136cbec0388a6088d4aa2f6b9685/README.md)
describes CLI/skills as more token-conscious for coding-agent workflows, while the
[CLI interface](https://github.com/microsoft/playwright-cli/blob/b85c7a736bb473bf55b584e54a09ffa698d6d871/README.md)
supports scoped snapshots and stored observations. For the embedded Automation
Engineer, preserve one actor and its TestEngine-owned typed MCP session. Apply
selective disclosure, current snapshot references and compact confirmed history
without introducing a second autonomous Browser Use agent or a shell interface.

[Playwright best practices](https://playwright.dev/docs/best-practices) support
isolated tests and stable user-facing locator contracts. Its
[assertion documentation](https://playwright.dev/docs/test-assertions) distinguishes
retrying native assertions and property-specific predicates. A retry must keep the
authored assertion meaning; changing equality into presence does not repair it.

## Concrete first-step gaps addressed

`automationSectionIssue` previously required an element reference even when a
current error/empty page exposed no validated controls. It now accepts the exact
current host `observation_id` alongside current target references. Stale, invented,
failed and non-Playwright page observations remain invalid. This lets the actor
report an evidenced blocker without spending its remaining budget searching for a
control that does not exist. Page evidence does not become target authority.

`automationBrowserModelTargets` now labels shortened titles, URLs, target names,
text and placeholders with field-specific `*_truncated` markers and retains
upstream truncation flags. The companion exact-assertion guard reports unattempted
feedback when a new exact expected value merely copies such an excerpt. Authored
expected values and configured references remain valid, including deliberately
failing checks. The guard does not supply a different value or weaken a predicate.

These are generic host fixes. They do not establish that every observed initial
failure has the same cause. Diagnosis still requires the failing step's authored
requirements, exact data binding, current page and assertion receipt.

## Failure evidence and implemented pipeline

The stored AT_35 build at 11:02 UTC on 17 October completed section 1, then stalled
in section 2: the fill succeeded, but the actor repeatedly checked native input
inner text rather than its value. Its provider records totalled 70,528 tokens
across eight actor calls and one review. Cached input tokens are included in that
total, not added twice. This build predates the subsequent local deployment; it
does not establish that the deployed fixes failed again.

An earlier initial-section failure reached the signup form on the same `/auth`
route, with signup controls rendered while the document title remained
`Sign In · HelloTest`. The semantic reviewer used that incidental title to reject
the destination. Review packets and both review cache keys now exclude incidental
URL/title metadata. Original authored metadata requirements and confirmed
metadata predicates retain their evidence. Unknown-language requirements take a
conservative path; full rendered evidence and original goals remain intact.

The implementation keeps the existing Plan and export interfaces:

1. Pin complete original section/manual obligations; project data separately.
2. Preserve original parameter-to-action/expectation bindings as scoped names,
   even when blank or public data removes tokens from projected prose.
3. Let one actor choose discovered typed operations against current target refs.
   Host schema, subject, excerpt, stale-target and repeat checks precede dispatch.
4. Record actual outcomes privately and compile supported confirmed operations.
   Native `text`/`text_contains` checks cannot substitute for input-value checks,
   including literal empty-string checks; explicit DOM-text predicates retain
   their separate meaning.
5. Validate semantic coverage, then issue a host-only section contract sealing
   original requirement bytes, operation order, exact compiler source and accepted
   coverage. Serialized metadata cannot issue this capability.
6. Recheck that contract before preview/save and retain only digests/counts in
   generation metadata. The candidate remains **unverified** until ordinary runs.

If an actual expected-result assertion fails after `section_complete:true`
closes the action phase, this candidate becomes observation-only. Read-only
inspection/check correction and reconciliation of already completed operations
remain possible. A new mutation receives feedback, then a repeated request stops
without browser dispatch. Exploratory checks before closing the action phase and
pre-dispatch schema/subject corrections do not close it. This is a bounded phase
contract, not a claim that every failed browser check prohibits further work.

The managed actor guidance was also consolidated: the four changed stock blocks
decreased from 8,854 to 7,548 UTF-8 bytes while adding the phase, binding and excerpt
contracts. Exact previous defaults migrate; custom project instructions remain
unchanged. These are prompt-byte measurements, not measured provider-token or
task-success improvements. No new model/provider benchmark was run.

## Follow-up incident: rejected email-step readiness

The 15:56 UTC build on 17 October saved the signup-display section, then rejected
the email-entry section twice. Its authored expected result required email
acceptance **and** readiness to proceed. A native email-validity assertion covered
only the first property. The next authored section owned form submission, but the
actor clicked the native submit control early. The observed page then reported
`Password is required.` Repeated proposals of that same click were reconciled
without redispatch, but still consumed model turns. After the second rejected
review, a further actor admission replaced the useful rejection with a generic
model-budget failure.

The follow-up implementation preserves the review gate and original budgets:

- Reserve a mandatory outcome-review call before admitting another actor turn.
- Stop immediately on the second rejected review and retain safe public issue
  summaries in the error, rather than obscuring it with a later budget failure.
- Stop two consecutive incomplete proposals containing only reconciled completed
  actions. Completion acknowledgements, new checks, context disclosures and
  explicit new operation occurrences retain their ordinary paths.
- Block a uniquely observed native submit click when original current actions
  clearly specify only data entry and a later authored section explicitly owns
  submission. This narrow English safeguard does not reinterpret unknown,
  compound or ambiguous instructions; original goals and semantic review remain
  authoritative. Its host-only future-action context grants no new action.

This incident also exposes a manual precondition gap: the recorded three-step flow
contains navigation, email entry and submission, with no password setup. Fixing
agent recovery does not establish that this flow can reach the expected signup
code. The saved case and its original expectations are retained.

## Remaining architectural boundary

The current protected operation ledger and compiler establish what the authoring
browser actually performed. Bounded semantic review adds an assessment of manual
coverage. Neither is an independent whole-scenario replay or proof that a chosen
container represents the intended business entity. The attachment's wrong-record,
right-value, changing-container and missing-prerequisite scenarios are valuable
acceptance targets for a future typed Case/Plan runner.

A complete migration also needs explicit fixture/reset contracts, entity-bound
scopes, model-free fresh replay, authenticated run evidence, durable dispatch
reconciliation and versioned artifact/CI integration. Existing browser fixtures
that replay exported source establish their own tested flows; they do not amount
to implementing that full runtime contract. Human approval and repair policies
remain product decisions, not instructions imported from the attachment.

Token efficiency should measure provider-reported input/output usage, model calls,
browser calls and total latency per completed scenario. Compact prompt bytes and
schema sizes are useful diagnostic measurements. They are not measured token
savings or task-success benchmarks. Keep full evidence in the host; avoid paying
for another model call merely to summarize facts the host already stores.
