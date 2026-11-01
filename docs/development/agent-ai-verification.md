# Agent and AI behavior verification

The agent catalog currently contains 22 project specialists, four repository agents
and five browser agents. The AI configuration catalog has 73 active profiles and
three reserved profiles. Reserved profiles are deliberately excluded from execution.

## Repeatable checks

| Command | Behavior covered |
| --- | --- |
| `npm run test:agent-intents` | Every executable agent resolves its own feature and source policy; actual specialist request construction retains the complete user task; native proposals, output requirements and exact citations are checked. Every active AI profile preserves task data and its configured context policy at the shared model boundary. |
| `npm run test:ai-features` | Backend and frontend agent, AI authoring, automation, chatbot, knowledge and manual-feature regressions, plus native contracts, publication, persistence and optional-source access. Four concurrent test files bound local resource usage. |
| `npm run test:quality-agent-engine` | Fresh Test Engine compilation, then all five browser agents against local browser fixtures, persisted findings/artifacts, journeys, baselines and deployment contracts. |
| `npm run test:repository-agents` | All four repository compilers against source fixtures, including API contracts, UI locators, component tests, Knowledge documents, source citations, bounded parsing and secret exclusion. |
| `npm run test:mcp` and `npm run check:mcp` | Real SDK transport contracts, supported protocol revisions, tools, discovery, permission enforcement, redaction, reviewed writes, idempotency and generated capability inventory. |
| `npm run test:mcp:postgres` | MCP transport and domain adapters against an isolated PostgreSQL database. |
| `node scripts/checks/test-sprint-automator-postgres.mjs` | Revision-bound Sprint pipeline, native persistence and explicit multi-Story loop execution against an isolated PostgreSQL database. |
| `npm run test:workflows:temporal` | Actual Temporal orchestration, loop histories, cancellation, dependency barriers and receipt/replay behavior against disposable infrastructure. |
| `npm run test:quality-agents:postgres` | Concurrent event writers, replay cursors, atomic finalization and stale-output rejection against an isolated PostgreSQL database. |

Run the PostgreSQL/Temporal commands serially on a constrained local Docker host.
Each runner owns and removes its disposable database; none replaces project data.
Optional PostgreSQL tests skipped by the ordinary Node suite require their dedicated
runner to establish database behavior.

The new deterministic evaluations live in
[agentIntentEvaluation.test.js](../../services/agentic/test/backend/agentIntentEvaluation.test.js)
and [aiFeatureIntentMatrix.test.js](../../services/platform/backend/test/aiFeatureIntentMatrix.test.js).
They exercise real request builders and validators with provider responses supplied
by fixtures. They do not measure a paid model's semantic accuracy or establish that
every configured external provider produces equivalent results.

## Output and intent regressions

The model-visible specialist schema includes the native fields for structured and
Gherkin Test Cases, Automation Plans, reports/tables/charts and typed repairs. Each
authoring kind declares its required fields. Agent-generated Gherkin uses the same
validator as native AI authoring: every Scenario needs a When action followed by a
Then outcome. A valid first Scenario cannot hide an incomplete later Scenario.

Chatbot usage questions select the product guide path, including navigation through
failed runs or configuration in the user's project. Project facts, summaries and
analysis retain their distinct evidence needs. A model retrieval plan cannot add
native project reads to a pure product guide request. A new usage question does not
inherit the previous project-summary intent. Mixed requests and explicitly selected
record identifiers retain project evidence routing.

Browser regression fixtures verify one complete saved answer, hidden legacy answer
chunks, citations, retries, cancellation, idempotent turns, and responsive layouts.
Workflow fixtures verify the Sprint loop's Loop/Continue/Done edges, per-Story native
pipeline and iteration history. MCP fixtures verify search, access filters and bulk
selection while preserving tools hidden by the current filter. These browser checks
use controlled API/model fixtures; their results are separate from database and
external-provider verification.

The verification also covers private loop histories. Public execution responses
strip internal lineage and resume checkpoints from every nested snapshot. Automation
source, including earlier batches replaced by later output, requires the current
automation/code viewing permissions. The public projection never mutates the
worker's retained checkpoints.

Source changes and local builds do not update already-running container images or
publish an external deployment. Verify the running image when rolling out changes.

## Local verification on 2026-11-01

| Check | Result |
| --- | --- |
| Combined AI feature suite, final code | 2,421 passed; 10 opt-in PostgreSQL cases skipped; zero failures |
| Agent/profile intent matrix | 128 passed; includes all 31 agent identities and 73 active AI profiles |
| Repository compiler fixtures | 47 passed across all four repository agents |
| Fresh Test Engine build and browser-agent checks | Five passed, including execution of all five browser agents against local pages |
| MCP protocol/domain suite | 105 passed |
| Managed connection/discovery/transport checks | 24 passed, including full-catalog discovery and unchanged operation-result limits |
| Workflow suite and focused frontend checks | 192 backend and 26 frontend passed |
| Sprint PostgreSQL integration | Passed; 84 local provider-fixture HTTP calls through real native services and database persistence; two Stories complete every stage; two manual and two unverified automation cases persist; historical acceptance and replay are verified |
| MCP PostgreSQL/SDK integration | Passed; actual HTTP, modern/legacy SDK clients, domain adapters, isolation, revocation, reviewed writes and reconciliation |
| Temporal/PostgreSQL integration | Passed; nested batches, parallel fan-in, lost acknowledgements, unknown outcomes, cancellation and five history replays |
| Quality-event PostgreSQL integration | Passed |
| Browser regressions | Chatbot, Sprint/foreach editor and MCP discovery/selection passed with controlled API fixtures |
| Frontend type checks and chatbot production build | Passed |
| Generated MCP contracts, service boundaries, architecture validation, documentation links and whitespace | Passed |

The initial complete workspace baseline had 49 backend and 14 frontend failures.
Affected AI fixtures were repaired without relaxing production validation. Final
verification uses the focused suites above; it does not assert that the entire
workspace `npm test` gate is green, including unrelated bootstrap, route-parity and
catalog UI contracts.

An existing Sprint workflow without an approved application start URL still needs
that configuration before browser automation can run. Its setup panel opens the
AI Automation Engineer node directly. Missing input remains visible rather than
being replaced with an invented target or a successful execution claim.
