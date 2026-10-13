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
