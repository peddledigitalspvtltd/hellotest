# HelloTest MCP

HelloTest serves MCP from the dedicated `services/mcp` workspace package (`@hellotest/mcp`), mounted inside the existing platform API process. It shares the application's domain services, permission checks, knowledge retrieval engine and PostgreSQL migration lifecycle. There is no additional MCP container or second copy of application data.

The attached implementation guide was used as a reference design. Its proposed private routes and sidecar were not treated as existing application contracts. The implementation discovers real registered routes and extracts their declared validation schemas.

The [Stitch MCP reference](https://stitch.withgoogle.com/docs/mcp/reference) was
reviewed for named domain tools, precise identifier contracts, shared response
types, effect annotations and recovery after uncertain long-running calls. Its
[Agent Skills guide](https://stitch.withgoogle.com/docs/skills/get-started/)
describes reusable task instructions layered over the MCP connection. HelloTest
keeps task recipes in its tool reference and permission-aware application agents;
tool discovery, instructions and annotations do not grant access or verify an effect.

## Start and connect

Build the changed application using the existing command:

```sh
TESTENGINE_WEB_REPLICAS=1 ./hellotest.sh up --build --stack local --no-cache
```

A running image built before this change does not contain the MCP dependency, routes, migration or UI. Changes require a new image and normal schema migration; the implementation tests use a disposable database and do not migrate your current local project data.

1. Sign in, select a project, and open **Agent Studio → MCP Servers** (`/mcp-servers`). Old Admin Space MCP links redirect here. The integration category previously named Workflow connections is now Credentials and contains only HTTP endpoints; the workflow sidebar likewise lists only HTTP credentials.
2. HelloTest is a built-in server. **Check connection status** verifies SDK tool discovery with your signed-in project identity; no host credential is needed for this check. Results appear directly beside the button, bypass cached responses, and time out explicitly after eight seconds. Open **Connect & inspect**, copy its endpoint, and create a host credential. Copy buttons show “Copied” for two seconds after clipboard success, then restore their original label. Copy the credential immediately; it is not stored in browser persistence or returned in later listings.
3. Configure an MCP client that supports Streamable HTTP to use that URL with `Authorization: Bearer <credential>`. Clients must send `Accept: application/json, text/event-stream`.
4. Initialize normally with a supported legacy protocol or use the current SDK's stateless protocol. Discover `tools/list`, `resources/list` and `prompts/list`. Start with `hellotest_capabilities` and `hellotest_database_schema`.
5. A credential is tied to its signed-in user, project and a unique server-generated host identity, expires after one hour, and can be revoked immediately. Creating a credential requires project read access. User suspension, project access, permissions and feature flags are rechecked during use.

The direct API endpoint is `/mcp`; the browser reverse-proxy endpoint is `/api/mcp`. Set a public URL when connecting from another machine. `Create MCP server` registers an external provider and discovers its tools; it does not provision a remote server or infrastructure.

## Tools and exposure

| Tool | Purpose |
| --- | --- |
| `hellotest_capabilities` | Paginated callable operation summaries, permissions, exposure and catalog revision; describe one operation for its full native schema |
| `hellotest_operation_describe` | Inspect one exact domain contract |
| `hellotest_operation_read` | Authorized project-scoped reads through existing domain APIs |
| `hellotest_context_build` | Cited, budgeted live project and knowledge evidence |
| `hellotest_database_schema` | Actual fields of permitted PostgreSQL projections and relationships |
| `hellotest_database_query` | Bounded, parameterized read projections |
| `hellotest_knowledge_fetch` | Exact indexed fragment with fresh source ACL/version/readiness checks |
| `hellotest_graph_expand` | Authorized one-hop relationship witnesses |
| `hellotest_graph_resolve` | Exact canonical/native IDs, titles and curated aliases, with ambiguity and visibility checks |
| `hellotest_graph_context` | Exact typed entity seeds, bounded graph expansion and authorized source passages |
| `hellotest_graph_trace` | Witnessed paths between two exact entities, with provenance and evidence |
| `hellotest_graph_schema` | Native graph vocabulary, provenance and traversal limits |
| `hellotest_context_graph_list` | Owner-private retained task contexts, filtered by application, feature and recording time |
| `hellotest_context_graph_explore` | One retained task's retrieval references, source versions and observed events under fresh authorization |
| `hellotest_browser_mission_prepare` | Reviewable, bounded same-origin browser mission plan |
| `hellotest_browser_mission_status` | Scoped browser mission progress, measured findings and artifact references |
| `hellotest_operation_prepare` | Persist an immutable action preview, with no business effect |
| `hellotest_operation_execute` | Claim and execute an authorized plan once |
| `hellotest_operation_status` | Durable original-plan state and receipt |

Named list/get tools cover applications, Stories, Test Cases, suites, runs,
Defects, environments, configurations, releases, Sprints, datasets and workflows,
plus test modules, schedules, workflow runs, agent definitions, repository runs,
Knowledge collections and dashboards, with current-project and Knowledge-source detail tools. Named prepare tools cover
Story, Test Case, suite, run and Defect authoring. They appear only when the
corresponding audited adapter is callable. Lists use bounded database summaries;
detail tools call native domain APIs and preserve delivery-omission metadata.
See the [tool reference](../product/mcp-tool-reference.md) for exact names,
schemas, task recipes and durable state meanings, the
[feature coverage inventory](../development/mcp-feature-coverage.md) for audited
native operations and gaps, and the
[context delivery audit](../development/mcp-context-accuracy.md) for retrieval
contracts and their verification.

Capability searches accept short phrases such as `list test cases`, `find requirements`
and `show bugs`. Deterministic product/native aliases handle Stories/requirements,
Defects/bugs and Sprints/iterations; every requested term must match. Search does
not confer permission or choose a route for execution. The built-in tool inspector
supports search and read/action filters. External connection discovery keeps tools
disabled until selected; its **Enable shown tools** and **Disable shown tools**
controls apply only to the current search/access filter and preserve hidden selections.
An external tool is classified as declared read only only when the server explicitly
publishes `readOnlyHint:true`; missing hints remain under actions or unspecified.
External discovery accepts at most 100 unique tools over five pages and 512 KB
across the catalog, with the same 512 KB ceiling for saved tool contracts. This
allows the complete HelloTest catalog to be inspected and selected. Ordinary
workflow MCP tool results retain their separate 128 KB transport limit; oversized
results are rejected without returning a successful prefix.

The server also publishes `hellotest://schema`, project operation and graph ontology resource templates, and an `investigate_failure` prompt. Every successful tool result carries a versioned envelope with its verified project and subject. **Connect & inspect** exposes the actual tool input/output schemas, supported protocols, resource templates and manual bearer connection contract. Discovery does not grant permission to call a tool.

Bounded response serialization retains exact canonical UUIDs in declared identity and provenance fields, typed identifier arrays and supported source-reference forms. Numeric UUID segments must not be redacted as phone or card numbers: project scope checks and citation joins require the original identifiers. Prose and sensitive fields retain their normal redaction policy; malformed and foreign-project context packets still fail closed.

The `investigate_failure` prompt resolves the published `ai.mcp.investigate_failure`
Admin AI configuration on each request. Its editable guidance is returned
separately from the caller's failure question. Retrieving the template invokes no
model. Identity, permissions, input schemas and reviewed-action enforcement remain
server contracts.

`hellotest_knowledge_fetch` returns immutable document/version/chunk hashes and
locations with its fragment. Supply `expected_document_id` and/or
`expected_version_hash` from a citation to fail explicitly when a revision differs.
Current reads reject deleted or moved native records, inactive versions and
unready indexes. Historical reads use `as_of` and the existing `knowledge.manage`
gate. ACLs apply again in the content query and after hydration. Redacted or
shortened displays retain the original chunk hash and explicitly identify their
delivery hash and original-source offset basis.

## Graph context and traceability

The graph tools call the existing Knowledge backplane with the verified MCP project and user. PostgreSQL owns canonical source identities and relationship witnesses; vector search remains a derived retrieval index. The MCP package does not operate a second graph database or expose raw SQL/Cypher. The attachment's standalone Python server was reference material; its unauthenticated transport and unscoped identifiers were not adopted.

Seeds use an exact `{kind, ref_id}` identity. Supported kinds are `requirement`, `test_case`, `execution`, `bug`, `knowledge_item`, `text`, `chat`, `file` and `url`; use `hellotest_graph_schema` for the native vocabulary. Similar names are not automatically merged. Application filters narrow the authorized project. The native service checks source permissions, document readiness, current versions and fragment ACLs; a relationship cannot reveal a hidden endpoint or passage.

Use `hellotest_graph_resolve` when the canonical identity is unknown. It accepts
up to 20 exact canonical or typed identifiers, an optional exact title/curated
alias query, an application filter and a result limit of 1–30. It reports
ambiguity, unresolved identifiers and partial results. A removed alias is not a
historical identity grant. Resolution returns only authorized current nodes;
an empty result is an evidence gap.

`hellotest_graph_context` accepts 1–6 seeds. `hellotest_graph_trace` accepts `source` and `target` plus at most five paths. Both support 0–3 hops, fanout 1–12, up to 100 nodes/edges, up to 30 evidence items, direction and relation-type filters, a 256–8,000 token context budget (default 4,000), and a deadline up to 20 seconds. These are traversal ceilings, not completeness guarantees. Zero edge/evidence budgets remain zero. The smaller MCP node/edge ceiling avoids the generic response projection's 100-item boundary. Oversized results fail explicitly so callers can narrow their request.

Graph packing uses UTF-8 bytes as a conservative token upper bound for the complete graph packet, including provenance and budget metadata. It is not a provider tokenizer or a measured saving. A budget too small for the metadata fails explicitly. Evidence is retained with its complete witnessed paths; redacted passage displays identify their offsets as referring to the immutable source chunk.

For example, the tool arguments below trace an authored Story to a selected Test Case:

```json
{
  "source": { "kind": "requirement", "ref_id": "saved-story-id" },
  "target": { "kind": "test_case", "ref_id": "saved-case-id" },
  "hops": 2,
  "max_paths": 3,
  "max_nodes": 40,
  "max_edges": 60,
  "max_evidence": 12,
  "token_budget": 3000
}
```

Returned paths retain canonical node IDs, edge provenance and exact source witnesses. An authorized domain link and an extracted passage relationship have different provenance. A path is evidence of the recorded relationship; it does not establish root cause, a passing test or an approved decision. No path within the selected bounds is an explicit retrieval gap. Source deletion, access changes and stale revisions remain authoritative over cached or indexed relationships.

The graph ontology is also readable at `hellotest://projects/{project_id}/graph/ontology`. Reading another project's resource is rejected. The operation ontology at `hellotest://projects/{project_id}/ontology` remains compatible with existing clients.

### Retained task context

Knowledge Graph describes current source relationships. Context Graph connects a
private task trace to its returned retrieval packet, exact evidence references,
recorded access checks and persisted feature outcomes. Both use the existing
PostgreSQL ledger; neither requires Neo4j. See the
[graph architecture](knowledge-context-graphs.md) for the distinct contracts.

The two `hellotest_context_graph_*` tools are reads. They derive the owner and
project from verified identity, require current Knowledge access, and cannot
write events or grant approval. Exact source/document/fragment access is checked
again during exploration. A denied selected fragment is omitted even when
another fragment of the same source remains readable. Authorized old revisions
and live snapshots retain honest state labels; live snapshots do not assert
current content or invent an indexed Knowledge node.

Successful native ContextPackets can carry `retrieval.context_graph` with a
recorded trace receipt or an explicit unavailable status. Capture is optional:
its failure does not replace valid evidence or replay a feature operation. An
immutable selection digest prevents a packet identity from silently acquiring a
different selection. Chatbot and specialist hooks record observed outcomes after
their native result is persisted. Other decisions, approvals and external effects
are not inferred from generated prose.

Capture describes the MCP retrieval result. Later host packing may select fewer
passages, so `RETRIEVED_EVIDENCE`, `stage:retrieval_result` and
`model_input_verified:false` do not establish provider consumption. Trusted
in-process feature/session metadata is retained where supplied; remote MCP
credentials carry principal/project scope, not unsigned caller feature labels.
Missing remote labels remain generic `mcp.context` observations. Events preserve
occurrence time separately from recording time. Date filters select recording
time and do not reconstruct a historical Knowledge Graph.

Trace/event metadata currently has no automatic expiry or session purge. Database
deletion of its owning user or project cascades the records. Bounded reads do not
bound stored history. Source bodies, raw prompts and hidden model reasoning are
not copied into this ledger. Verification scope is recorded in the
[graph verification guide](../development/knowledge-context-graph-verification.md).

All registered API routes are inventoried. Ordinary catalog discovery returns
callable canonical operations matching the user's permissions, feature access,
family and query. `callable_only:false` includes authorized diagnostic entries
with explicit `requires_domain_wrapper` or `nondelegable` reasons; it does not
enable them. Compatibility aliases are hidden from normal discovery. Environment
and configuration reads omit variable bags and header/cookie values. Read
adapters cover core QA records, planning, workflow/agent metadata, Knowledge,
dashboards, traceability, object metadata and other audited JSON contracts.
Privileged, streaming, binary and unwrapped routes remain unavailable.

Reviewed adapters now include persisted create/update/delete operations,
membership changes, durable commands and bounded AI proposals across multiple
feature families. Each has explicit project/reference checks, a native input
contract, reviewed preview and a verifiable result strategy. AI generation uses
the reviewed action path rather than masquerading as a read. Missing controller
schemas are unavailable rather than invented. The generated contract artifact
extracts real controller validation, including helper-registered routes and
shared field declarations; domain services retain business-rule ownership.
Adding a route alone never exposes a mutation. Consult live discovery and the
coverage inventory rather than a fixed operation count.

PostgreSQL projections include core QA summaries, steps/modules, planning,
datasets, schedules, workflows/runs, agent metadata, Knowledge metadata,
dashboards, activity and object metadata. `hellotest_database_schema` publishes
the exact available fields; allowed columns are intersected with the actual
database schema. Queries use fixed project predicates and parameterized filters;
callers cannot supply SQL, table names, joins or functions. Projection queries
run in a separate pool of at most three connections, read-only transactions, a
3-second statement timeout and 500ms lock timeout. Set
`HELLOTEST_MCP_DATABASE_URL` to a dedicated SELECT-only PostgreSQL role for
deployment-level least privilege. Otherwise, the application database connection
is reused with read-only transactions. Authentication and secret tables are
absent from schema discovery.

## Reviewed actions

Preparing persists the original arguments, user, project, client, catalog revision, expiry and digest. Plans expire in 15 minutes. The model has no approval tool and cannot approve using an MCP credential.

Execution plans also capture each selected Test Case's actual history revision
and SHA-256 of its stored case fields and ordered steps. These server-derived
preconditions appear in the review preview and are part of the immutable digest.
Standalone step edits are detected even when they do not advance case version
history. Approval and execution recheck them. Native execution creation checks
them again while holding case/step locks and reloads the case facts before
persisting its snapshots, closing the gap between MCP claiming and domain
execution. Legacy execution plans without reviewed revisions require a new
preview. The ordinary execution contract is extracted from the complete request
body; nested Smart Run acceptance validation cannot replace that contract.

The signed-in original user opens the HelloTest card's action plans, expands the preview and explicitly authorizes its exact digest. The server checks ownership, current permissions, catalog and expiry. Execution locks and claims the original row before invoking the domain API. Concurrent or repeated calls return the same plan's state; they do not create another effect.

Persisted changes require read-back of reviewed fields and applicable membership
storage. A durable job/run is reported as `submitted`, never as a passing test
run. Generated proposals use `succeeded_proposal` with `persisted:false` and
`approved:false`; saving selected material requires a separate reviewed action.
Updates capture a target revision/content fingerprint and reject intervening
edits. Test Case and execution creation bind the domain's durable source
idempotency key to the original plan ID. For an `unknown` receipt or stale
`executing` state, status can locate that exact original record, recheck
ownership/permissions and verify saved fields/scope, then persist an audited
verified receipt. Reconciliation issues no replacement action. When the original
effect cannot be verified, the outcome remains `unknown`; applicable commands
still require original-record/operator reconciliation. Authorization, accepted
execution and final receipts are audited without tokens or raw knowledge
passages.

## AI and Smart Context

Smart Context and the grounded chatbot use the same MCP `context_build` boundary in process through the real SDK handler. Internal use needs no saved host token or shared administrator account: the signed-in user and current project are revalidated. Invalid or mismatched context packets are rejected. Smart Context packets expose `retrieval.context_transport: "mcp"`. Existing retrieval packets, citation identities, ACL checks, historical access, hybrid search, live facts, relationships, budget accounting and progress callbacks remain owned by the knowledge engine. MCP does not replace ranking or turn knowledge text into instructions.

The shared LLM HTTP client also injects bounded MCP evidence for project-bound AI calls (including the text portions of image-based authoring requests): authoring, story assistance, reviews, automation, Agent Studio, dashboard analysis, execution analysis and reports. Request-local authenticated identity and existing background integration bindings determine scope. Requests without a verified user and project are not given guessed access. Internal retrieval sets a recursion guard; knowledge planning/answering calls avoid duplicate enrichment. Retrieval failure adds an explicit evidence gap to the generation input instead of claiming unavailable context.

Native graph witnesses deliberately carry zero similarity score. Fusion admits
their exact evidence only through the authorized, reviewed graph relationship
contract; it never invents semantic confidence to pass a lexical/vector search
threshold. The shared AI gateway and provider size correction retain graph
relationships together with their delivered witness evidence. Missing, altered,
redacted or shortened witnesses remove the dependent relationship and increment
the omission count. Citation IDs alone cannot establish a relationship whose
assertion text was omitted.

MCP redaction preserves the ContextPacket `authorization` provenance and `authorization_partial` limitation fields while stripping HTTP authorization headers and credentials. The PostgreSQL integration check validates a retrieved MCP packet through `buildModelRequest`, so a packet that cannot be consumed by synthesis fails verification. Model synthesis gets one bounded regeneration for invalid JSON or missing/invented claim citations; it never publishes an uncited answer as grounded.

This supplies grounded inputs; it does not guarantee an LLM's correctness. Existing feature schemas, response validation, citations and human review still apply. Live quality improvement depends on the configured LLM and indexed project knowledge. The separate Temporal worker dispatches built-in tools to the API MCP endpoint using freshly issued resource-bound credentials revoked after each call; it does not need its own API listener or route catalog. External providers remain explicit workflow connections; their tools are not automatically granted to every AI feature.

## Deployment configuration

| Variable | Meaning |
| --- | --- |
| `HELLOTEST_MCP_PUBLIC_URL` | Public HTTPS MCP endpoint, e.g. `https://qa.example.com/api/mcp` |
| `HELLOTEST_MCP_ALLOWED_HOSTS` | Comma-separated allowed incoming hostnames; public URL hostname is included |
| `CORS_ORIGIN` | Allowed browser origins, shared with platform CORS |
| `HELLOTEST_MCP_SIGNING_KEY` | Optional dedicated signing secret of at least 32 bytes; otherwise a resource-specific key is derived from the session secret |
| `HELLOTEST_MCP_INTERNAL_URL` | Fixed API MCP endpoint for a separate durable worker; worker defaults to `http://api:3000/mcp`, or the configured public endpoint |
| `HELLOTEST_MCP_DATABASE_URL` | Optional dedicated SELECT-only projection database connection |
| `HELLOTEST_MCP_MAX_CONCURRENT` | MCP HTTP concurrency per API process; default 16, capped at 64 |

Run normal migrations before production verification mode. Keep TLS at the trusted ingress and pass the correct allowed host. HTTP requests have a 128KiB body limit, capacity backpressure and a complete request deadline that includes authentication. Ordinary calls have 30 seconds; a context read can use its selected retrieval budget up to 60 seconds plus a 2-second assembly allowance. Graph reads also enforce their smaller native deadline. Reads return bounded sanitized JSON, at most 50 projection rows, and at most 180KB per tool result. Cancellation is cooperative: it must not be interpreted as proof that an already accepted mutation had no effect.

Protocol verification uses the pinned official TypeScript server package `2.3.1`, the modern `2026-07-28` stateless request format and the three advertised legacy revisions. The current official [MCP specification](https://modelcontextprotocol.io/specification/2026-07-28) and [TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) were checked on 20 October 2026. The modern HTTP binding carries method/name metadata in matching headers and request bodies, including resource reads. Compatibility is tested through actual SDK requests rather than inferred from a version constant. See the official [Streamable HTTP binding](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports) for transport semantics.

The built-in authentication flow is **manual resource-bound bearer credentials**. An OAuth authorization server, automatic client onboarding and federated SSO are not implemented or claimed. Hosts that require OAuth-only onboarding need a separate identity-provider integration. The default local endpoint is not a public production deployment. Retain MCP audit/plan records under the deployment's database backup and retention policy; no automatic audit purging is enabled.

## Cloud host/origin troubleshooting

A built-in status check verifies the in-process MCP protocol. It does not traverse the public reverse proxy. The status response includes `external_transport` flags for the request Host/Origin and advertised endpoint configuration; these flags are diagnostics, not a public reachability test.

For `https://app.hellotest.ai/api/mcp`, configure the cloud API process with `HELLOTEST_MCP_PUBLIC_URL=https://app.hellotest.ai/api/mcp`. Its hostname and own origin are included in the MCP policy. Add any internal hostname actually sent by your trusted reverse proxy to `HELLOTEST_MCP_ALLOWED_HOSTS`, or preserve the public Host with `proxy_set_header Host $host`. Do not rely on arbitrary forwarded headers to authorize a host. The launcher derives the MCP URL from a configured HTTPS public API URL when no explicit or retained MCP URL is available.

External server-side clients may omit Origin and still require a valid delegated bearer credential. Browser clients that send Origin must use an exact origin included in `CORS_ORIGIN`, for example the actual client website's `https://...` origin. Do not add wildcard origins or confuse the client Origin with the HelloTest endpoint hostname. Recreate the API container after changing its environment; an env-file edit alone does not update a running process. A request without a token should reach HTTP 401 after the Host/Origin rules are correct, rather than HTTP 403. New error responses distinguish `MCP_HOST_DENIED` from `MCP_ORIGIN_DENIED`.

## Validation

```sh
node scripts/build/mcp-contracts.mjs --check
npm run test:mcp
node scripts/checks/test-mcp-postgres.mjs
npm test --workspace @hellotest/agentic
npm test --workspace @hellotest/knowledge
npm test --workspace @hellotest/chatbot
npm test --workspace @hellotest/integration
```

The PostgreSQL check reads the local environment configuration, creates an isolated `agent_verify_mcp_*` database, migrates it, exercises actual domain APIs and the SDK, and drops it in `finally`. It refuses nonlocal database hosts. It checks same-user cross-project isolation, typed projections, live context retrieval, fresh fragment ACL and historical-access checks, lost-receipt reconciliation without duplicate effects, actual worker-to-API HTTP, forged SQL/identity rejection, host/origin validation, explicit approval, concurrent execution, actor isolation, suspension and credential revocation.

Browser verification uses the actual MCP Servers component with controlled API fixtures for search, creation/discovery, credentials, exact-plan review, project switching and mobile layout. It verifies UI behavior, not an external LLM provider or public TLS deployment.

Architecture skill: `~/.codex/skills/hellotest-mcp-architecture/SKILL.md`, with the complete extracted reference guide under `references/implementation-guide.txt`.

## Intent planning and knowledge enrichment

Project-bound AI generation uses the shared MCP enrichment boundary according
to the effective feature or native-node evidence policy; task-input-only mode
makes no optional retrieval. The legacy `HELLOTEST_MCP_AI_CONTEXT=false` bypass
is no longer honored. Calls without verified user/project scope are never given
guessed credentials. The selected integration is checked against the same
project. Required missing evidence stops primary generation; optional retrieval
failures remain explicit gaps. Prefetched evidence is marked to avoid a second,
wider search.

Smart Context's intent-aware search delegates to the MCP ContextPacket path
under the existing project/Knowledge permissions. Public `context_build` uses
deterministic intent routing, with an optional bounded, anchored `intent_plan`
hint. It does not call a hidden generative intent planner or generate an answer.
An internal chatbot plan can be carried through once instead of invoking a
second planner. Embedding retrieval still follows the selected integration and
cost budget; `max_query_cost_usd:0` permits lexical/graph retrieval without model
query cost. Exact source/application/evidence filters, empty scopes and zero
budgets remain authoritative. Plain repository search remains direct
hybrid/keyword search for explicit search use.

Knowledge ingestion publishes canonical extracted text, lexical indexes and local vectors first. Optional LLM enrichment selects exact source excerpts and information needs; invented/paraphrased excerpts and unknown chunk IDs are rejected. Generated hints are tagged nonauthoritative in metadata, stored under the same document/source ACL and revision, and cannot replace source content. A model outage leaves the standard index ready. The ingestion processing fingerprint is versioned as `2026.10-intent-enrichment-v3`. Existing sources gain enrichment on their next authorized refresh/reindex that rebuilds the source; this code change does not silently reindex all projects or send their content to a provider.

Each of the 22 built-in specialist profiles defines an artifact format suited to its intent. Test Design includes a design rationale, test techniques, actual cases with data/actions/expected results and a traceability matrix. Agents support longer bounded outputs and reject provider output-limit termination. Shared text rendering supports headings, lists, tables and code as React text without executing HTML. These contracts improve usefulness and traceability; source citation validation does not prove every model interpretation correct.

Where an internal AI workflow explicitly performs model intent planning, those
calls consume its model/tool, cost and wall-clock budgets and are reported as
`intent_model_calls`; retrieval receives the remaining budget. Public evidence
reads use deterministic planning. These limits are separate from specialist
generation/correction calls. Knowledge enrichment samples up to eight sections
across the document; the full canonical source is still indexed.

The four repository agents also have separate source-review formats for objects/locators, API case drafts, repository documentation and component cases. Their model reviews use the same Agent Studio/MCP path. Repository Knowledge Builder retains validated standard compiler findings if optional model review fails; the run is marked partial and requires human review, with no fake model success. Permission failures, cancellation and source/compiler failures still stop the run. The five executable browser agents retain their measured, typed findings and artifacts; model planning never substitutes for observed execution evidence.

## Package ownership and connection troubleshooting

`services/mcp/backend/plugin.js` mounts the HTTP and management routes. `mcpServer.js` defines tools/resources/prompts; `gateway.js` connects shared AI context; `auth.js` verifies delegated credentials; `registry.js` inventories domain contracts; `backplane.js` authorizes domain reads and reviewed writes. `mcpSchema.js` is consumed by the existing platform migration lifecycle. This is an infrastructure workspace package, not another UI capability or separately deployed server. Public imports use `@hellotest/mcp/backend/{plugin,server,auth,gateway,schema}`. Docker packages the same source for API and worker use.

A separate source folder gives MCP clear ownership and test boundaries while keeping domain authorization and data access in their existing services. A separate network process would need a backend delegation contract and independent deployment lifecycle; it is not needed for external clients, which already connect to the API's HTTP endpoint.

Use the built-in HelloTest connection for app workflows and AI features. Creating an external provider pointing back to HelloTest stores a short-lived host token and requires replacement after expiry; it is unnecessary for built-in access. For manual testing of that external-provider flow in Docker, use `http://api:3000/mcp`, enable private-network access, select Bearer, and paste only the `mcp1.` token created in Connect & inspect. Clients running on the host use `http://localhost:8080/api/mcp` instead. Do not paste a login token, API key, credential encryption key or the `Bearer ` prefix into the token field.

Private-network policy failures return 403 before a connection is attempted. MCP Host/Origin failures also return 403; current account/project/feature access is checked independently. An invalid, expired or revoked host token returns 401. Authentication failures include a machine-readable MCP error code; the connection UI provides remediation without displaying remote response bodies or secrets. A browser GET returning 405 means the stateless endpoint is reachable and expects MCP POST requests.

Credential storage requires a persistent `WORKFLOW_CREDENTIAL_KEY` of at least 32 characters (or an allowed secret environment reference). `hellotest.sh` generates and retains this key in the stack environment. Do not rotate it during ordinary startup: saved encrypted connections depend on it. MCP public URL, hostname, signing key, projection database and capacity settings are passed into the API by the Compose files and retained by the launcher. Source changes still require image rebuilds.

Remaining deliberate limits include manual bearer onboarding, no OAuth
authorization server or automatic token refresh, no stdio/legacy SSE provider
launching, and no arbitrary SQL, URLs, host commands or unreviewed writes.
Instance administration, credentials, binary/file transfers, live transports and
host-local device/recording flows need the native UI or a dedicated adapter.
Metadata/context alternatives and explicit unavailable-operation reasons are
documented in the tool reference and coverage inventory. Broader exposure still
requires a scoped contract, native authority checks and meaningful receipt
verification; the implementation does not claim universal application parity.

## Internal context delivery checks

The shared AI gateway leaves the original text/image messages intact and inserts authorized MCP evidence immediately before the relevant user request. Enrichment is limited to eight seconds and at most one third of the model request's timeout; the model timeout includes retrieval time. A stalled optional read is cancelled and represented as an explicit evidence gap, while user cancellation stops generation. Chatbot and Smart Context forward their request signals through the SDK and the existing knowledge execution stages. Authorization failures and foreign-project packets are never bypassed with a broader fallback.

Regression evidence includes real PostgreSQL project evidence delivered into the shared LLM HTTP request with a controlled model response, and a check that internal retrieval creates no host credential rows. Gateway tests cover model integrations bound to background user/project scope, multimodal authoring, request cancellation and stalled retrieval. Browser fixtures cover visible status success/error feedback, both copy labels returning after two seconds, and clipboard errors. These checks prove context delivery and application behavior; they do not claim to evaluate a live model provider's answer quality.

## Repeatable local-stack rebuilds behind a cloud gateway

On the first startup, configure the public gateway URL:

```sh
HELLOTEST_PUBLIC_URL=https://app.hellotest.ai TESTENGINE_WEB_REPLICAS=1 ./hellotest.sh up --build --stack local --no-cache
```

For this HTTPS gateway the launcher defaults the public API to `/api`, advertises `/api/mcp`, and uses the public API for local-run callbacks. Public URLs, exact `CORS_ORIGIN` values, MCP settings, configured local/remote runner URLs, callback URLs and credential keys are retained in the generated stack environment. Explicit environment or `--config` values override retained settings. Configure the actual external browser client's exact origin in `CORS_ORIGIN` when required; the launcher does not trust arbitrary websites automatically.

Later rebuilds can use:

```sh
TESTENGINE_WEB_REPLICAS=1 ./hellotest.sh up --build --stack local --no-cache
```

Keep the generated environment directory across deployments. Use a configured runner callback URL reachable from that runner. This command rebuilds Compose services; a native host Playwright helper has its own startup lifecycle. Updating source and rebuilding on the cloud host is required to apply code changes there.

The server also derives its MCP authority from an explicitly configured HTTPS
`HELLOTEST_API_PUBLIC_URL` or `HELLOTEST_PUBLIC_URL` when the MCP-specific URL is
unset. Compose forwards these settings to the API. Host denials return
`MCP_HOST_DENIED`; browser-origin denials return `MCP_ORIGIN_DENIED`, each with
configuration guidance. An internal status check is not a public gateway test.
Server-to-server clients can connect using the endpoint and a fresh MCP bearer
credential without an Origin; browser clients must use an explicitly trusted
`CORS_ORIGIN`. Untrusted hosts/origins remain rejected.
