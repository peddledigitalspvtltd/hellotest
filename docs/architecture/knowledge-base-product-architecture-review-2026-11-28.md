# AI Knowledge Base: product-architecture review, gaps and improvement plan

Review date: 28 November 2026. Reviewer stance: product architect. Scope: the
Knowledge capability (`services/knowledge`), its consumers (`services/chatbot`,
`services/mcp`, `services/agentic`, `services/automation`, `services/ai`) and
the shared platform pieces it depends on.

**Method and limits.** This is a static, code-and-document review of the
checkout at `main` (the Knowledge and chatbot trees had no uncommitted changes
when reviewed). Nothing was run against a live database or provider. Statements
marked **(verified in code)** were read in the cited file. Statements marked
**(inferred)** follow from the code but were not exercised. Existing measurements
in earlier reviews are quoted as theirs, not re-measured. The earlier reviews
([context architecture](knowledge-context.md),
[2 Nov review](knowledge-mcp-chatbot-review-2026-11-02.md),
[16 Nov progress](knowledge-mcp-chatbot-review-progress-2026-11-16.md)) are the
baseline; this document does not repeat their closed findings.

---

## 1. Verdict

The Knowledge Base is an unusually strong **evidence-governance and retrieval
core** and a comparatively thin **knowledge product**.

- As a *trustworthy retrieval substrate* for QAIra's own records (Stories, Test
  Cases, Runs, Defects) it meets its intent: immutable revisions, three-level
  ACLs enforced before and after retrieval, hybrid lexical/vector/graph
  retrieval, witnessed graph relationships, bounded and cancellable execution,
  cost-aware modes, and a replayable context ledger.
- As a *knowledge base people maintain, trust over time, and that makes every AI
  feature smarter*, it falls short. Four things hold it back: (1) what can go in
  is narrow and partly pointer-only; (2) nothing tells you whether the content is
  stale, duplicated or contradictory; (3) there is no feedback loop from users or
  outcomes back into quality; (4) most AI features reach it only through
  explicit, hand-wired paths rather than by default.

The most consequential single finding: **with no embedding model configured the
"semantic" channel is a degraded local hash vector** (verified in code,
`knowledgeOverview.service.js:92`, `knowledgeEmbeddingRuntime.service.js`), and
the embedding setting was deliberately retired from the integration form
(`docs/research/knowledge-reliability-review.md`). A default install therefore
runs lexical-plus-graph retrieval and presents itself as an "AI" knowledge base.
The system is honest about this in diagnostics, but a user cannot see or fix it
from a first-class screen.

### Scorecard

| Dimension | Rating | One-line basis |
|---|---|---|
| Access control and evidence integrity | Strong | Source/revision/fragment ACL before and after retrieval; DENY precedence; replay re-checks |
| Retrieval engine | Strong, gated by config | RRF over lexical, dense, graph; reranker adapter exists but is env-only and off |
| Graph and lineage | Strong for source-level graph | Witnessed edges; no entity layer |
| Ingestion breadth | Weak | Text/Office via optional Tika; media and URLs are not extracted |
| Knowledge lifecycle and quality | Weak | Content hash dedup only; no staleness, ownership, contradiction handling |
| Feedback and learning | Absent | No answer rating, no miss capture, privacy floor hides small-team analytics |
| Administration UX | Partial | ACL editing and reranker/embedding setup are API/env only |
| Ecosystem integration | Partial | MCP/workflow node/chatbot yes; test-design AI and quality agents opt-in |
| Operability at scale | Good design, unproven | Fair queues and leases; per-process caches; large service files |
| Evaluation | Good for a curated set | 120-question curated benchmark; no real-traffic or faithfulness measurement |

---

## 2. Intended feature, as the repository defines it

Derived from the architecture documents and code, the intended product is:

1. **A governed repository of project evidence**: native records plus
   user-supplied files, notes, conversations and URLs, each with a canonical
   source ID, immutable document revisions and citable chunks.
2. **Permission-true retrieval**: nobody retrieves, sees in a graph, or receives
   in an answer anything their current permissions deny, including after
   revocation mid-turn.
3. **Context for humans and agents**: Ask HelloTest (chat), the MCP server, and
   workflow nodes consume the same ContextPacket contract with citations,
   limitations and budgets.
4. **Relationship intelligence**: a Knowledge Graph of witnessed links, plus a
   private Context Graph of what a task actually retrieved.
5. **Honest degradation**: partial evidence, labelled fallbacks, never an
   invented citation.
6. **Freshness without babysitting**: transactional outbox plus periodic refresh
   keeps native records current.

Items 1 to 5 are largely delivered. Item 6 is delivered for native records only
(section 4.3). What is *not* in the stated intent, but is what users of a
"knowledge base" expect, is covered under feature gaps.

---

## 3. Capability map: what exists

| Layer | Capability | Primary code |
|---|---|---|
| Sources | Native kinds: requirement, test_case, execution, execution_result, bug, test_suite, test_module, release, sprint. Free-form: knowledge_item, text, chat, file, url | `knowledgeOntology.js` |
| Ingestion | Upload (multipart, idempotency key), selected-record import, background jobs with leases, retry cap of 5, fair per-project queue | `knowledgeIngestion.service.js` (1,891 lines) |
| Extraction | Native text decode; Apache Tika for PDF/OOXML/ODF when configured; 20 MB default cap; PDF OCR off | `knowledgeRag.service.js:303-345`, `knowledgeProcessing.service.js` |
| Chunking | Structure-aware, 1,600 chars / 220 overlap default, 4,000 max, fixed or structural strategy, heading paths | `knowledgeProcessing.service.js:337` |
| Indexing | PostgreSQL `tsvector` (GIN), local hash vectors, optional provider embeddings, optional Qdrant projection with journal, typed pgvector HNSW once enough rows | `knowledgeSearch.service.js`, `knowledgeVectorStore.service.js`, `knowledgeVectorIndex.service.js` |
| Retrieval | Lexical, dense, graph channels; RRF (k=60); per-source caps with pinned depth; optional cross-encoder rerank; aggregate intents; as-of (historical) filter | `knowledgeRanking.js`, `knowledgeReranker.js`, `knowledgeContextEngine.service.js` |
| Graph | Typed ontology (9 relations), deterministic and source-explicit edges, reviewed LLM suggestions, bidirectional bounded trace | `knowledgeGraph*.js` |
| Context ledger | Private per-owner traces, sent vs cited evidence, TTL, monthly partitions, k-anonymous aggregates | `knowledgeContextGraph.service.js`, `knowledgeContextHealth.js` |
| Assistant | Intent plan, retrieval, grounded synthesis, claim validation, streaming, session focus | `chatbot/.../knowledgeAssistant.service.js` (1,465 lines) |
| Agent surface | MCP read tools (`context_build`, `graph_*`, `knowledge_fetch`, `knowledge_source_get`, collections), OAuth, workflow `knowledgeTool` node | `services/mcp/backend`, `agentic/.../knowledgeTool.js` |
| Freshness | Native outbox (2 s), refresh scan, nightly reconciliation, embedding-config backfill | `workers.js` |
| UI | Knowledge Repo page, Context Studio (sources, builder, graph, context graph), refresh control | `services/knowledge/frontend` |

---

## 4. Feature-capability gaps

Priority: **P0** blocks the product's core promise; **P1** materially limits
value; **P2** improves maturity. Effort: S under 1 week, M 1 to 3 weeks, L over 3.

### 4.1 Ingestion breadth

**F1. Media is accepted but not searchable (P0, M).** Images, audio and video
are valid upload types (`MEDIA_MIME_TYPES`) yet there is no OCR, vision caption
or ASR path. Without caller-supplied `extracted_text` the source is stored as
`metadata_only` with the warning "needs extracted_text, a caption, a transcript"
(verified in code, `knowledgeIngestion.service.js:1627-1650`). PDF extraction
sends `X-Tika-PDFOcrStrategy: no_ocr`, so scanned PDFs silently yield nothing.
For a QA product, screenshots, UI mocks, recorded defects and scanned specs are
primary evidence. Users are shown an upload that succeeds and never answers
questions. *Target:* an extraction-provider port with OCR (Tika/Tesseract),
vision-model captioning governed by AI Controls, and ASR for audio/video, each
producing exact-offset text so citations remain verifiable. Mark extraction
confidence on the chunk and show "extracted by OCR" in the citation.

**F2. URL sources are bookmarks, not knowledge (P0, M).** The Studio's "URL
reference" stores `source_uri` and the typed text only; there is no fetcher
(verified in code: no fetch/crawl path in `knowledgeIngestion.service.js`; UI
copy "URL references"). The 2 Nov review itself notes "a URL pointer alone does
not establish that its contents were fetched." *Target:* a bounded, SSRF-safe
fetcher (allow-list and egress policy, robots, size/time caps, content-type
gate, HTML-to-text with main-content extraction), snapshotting each fetch as an
immutable revision with the fetch time and ETag, and a per-source re-fetch
schedule.

**F3. No external connectors (P1, L).** Confluence, Jira, SharePoint/Drive,
GitHub/Git, Slack/Teams and Notion are absent; the docs say so explicitly
("source-specific connectors" are future work). The "Jira" and "defect"
workflows in QAIra therefore cannot share their narrative context with the KB.
*Target:* a connector SDK on the existing integration capability (credentials,
scopes, rate limits), with incremental sync via cursors, delete propagation, and
source-system ACL mapping into `ai_knowledge_security_bindings`. Start with Git
(repo docs/ADRs) and Jira/Confluence because they match QAIra users.

**F4. Native coverage stops at records, not their rich content (P1, M).** The
native kinds omit shared steps, step-level comments, attachments and screenshots
on runs, run logs and failure traces, test data sets/parameters, environments and
configurations, and the automation object repository. Some of these appear only
as *live snapshot* scopes (`execution-context`, `object-repository`), which are
recomputed per query, are not citeable as immutable versions, and cannot be
graph nodes. Failure logs in particular are the highest-value content for
triage and are not retrievable by similarity. *Target:* promote each to an
indexed native kind with its own permission mapping (the `PERMISSION_BY_KIND`
table is the extension point), and chunk failure logs with error-signature
normalisation.

**F5. Single-project boundary, no shared knowledge tier (P1, M).** Retrieval is
always project-scoped; there is no workspace- or organisation-level collection
for test standards, naming conventions, compliance rules, or a shared glossary
that every project should inherit. *Target:* a `scope = workspace` collection
type with read inheritance into projects, an explicit per-project opt-out, and
visible provenance ("from Workspace Standards").

### 4.2 Knowledge quality and lifecycle

**F6. No staleness, ownership or review cycle (P0, M).** Documents carry content
hashes and revisions, but there is no `owner`, `review_due`, `expires_at`,
`last_verified`, or trust tier. A note written two years ago and a note approved
yesterday rank identically apart from lexical/vector score. In QA, outdated
guidance is more dangerous than missing guidance because the model cites it
confidently. *Target:* lifecycle metadata on user-authored sources, a freshness
signal in ranking (decay only for sources that declare a review interval), a
"needs review" queue, and answer-level labelling ("based on a source not
reviewed since ...").

**F7. Duplicate and contradiction handling is exact-hash only (P1, M).**
Deduplication uses SHA-256 of content (`checksum_sha256`, chunk fingerprints).
Near-duplicates (the same spec exported twice with a changed header) and
conflicting sources are not detected. With RRF and per-source caps, duplicates
crowd out diverse evidence. *Target:* shingle/MinHash near-duplicate clustering
at ingest, a "likely duplicate of" prompt, and a contradiction check that runs
only on retrieved candidate pairs at query time (cheap, bounded), surfacing
"sources disagree" in the ContextPacket rather than letting the model pick.

**F8. No curation workflow for free-form content (P1, M).** Knowledge
management is create/replace/archive. There is no draft, approve, publish state
for notes and rules, although the graph layer already has a review workflow and
agents already publish into the KB (`knowledgePublication.service.js`). Agent- or
user-proposed knowledge should be a *candidate* until approved, mirroring graph
candidates. *Target:* a candidate state with reviewer assignment, diff against
the prior revision, and approval audit.

**F9. Quality scoring exists but is not actionable (P2, S).** `assessContextQuality`
computes duplicate, undersized and heading ratios, but the result is not turned
into a repair queue (re-chunk with another strategy, split, merge, add headings).
*Target:* surface per-source quality with one-click re-chunk and per-source
chunking profile.

### 4.3 Freshness and sync

**F10. External-change freshness is polling or manual (P1, M).** Native records
are event-driven; everything else relies on re-upload. Combined with F2 and F3
there is no way to keep a non-native source current. Source deletion in an
external system is not propagated (docs: "an absent record in a partial import is
not treated as a deletion"). *Target:* webhooks plus cursor polling per
connector, tombstone propagation, and a per-source "last synced / next sync /
failure reason" in the UI.

### 4.4 Feedback and learning

**F11. No answer feedback loop (P0, S to M).** No thumbs, correction, "wrong
source", or "missing knowledge" action exists on Ask HelloTest answers (searched
`services/chatbot` and `services/knowledge`: no feedback persistence). The
context ledger records what was sent and cited, which is observation, not
judgement. Consequently retrieval quality cannot improve from use, and the team
cannot tell which questions fail. *Target:* per-answer helpful/unhelpful with a
reason taxonomy (wrong, outdated, missing, unsafe), "this source is wrong"
pointing at a cited chunk, stored against the trace ID, with a project admin
triage view.

**F12. Knowledge gaps are not captured (P1, S).** When evidence is insufficient
the assistant says so, but the unanswered question class is not aggregated into
a "what should we document" list. *Target:* a gap register built from
`INSUFFICIENT`/`PARTIAL` traces by query class and entity, deduplicated, with a
"create note from this question" action.

**F13. Analytics are hidden from small teams (P1, S).** `MIN_ACTORS = 5` in
`knowledgeContextHealth.js` suppresses every aggregate unless five distinct users
contributed. The privacy rule is sound for cross-user disclosure but makes the
health view empty for the many projects with fewer than five users, and for the
owner's own data. *Target:* show a user their own aggregates always; keep the
k-anonymity floor only for cross-user views; allow a project admin to opt the
project into named analytics under a documented policy.

**F14. No real-traffic evaluation (P1, M).** The benchmark is 120 authored
questions over 317 seeded records; the 16 Nov review states real-traffic recall,
claim faithfulness and reranker uplift are unmeasured. Feedback (F11) is the
natural source of labels. *Target:* a consented sampling pipeline that turns
rated answers into regression cases (with source text redacted), and a human
claim-review queue for a small monthly sample.

### 4.5 Administration and transparency

**F15. Security bindings have no UI (P0 for enterprise, M).** The API supports
source, revision and fragment bindings (`PUT /knowledge/sources/:id/security`),
and the engine enforces them rigorously, but the Knowledge frontend has no screen
to view or edit them (no security calls in `frontend/api.client.ts` and no
related component). Managers must call the API. A control that cannot be
inspected is hard to trust and hard to audit. *Target:* an access panel on the
source detail showing effective access per role/user with "why" (the winning
binding), a dry-run "what can user X see", and bulk apply to a collection.

**F16. Retrieval configuration is not a product setting (P0, S).** Three
settings determine whether the KB is semantic and how well it ranks, and none is
a first-class screen: the embedding model (retired from the integration form;
configured only through the integration's `embedding_model`), the cross-encoder
reranker (`KNOWLEDGE_RERANKER_URL` and four sibling env vars, referenced only in
`knowledgeReranker.js` and its test), and the Qdrant vector store (config
only). A new tenant cannot tell they are on the degraded path without reading the
overview's `mode`. *Target:* a "Retrieval health" card: embedding mode
(semantic vs local-hash), vector store state, reranker state, backfill progress,
with guided setup and a "test retrieval" button. Add reranker and embedding
selection to AI Controls alongside the existing `ai.knowledge.*` keys, and add
the reranker variables to `development.env.example` and the deployment docs
(currently undocumented there).

**F17. "Why this answer" is rich but not actionable (P2, S).** Provenance and
trace views are good; there is no "exclude this source for this question",
"pin this source", or "ask again with only these sources" from the answer view.
Per-source pinning exists in retrieval (pinned depth) but is not surfaced from
chat. *Target:* answer-level source controls that write to session focus.

**F18. Export, backup and portability (P2, M).** No export of sources,
revisions and graph in an open format, and no import for migration between
projects/environments. *Target:* a signed export bundle (sources, revisions,
chunks without vectors, edges with witnesses) and restore with ID remapping.

### 4.6 Semantics beyond sources

**F19. Graph nodes are sources, not entities (P1, L).** Acknowledged in the 2 Nov
review: no concept/service/API/rule entities. Questions such as "which tests
touch the checkout API" or "what rules apply to refunds" depend on entity
resolution that does not exist. The reviewed-candidate pipeline (`graph_extract`)
is the right safety model; it needs a typed entity layer, validity intervals and
review state before it can fill this gap. *Target:* project-scoped canonical
entities with exact-passage witnesses, alias curation (exists), and candidate
review (exists), expanding the ontology one entity type at a time.

**F20. Execution membership incomplete (P1, M).** `EXECUTED_IN` is defined but,
per the 2 Nov review, lacks a complete native witness adapter; a Run view
permission alone does not authorise listing every linked case and result.
Story-to-case-to-run impact paths, the most common QA traceability question, are
therefore not guaranteed complete. *Target:* a native membership projection with
joint Run/case/result authorisation, and a coverage indicator on the answer
("path complete / partial").

**F21. Language and locale (P2, S to M).** The lexical config is one configured
prose language (`knowledgeLexicalQuery.configuredProseConfig`). Mixed-language
projects (common in distributed QA teams) get stemming for one language only, and
the local hash embedding is language-agnostic but weak. *Target:* per-source
language detection, per-language `tsvector` configuration, multilingual
embedding recommendation in the setup card.

---

## 5. Design and implementation gaps (technical)

### 5.1 Structure and maintainability

**T1. Oversized services with port injection (P1, M).** Verified sizes:
`knowledgeIngestion.service.js` 1,891 lines, `knowledgeAssistant.service.js`
1,465, `KnowledgeContextStudio.tsx` 1,037 (plus a 1,054-line stylesheet),
`knowledgeRag.service.js` 795, `knowledgeSearch.service.js` 759.
`knowledgeIngestion.service.js:4` destructures roughly 80 names from a `ports`
object, then lines 5-6 repeat the same list in a runtime `required` check. Adding
a dependency means editing three places, and the check can only detect `undefined`
after the fact. `knowledgeRag.service.js` is a facade that wires every module,
which keeps the original public import path alive but hides the real dependency
graph. *Target:* group ports into cohesive objects (`ingestPorts`, `embedPorts`,
`graphPorts`), define them once as a typed (TS or JSDoc) interface, and split
ingestion into extract, chunk, persist, promote and enqueue modules with their own
tests. The repo already has `docs/architecture/large-file-split-plans.json`;
bring these files under it.

**T2. Two storage models for the same idea (P1, M).** A legacy "knowledge
items" model (`aiKnowledge.service.js`, routes under `/projects/:id/knowledge`,
`syncLegacyKnowledgeItem`, a legacy sync outbox and worker lane) coexists with
the sources/documents/chunks model. Every legacy write is mirrored into the new
model through an outbox. This doubles the failure surface (two workers, two
status vocabularies) and leaves two UIs ("Notes & rules" and Sources). *Target:*
a migration that makes sources canonical, the legacy routes a thin compatibility
layer with a published removal date, then delete the sync lane.

**T3. Weak typing on the client contract (P2, S).** The frontend client uses
`any` in 26 places (`api.client.ts` for list/create/update, and components).
The backend has strong executable schemas (`knowledgeContractSchemas.service.js`)
that the frontend does not consume, so drift is caught only by the compatibility
tests. *Target:* generate TS types from the same schemas (the repo already
ships OpenAPI), and remove `any` from the client.

### 5.2 Retrieval and ranking design

**T4. Quality depends on an unconfigured stage (P0, S).** The reranker is
disabled by default and its configuration is read from process environment on
every call (`configuration()` in `knowledgeReranker.js`), invisible to the
product and impossible to set per project. Dense retrieval likewise silently
degrades. The code is careful never to *claim* semantic quality it lacks, which is
right, but the product consequence is that the headline recall figures
(0.9583 recall@10 curated) reflect lexical/graph retrieval and say little about a
semantic deployment. *Target:* see F16, plus run the evaluation in three modes
(hash-only, provider embeddings, provider plus reranker) in CI against a local
embedding fixture so regressions in any mode are visible.

**T5. Fusion is rank-only with fixed constants (P2, M).** RRF `k = 60` and equal
channel weights are global constants (`knowledgeRanking.js`). Rank-only fusion
discards score magnitude, so a confident exact-ID hit and a weak semantic hit at
the same rank are equivalent. Per-source caps and pinned depth partially
compensate. *Target:* query-class-aware channel weights (an ID query should
dominate lexical; a "why" question should favour dense), learned from the
benchmark and, later, from feedback; keep RRF as the default and tune by class.

**T6. Chunking is character-based and one-size (P2, M).** Sizes are in characters
(`token_count` is `ceil(chars/4)`), with one default profile. Tables, code, logs
and Gherkin steps need different boundaries; a fixed overlap duplicates text in
every chunk. *Target:* content-type profiles (table row groups with header
repeat, log windows with error signature, step-aligned Gherkin, code by symbol),
real tokenizer counts for budget accuracy, and parent-child retrieval (match small,
return the surrounding section) so precision and context are both kept. The
ContextPacket already supports adjacent fragments; make this a first-class mode.

**T7. Query understanding is LLM-optional and shallow (P2, M).** Intent planning
is one model call with deterministic fallbacks. There is no query rewriting from
conversation history for ordinary retrieval (session focus covers entities only),
no HyDE or decomposition for compound questions on the non-analytical path, and no
learned query-class router. *Target:* a cheap deterministic classifier first, with
the model call reserved for ambiguous or compound questions, and logged outcomes
so the router can be evaluated.

### 5.3 Consistency, scale and operations

**T8. Per-process state in a multi-replica system (P1, S to M).** Several
correctness-adjacent caches live in module memory: Qdrant circuit-breaker counters
and collection cache (`knowledgeVectorStore.service.js`), embedding cooldowns,
model-parameter-rejection cache, query-vector cache, and the pg_stats lexeme
cache. Replicas will disagree on whether Qdrant is "open", cooldown windows
multiply, and a deploy resets all of it. Most are performance hints and fail safe,
so this is a consistency and observability issue, not a security one. *Target:*
move circuit and cooldown state to the shared cache the platform already uses
(`utils/cache`) or accept per-replica state but export it as metrics so operators
can see divergence.

**T9. Qdrant is an eventually consistent projection with an unbounded blind spot
(P1, M).** The journal is well designed, and the docs state the residual risk
plainly: points for a source hard-deleted before the journal existed, and points
left behind by changing the endpoint or prefix, cannot be discovered. *Target:* a
bounded inventory job that lists collection points by `project_id` payload and
reports orphans, plus an operator command to purge them behind a dry-run.

**T10. Queue throughput is set for correctness, not volume (P1, S).** Defaults
(verified in `workers.js`): native outbox 2 events per 2 s, ingestion
concurrency 2 per 10 s, semantic work 1 per 15 s, graph projection 4 per 15 s.
Fairness and leases are good, but a large first import (thousands of records) or
an embedding model change backfills at a few records per tick. The refresh
service also scans 30 records per 5 s. *Target:* an adaptive batch size driven by
queue lag, a visible "indexing 12,400 of 40,000, about N minutes" progress, and
load tests that set documented defaults. Alert on lag (metrics exist in
`knowledgeWorkerMetrics.service.js`; confirm they are exported to the platform's
alerting).

**T11. Embedding-model changes rebuild everything (P2, M).** The configuration
fingerprint invalidates vectors and enqueues a backfill, which is correct, but
retrieval during the transition mixes dimensions through separate collections and
typed indexes, and there is no staged cut-over. *Target:* dual-write with a
shadow index and an explicit "promote when coverage over 95 percent" switch, so an
embedding upgrade never reduces recall mid-migration.

**T12. Retention and cost visibility for the KB itself (P2, S).** Trace retention
and partitions are managed; source storage (attachments, retained revisions,
vectors) has no per-project quota, cost estimate or history pruning policy for
superseded revisions. *Target:* per-project storage and embedding-spend rollups,
a revision retention policy (keep N plus pinned), and quota warnings.

### 5.4 Security and privacy hardening

**T13. Redaction is pattern-based and silent (P1, S).** Sensitive values are
deterministically redacted before embedding and prompting; the user is not told
what was redacted in a document, and pattern coverage determines leakage risk to
a third-party provider. *Target:* a redaction report per revision (counts by
type, locations without values), a project policy to block ingestion of a file
above a redaction threshold, and an allow-list of providers per sensitivity tier.

**T14. Prompt-injection assurance is untested against real providers (P1, M).**
Retrieved text is neutralised and flagged, and fixtures cover hostile
instructions, but the docs correctly state there is no provider prompt-injection
benchmark. Agents that consume the KB with tool access (workflow nodes, MCP hosts)
raise the stakes. *Target:* a red-team corpus run on a schedule against each
configured provider, with failures blocking tool-enabled use of the affected
provider.

**T15. Excerpt-based provenance is only as good as the source (P2, S).** Repository
Knowledge Builder provenance is carried through an allow-list and marked
unverified at runtime, which is the right call. Surface that label wherever the
chunk is cited so users do not read a static-analysis excerpt as a verified fact.

---

## 6. Integration review: how the KB serves the rest of QAIra

| Consumer | Today | Gap | Improvement |
|---|---|---|---|
| Ask HelloTest (chatbot) | Full pipeline: plan, retrieve, validate, stream, trace | No feedback, no answer-level source controls (F11, F17); 1,465-line service (T1) | Feedback and source controls; split orchestration from persistence |
| MCP | Context, graph, fetch, collections tools; OAuth; per-credential budgets | Read tools only, no way for a host to *propose* knowledge; no write-back receipts | Add a `propose_knowledge` tool that creates a candidate (F8), never a live fact |
| Workflow `knowledgeTool` node | Retrieval with `max_query_cost_usd: 0` (lexical only by design) and kind filters | The cost cap forces lexical mode, so workflows never use the semantic channel even when configured; the `testOpsTool` filter admits only `execution` (not `execution_result` or `bug`) (verified in code) | Expose cost/mode on the node; widen filters; surface `limitations` in the node output UI |
| Bug triage | Takes *human-reviewed* Knowledge context as untrusted supporting text | Context is hand-selected, so triage does not automatically find the prior similar defect or the owning Story's acceptance rules | Auto-retrieve top related defects/stories as a labelled, budgeted block alongside the reviewed context |
| Test-data and artifact generation | Reviewed context accepted (`aiTestDataGeneration`, `artifactAssurance`) | Same: opt-in only | Retrieval-augmented generation by default with a "context used" panel and a way to switch it off |
| Quality agents and agent planner | Reviewed-context plumbing and agent task briefs | No evidence that planners retrieve standards/conventions without being handed them | Give planners a standing "project standards" retrieval (workspace tier, F5) |
| Automation builder | Knowledge packets summarised into build context | Code-and-object evidence is `knowledge_item`/`file`/`text` only; repository symbols are not nodes (documented) | Index repository symbols as native-adjacent kinds with `PART_OF`/`USES` witnesses |
| Dashboard | Not a consumer | KB health (coverage, staleness, gap register, answer quality) is not a dashboard widget | Add KB health widgets (F6, F12, F13) |
| Coverage review | Uses graph/coverage rules | Coverage is rule-based from links; no semantic "uncovered requirement" suggestions from KB content | Feed coverage gaps into the candidate-link queue |

**The principle to adopt:** every AI feature that generates or judges project
artefacts should call one shared retrieval entry point with a per-feature budget
and a visible "context used" disclosure, and the KB owns the policy for what is
allowed. Today each feature wires its own path, which is why behaviour differs
(lexical in workflows, hybrid in chat).

---

## 7. Roadmap

Sequenced to deliver trust and usefulness first, scale second.

### Phase 1: make the existing engine visible and correct (about 4 to 6 weeks)

| Item | Gaps | Outcome |
|---|---|---|
| Retrieval health card and AI Controls entries for embedding and reranker | F16, T4 | Users can see and fix degraded retrieval |
| Answer feedback and gap register | F11, F12 | First quality signal; stops flying blind |
| Per-user analytics floor change | F13 | Health view useful for small teams |
| Security panel (read-only first, then edit) | F15 | Auditability of the strongest control |
| Workflow node mode and filter fixes | Section 6 | Consistent retrieval across features |
| Document reranker env vars | F16 | Deployability |

### Phase 2: widen what goes in and keep it trustworthy (about 8 to 12 weeks)

| Item | Gaps | Outcome |
|---|---|---|
| OCR, captioning, ASR providers | F1 | Screenshots and recordings become evidence |
| URL fetcher with snapshots | F2 | URL sources carry content |
| Lifecycle metadata, review queue, freshness labels | F6, F8 | Outdated guidance is visible |
| Near-duplicate clustering, contradiction surfacing | F7 | Diverse, honest evidence |
| Failure-log and shared-step native kinds | F4 | Triage-grade retrieval |
| Ingestion module split and port consolidation | T1 | Safer change velocity |

### Phase 3: connectors, semantics and scale (quarter-scale)

| Item | Gaps | Outcome |
|---|---|---|
| Connector SDK; Git, Jira, Confluence first | F3, F10 | Non-native knowledge stays current |
| Workspace knowledge tier | F5 | Shared standards inherited by projects |
| Entity layer with review | F19, F20 | Impact analysis beyond source links |
| Real-traffic evaluation pipeline | F14 | Measured quality, not curated quality |
| Legacy model retirement | T2 | One storage model |
| Shadow-index embedding migration, orphan inventory, load-tested defaults | T9, T10, T11 | Safe operation at volume |

---

## 8. Success measures

Track these per project and release; every number needs a stated denominator and
source (consistent with the repository's existing "no unmeasured claims" rule).

| Measure | Source | Why |
|---|---|---|
| Helpful-answer rate; unhelpful reasons by class | Feedback (F11) | Primary quality signal |
| Insufficient-evidence rate by query class | Context ledger | Coverage of the KB against real questions |
| Citation precision and unsupported-claim rate on a rated sample | Human review (F14) | Faithfulness, currently unmeasured |
| Recall@10 and MRR in each retrieval mode | CI benchmark (T4) | Prevents silent regressions per mode |
| Share of sources reviewed within their interval | Lifecycle (F6) | Freshness |
| Indexing lag p95 and backlog | Worker metrics (T10) | Operability |
| Searchable-media share of uploaded media | Ingestion (F1) | Ingestion usefulness |
| Share of AI features using shared retrieval with disclosure | Section 6 | Integration consistency |

---

## 9. Risks and open questions

1. **Cost and egress.** OCR, captioning and ASR send content to providers.
   Gate each behind AI Controls and the redaction report (T13) before enabling.
2. **Permission mapping for connectors (F3).** Source-system ACLs rarely map
   cleanly. Default to *deny until mapped* and surface unmapped sources.
3. **Freshness decay can hide valid old evidence.** Apply only where a source
   declares a review interval, never globally.
4. **Feedback privacy.** Ratings tied to traces can reveal who asked what. Keep
   them owner-private by default and aggregate with the existing k floor for
   cross-user views.
5. **Product decision needed:** should the workspace tier (F5) be able to
   *override* project knowledge, or only supplement it? Recommendation:
   supplement, with conflict surfaced (F7).
6. **Not verified in this review:** live latency, real recall on production
   content, and whether worker lag metrics reach alerting. These need runs
   against a staging deployment.

## 10. Evidence index

| Claim | Where to look |
|---|---|
| Media/URL not extracted; OCR off | `knowledgeIngestion.service.js` (extraction block near line 1627); `knowledgeRag.service.js` Tika headers (about line 318); `KnowledgeContextStudio.tsx` paste kinds (line 63) |
| Degraded embedding mode reporting | `knowledgeOverview.service.js` line 92 |
| Embedding setting retired from integration form | `docs/research/knowledge-reliability-review.md`, finding 3 |
| Reranker env-only | `knowledgeReranker.js` header and `configuration()` |
| Analytics privacy floor | `knowledgeContextHealth.js` `MIN_ACTORS = 5` |
| Worker cadence defaults | `workers.js` |
| Security API without UI | `knowledge.routes.js:325`; `frontend/api.client.ts` (no security calls) |
| Ports pattern | `knowledgeIngestion.service.js` lines 3-6 |
| Workflow node cost cap and filters | `agentic/backend/workflows/nodes/knowledgeTool.js` |
| Legacy dual model | `aiKnowledge.service.js`; routes at `knowledge.routes.js:40-124`; `syncLegacyKnowledgeItem` |
| Benchmark scope and unmeasured items | `knowledge-mcp-chatbot-review-progress-2026-11-16.md` |
