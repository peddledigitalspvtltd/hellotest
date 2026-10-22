# MCP, Context Graph and Knowledge Repository review

Reviewed against this checkout on 22 October 2026. This is implementation and
local verification evidence; it does not attest to the running cloud images,
public TLS, provider answer quality or a production deployment.

## Architecture verified

The platform mounts `@hellotest/mcp/backend/plugin` before domain routes. Its
registration hook inventories real operations and permissions. The official
`@modelcontextprotocol/server` SDK is installed and pinned to **2.3.1**. A thin
Streamable HTTP transport delegates tools into the application backplane; it
does not run a second graph, duplicate identity store or unrestricted HTTP/SQL
agent.

The same Knowledge engine supplies external MCP context, Smart Context,
chatbot retrieval and shared project-bound LLM enrichment. PostgreSQL owns
sources, immutable document revisions, chunks, ACL bindings, graph witnesses,
plans and receipts. Qdrant is a derived retrieval projection. Live domain facts,
indexed source passages and reviewed graph relationships remain distinguishable.

Verified MCP identity comes from signed, expiring, revocable user/project/client
credentials; internal in-process calls revalidate the signed-in principal.
External credentials cannot be used as ordinary application sessions. Current
account, project membership, feature and native domain permissions remain
authoritative. Graph traversal checks both endpoints, intermediate nodes,
source/document/fragment ACLs, current indexes and immutable witness versions.

## Gaps corrected

| Finding | Resulting implementation | Regression evidence |
| --- | --- | --- |
| Native graph passages have `score: 0`, but the real fusion function rejected all evidence below `0.06`. Simplified fixture mergers hid the disconnected path. | Context expansion preserves the native graph contract. Fusion admits an exact witness only from an authorized reviewed graph relationship, without manufacturing a similarity/confidence score. | Real production fusion plus Context Engine test proves the zero-score proof and its edge reach the packet; weak ordinary matches and unreviewed candidates remain excluded. |
| Shared LLM enrichment discarded `packet.relationships`; provider size correction discarded relationships again. | Both delivery stages retain relationships only when every exact proof survives. Altered or truncated witness text cannot support a source-offset assertion. Omitted proofs/relationships are counted and disclosed. | Gateway and provider fallback tests exercise retained, omitted, altered, truncated and unreviewed proofs, including immutable chunk identity. |
| Exact knowledge fetch used an ACL probe followed by a raw chunk read, and returned no citation version/hash contract. | A reusable Knowledge evidence reader reapplies source/document/fragment ACL, index/version/project joins and native-record gates during hydration, then rechecks access. Fetch returns document version, original hashes and locations. Optional expected document/hash inputs reject a revision mismatch; historical reads retain their permission gate. MCP rechecks native feature/permissions before delivery and discloses rendered-content changes. | Focused denial/removal/concurrent-revocation tests; real PostgreSQL/SDK tests for citations, expected-revision mismatch, pinned graph witness hashes and ACL denial. |
| MCP exposed graph traversal but omitted the application's existing exact node/curated-alias resolver. | New `hellotest_graph_resolve` delegates to the existing bounded authorized resolver and preserves ambiguity, unresolved and partial-result metadata. Identity remains credential-bound. | Native boundary tests plus real PostgreSQL/SDK exact-title resolution, removed-alias rejection and foreign-project isolation. |
| `investigate_failure` embedded its instructional template in the MCP implementation. | The prompt resolves published `ai.mcp.investigate_failure` Admin AI configuration on each request. Configuration guidance and the user question are separate messages. Server authorization and tool contracts remain enforced in code. | Real SDK prompt retrieval for every advertised legacy revision verifies configured guidance and preserved user input. |
| The generated ordinary execution contract was overwritten by validation of `req.body.smart_plan`, so normal MCP execution preparation required unrelated Smart Run acceptance fields. | Schema extraction recognizes only whole body/query targets, including default-object expressions. Nested-object validators do not replace the route's complete contract. | Generated-contract regression and real ordinary execution preparation. |
| Reviewed execution plans did not pin selected case content. Case history revision alone would also miss standalone step edits. | Server-derived history revisions and exact stored case/ordered-step hashes are included in preview and digest; approval/execute recheck them. Native creation verifies again under source locks, reloads source facts and persists snapshots in the same transaction. | Real PostgreSQL tests reject stale history, edited steps, expired plans, changed catalogs, tampered arguments and a source change injected between MCP claim and domain creation. A valid plan retains exact snapshot content and source revision receipt. |
| Generic MCP idempotency headers were not attached to native Test Case/Execution source keys, preventing reliable original-record reconciliation after a lost acknowledgement. | Those wrappers stamp the original plan key into native durable idempotency storage. Status reconciles only that original owned record, rechecks permissions and persisted fields/scope, and records an audited verified receipt without resubmission. | Real PostgreSQL fixture loses the response after committed creation; repeated execute/status verifies the original record and count remains one. |

## Coverage inventory

An actual Fastify route-registration pass produced the following snapshot. No
project data was queried to construct this inventory. Availability for an
individual principal is filtered again at discovery/call time.

| Classification | Operation count |
| --- | ---: |
| Registered operations | 537 |
| Operations with catalog permissions | 448 |
| Executable generic reads | 63 |
| Reviewed planned actions | 3 |
| Domain wrapper required | 284 |
| Nondelegable, including 89 without catalog permission mappings | 187 |

The server publishes **17 tools**, schema and ontology resources, and one
configurable investigation prompt. The generated API artifact contains **182**
controller-declared validation contracts. Counts describe the inspected checkout
and change as routes are added. `hellotest_capabilities` and
`hellotest_operation_describe` provide the exact runtime permission, path,
contract, exposure status and catalog revision for each discoverable operation.

The three reviewed business wrappers create Test Cases, create executions with
explicit selected cases, and submit bounded browser missions. Other writes do
not become executable merely because a route or permission appears in discovery.
Typed PostgreSQL reads cover projects, applications, requirements, Test Cases,
suites, executions, defects, environments and configurations. Authentication
tables, arbitrary SQL, arbitrary hosts, shell commands and credential values are
absent from model tools.

## Verification

- `npm run test:mcp`: 49 passing tests, including real SDK modern requests and
  all advertised legacy revisions (`2025-11-25`, `2025-06-18`, `2025-03-26`).
- Focused Context Engine, Knowledge evidence, executable-contract and LLM size
  correction suite: 51 passing tests. Source/permission dependencies are
  substituted in focused evidence tests; the fusion implementation is real.
- Two additional domain source-precondition tests pass, covering exact stored
  step changes, history revisions, invalid snapshots and source-lock ordering.
- `npm run test:mcp:postgres`: passed against a newly created and dropped local
  disposable database. Uses real migrations, PostgreSQL ACL/version queries,
  SDK transport, project isolation, reviewed-plan deduplication, revocation,
  graph traversal/resolution and exact evidence fetch. Provider responses in the
  broader fixture remain controlled; it does not assess a live model.
- `npm run check:mcp`, service boundary checks and service architecture validation
  passed. Module graph audit reported no unresolved imports; its overall failure
  was two unrelated existing automation frontend sources identified as orphans
  (`automationExportSource.ts`, `automationInstructionSummary.ts`).

## Remaining architecture work and limits

| Area | Evidence and required follow-up |
| --- | --- |
| Whole-application mutation coverage | The 284 wrapper-required operations need deliberate domain contracts, exact previews, existing permissions and persisted read-back verification. Broad update/delete, connector/admin, report/export and streaming operations are not implemented as generic MCP writes. |
| Source-precondition scope | Selected stored case fields and steps are pinned. Independently configured environments, data-set contents, shared-group defaults and external integrations keep their existing execution snapshot/permission contracts; approval does not freeze every independently editable dependency. New wrappers need explicit preconditions for their own source facts. |
| Uncertain write outcomes | Test Case/Execution original records can be reconciled by their durable plan key. Missing/unverifiable effects remain `unknown`; browser mission acknowledgement gaps and arbitrary future mutations need their own reconciliation contracts. There is no claim of distributed exactly-once delivery. |
| External onboarding | Current client contract is manual bearer with one-hour credentials. OAuth federation, automatic refresh and authorization-server discovery require a real deployment identity integration. |
| Separate worker boundary | Durable workers can use the configured API MCP endpoint and short-lived delegated credentials. Rich chatbot callbacks/history use the in-process transport; they are not serializable over the public packet-only endpoint. |
| Production validation | Public TLS/Host/Origin routing, dedicated SELECT-only projection role, persisted signing/encryption settings, operational/load checks and rebuilt images must be verified in the target deployment. Local tests alone do not establish these. |
| Retrieval quality | Labeled project-specific recall, citation precision and faithfulness evaluation remains necessary. A graph path establishes a recorded relationship; it does not prove root cause, complete coverage or a passing test. |

Primary protocol references checked during this review:
[MCP tool contracts](https://modelcontextprotocol.io/specification/2026-07-28/server/tools),
[MCP authorization security considerations](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations),
[official SDK protocol compatibility](https://ts.sdk.modelcontextprotocol.io/v2/protocol-versions),
and [official SDK stateless scaling architecture](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/sessions-state-scaling.md).
