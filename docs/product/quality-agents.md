# Quality Agents

Quality Agents turn an approved application URL and bounded configuration into real browser observations on the configured Test Engine. The application API owns authorization, durable queue/history and evidence access. The engine owns isolated browser execution, actual checks and screenshot artifacts.

| Agent | Executes | Boundary |
| --- | --- | --- |
| Web Journey | Reviewed `click`, non-secret `fill`, `assert_text` and same-origin `assert_url` actions; navigation/console observations; bounded link discovery when no journey is supplied | Up to 12 approved actions and five pages. Fresh context, no stored credentials, arbitrary code or inferred workflow coverage. |
| Security Posture | Passive browser-visible response policy and transport observations | No exploitation, penetration testing or authenticated certification. |
| Navigation Performance | One navigation, available browser metrics, resource observations and explicit budgets | Not load testing, production percentiles or a universal performance score. |
| Accessibility Review | The engine's implemented axe-core rules with observed element evidence | Automated results require manual accessibility review and do not certify WCAG conformance. |
| Visual Regression | Fixed-viewport screenshot; optional explicit masks; pixel comparison with a reviewed baseline | A first capture produces `needs_review`, not a regression pass. Dynamic content and environment differences remain review concerns. |

## Plan, review and execute

`POST /agentic-quality/plan` accepts project/application scope, agent kind, target URL, an optional goal and bounded options. Web goals may use the project's configured LLM to propose typed actions. The planner uses only selectors explicitly present in the goal or authorized saved CSS locators from the Object Repository at the target origin. Repository context requires `automation.view`; a selected LLM connection additionally requires `integration.view`. No DOM is inspected during planning. Saved locators can be stale, and the response identifies this limitation and any repository grounding.

Model selection uses `ai.agentic.quality_plan` in the existing AI settings registry. A governed prompt override is supplemental QA guidance; it cannot change the executable action contract, selector provenance or secret restrictions. If no model is configured, its output is invalid or the goal has no concrete selectors, the plan remains editable with explicit limitations. A web goal with no reviewed nonempty steps is rejected before a run is queued. Other presets execute their published checks; the goal remains review context and does not add arbitrary browser actions.

`POST /agentic-quality/runs` accepts the final approved URL/options and, for a web journey, `reviewed_plan: { reviewed: true, goal, steps }`. The caller must review selectors, expected text and page count. A journey that navigates between pages needs a page bound large enough for those transitions. Non-secret input values are persisted so queued work can resume. Authentication tokens, private keys, secret URL parameters and sensitive input selectors are rejected.

## Scope and access

Every catalog, plan, history, result and artifact operation checks current project membership, application ownership and the relevant existing capability. `agentic_workflow.view` reads evidence/history; `agentic_workflow.run` proposes, starts and stops reviews; `agentic_workflow.manage` approves visual baselines. Explicit Test Engine selection also requires `integration.view`. A connection scoped to another project cannot be used. Default connection selection uses the existing active project Test Engine integration, with the existing unscoped connection fallback.

Worker dispatch refreshes the originating user's active account, membership and run permission. Revoked access prevents execution and triggers bounded remote cleanup when needed. Engine requests use the existing Test Engine shared-secret mechanism; the secret is never exposed through run metadata or browser responses. The runtime applies its own target-origin and DNS/network controls. Private QA hosts and additional origins need the engine's explicit deployment allowlists.

Catalog readiness makes a three-second authenticated capabilities request. A configured connection and a present Chromium binary are separate states. Binary presence is a preflight observation; each run still has to launch a browser and reach its target successfully.

## Durable lifecycle and cancellation

The API stores runs in the existing PostgreSQL observability `workspace_transactions` and records lifecycle events. No new database migration or in-memory-only platform history is used. The owning worker reconciles saved queued/running reviews every two seconds using `FOR UPDATE SKIP LOCKED` and expiring leases. A failed worker can be replaced without inventing results. Only recorded engine stages are shown.

An `Idempotency-Key` header or `idempotency_key` body field prevents duplicate acceptance for the same actor/project. Reusing a key with different normalized inputs returns a conflict; if both locations supply a key they must match. Each engine dispatch has one HTTP attempt, a bounded response and a ten-second deadline. An uncertain acknowledgement can be retried by the durable worker with the same `client_run_id`, under the engine's idempotent acceptance contract. Permanent input/contract errors fail the review; transient availability failures retry only within the overall deadline. Up to three reviews per actor/project can be queued/running.

Stopping a review persists cancellation before requesting a five-second bounded remote stop. If the engine ID is not yet known, the request uses the saved client ID and exact scope. A late start acknowledgement also triggers cleanup. Lease/state predicates prevent any late success or polling response from overwriting the cancelled result. The engine separately bounds browser duration. If it cannot acknowledge cancellation, remote work may remain active until that deadline; the saved platform result remains cancelled.

## Evidence and reviewed baselines

Artifact routes accept only IDs from the authorized run's validated manifest. Downloads are bounded to 8 MiB, checked against content type, exact byte count and SHA256, and served with private/no-store, nosniff and restrictive content policy headers. JSON/report content is an attachment. Run records and manifests persist in the application database; ordinary artifact bytes remain in the engine's persistent evidence directory and depend on its availability/retention. The engine defaults to seven-day retention for old terminal runs; baseline-associated runs are preserved. Keep that directory on a durable deployment volume.

`POST /agentic-quality/runs/:id/baseline` requires an explicit completed visual screenshot review. The backend supplies the authorized reviewer identity, validates the engine's project/application/URL/viewport/masks/hash, and copies the PNG into the existing durable transaction artifact store before the database transaction commits. Repeated promotion of the same source screenshot returns the same saved baseline. The stored image can be read even if the engine is temporarily unavailable and is hash-verified on every read.

A comparison baseline must match project, application, URL, viewport, masks and Test Engine integration. Promoting a new screenshot creates an immutable reviewed baseline rather than silently replacing an existing one. Engine-side baseline files also require persistent storage for subsequent comparisons.

## API surface

| Method | Route | Result |
| --- | --- | --- |
| GET | `/agentic-quality/catalog?project_id=&app_type_id=` | Presets, truthful limits and current engine preflight |
| POST | `/agentic-quality/plan` | Editable bounded proposal and limitations |
| POST / GET | `/agentic-quality/runs` | Accepted saved review / `{items: [...]}` scoped history |
| GET | `/agentic-quality/runs/:id` | Saved status, recorded stages, findings, metrics and manifest |
| POST | `/agentic-quality/runs/:id/cancel` | Persisted cancellation and bounded engine stop request |
| GET | `/agentic-quality/runs/:id/artifacts/:artifactId` | Authorized verified evidence bytes |
| GET | `/agentic-quality/baselines?project_id=&app_type_id=` | `{items: [...]}` reviewed baseline catalog |
| POST | `/agentic-quality/runs/:id/baseline` | Explicit `{artifact_id, label?}` screenshot approval |
| GET | `/agentic-quality/baselines/:id/artifact` | Durably stored reviewed PNG |

Shared UI contracts live in `services/agentic/frontend/lib/qualityAgentContracts.ts`; engine contracts live in `testengine/backend/src/contracts/qualityAgents.ts`. Focused checks exercise platform authorization, stale cancellation, idempotency, malformed evidence, artifact integrity, baseline persistence and the actual engine input validator.
