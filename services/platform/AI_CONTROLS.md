# AI Controls

Administration → **AI Controls** replaces workspace Settings → Prompt key mapping. Quality metric formulas and criteria are managed separately in Administration → Metric governance; they are deterministic business rules, not generation controls.

The shared catalog in `shared/aiFeatureCatalog.json` defines stable feature identities, families, operation aliases, initial configurations and detailed instruction blocks. It covers Story authoring/grooming/assurance, Test Case design, automation, execution, Defects, test data, knowledge, content, built-in specialists, browser planning/decisions, and administration prompt optimization. `shared/aiPromptDefaults.json` is a public projection for the existing frontend prompt hook; its consistency is checked in tests.

## Configuration and publication

Each feature has role, task, domain, primary prompt, detailed task instructions, guardrails, sampling, provider preference, output cap, optional JSON Schema constraints and MCP context policy. Schema constraints supplement the native artifact shape. HTML authoring does not accept a JSON object schema. Permission checks, typed artifact validators, tool contracts, spending ceilings, source ACLs and approval of writes remain application rules.

Save draft stores a configuration without changing generation. Publish uses an expected revision, a transaction-scoped PostgreSQL advisory lock and an administrator audit entry. Competing edits receive HTTP 409. Reload latest makes reconciliation explicit. Publication history keeps 30 snapshots in separate setting records; routine generation reads only the published configuration and revision. Restore publishes a prior snapshot as a new version. Default/legacy prompt and provider preferences remain effective until a feature is published.

The workspace preference endpoint rejects writes to the retired prompt/provider mapping keys. Workspace metric criteria and formulas retain their existing permission controls. Server-side provider selection uses published preferences through the shared settings service. Explicit user selections take precedence; integrations tied to another project are rejected, including a global fallback that would cross project scope. Individual built-in specialists have their own provider and generation configuration; successor calls receive the successor's profile. Knowledge-stage preferences resolve before provider-specific cost reservation. Embedding entries expose metrics; their model is managed on the Knowledge Assistant integration so document/query dimensions and egress remain compatible.

## Model request boundary

`aiFeatureRuntime` resolves the effective published configuration before MCP retrieval and request-policy preparation. Detailed instruction markers expand before dispatch, input budgeting and trace capture, including reduced-context compatibility requests. Dynamic inputs, images, exact allowed IDs, current enum values and native domain validations are preserved. Marker references without a feature mapping fail explicitly rather than reaching the provider.

Sampling and output caps come from configuration. Smaller operation/request spending bounds still apply. Reasoning-model sampling restrictions and explicit provider compatibility negotiations remain effective. Additional object schemas are compiled before publication and validated locally against responses; no remote references, executable schema expressions or regex validation are accepted. A schema failure is reported without automatically replaying a paid generation.

Additional automatic project retrieval uses the built-in MCP gateway with the verified current user/project. Administrators can select task input only, evidence budgets, focus and whether successful retrieval is required. Selected drafts and user-provided inputs remain task data; changing context policy does not erase these inputs. Optional retrieval failures produce an explicit evidence-gap notice. Required retrieval failures stop generation and are traced. Context planning, ingestion and embeddings cannot recursively request MCP context. Existing knowledge pipelines handle their authorized MCP packets rather than retrieving the same packet again at synthesis.

## Optimization and observability

Optimize prompt sends only the feature definition being edited to the configured optimizer integration. It does not retrieve a project's private evidence or impersonate a project user. The model may propose role, task, domain, prompt and guardrail improvements. The portal shows the changed fields for review; using a suggestion edits the draft and never publishes it. The operation is audited and traced with an explicit instance scope.

Trace capture records stable feature/family, published configuration version and fingerprint, referenced instruction-profile versions, provider request/response, usage when reported, MCP status and corrections. Instance calls have a null project and a verified actor. Existing project trace APIs still require exact project scope. Admin metrics expose aggregate feature/operation counts, failed/invalid responses, corrections, MCP gaps, latency and tokens for the last 24 hours under the existing 14-day trace retention. Unknown usage and trace-write failures remain explicit. These are model transport/contract metrics, not semantic correctness or release-readiness scores. Cost is not invented when provider pricing is unknown.

## Verification

- `node --test --test-concurrency=1 services/platform/backend/test/aiConfiguration.test.js services/platform/backend/test/llmTraceCapture.test.js services/integration/test/backend/llmRequestPolicy.test.js`
- `npm run test:mcp:postgres`: disposable PostgreSQL; native admin authorization, draft/publication conflict, rollback, provider dispatch, retired preference protection, optimizer scope, aggregate-only metrics, MCP SDK and project isolation checks. Provider responses in this fixture are mocked; database and domain routes are real.
- `node --test --test-concurrency=1 services/platform/frontend/test/browser/aiControls.test.mjs` against the repository Vite server: real React editor with mocked API responses; tab switching, drafts, reviewed optimization, publication and responsive overflow checks.
- `npm --prefix services/platform/frontend run build:all` and `node scripts/checks/check-service-boundaries.mjs`.
