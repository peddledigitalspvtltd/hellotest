# Knowledge Repository and AskHelloTest context engine

This implementation applies the attached engineering blueprint to the existing
Fastify, PostgreSQL, Qdrant, and React application. It introduces reusable
contracts and execution boundaries while retaining existing integrations,
ingestion jobs, project permissions, and assistant conversations.

## Repository evidence and lifecycle

- A source ID identifies the canonical artifact, a document ID identifies an
  immutable revision, and a chunk ID identifies a citable fragment.
- A new revision becomes current only after its required indexes are ready.
  Promotion expires the old revision transactionally; a partial unique index
  prevents multiple current revisions. Failed indexing preserves the prior
  usable revision.
- Source archival tombstones immediately, cancels ingestion, and retains
  revision history. Index deletion is cleanup, not the authorization boundary.
- Source, revision, and fragment bindings apply before lexical/vector retrieval,
  again during result hydration, and before answers are saved. Explicit DENY
  outranks explicit ALLOW, inherited DENY, inherited ALLOW, and default DENY.
  Existing project-readable sources retain inherited project access.
- Source inspection shows the index state, effective revision intervals,
  permitted fragments, and a schema-validated KnowledgeObject. Restricted
  fragments are omitted; whole-file downloads are blocked if they would expose
  restricted fragments. History and archived-source audit require
  `knowledge.manage`.

## Context retrieval

`knowledgeContextEngine.service.js` is reusable independently of chat generation.
It combines current permitted project snapshots with hybrid indexed retrieval,
reciprocal-rank fusion, bounded adjacent fragments, and explicit authorized
relationships. Search expansion retains the original question and rejects
unrelated or repeated proposed queries. Novelty uses evidence identities.

Execution bounds cover deadlines, rounds, queries, tool calls, candidate counts,
and context size. Reads that cannot be cancelled in the database are no longer
awaited after their deadline; embedding and vector requests receive cancellation
signals. Retrieval returns partial evidence when a dependency or budget limits
coverage. Progress events describe actual work and never expose model reasoning.

The five executable version `1.0` contracts are KnowledgeObject,
RetrievalRequest, RetrievalEvent, ContextPacket, and AnswerContract. Their
schemas and runtime validation live in `knowledgeContractSchemas.service.js`.
The legacy schema identifier remains available as `schema_id` for migration.

## Answer and conversation behavior

- Evidence-only mode skips answer generation and model planning explicitly.
- Planning and synthesis receive bounded, authorized packets. Retrieved material,
  reviewed context, and conversation references are untrusted data.
- Answers displayed and persisted are rebuilt from validated claims. Unknown or
  mixed invalid citation IDs reject the entire claim; arbitrary model summaries
  do not bypass that boundary.
- Direct extracts and trusted server-derived live summaries can be supported
  claims. Other citation-bound paraphrases are labeled **Interpretation**.
  Citation binding is not represented as calibrated semantic entailment.
- Presentation is an allowlisted data structure: text, table, timeline,
  relationship graph, comparison, metric, document results, or image results.
  The renderer never executes provider-authored HTML or JavaScript.
- History and idempotent replays recheck current source access. Revoked evidence
  removes the stored answer and packet from the response. Old live snapshots
  are omitted from model conversation memory; current project facts are fetched
  again. Conversations can be renamed and archived.
- Cancelled turns are immediately retryable with their original client turn ID.
  Replays do not insert duplicate messages. Changing the question, selected
  scope, reviewed context, response mode, or integration requires a new turn ID.

## API additions

| Endpoint | Result |
| --- | --- |
| `POST /v1/context/retrieve` | Authorized ContextPacket without answer generation |
| `POST /v1/context/retrieve-stream` | RetrievalEvent progress and ContextPacket result |
| `POST /knowledge/assistant/sessions/:id/messages/stream` | Progress and validated assistant result |
| `PATCH /knowledge/assistant/sessions/:id` | Rename or archive an owned conversation |
| `GET /knowledge/sources/:id` | Source, revision, visible fragments, KnowledgeObject |
| `GET /knowledge/sources/:id/revisions` | Authorized revision history |
| `PUT /knowledge/sources/:id/security` | Replace source/revision/fragment bindings |

Streaming uses authenticated POST fetch with `progress`, `answer_delta`, `result`, and `error`
SSE events. Disconnect aborts work. Client retries preserve the selected scope,
model, response mode, and turn ID. Server identity and permissions are never
taken from client-supplied authorization fields. OpenAPI documents the routes.

## Model gateway and operational limits

The gateway currently ships the existing OpenAI-compatible protocol adapter;
the adapter registry is the extension point for other provider protocols. It
records reported token usage and configured-price costs, caps output tokens,
counts failed attempts, and propagates cancellation. Unknown usage/cost stays
null. Explicit cost-limited requests require configured input/output pricing;
requests that cannot fit the conservative estimate fall back to evidence.
Explicit cost-limited retrieval uses lexical search to avoid unpriced embedding
calls; ordinary requests retain hybrid search. These modes are recorded in the
retrieval metadata.

This change does not claim a measured 100x improvement. Native Anthropic/Gemini
adapters, a calibrated entailment model, new OCR/ASR or multimodal embedding
pipelines, additional external connectors, and physical tenant/shard isolation
are separate follow-on work. Existing media extraction capabilities remain the
available ingestion surface. No generated image evidence is invented.

## Validation

Run focused checks with:

```sh
node --test services/platform/backend/test/knowledge*.test.js
KNOWLEDGE_POSTGRES_TEST=1 node --test services/platform/backend/test/knowledgeRepositoryLifecycle.test.js
node services/platform/backend/eval/knowledge/run.js /tmp/knowledge-evaluation.json
```

The PostgreSQL integration uses temporary tables and covers failed index
promotion, current/history semantics, fragment denial before vector retrieval,
hydration, source inspection, and archive revocation. Assistant tests cover
evidence-only generation, validated persistence, same-turn replay, cancellation,
changed-scope conflicts, and history revocation. Frontend tests cover split UTF-8
streams, cancellation/retry, safe presentations, citations, and source workflows.

The deterministic evaluation fixtures report boundary exposure and basic
retrieval/grounding metrics. They are not a production relevance goldset or a
provider prompt-injection benchmark; those quality measurements remain explicitly
uncalibrated. Live visual verification requires an available in-app browser.

## Chatbot request and transport budgets

The chatbot uses a 120-second turn deadline. Planning has a 12-second budget; synthesis is capped at 65 seconds and the remaining turn budget. Retrieval receives the remaining turn time with 12 seconds reserved for finalization. MCP normalizes retrieval deadlines (default 15 seconds, maximum 60 seconds); its transport adds two seconds for packet assembly and remains capped by the caller's remaining deadline. The frontend transport timeout is 210 seconds. A transport timeout does not authorize work beyond the server deadline.

The gateway verifies the packet project against the authenticated request project. Missing project identity is rejected. Source selection, evidence limits and fresh permission decisions apply before sources enter the model context. SSE progress and `answer_delta` events preserve paragraph and Markdown boundaries; the final result replaces the accumulated answer. Disconnect cancels request-scoped work.

## Context graph beside vector retrieval

The graph uses PostgreSQL beside the existing vector store. Canonical source IDs
identify nodes; immutable document/version/hash and chunk IDs identify every
relationship witness. The graph does not replace vector search or introduce a
second MCP server. See [MCP setup and tools](mcp.md) for the authenticated endpoint.

The initial ontology follows existing application records: Story (`requirement`),
Test Case, Test Run (`execution`), Defect (`bug`), Knowledge item, text, chat, file,
and URL. Supported links are `TESTS`, `EXECUTED_IN`, `HAS_DEFECT`, `RELATED_TO`,
`DEPENDS_ON`, `DERIVED_FROM`, `USES`, and `PART_OF`. This is a source-level graph;
filenames and arbitrary name similarity do not establish services, releases,
repository symbols, or ownership. New semantic entity types need explicit source
adapters and permission contracts before expanding this ontology.

Native serializers provide deterministic links, such as Test Case → Story and
linked Story/Test Case/Test Run → Defect. A reference must occur in the immutable source passage.
The projection is written in the canonical document activation transaction.
Bounded worker backfill handles existing documents and retries references whose
target source has not yet been indexed. Versions without current proof cannot
participate in retrieval. Source archival hides its node immediately; background
cleanup reconciles native records that were deleted outside Knowledge Repo.
Native graph endpoints and proofs also check the current application record at
read time, so a deleted native record is hidden before that cleanup tick runs.

Repository Knowledge Builder acceptance uses this same ingestion boundary.
The durable legacy-item sync retains an explicit, bounded repository provenance
allowlist: run/finding key, repository revision, relative file/line evidence,
content hash and excerpt coverage. It discards client authorization metadata and
keeps static evidence unverified at runtime. Provenance changes invalidate reuse
of an older document; missing source projections are repaired by promoting a
complete new immutable revision. The repository publication status endpoint
reports graph/context readiness only for the exact current source, document and
fragment projection. These are source evidence nodes; acceptance does not infer
repository dependency or ownership relationships from file names.

Entity resolution uses exact canonical IDs, typed native keys, names and curated
aliases. It returns ambiguity instead of selecting a similar record. Knowledge
managers can edit aliases with optimistic revision checks. Conflicting aliases
cannot silently merge different native records. The native record IDs remain
unchanged.

`Knowledge Repo → Graph` shows verified links, their source excerpts and revisions,
plus a separate suggestion queue. Optional **Suggest links** reads at most eight
bounded excerpts from 2–12 explicitly selected, permitted records, makes at most
one model call, and validates exact entity IDs, chunk IDs and verbatim evidence.
It neither invents nodes nor promotes suggestions. Prompts, provider selection,
sampling and the additional output contract are managed under **AI Controls →
Knowledge relationship extraction** (`ai.knowledge.graph_extract`); ordinary
graph ingestion and traversal need no model call.

Approvals require `knowledge.manage` and current access to both endpoints and the
exact proof. A review revision binds the relationship, proof document/hash/span,
and both endpoint document revisions and curated aliases. Each resubmission has
a unique proposal revision, including when its text is unchanged. A changed revision, denied fragment or
replayed approval is rejected. Reviewed suggestions become `HUMAN_VERIFIED`;
unreviewed/rejected model output never becomes factual retrieval context. Curation
can renew a human-reviewed link after its last current proof expires, with a new
review and retained historical witnesses. Existing current facts remain protected,
including when their supporting source is private to another reader. Curation
events record actor, project, IDs and hashes in the existing audit log, without
copying source text into it. MCP graph tools are read-only and cannot approve a
candidate through a generic mutation.

Traversal authorizes every intermediate node and witness **before** the per-node
fan-out limit. Depth is at most three hops, with explicit bounds on seeds, fan-out,
nodes, edges, evidence, deadline and context size. It rechecks permissions and
current versions, then reconstructs reachable paths so revoked intermediate
records cannot survive in path IDs or disconnected descendants. Result packing
preserves endpoints and supporting evidence together and reports omissions.
The token estimate uses a conservative UTF-8 byte bound over the whole returned
graph envelope; it is not measured provider billing. Too small a budget produces
an explicit budget error. A bounded missing path is an evidence gap, not proof of
independence, root cause, complete coverage or a passing test.

Authenticated REST endpoints live under
`/projects/:project_id/knowledge/graph`: schema, `resolve`, `expand`, bounded
`reconcile`, node `aliases`, `candidates`, candidate `review`, and opt-in `extract`.
MCP exposes the same domain through `hellotest_graph_schema`,
`hellotest_graph_context`, `hellotest_graph_trace`, and the project ontology
resource. Both paths use existing project, feature, native permission and
source/document/fragment checks. They expose neither arbitrary SQL/Cypher nor
client-selected actor credentials.

## PostgreSQL and Qdrant consistency

`ai_knowledge_vector_jobs` is a durable projection journal, separate from the
legacy Knowledge-note synchronization outbox. Canonical publication and source
tombstoning enqueue a target in the same PostgreSQL transaction. The existing
worker reconciles Qdrant with current canonical chunks and stored embeddings,
verifies exact IDs and payloads, and retries failures with backoff. Retrying does
not require another embedding/model call. Already acknowledged batches are
verified before any missing or drifted batch is upserted. The code no longer
deletes a usable projection before publishing the replacement.

The journal survives source and project hard deletion. Cleanup discovers owned
collections from Qdrant after process restart, rather than relying on a warm
in-memory collection cache, and scopes deletion to the exact project/source.
Reconciliation periodically checks acknowledged projections too, so lost points
can be restored. A deadline callback performs external I/O only; readiness writes
occur after acknowledged completion and cancellation/configuration checks.

There is no distributed PostgreSQL/Qdrant transaction. PostgreSQL remains the
source of truth; Qdrant is an eventually consistent projection. Mandatory
authorized PostgreSQL chunk IDs constrain vector queries and hydrated results.
The journal prevents new untracked failures and backfills existing live or
tombstoned sources. It cannot identify a legacy source that was hard-deleted
before the journal existed and left no canonical record; inventory cleanup for
such unknown points is not claimed. Changing the configured Qdrant endpoint or
collection prefix also requires an operator-owned retention decision for the old
store.

Unchanged document fingerprints skip reprocessing. Changed revisions reuse
compatible unchanged chunk embeddings only within the same project/source and
embedding configuration; changed or incompatible chunks are embedded again.
Graph extraction is deterministic by default, so paragraph edits do not trigger
an automatic full-document relationship LLM pass. Existing refresh controls scan
native records incrementally. External Jira/Git webhooks and source-deletion
notifications still require source-specific connectors; an absent record in a
partial import is not treated as a deletion.

## Attachment review and operational validation

The supplied `files.zip` / `qaira-contextgraph.zip` was inspected as reference
source only. Its plain-PostgreSQL graph, chunk bridge and rule-first adapters
inform this implementation. Its unauthenticated Python MCP server, fuzzy
automatic merges, ungrounded-span confidence discount, unbounded intermediate
walk and external vector writes inside an open SQL transaction were not copied.
Its sample impact questions are illustrative, not QAira relevance benchmarks.

Schema 11 adds the graph tables, projection state and vector journal. Run the
normal deployment migration before starting a `HELLOTEST_SCHEMA_MODE=verify`
API; both upgrade statements and fresh-instance SQL include these tables. No
Neo4j/AGE service, Python daemon, new secret, or new browser driver is required.

Focused checks:

```sh
node --test services/knowledge/test/backend/knowledgeGraph*.test.js
npm run test:mcp
npm run test:mcp:postgres
npm run test:knowledge:postgres
VITE_TEST_URL=http://127.0.0.1:5197 node --test services/knowledge/test/browser/knowledgeGraph.test.mjs
```

The MCP integration creates and drops a local disposable database. It verifies
real SDK calls, reviewed graph facts, immutable witnesses, Unicode offsets,
cross-project/application scope, denial, alias conflicts and stale/replayed
approvals. Vector integration additionally uses a uniquely named local Qdrant
collection and temporary SQL ledger tables, then removes that collection. Its
opt-in environment/connection requirements are documented in
`services/knowledge/test/backend/knowledgeVectorConsistency.postgres.test.js`.
Provider boundaries in extraction tests are mocked; live model quality, semantic
recall and cost improvements require a labeled project-specific evaluation set.

Primary references: [PostgreSQL recursive query behavior](https://www.postgresql.org/docs/current/queries-with.html),
[Qdrant point idempotence](https://qdrant.tech/documentation/concepts/points/),
and [MCP tool contracts and access controls](https://modelcontextprotocol.io/specification/2026-07-28/server/tools).

## MCP and graph integration review, 22 October 2026

The production retrieval merger now admits exact authorized graph witnesses
through their reviewed relationship provenance even when their similarity score
is zero. It preserves the native graph contract during expansion. Shared LLM
enrichment and provider size correction carry the resulting relationships with
their exact delivered proofs; missing, modified or truncated proof text removes
the dependent relationship and reports an omission. A retained citation ID alone
cannot establish a discarded relationship witness.

MCP now exposes the existing exact node/curated-alias resolver and uses a reusable
Knowledge exact-evidence reader. The reader rechecks source/document/fragment
ACLs and current native record/index/version gates during hydration. Fetches
retain immutable document, version and chunk identity, with optional expected
document/hash checks and explicit display-redaction metadata. Historical access
retains its existing permission boundary.

The [combined architecture review](../research/mcp-context-knowledge-review-2026-10-22.md)
records the real route/tool coverage, corrected implementation gaps, real
PostgreSQL/SDK checks and remaining wrapper/deployment limits. It also documents
source revision pinning for reviewed execution plans and original-record
reconciliation for uncertain Test Case/Execution create receipts.
