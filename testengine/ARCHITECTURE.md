# HelloTest Test Engine Architecture

See also: [HelloTest product operating model](../docs/HELLOTEST_PRODUCT_OPERATING_MODEL.md)
See also: [HelloTest background operations strategy](../docs/HELLOTEST_BACKGROUND_OPERATIONS_STRATEGY.md)

## Control Plane

HelloTest stays the single frontend. Users should start and inspect runs from HelloTest only.

That means:

- no separate Playwright frontend
- no separate operator dashboard outside HelloTest
- no second source of truth for results or evidence

Test Engine exists only as a remote execution backend that HelloTest calls.

## Run Flow

### 1. Run start in HelloTest

When a user starts an automated case from the existing HelloTest run flow:

1. HelloTest creates or reuses the run with `POST /executions`
2. HelloTest marks it active with `POST /executions/:id/start`
3. HelloTest reads the snapped run payload from `GET /executions/:id`
4. HelloTest fans out only the automated cases to Test Engine

The UI label can stay `Runs` while the backend API remains `/executions`.

### 2. Handoff to Test Engine

HelloTest should send one automated case at a time to `POST /api/v1/runs`.

That handoff should include:

- HelloTest run id and execution id
- project and app type
- test case snapshot
- execution step snapshots
- environment snapshot
- configuration snapshot
- data snapshot
- suite and case parameter values
- attached Playwright script if one already exists
- manual handover spec derived from the test case and steps
- callback target and signing secret

One-case-per-engine-run is the simplest and most scalable shape because:

- retries stay isolated
- artifacts stay isolated
- self-healing stays isolated
- case results can stream back independently

### 3. Deterministic execution first

Execution order should be:

1. use attached Playwright script if present
2. otherwise generate a Playwright spec from the manual handover
3. run deterministically
4. only on failure, enter assisted repair

This keeps cost and nondeterminism low.

## How Test Engine Updates HelloTest

HelloTest already has the primitives needed for first-pass integration.

### Case result writeback

Test Engine should callback into a HelloTest route that internally uses the existing execution services to:

- create the case result with `POST /execution-results` if none exists
- update the same result with `PUT /execution-results/:id` on progress or completion
- complete the run with `POST /executions/:id/complete` after the final case settles

### Step evidence writeback

HelloTest already uses this structured payload inside `execution_results.logs`:

```json
{
  "stepStatuses": {
    "step-id-1": "passed",
    "step-id-2": "failed"
  },
  "stepNotes": {
    "step-id-2": "Popup blocked the primary button."
  },
  "stepEvidence": {
    "step-id-2": {
      "dataUrl": "data:image/png;base64,...",
      "fileName": "step-2-failure.png",
      "mimeType": "image/png"
    }
  }
}
```

That should be the compatibility target for the first engine rollout.

Recommended policy:

- inline only one preview image per relevant step
- keep inline images small
- store larger artifacts outside HelloTest and return them as artifact references

## Artifact Model

Test Engine should always capture a full artifact bundle for failures:

- Playwright trace
- screenshot series
- console log
- network HAR
- DOM snapshot
- generated script version
- locator map version
- repair summary

HelloTest should initially store:

- inline step preview image when needed for fast review
- case status and duration
- result summary in logs
- artifact manifest references for deep debugging

HelloTest should later add a dedicated artifact table when traces, HARs, and videos need first-class browsing.

## Intelligent Automation Layer

The smart automation agent inside this system should not be the runner itself. It should be a focused intelligence layer that supports the runner.

Recommended name: `HelloTest Pilot`

`HelloTest Pilot` has four responsibilities:

- build Playwright code from HelloTest’s manual case model
- build API execution chains from structured API steps
- repair only constrained automation failures
- propose patches back to HelloTest for review

### Internal sub-agents

`Web Pilot`

- converts web steps into Playwright actions
- prefers semantic locators, roles, labels, and stable attributes
- keeps a locator memory file per case version

`API Pilot`

- converts structured API steps into Playwright request-context code
- respects headers, body mode, validations, and response captures
- uses deterministic request models before any free-form reasoning

`Repair Pilot`

- analyzes only the failing step neighborhood
- reads screenshot, DOM digest, console, and network summary
- proposes locator and wait repairs with confidence

`Patch Governor`

- allows locator and wait changes automatically when confidence is high
- blocks business assertion changes without HelloTest review

## Token Optimization

The AI layer should be cheap by default and only expensive when ambiguity is real.

### Rules

- never send the full project to the model
- never regenerate from scratch if a script already exists
- never send full traces or full DOM unless triage actually needs them
- never ask a large model to solve a problem a smaller model can classify first

### Context packing strategy

Use canonical case JSON as the base context:

- case title and intent
- step list
- expected results
- suite parameters
- case parameters
- environment summary
- data references

Then attach only targeted extras:

- Shared Step Group pack only for referenced Shared Step Groups
- locator memory only for the current case version
- failing step plus one step before and after for repair
- DOM digest instead of full HTML first
- console and network summaries before raw logs

### Model cascade

- small model:
  - classify step type
  - rank locator candidates
  - summarize console and network noise
- medium model:
  - generate first-pass Playwright script
  - repair locator and wait issues
- large model:
  - only for ambiguous recovery or major script synthesis

### Persistent memory

Persist adjacent assets per case version:

- `manual_spec.json`
- `generated_script.spec.ts`
- `locator_knowledge.json`
- `step_map.json`
- `repair_history.json`

That lets the next run reuse prior work instead of paying fresh token cost every time.

## Guardrails

Allowed automatic repair:

- locator substitution
- wait tuning
- popup dismissal
- scroll or focus correction
- transient navigation handling

Blocked without review:

- changing assertions
- deleting validation steps
- changing expected business outcomes
- adding hidden side-effect steps

## HelloTest Backend Seam

This repo now has the minimum callback seam to support the engine model:

1. `POST /api/testengine/callbacks/runs`
   - verifies callback signature
   - upserts the execution result for the case
   - stores structured step logs and inline preview evidence
   - records a workspace transaction event for operations visibility

2. internal result upsert support
   - create result if missing
   - update latest result if present

The next backend additions should be:

1. direct run handoff from HelloTest into Test Engine
2. optional execution auto-complete policy for fully automated runs
3. dedicated artifact manifest persistence for trace, HAR, and video browsing

That is enough to make HelloTest the intelligent control plane and Test Engine the scalable Playwright backend.
