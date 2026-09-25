# Knowledge ingestion and Ask AI reliability

Date: 2026-09-10. Scope: existing backend ingestion, retrieval and buffered model requests. No production records, integration settings, feature flags or external providers were changed during this review.

## Findings from the implementation

The existing assistant already had important safeguards: parallel lexical/live retrieval, independent short semantic-search deadlines, local embeddings, authorization before and after generation, classified transient model retries, provider `Retry-After` handling, same-turn idempotency and cited deterministic answers when synthesis fails. Specialist reviews also already retried their read-only model request. Replacing these paths would have duplicated working controls.

Two remaining problems undermined those guarantees:

1. `persistDocument` waited for provider embeddings before writing canonical chunks. Each batch could start another 45-second retry budget, and default integration discovery had no time bound. A source with useful extracted text could remain unavailable while optional enrichment stalled. A Qdrant failure also prevented promotion of the entire new revision, despite complete PostgreSQL lexical and local-vector data.
2. Ask AI had per-stage deadlines but no total turn deadline. Callers could request up to 60 seconds of retrieval and then start a fresh 45-second synthesis operation, followed by access checks and persistence. Database reads outside the bounded setup helper could wait indefinitely. Failure cleanup itself could also wait indefinitely.
3. The embedding resolver implicitly treated the configured chat model as an embedding model. The current integration form intentionally configures chat generation and retires separate embedding settings. Consequently, otherwise valid chat connections could trigger unsupported `/embeddings` requests on cold retrieval. The resolver now uses local indexing directly when no existing explicit embedding capability is configured, without reporting normal local indexing as a provider failure.

## Implemented behavior

Canonical source publication now comes first. The service sanitizes and chunks content, stores PostgreSQL full-text indexes and deterministic local vectors, and promotes the complete revision using the existing source revision token, lease/snapshot guards and active-version transaction. Only then does it discover the default model and attempt provider embeddings. Explicit model selections are still validated before writes.

Provider embedding enrichment updates a current revision only after reacquiring the source lock and checking its revision, active document and lease/snapshot guard. All chunk vectors are replaced together; partial provider batches are never mixed with local dimensions. PostgreSQL remains searchable throughout. Optional pgvector casts remain outside the canonical transaction so an extension error cannot roll back the document.

Qdrant is an optional projection of those canonical indexes. Its failure now leaves the current PostgreSQL revision searchable and returns a `vector_projection_degraded` warning. `dense_state=ready` describes the usable canonical vector index; `vector_provider=postgresql` accurately records fallback when the external projection fails. A successful projection is recorded only after a final current-revision check. Cancellation reaches cold collection setup and its payload-index requests, as well as uploads.

| Operation | Bound and fallback |
| --- | --- |
| Default embedding configuration |2 seconds; local indexing with a safe diagnostic if unavailable |
| Explicit embedding configuration |2 seconds; invalid, unavailable or cross-project selection remains an error |
| Provider embedding for one document |8 seconds total across batches, attempts and backoff; complete local vectors on failure |
| One embedding attempt |At most 3 seconds within the document budget |
| Optional Qdrant projection |8 seconds total; keep canonical evidence available on failure |
| Ask AI turn |90 seconds total, including retrieval and synthesis |
| Ask AI synthesis |At most 45 seconds including retries, shortened to retain 10 seconds for final authorization and persistence |
| Failed-turn cleanup |2 seconds on a separate cancellation signal; preserve the original request failure |

Existing bounded semantic retrieval, transient retry classifications, model call/cost budgets, project/source permissions, feature gates, citation contracts and deterministic fallbacks remain in place. Late idempotency reads cannot initiate message writes after cancellation. If synthesis has no remaining budget, Ask AI performs its final access check and saves the authorized cited fallback instead of dispatching another model request.

## Verification

`node --test services/platform/backend/test/knowledge*.test.js services/platform/backend/test/agenticAssistantContract.test.js`

Result: 150 tests, 149 passed, zero failed, one PostgreSQL-only test skipped in the unit-suite invocation.

New executable coverage verifies canonical publication before model configuration/provider calls, preservation during vector outages, rejection of stale enrichment, one budget across multiple embedding batches, configuration timeout fallback, explicit scope errors, cancellation during cold vector setup, shortened synthesis budgets, saved cited fallback without a late model call, and no late message writes after an overall timeout. Existing tests continue to verify retry exhaustion, billing/authentication failures without retries, safe provider diagnostics, model usage budgets, access revocation and same-turn replay.

The PostgreSQL lifecycle test was updated to retrieve the new revision during a simulated Qdrant outage and continues to cover active-version uniqueness, historical evidence, ACL prefilters, fragment restrictions and archive behavior. It passed separately: 3 tests, 3 passed. The fixture now creates its required settings/permission tables and runs against a fresh isolated `agent_verify_knowledge_<epoch>` database, which was dropped after validation. No public database records were changed. Reproduce with `KNOWLEDGE_POSTGRES_TEST=1 node --test services/platform/backend/test/knowledgeRepositoryLifecycle.test.js` against an isolated database.

## Read-only live configuration check

On this review date, three active chat profiles had usable credential presence: `Open AI / gpt-5.4-mini` at `api.openai.com`, `grok / openai/gpt-oss-20b` at `api.groq.com`, and `kiwi / auto` at `api.llm.kiwi`. The installed sample profile was inactive and had no credential. No Knowledge/agent-specific user override was recorded; the selected global fallback was `kiwi / auto`.

One call through the existing connection-test service, bounded to 20 seconds and requesting only the word `OK`, verified authentication and generation for that exact saved global fallback. It passed. The other providers were inspected but not probed; no claim is made about their current availability. Credential values and provider output were not exposed. No saved credentials, model selections or configuration records were changed. The absence of a separate embedding setting is compatible with the intentional local retrieval path and does not prevent chat generation.

## Practical limits

These changes bound network/provider waits and preserve usable evidence; they do not claim semantic enrichment succeeded during an outage. No automatic background retry or external provider switch was introduced. Database statements already dispatched may complete after a JavaScript cancellation deadline; cancellation checks prevent scheduling subsequent message writes, and existing database revision/lease guards remain authoritative for ingestion. Local hashing supports deterministic fallback retrieval and is not presented as equivalent to a learned embedding model.
