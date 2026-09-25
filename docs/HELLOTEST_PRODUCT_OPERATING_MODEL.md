# HelloTest Product Operating Model

## Product Position

HelloTest should feel like one intelligent QA operating system, not a collection of screens.

The product promise is:

- capture requirements and turn them into reusable coverage
- generate manual test cases with AI assistance
- generate automation where it is safe and worthwhile
- execute manual and automated runs from the same control plane
- learn from every run without wasting tokens
- publish executive-ready HTML run reports with linked evidence

HelloTest remains the only frontend.

Test Engine is a backend-only worker plane that executes Playwright workloads and reports back to HelloTest.

See also: [HelloTest background operations strategy](HELLOTEST_BACKGROUND_OPERATIONS_STRATEGY.md)

## What The Current Repo Already Has

The current codebase already provides a strong starting point:

- authentication, projects, app types, and role-aware access
- requirements and linked test cases
- AI-generated manual test case creation and scheduler-driven generation jobs
- `test_cases.automated = yes|no`
- `test_steps.automation_code` plus structured `api_request`
- execution snapshots for suites, cases, steps, environment, configuration, and data
- execution schedules for future run creation
- execution results with structured step logs and inline step image evidence
- workspace transactions for operation visibility
- a project-scoped `testengine` integration
- a signed callback seam from Test Engine back into HelloTest

That means the foundation is real. The missing work is orchestration depth, automation asset persistence, smarter learning, and reporting.

## End-To-End Product Flow

### 1. Login and workspace selection

After login, the user lands in HelloTest and selects:

- workspace
- project
- app type

At this point HelloTest should surface:

- active requirements
- coverage status
- automation status
- recent runs
- scheduled build and run activity

This should be the command center, not just a navigation page.

### 2. Requirement capture

Requirements can come from:

- manual authoring in HelloTest
- Jira and external sync sources
- imported requirement documents or links

Each requirement should feed two paths:

- manual design path
- automation readiness path

### 3. Manual test case generation

HelloTest should continue generating manual test cases first because manual intent is the strongest source of durable automation.

The target authoring chain is:

1. requirement captured
2. AI proposes one or more manual test cases
3. user reviews and accepts
4. accepted case becomes reusable source material
5. steps are enriched with:
   - step type
   - expected result
   - data references
   - Shared Step Group linkage
   - automation hints

Manual clarity should remain the canonical truth. Automation is attached to the case, not a replacement for the case.

### 4. Automation build decision

Every test case should support two automation build modes:

- `Build now`
  - immediate case-level automation generation
- `Build later`
  - queued build as part of a suite-level or scheduled automation job

That should work at two scopes:

- test-by-test instant generation
- suite-by-suite scheduled generation

This is important because not every team wants automation generated synchronously while authoring.

### 5. Script attachment model

Once automation is generated, it should be attached to the test smartly.

The attachment is not just raw code in a step. HelloTest should treat automation as a versioned asset.

Each test case needs a first-class automation asset record that stores:

- source mode
  - attached
  - generated
  - healed
- framework
  - Playwright
- generated script path or content hash
- locator knowledge path
- generation summary
- last build status
- last run status
- last success timestamp
- last healed timestamp
- stability score
- confidence score

When a future run starts, HelloTest should prefer:

1. last verified successful script
2. last generated script
3. fresh generation only if no usable script exists

That avoids paying generation cost on every run.

### 6. Run decision

When a run is created in HelloTest:

- if `automated = no`
  - keep it in the manual run path
- if `automated = yes`
  - treat it as CI-style handoff to Test Engine

Both still live under the same HelloTest Runs experience.

The user should never have to think about “which product” they are using.

### 7. Automated run execution

For automated cases:

1. HelloTest creates the run
2. HelloTest snapshots run context
3. HelloTest dispatches only automated cases to Test Engine
4. Test Engine executes one case per worker unit
5. Test Engine streams back:
   - case progress
   - step outcomes
   - inline failure preview images
   - artifact references
   - final case status
6. HelloTest updates the run in place
7. HelloTest completes the run when all cases settle

### 8. Self-healing path

If the last saved script fails:

1. capture failure artifacts
2. attempt constrained healing
3. continue only if confidence is high
4. save the healed patch as a reviewable candidate
5. stamp the case as:
   - reused successfully
   - self-healed
   - unstable
   - needs review

HelloTest should never silently change business assertions.

### 9. Reporting path

When a run finishes, HelloTest should create a durable HTML report that includes:

- run summary
- pass, fail, blocked counts
- suite breakdown
- case breakdown
- top failure themes
- evidence links
- trace and artifact links
- healed vs deterministic counts
- duration summary
- environment snapshot
- configuration snapshot
- data set snapshot
- generated by and executed at metadata

This report should be exportable and also preservable as an artifact snapshot.

## Target Architecture

### HelloTest frontend

Owns:

- authoring
- review
- build requests
- run creation
- schedules
- operations visibility
- report viewing and export

### HelloTest backend

Owns:

- source of truth
- run orchestration
- build orchestration
- schedule processing
- callback ingestion
- artifact manifest persistence
- HTML report generation
- model budget and learning coordination

### Test Engine backend

Owns:

- Playwright execution
- isolated browser runtime
- deterministic run execution
- constrained self-healing
- artifact generation
- callback delivery back to HelloTest

### AI agent layer

Owns reasoning, not final authority.

Recommended structure:

- `HelloTest Pilot`
  - master planner and retrieval layer
- `Web Pilot`
  - web step to Playwright conversion
- `API Pilot`
  - API step to Playwright request-context conversion
- `Repair Pilot`
  - failure analysis and constrained healing
- `Patch Governor`
  - approval policy and risk classification

## Scheduling Strategy

HelloTest needs two scheduling families, not one.

### A. Run schedules

Already mostly present in the repo.

Purpose:

- create future runs
- repeat regression packs
- trigger manual or automated run waves

### B. Automation build schedules

Not yet present as a first-class concept.

Purpose:

- generate scripts for accepted manual cases
- regenerate stale scripts
- suite-by-suite automation build waves
- overnight build queues for newly accepted cases

Recommended build schedule scopes:

- single test case
- suite
- app type
- changed requirements only
- stale automation only

## Smooth Backend Handoff

The handoff between HelloTest and Test Engine should be hook-driven and queue-safe.

Recommended hook events:

- `run.created`
- `run.started`
- `case.dispatched`
- `case.accepted_by_engine`
- `step.completed`
- `case.completed`
- `case.failed`
- `case.healed`
- `run.completed`
- `report.generated`
- `build.requested`
- `build.completed`
- `build.failed`
- `patch.proposed`
- `patch.promoted`

Recommended queue semantics:

- idempotent dispatch key per case run
- lease-based worker claiming
- heartbeat for long browser sessions
- retry with backoff
- dead-letter queue for broken jobs
- cancellation token for user-aborted runs

## Parallel Execution Strategy

Parallelism should happen at the case level, not as uncontrolled step-level chaos.

Recommended model:

- one run can dispatch many case jobs
- each case job is isolated
- each case worker processes steps sequentially
- API-only cases can run with higher parallelism
- browser cases should respect browser pool quotas

Parallel controls should exist at:

- project level
- app type level
- integration level
- schedule level

This prevents a large suite from flooding the engine.

## Learning Strategy

The learning layer should be rich, but not token-hungry.

### What to store

Store app-specific metadata in a retrieval-friendly way:

- page URL
- page title
- route pattern
- domain
- stable locator candidates
- semantic element names
- common popups
- recurring failure signatures
- auth flow fingerprints
- API response shapes
- shared data bindings
- environment-specific quirks

### Where to store it

Do not leave this as random files only.

Use a structured memory model keyed by:

- project
- app type
- environment
- route
- page title
- case id
- step id

### How to avoid token waste

Use retrieval before prompting:

- fetch only page-specific memory
- fetch only the failing step neighborhood
- fetch only the relevant Shared Step Group pack
- use DOM digests first, not full DOM
- use network summaries first, not full HAR
- reuse prior locator candidates before asking AI

### Learning stamp model

Every case automation asset should track:

- `last_built_at`
- `last_run_at`
- `last_success_at`
- `last_healed_at`
- `last_failure_signature`
- `reuse_count`
- `heal_count`
- `stability_score`
- `requires_review`

This is the smart stamp that tells HelloTest whether to rebuild or reuse.

## HTML Report Strategy

The HTML report should be generated by HelloTest backend after run completion.

Generation pipeline:

1. collect run summary
2. collect case results
3. collect structured step logs
4. collect artifact manifest
5. render branded HTML
6. store snapshot metadata
7. expose download from HelloTest UI

The HTML report should be:

- portable
- visually executive-friendly
- still detailed enough for QA leads
- stable even if source cases later change

Recommended report sections:

- cover summary
- release or scope summary
- suite summary
- failed cases
- healed cases
- manual cases pending action
- evidence links
- environment and configuration snapshot
- appendix with all case outcomes

## Gaps In This Codebase Today

The repo is already partway there, but these gaps are still real.

### Gap 1: no first-class automation asset model

Current state:

- automation lives mainly as `test_steps.automation_code`

Missing:

- case-level attached script
- versioned automation asset
- last success stamp
- stability metadata
- locator knowledge record

### Gap 2: no outbound run handoff yet

Current state:

- HelloTest can receive engine callbacks

Missing:

- HelloTest dispatch from run creation into Test Engine
- case fan-out worker orchestration
- idempotent dispatch records

### Gap 3: no automation build job model

Current state:

- execution schedules exist
- AI test case generation scheduler exists

Missing:

- build-now case automation job
- suite automation build queue
- automation build schedule entity

### Gap 4: no durable learning store

Current state:

- architecture describes locator memory

Missing:

- backend persistence for locator knowledge
- page metadata store
- failure signature store
- retrieval ranking layer

### Gap 5: no real HTML report pipeline

Current state:

- settings mention export prompts

Missing:

- run-to-report renderer
- stored HTML artifact
- downloadable report endpoint
- report manifest in run history

### Gap 6: evidence model is still transitional

Current state:

- inline step evidence is stored in structured logs

Missing:

- durable artifact table for trace, video, HAR, and HTML report assets
- artifact retention policies tied to run cleanup

### Gap 7: no run auto-complete policy for engine-driven runs

Current state:

- callback seam exists

Missing:

- run completion coordinator once all automated cases finish
- mixed manual plus automated run settlement logic

### Gap 8: no explicit concurrency governance

Current state:

- schedules run in process

Missing:

- worker lease model
- queue concurrency limits
- heartbeat and cancellation
- dead-letter handling

## Recommended Data Model Additions

HelloTest backend should add first-class entities for:

- `automation_assets`
- `automation_asset_versions`
- `automation_build_jobs`
- `automation_schedules`
- `automation_memories`
- `automation_failure_signatures`
- `execution_artifacts`
- `run_reports`
- `engine_dispatch_jobs`

## Recommended Delivery Phases

### Phase 1: attach and reuse

- add automation asset tables
- attach generated scripts to cases
- stamp last success and stability
- prefer reuse before rebuild

### Phase 2: handoff and orchestration

- dispatch automated cases from HelloTest to Test Engine
- add engine dispatch job tracking
- auto-start and settle automated runs

### Phase 3: build jobs and schedules

- add build-now case automation action
- add suite automation build jobs
- add scheduled build waves

### Phase 4: learning and healing memory

- persist page metadata and locator knowledge
- store failure signatures
- retrieval-first token optimization

### Phase 5: reporting

- generate HTML reports
- store report artifacts
- expose export and executive summary views

## Strategic Product Rule

The most important rule for the whole system is:

AI should create, repair, and recommend automation, but HelloTest should own truth, attachment, scheduling, evidence, and reporting.

That is what makes the product feel intelligent without becoming unreliable.
