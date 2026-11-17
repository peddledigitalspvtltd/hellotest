# Knowledge Graph and Context Graph

HelloTest provides two connected views over its existing PostgreSQL evidence
ledger. Knowledge Graph explores source relationships. Context Graph inspects
the retrieval selections and recorded events associated with one private task.
No Neo4j server, Cypher endpoint or second graph database is required.

## Layers and ownership

| Layer | Stored meaning | Main implementation |
| --- | --- | --- |
| Canonical evidence | Project sources, document versions, chunks, ACLs and index readiness | Platform schema and Knowledge ingestion/authorization services |
| Knowledge Graph | Canonical source nodes and typed, witnessed source relationships | `knowledgeGraph.service.js`, projection, management and evidence services |
| Context Graph | Owner-private packet selections, exact evidence references and observed task events | `knowledgeContextGraph.service.js`; `ai_context_graph_traces` and `ai_context_graph_events` |
| MCP boundary | Verified identity, bounded retrieval and private trace reads | MCP `backplane.js`, `contextGraph.js` and `gateway.js` |

Portable request/packet/answer schemas and their bounded validator have one
runtime owner, `@hellotest/contracts/evidence`. Knowledge owns their builders,
source ACL and freshness decisions, cache admission and grounding. Generated
TypeScript declarations derive from the runtime JSON schemas. The former
Knowledge schema module remains a compatibility export of the same object;
version1.0 shapes are unchanged. Validation checks both compatible relationship
aliases independently: an empty `relationship_evidence` array cannot hide
foreign proof IDs carried by `relationships`. This closes a preexisting
invariant-enforcement gap without changing any valid packet.

The shared schema is [graphSchema.js](../../services/knowledge/backend/graphSchema.js).
Knowledge nodes retain canonical source IDs; exact aliases support resolution
without fuzzy merges. Native structural links, source-supported assertions and
observed task lineage retain different provenance. Unreviewed model candidates
do not become active facts. A relationship or graph path does not establish
causality, complete impact, an approval or a passing test.

These product layers follow the distinction between structured retrieval context
and connected knowledge/conversation/decision memory discussed by
[IBM](https://www.ibm.com/think/topics/context-graph) and
[Neo4j](https://neo4j.com/blog/agentic-ai/context-graph-ai-agent-memory/).
Their conceptual guidance does not establish HelloTest deployment or correctness.

## Quality projection and canonical identities

AI Quality Graph is a bounded revision index over current authorized Stories,
Test Cases, runs, attempts and Defects. It owns quality obligations, reviewed
assertion coverage and assessment freshness; Knowledge owns canonical source,
document and chunk identity and witnessed source relationships. These are
separate projections of the same native record identity, rather than competing
entity registries.

The `quality-graph-boundary/1` response names this boundary. Every native quality
node exposes `source_reference: {kind, ref_id}` using the Knowledge ontology's
native kind and record ID. Derived acceptance obligations and assertions retain
their parent record reference plus `derived_path`. They do not fabricate a
Knowledge source ID when that record is not indexed. Clients can resolve this
native reference through the existing permission-aware source/record boundary;
source IDs and witnesses continue to come from Knowledge. Quality projections
never promote inferred relationships into canonical Knowledge assertions.

A complete, comparable, actor-scoped snapshot can establish removal from its
quality index. An incomplete capture or lost permission cannot establish global
deletion. Every assessment rereads authoritative source scope, and source changes
invalidate retained results. Neither a quality link nor a Knowledge relationship
establishes an executed test, adequate assertion coverage or release approval.

## Current knowledge and retained context

Knowledge Graph returns authorized current sources and active assertions with
immutable version witnesses. Source/native-record deletion, archival, changed
versions, effective intervals and revoked access govern current participation.
Expansion is bounded and reports gaps; no returned path does not establish that
no relationship exists. Current graph endpoints do not reconstruct an `as_of`
historical graph. Separate historical passage retrieval retains its existing
Knowledge management permission checks.

Context capture records the returned native ContextPacket's identity, selected
source/document/chunk/version references, safe selection metadata and a query
digest. It does not copy raw prompts, source passages or hidden model reasoning.
An immutable selection digest rejects conflicting reuse of a packet identity.
Existing messages and runs are not silently backfilled into the new ledger.

Capture occurs at the MCP retrieval stage. A host can subsequently shorten or
omit evidence while constructing its model request. Context edges therefore use
`RETRIEVED_EVIDENCE`, with `stage:retrieval_result` and
`model_input_verified:false`. They establish returned retrieval provenance rather
than provider consumption or support for every generated claim. Chatbot and
specialist hooks add observed terminal/proposal events after their native result
is persisted. Missing decisions, approvals and execution outcomes remain missing.
This preserves the distinction between entities, activities and agents expressed
by [W3C PROV-DM](https://www.w3.org/TR/prov-dm/).

## Relationship coverage and traversal

- **One ontology.** Node kinds, relation types and the kind-to-permission map are defined once in `knowledgeOntology.js`. The graph contracts, the Zod enums and the SQL `CHECK` constraints are generated from that definition, and the constraints change through a recorded, versioned migration instead of a one-off `ALTER`. A test proves the migration applies to an existing database exactly once.
- **Display IDs resolve.** A seed or exact query such as `STORY-12`, `TC-1` or `BUG-1` resolves to its source node. The display ID is stored as an alias at projection time and survives re-projection next to curated aliases. An identifier that matches nothing, or several records, anchors nothing: the graph never guesses.
- **`MENTIONS`.** Free-form text (notes, chat, files) that quotes the exact display ID of an indexed record gets a `MENTIONS` edge whose witness is the mentioning passage. It is deliberately weaker than a native link or a source-explicit assertion, carries its own provenance, and closes when a later revision of the text drops the mention.
- **Links to records that are not indexed yet** are written to a ledger and retried with exponential back-off instead of every minute. When the missing record is indexed, the documents waiting on it are queued at once and both ends connect.
- **One query per hop.** Expansion sends the whole frontier in a single query. Source permissions, readiness, ACLs and proof checks apply before each node's fanout window, so a hidden source can neither leak a title nor use up another node's fanout. `preferRelations` orders that window, so a tight fanout cap keeps the relation types the question is about.
- **A trace meets in the middle.** `hellotest_graph_trace` walks forward from the source and backward from the target and joins the halves, so a path costs about half its length in expansion levels from each end. All three directions (`outbound`, `inbound`, `both`) are valid and are tested against real PostgreSQL.
- **Budgets are bytes.** Graph packets are measured in UTF-8 bytes (`maxBytes`, 256–8,000, default 4,000; `maxTokens` remains an alias). Real citations carry several hashes each, so a request expected to return more than a couple of citations should raise it.
- **Questions anchor the walk.** Retrieval resolves the identifiers a question names and starts the graph walk there, returning the neighbouring records' content under their own source access rather than only the proof of the link. A question that names no identifier gets no graph anchor.

Not yet modelled: `EXECUTED_IN` (execution to environment and configuration) needs new node kinds and a decision on their permission mapping. Until then those questions are answered from passage retrieval.

## Authorization and source states

Trace queries bind both project and owner to the verified caller. Project
membership, active account, Knowledge permissions and feature availability are
checked again when reading. Even another project member cannot select someone
else's trace through these endpoints. Current source, document, fragment, native
record and application checks apply to each returned evidence reference.

A denied selected fragment is omitted with its identifying metadata even if a
different fragment of that source remains readable. An accessible exact old
revision can retain historical selection metadata with a stale state. Expired,
not-yet-valid and unknown validity are distinguished. Source nodes with differing
retained states use `MIXED`; missing details remain explicit gaps.

Live project references use strict same-project identities and current native
permissions, including the collaborators declared by the original snapshot.
Missing or truncated declarations retain conservative permission requirements.
They appear as `RECORDED_SNAPSHOT`, without creating a fictitious indexed
Knowledge node or claiming that former snapshot content still matches live
records. Built-in product guidance is a versioned guide, not an indexed source.

## Time, identity and retention

Events retain `occurred_at` and database `recorded_at` separately. Recording time
drives history filters and recorded labels; occurrence time orders the event
timeline. Source effective intervals describe assertion validity independently.
These are application-specific semantics over the instants and intervals modeled
by [W3C Time Ontology](https://www.w3.org/TR/owl-time/).

Trusted in-process feature/session/task metadata can label a trace. Remote MCP
credentials establish signed principal/project/client scope; they do not carry a
caller-supplied task identity grant. Missing remote feature/session labels remain
generic `mcp.context` observations. Past traces never grant current authority.

Trace metadata expires by feature: assistant/MCP observations default to 30
days, agent runs to 90 days and other features to 60 days. A global or
feature-specific `HELLOTEST_CONTEXT_TRACE_RETENTION_DAYS_*` value can set 7–365
days. The hourly retention worker deletes expired trace identities; database
cascades remove their decision events and partitioned evidence payloads.
Large evidence, coverage and selection payloads are stored in monthly partitions;
the small unpartitioned trace directory remains the stable target for event
foreign keys and owner-scoped identity checks. Migration creates the current and
next 24 monthly partitions, and a daily maintenance worker keeps the horizon
ahead of time.

Capture is sampled deterministically by packet identity: assistant/chat and MCP
features default to 100%, agent features to 20%, and other features to 10%.
Feature-specific `HELLOTEST_CONTEXT_TRACE_SAMPLE_RATE_*` overrides accept 0–1.
Sampling occurs only after identity, packet and project authorization checks;
sampled-out receipts are explicit and do not create rows. Health metrics describe
observed traces and are not extrapolated to unsampled traffic. Optional capture
failure remains unavailable and does not invalidate saved feature work or
trigger replay. Capture deadlines bound the wait for a receipt. A database
insert already in flight can still persist after that deadline; an unavailable
receipt does not establish that no trace was stored. Immutable packet/event
identities prevent duplicate records when the same work is observed again.

## Interfaces and visualization

Native routes are rooted at
`/projects/:project_id/knowledge/context-graph`: GET lists private traces,
GET `/health` returns de-identified 30-day source/query-class aggregates, and
POST `/explore` accepts an exact `trace_id`. Health metrics require five distinct
actors per cohort and recheck source permissions before counting selected,
submitted or cited evidence. MCP exposes
`hellotest_context_graph_list` and `hellotest_context_graph_explore`; neither tool
records events or approves actions. History pages contain at most 20 traces.
Exploration bounds nodes, edges, event count and serialized size and reports
unavailable, stale and truncated evidence explicitly.

Knowledge and Context modes share a directed graph renderer, search/filter
controls, relationship lists and an inspector. Knowledge inspection exposes
witnesses and revisions; Context inspection exposes retrieval lineage and
occurrence/recording times. Its health summary shows only cohorts with five or
more distinct actors. Loaded counts describe the returned subgraph. Source
opening remains restricted to authorized indexed revisions; guide and live
snapshot nodes do not pretend to be source documents.

See the [MCP tool reference](../product/mcp-tool-reference.md) and
[verification guide](../development/knowledge-context-graph-verification.md).
