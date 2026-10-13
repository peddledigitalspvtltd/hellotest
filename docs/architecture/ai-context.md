# HelloTest AI Context Platform

Audience: engineering, security, product, and operations  
Reviewed: 2026-09-05

## Executive decision

HelloTest should remain a retrieval-first, project-scoped AI system. The configured LLM is a planner and synthesizer, not a database, authorization layer, or source of project facts. Every chatbot and specialist-agent turn follows the same control loop:

1. classify the user’s intent and resolve conversational references;
2. select authorized live and indexed context scopes;
3. run bounded hybrid retrieval and up to two model-planned follow-up rounds;
4. fuse, deduplicate, diversify, and bound evidence;
5. synthesize against an explicit output contract;
6. reject invented citations and verify grounded answers;
7. expose a safe processing trace, citations, provider provenance, and fallbacks.

This architecture is already substantially implemented in `aiContextOrchestrator.service.js`, `knowledgeRag.service.js`, `knowledgeAssistant.service.js`, `aiLlmSelection.service.js`, and `agenticAssistant.service.js`. The current hardening pass makes the control loop visible to users and records the production contract.

## Knowledge ingestion contract

Knowledge sources retain tenant/project ownership, source provenance, extraction status, content hashes, document versions, chunk locations, risk flags, and collection links. Processing must remain asynchronous, idempotent, bounded by file and extraction limits, and fail closed for unsupported or suspicious content.

The processing stages are:

- validate media type and signature;
- extract text through a native parser or configured extraction service;
- remove hidden controls, redact supported sensitive identifiers, and neutralize instruction-like content;
- split on document, heading, paragraph, Gherkin, or fixed boundaries with overlap;
- enrich each retrieval representation with its document title and nearest section heading while retaining the original chunk as the citable payload;
- create embeddings through the configured compatible provider, retaining the deterministic local vector only as a degraded retrieval fallback;
- index lexical and vector representations and activate the new document version atomically;
- score context fitness (duplication, undersized chunks, heading coverage, lexical diversity, and redaction pressure) and flag weak corpora for review;
- retain warnings and observable job state for operational review.

Any-document support means a document is accepted only when a trustworthy extraction path exists. Images, audio, and video require explicit caption/transcript text unless a governed extraction provider is configured. Binary bytes must never be embedded as if they were text.

## Canonical storage and retrieval contract

PostgreSQL is the system of record for source identity, revisions, chunks, ACL bindings, active-version state, conversations, and index status. Qdrant is a rebuildable semantic projection. It stores the embedding plus stable PostgreSQL IDs and filter metadata; answer context is always hydrated from PostgreSQL and rechecked against the active document revision and current source ACL. This prevents a stale or mis-scoped vector point from becoming factual or authorization truth.

The Qdrant collection is versioned by embedding dimension so model upgrades cannot mix incompatible vector shapes. Every vector query prefilters `project_id`, `is_current`, `embedding_model`, and an `allowed_scope` array containing either `__public__` or an authorized record permission. PostgreSQL applies the same restrictions again during hydration. Payload indexes cover each high-selectivity filter. Projection failures open a bounded circuit and degrade to PostgreSQL retrieval without bypassing ACLs.

Retrieval is hybrid: PostgreSQL full-text ranking supplies exact identifiers and lexical evidence while vector similarity supplies semantic recall. Results are fused using reciprocal-rank-style signals, deduplicated by chunk, diversified by source, filtered by project/application/collection/source ACLs, and bounded before they reach an LLM.

Every document revision has an explicit `ai_knowledge_index_states` row covering lexical and dense readiness, provider/model/dimension, current-version state, indexed chunk count, and a sanitized error fingerprint. This state makes projection lag and model-version drift operationally visible.

Three versioned envelopes cross the orchestration boundaries:

- `RetrievalRequest.v1` contains the normalized query, canonical query class, filters, conversation/smart-context hints, and hard budgets.
- `ContextPacket.v1` contains only authorized evidence, stable evidence IDs, integrity/version hashes, coverage, applied filters, and budget state.
- `AnswerContract.v1` contains structured claims linked only to evidence IDs present in that packet, plus limitations and the explicit termination reason. Model-reported confidence is never accepted as a grounding score.

Canonical query classes are `LOOKUP`, `SEARCH`, `ANALYTICAL`, `INVESTIGATIVE`, and `MULTIMODAL`. Exact artifact identifiers take the lookup path; analytical and investigative questions can use bounded context expansion. All paths have deadline, round, query, tool-call, candidate, evidence-item, and context-token ceilings.

The official pgvector guidance explicitly recommends combining vector search with PostgreSQL full-text search and using Reciprocal Rank Fusion or a cross-encoder. It also warns that filtered approximate indexes can reduce returned results and documents iterative scans as a mitigation. HelloTest currently uses exact pgvector retrieval when available plus a JSONB-cosine/FTS degraded path; production scale should add measured HNSW indexes only after establishing recall baselines. Source: [pgvector README](https://github.com/pgvector/pgvector).

The original RAG architecture grounds generation in retrieved non-parametric memory. Self-RAG and Corrective RAG add an important production lesson: retrieval should be adaptive and evidence quality should influence whether the system retrieves again or answers. HelloTest applies that principle conservatively through a two-round query budget, evidence-growth stopping, and explicit insufficient-context outcomes rather than an unbounded autonomous loop. Sources: [RAG](https://arxiv.org/abs/2005.11401), [Self-RAG](https://arxiv.org/abs/2310.11511), and [Corrective RAG](https://arxiv.org/abs/2401.15884).

Long-document retrieval must preserve both local facts and their enclosing document structure. RAPTOR demonstrates the value of retrieving at multiple abstraction levels, while Lost in the Middle shows that larger prompts do not guarantee reliable use of evidence positioned inside them. HelloTest therefore enriches lexical and embedding representations with document and section identity, keeps the original chunk as the citation payload, diversifies sources, and bounds the final evidence block. Full recursive model-generated summaries are intentionally deferred until corpus-specific evaluation proves that their additional ingestion cost and hallucination surface are justified. Sources: [RAPTOR](https://arxiv.org/abs/2401.18059) and [Lost in the Middle](https://arxiv.org/abs/2307.03172).

Required retrieval evaluation includes recall@k against a curated project-question set, citation precision, faithfulness, answer relevance, context relevance, unsupported-claim rate, retrieval latency, empty-result rate, degraded-mode rate, cross-project isolation tests, and model/version compatibility checks. RAGAS provides a useful reference for reference-light evaluation dimensions, but release thresholds must be calibrated against HelloTest's own reviewed QA corpus. Source: [RAGAS](https://arxiv.org/abs/2309.15217).

Each retrieval turn also reports a bounded evidence-sufficiency diagnostic based on citation readiness, source diversity, strongest retrieval score, query corroboration, and authoritative live evidence. This score controls whether another retrieval round is useful; it is explicitly not proof that an answer is correct. NIST's report-evaluation work reinforces the need to evaluate completeness, accuracy, and claim-to-source verifiability separately. Source: [NIST, On the Evaluation of Machine-Generated Reports](https://www.nist.gov/publications/evaluation-machine-generated-reports).

## Conversational assistant contract

Conversation history is used only to resolve references and preserve task continuity. It does not override current project facts. Each user turn is idempotent by client turn ID and bound to the selected LLM integration. The assistant first asks the model for missing-context queries, executes only bounded authorized retrieval, then asks for a structured grounded answer. A second verification pass checks evidence and citations when the provider is available.

The user interface exposes five safe stages—understand, plan, retrieve, synthesize, verify—without exposing private chain-of-thought. It also shows the bounded context-query chain and retrieval-round count. Users can insert a source-pinned, editable Smart Context pack directly into Ask HelloTest; the pack guides retrieval but cannot establish uncited facts. Answers follow a summary, findings, recommendations, and evidence-gaps contract and are rendered into readable sections and lists, followed by expandable citations and retrieval details.

When no usable LLM exists, Ask HelloTest remains available in retrieval-only mode. Deterministic query expansion adds artifact identifiers and domain-specific terms for failures, Bugs, requirements, tests, releases, environments, and automation. The response then uses permission-checked live snapshots where available or a structured extractive evidence brief. It clearly identifies the evidence boundary and never represents retrieval-only output as model synthesis.

## Shared LLM runtime contract

All AI capabilities resolve a usable active LLM through `aiLlmSelection.service.js`, respecting explicit selection, per-usage overrides, project scope, and project/global fallback. Provider HTTP uses the shared bounded client with deadlines, response-size limits, circuit breaking, concurrency bounds, and replay-safe retry rules. Model calls must never silently cross project integration boundaries.

New AI features must not implement ad hoc integration selection. They should use the shared selector and HTTP client, validate model presence and credentials, fingerprint provider failures rather than returning secrets, and provide a truthful deterministic or extractive fallback.

## Specialist-agent contract

Each agent has a decision question, prioritized scopes, retrieval focus, required outcome sections, and deliverable contract. Agent outputs distinguish observations, recommendations, assumptions, and evidence gaps; cite supplied evidence IDs; and remain read-only until a separately authorized human-approved mutation occurs. The quality evaluator remains the recommended final handoff for consequential specialist outcomes.

## Security and governance

Retrieved content is untrusted data and cannot issue instructions. Retrieval-augmented generation does not itself eliminate prompt injection; OWASP explicitly treats indirect prompt injection from external files and pages as a continuing risk. Source: [OWASP Top 10 for LLM Applications 2025](https://owasp.org/www-project-top-10-for-large-language-model-applications/assets/PDF/OWASP-Top-10-for-LLMs-v2025.pdf).

Operational governance should follow lifecycle measurement and documented risk controls rather than relying on model behavior alone. The NIST Generative AI Profile calls for risk management and evaluation across the AI lifecycle. Source: [NIST AI 600-1](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence).

## Production exit criteria

- all ingestion, ACL, redaction, prompt-injection, idempotency, citation, and provider-fallback contracts pass;
- representative retrieval evaluation has an approved recall and citation-precision threshold;
- no answer marked grounded can survive with unknown or invented citation IDs;
- every model-backed feature reports provider/model/fallback provenance;
- degraded embedding and provider failure rates are observable;
- conversation follow-ups remain project-scoped and cannot reuse another user’s session;
- agent outcomes conform to their specialist contract and require review before mutation.

## Material limitations

The local hash embedding is intentionally a degraded fallback and is not a semantic substitute for a compatible embedding model. Approximate indexes are not automatically superior: they require dataset-specific recall/latency measurement. “Any document” remains constrained by trustworthy extraction and content-policy limits. The high-level processing trace is an operational summary, not private model reasoning.
