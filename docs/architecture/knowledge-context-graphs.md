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

Trace and event metadata currently remains until its owning user or project is
deleted, which cascades through database foreign keys. Account suspension and
session archival do not purge the ledger. No automatic expiry, session purge or
per-owner storage quota is implemented. Page, event and graph response limits
bound reads rather than persisted history. Optional capture failure is exposed
as unavailable and does not invalidate saved feature work or trigger replay.
Capture deadlines bound the wait for a receipt. A database insert already in
flight can still persist after that deadline; an unavailable receipt does not
establish that no trace was stored. Immutable packet/event identities prevent
duplicate records when the same work is observed again.

## Interfaces and visualization

Native routes are rooted at
`/projects/:project_id/knowledge/context-graph`: GET lists private traces and
POST `/explore` accepts an exact `trace_id`. MCP exposes
`hellotest_context_graph_list` and `hellotest_context_graph_explore`; neither tool
records events or approves actions. History pages contain at most 20 traces.
Exploration bounds nodes, edges, event count and serialized size and reports
unavailable, stale and truncated evidence explicitly.

Knowledge and Context modes share a directed graph renderer, search/filter
controls, relationship lists and an inspector. Knowledge inspection exposes
witnesses and revisions; Context inspection exposes retrieval lineage and
occurrence/recording times. Loaded counts describe the returned subgraph. Source
opening remains restricted to authorized indexed revisions; guide and live
snapshot nodes do not pretend to be source documents.

See the [MCP tool reference](../product/mcp-tool-reference.md) and
[verification guide](../development/knowledge-context-graph-verification.md).
