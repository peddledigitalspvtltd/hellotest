# MCP context delivery audit

The context interface reuses HelloTest's verified project identity, source ACLs, native record projections, Knowledge search, graph witnesses, freshness checks and bounded retrieval engine. MCP does not make retrieved text an instruction, grant additional access or certify complete coverage.

## Public evidence reads and internal AI requests

`hellotest_context_build` accepts the original question, optional application, exact source IDs, typed feature/evidence filters, bounded budgets and an optional retrieval hint. Identity comes from the connection. Unsupported evidence selectors are rejected rather than accepted and ignored. Explicit empty feature scopes and zero activity budgets remain empty/zero.

Public calls use deterministic intent routing. They do not make a hidden generative intent-planning call. Embedding retrieval still follows the selected integration and cost budget; a zero query-cost budget supports lexical and graph retrieval. An optional caller-supplied plan is a bounded, question-anchored hint. It does not replace source selectors, choose arbitrary tools or grant permissions. Packet diagnostics distinguish deterministic routing, caller-supplied hints and internal model planning.

The API-process bridge retains the native retrieval result. A separate worker/chatbot process uses the same public arguments and reconstructs the established packet, hits, citation, route and budget receipt. Private callbacks, history, integration secrets and user objects are never sent as tool arguments. An already prepared chatbot plan is carried once instead of invoking a second intent model.

The separate-process bridge also preserves application-owned feature, session,
task/run and trace attribution. Async-local metadata alone does not cross HTTP.
The worker signs a bounded allowlist of correlation labels into its temporary
project/user/client-bound MCP resource credential; authentication restores those
labels for ContextGraph recording, and the worker revokes that credential after
the call. Tool arguments and protocol `_meta` cannot set or override these
labels. External credentials created through the normal onboarding endpoint do
not acquire internal attribution. The labels never grant access, approvals or
authority to reuse an earlier decision.

LLM orchestration belongs to the authenticated host. Both general Knowledge
intent planning and chatbot intent planning select anchored search terms,
source families, information needs and a closed `retrieval_strategy`:
`hybrid_evidence` or `graph_expand`. The latter requests one witnessed
relationship expansion from authorized search hits even when individual
passages appear sufficient. Before search, the engine reserves at most six
candidate positions and one tool slot within the original allowance so an
exhaustive lexical lookup or optional live snapshot cannot starve that selected
graph read. It consumes the same retrieval tool budget and
never overrides pinned source/collection, exact-record, explicit source-kind,
historical or remaining-budget boundaries. Packet diagnostics record the
requested/applied strategy, actual graph call count, delivered witness counts
and a skipped/failed reason; the ContextGraph retains the safe observed receipt.
Legacy plans without the field retain hybrid behavior; unsupported explicit
strategies are rejected or produce the host's explicit planner fallback.

MCP separately exposes typed graph resolution, expansion, witnessed paths and
owner-private context history tools. The host cannot select arbitrary tools or
author graph queries through its retrieval strategy. Model-directed graph
tracing and personal decision-memory retrieval remain unimplemented rather than
being implied by a successful bounded expansion. See the
[MCP architecture](https://modelcontextprotocol.io/specification/2026-07-28/architecture)
for the host/server responsibility boundary.

## Application and node configuration

Ordinary model requests inherit the authenticated task's application scope. Conflicting application selectors fail before retrieval. Structured request data is projected into semantic objective and artifact fields before search; JSON Schema, guardrails and parameter/credential bags are not used as retrieval questions. Images remain attached to the original generation request and do not become fabricated text queries.

Story creation/completion and Story-to-Test-Case generation previously prefetched Knowledge before the shared model boundary. Those paths now identify their consuming feature, honor the effective application/node evidence policy, and apply the smaller requested item/token budgets. Task-input-only configuration makes no optional Knowledge reads. Required missing evidence stops primary generation. Optional transport failures remain explicit gaps; access failures and cancellation are not swallowed.

Prefetched MCP evidence is marked as already handled, preventing a second wider search at generation. Selected source IDs, application filters and exact record scope remain intact. Native selected Story/Test Case inputs remain available independently of optional retrieval. Model prompt data retains chunk-level citation identities, source versions and hashes, and discloses projection/excerpt omissions. Two chunks from the same source no longer collapse into the same Story evidence reference.

Legacy authored Knowledge rows now share the source, document and chunk access rules of their current indexed representation. Native detail/list/search, feature prefetch and MCP reads cannot recover a denied full item through the authoring table. An archived representation in a previous application scope does not hide the current item. Cached action receipts recheck record access before delivering stored content; their non-content effect verification remains available after content access changes.

## Delivered provenance and budgets

The gateway checks the verified project, nested evidence scope, duplicate evidence IDs and native authorization flags. Automatic model context retains applied filters, authorization, freshness, limitations and retrieval status. Evidence-free optional results are explicitly empty. UTF-8 bytes, including metadata, are used for the conservative delivery estimate; non-Latin text cannot evade a character-only budget.

MCP redaction or result projection can alter source text after native retrieval. `packetDelivery` reconciles that representation: immutable source/chunk/version hashes remain unchanged, the original excerpt hash and rendered hash are separately recorded, obsolete source offsets are removed, and only relationships depending on altered witnesses are omitted. Unchanged relationships remain available. The result stays valid against the native `ContextPacket` schema and reports partial delivery rather than complete source review.

Graph delivery verifies node/edge endpoints, project scope, duplicate identities, required witness presence and projection completeness. Redacted displays disclose immutable-source offset semantics. A path shows a witnessed relationship; it is not proof of causation, execution success or exhaustive impact.

## Verification

Focused checks cover concurrent actor/project isolation, native/remote public contract parity, source-filter intersection, zero budgets, strict retrieval hints, cancellation, required/optional evidence, application mismatch, source/chunk provenance, UTF-8 delivery limits, graph witnesses and schema-valid redacted packets.

The signed-attribution check uses actual HTTP, the installed SDK and resource
credential signing/verification with controlled persistence dependencies. It
checks concurrent user/task isolation, forged metadata rejection and temporary
credential revocation. The PostgreSQL integration separately checks the native
HTTP plugin's persisted task/session/trace attribution and token revocation.

```sh
node --test services/mcp/test/backend/mcpGateway.test.js services/mcp/test/backend/mcpContextRequest.test.js services/mcp/test/backend/mcpGraph.test.js services/mcp/test/backend/mcpPacketDelivery.test.js
node --test services/knowledge/test/backend/knowledgePrefetchPolicy.test.js services/knowledge/test/backend/mcpRetrievalPlanning.test.js services/platform/backend/test/aiArtifactRequests.test.js
```

Provider responses and retrieval dependencies in these focused tests are controlled fixtures. They verify contracts and boundaries, not live model quality or public deployment configuration. The repository's separate PostgreSQL/SDK integration suite verifies real persistence and native authorization paths.
