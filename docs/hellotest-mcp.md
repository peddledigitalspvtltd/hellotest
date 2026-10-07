# HelloTest MCP

HelloTest serves MCP from the dedicated `services/mcp` workspace package (`@hellotest/mcp`), mounted inside the existing platform API process. It shares the application's domain services, permission checks, knowledge retrieval engine and PostgreSQL migration lifecycle. There is no additional MCP container or second copy of application data.

The attached implementation guide was used as a reference design. Its proposed private routes and sidecar were not treated as existing application contracts. The implementation discovers real registered routes and extracts their declared validation schemas.

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
| `hellotest_capabilities` | Paginated actual route inventory, permissions, input schemas, exposure and catalog revision |
| `hellotest_operation_describe` | Inspect one exact domain contract |
| `hellotest_operation_read` | Authorized project-scoped reads through existing domain APIs |
| `hellotest_context_build` | Cited, budgeted live project and knowledge evidence |
| `hellotest_database_schema` | Actual fields of permitted PostgreSQL projections and relationships |
| `hellotest_database_query` | Bounded, parameterized read projections |
| `hellotest_knowledge_fetch` | Exact indexed fragment with fresh source ACL/version/readiness checks |
| `hellotest_graph_expand` | Authorized one-hop relationship witnesses |
| `hellotest_operation_prepare` | Persist an immutable action preview, with no business effect |
| `hellotest_operation_execute` | Claim and execute an authorized plan once |
| `hellotest_operation_status` | Durable original-plan state and receipt |

The server also publishes `hellotest://schema`, a project ontology resource template, and an `investigate_failure` prompt. Every successful tool result carries a versioned envelope with its verified project and subject.

All registered API routes are inventoried, and routes with permissions are discoverable according to the caller's access. This does **not** make every route executable. The catalog explicitly labels `read`, `planned_action`, `requires_domain_wrapper` or `nondelegable`, and returns exposure counts for the authorized search results. Feature-disabled operations are excluded from discovery. Environment and configuration reads omit variable bags and header/cookie values, which can contain credentials. Generic reads cover projects, applications, environments, configurations, requirements, test cases, suites, shared steps, executions, results, feedback and knowledge sources, excluding privileged, streaming, download and recursive AI routes. Missing controller schemas are returned as unavailable rather than invented. Reviewed action plans validate the declared body schema before persistence; domain services still enforce business rules when execution occurs. The generated artifact captures 178 declared request contracts; business rules remain owned by domain services.

Initial reviewed writes are **test case creation** and **execution creation with 1–50 explicit test cases**. Suite expansion, destructive operations, secrets, administrative changes, arbitrary URLs, raw SQL and unwrapped mutations are not delegated. Adding another mutation requires a scoped wrapper, meaningful preview, authorization and read-back verification; adding a route alone never silently exposes a write.

PostgreSQL projections cover projects, applications, requirements, test cases, suites, executions, defects, environments and configurations. Allowed columns are intersected with the actual database schema. Queries use fixed project predicates and parameterized filters; callers cannot supply SQL, table names, joins or functions. Projection queries run in a separate pool of at most three connections, read-only transactions, a 3-second statement timeout and 500ms lock timeout. Set `HELLOTEST_MCP_DATABASE_URL` to a dedicated SELECT-only PostgreSQL role for deployment-level least privilege. Otherwise, the application database connection is reused with read-only transactions. Authentication and secret tables are absent from schema discovery.

## Reviewed actions

Preparing persists the original arguments, user, project, client, catalog revision, expiry and digest. Plans expire in 15 minutes. The model has no approval tool and cannot approve using an MCP credential.

The signed-in original user opens the HelloTest card's action plans, expands the preview and explicitly authorizes its exact digest. The server checks ownership, current permissions, catalog and expiry. Execution locks and claims the original row before invoking the domain API. Concurrent or repeated calls return the same plan's state; they do not create another effect.

A successful create requires persisted read-back. Execution submission is reported as `submitted`, never as a passing test run. An uncertain outcome remains `unknown` (or temporarily `executing`): reconcile the original plan and domain record rather than retrying or creating a replacement. Authorization, accepted execution and final receipts are audited without tokens or raw knowledge passages. A process crash between the business effect and receipt can require manual reconciliation; exactly-once claiming does not eliminate that uncertainty.

## AI and Smart Context

Smart Context and the grounded chatbot use the same MCP `context_build` boundary in process through the real SDK handler. Internal use needs no saved host token or shared administrator account: the signed-in user and current project are revalidated. Invalid or mismatched context packets are rejected. Smart Context packets expose `retrieval.context_transport: "mcp"`. Existing retrieval packets, citation identities, ACL checks, historical access, hybrid search, live facts, relationships, budget accounting and progress callbacks remain owned by the knowledge engine. MCP does not replace ranking or turn knowledge text into instructions.

The shared LLM HTTP client also injects bounded MCP evidence for project-bound AI calls (including the text portions of image-based authoring requests): authoring, story assistance, reviews, automation, Agent Studio, dashboard analysis, execution analysis and reports. Request-local authenticated identity and existing background integration bindings determine scope. Requests without a verified user and project are not given guessed access. Internal retrieval sets a recursion guard; knowledge planning/answering calls avoid duplicate enrichment. Retrieval failure adds an explicit evidence gap to the generation input instead of claiming unavailable context.

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

Run normal migrations before production verification mode. Keep TLS at the trusted ingress and pass the correct allowed host. HTTP requests have a 128KiB body limit, a 30-second cancellation signal and capacity backpressure. Reads return bounded sanitized JSON, at most 50 projection rows, and at most 180KB per tool result. Knowledge retrieval has its own execution budgets. Cancellation is cooperative: it must not be interpreted as proof that an already accepted mutation had no effect.

The built-in authentication flow is **manual resource-bound bearer credentials**. An OAuth authorization server, automatic client onboarding and federated SSO are not implemented or claimed. Hosts that require OAuth-only onboarding need a separate identity-provider integration. The default local endpoint is not a public production deployment. Retain MCP audit/plan records under the deployment's database backup and retention policy; no automatic audit purging is enabled.

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

Project-bound AI generation always uses the shared MCP enrichment boundary; the legacy `HELLOTEST_MCP_AI_CONTEXT=false` bypass is no longer honored. Calls without verified user/project scope are never given guessed credentials. The selected generation integration ID is passed as a retrieval preference and checked against the same project. MCP failures remain explicit context gaps, not claims that missing evidence was read.

Smart Context requests `/knowledge/search` with `intent_aware: true`. The route retains project/knowledge permissions and delegates to the MCP ContextPacket path. That path asks the configured project-safe LLM for information needs, source kinds and anchored query variants before authorized hybrid/live retrieval. Source filters and source ACLs remain authoritative. An unavailable or invalid planner returns `intent_planning_mode: standard` and a safe reason code; it never claims LLM planning succeeded. Plain repository search remains a direct hybrid/keyword search for explicit search use.

Knowledge ingestion publishes canonical extracted text, lexical indexes and local vectors first. Optional LLM enrichment selects exact source excerpts and information needs; invented/paraphrased excerpts and unknown chunk IDs are rejected. Generated hints are tagged nonauthoritative in metadata, stored under the same document/source ACL and revision, and cannot replace source content. A model outage leaves the standard index ready. The ingestion processing fingerprint is versioned as `2026.10-intent-enrichment-v3`. Existing sources gain enrichment on their next authorized refresh/reindex that rebuilds the source; this code change does not silently reindex all projects or send their content to a provider.

Each of the 22 built-in specialist profiles defines an artifact format suited to its intent. Test Design includes a design rationale, test techniques, actual cases with data/actions/expected results and a traceability matrix. Agents support longer bounded outputs and reject provider output-limit termination. Shared text rendering supports headings, lists, tables and code as React text without executing HTML. These contracts improve usefulness and traceability; source citation validation does not prove every model interpretation correct.

Intent planning consumes the context request’s model/tool, cost and wall-clock budgets. Planner calls are reported as `intent_model_calls`, and retrieval receives the remaining budget. This is separate from the specialist generation/correction call limit. Knowledge enrichment samples up to eight sections across the document; the full canonical source is still indexed.

The four repository agents also have separate source-review formats for objects/locators, API case drafts, repository documentation and component cases. Their model reviews use the same Agent Studio/MCP path. Repository Knowledge Builder retains validated standard compiler findings if optional model review fails; the run is marked partial and requires human review, with no fake model success. Permission failures, cancellation and source/compiler failures still stop the run. The five executable browser agents retain their measured, typed findings and artifacts; model planning never substitutes for observed execution evidence.

## Package ownership and connection troubleshooting

`services/mcp/backend/plugin.js` mounts the HTTP and management routes. `mcpServer.js` defines tools/resources/prompts; `gateway.js` connects shared AI context; `auth.js` verifies delegated credentials; `registry.js` inventories domain contracts; `backplane.js` authorizes domain reads and reviewed writes. `mcpSchema.js` is consumed by the existing platform migration lifecycle. This is an infrastructure workspace package, not another UI capability or separately deployed server. Public imports use `@hellotest/mcp/backend/{plugin,server,auth,gateway,schema}`. Docker packages the same source for API and worker use.

A separate source folder gives MCP clear ownership and test boundaries while keeping domain authorization and data access in their existing services. A separate network process would need a backend delegation contract and independent deployment lifecycle; it is not needed for external clients, which already connect to the API's HTTP endpoint.

Use the built-in HelloTest connection for app workflows and AI features. Creating an external provider pointing back to HelloTest stores a short-lived host token and requires replacement after expiry; it is unnecessary for built-in access. For manual testing of that external-provider flow in Docker, use `http://api:3000/mcp`, enable private-network access, select Bearer, and paste only the `mcp1.` token created in Connect & inspect. Clients running on the host use `http://localhost:8080/api/mcp` instead. Do not paste a login token, API key, credential encryption key or the `Bearer ` prefix into the token field.

Private-network policy failures return 403 before a connection is attempted. MCP Host/Origin failures also return 403; current account/project/feature access is checked independently. An invalid, expired or revoked host token returns 401. Authentication failures include a machine-readable MCP error code; the connection UI provides remediation without displaying remote response bodies or secrets. A browser GET returning 405 means the stateless endpoint is reachable and expects MCP POST requests.

Credential storage requires a persistent `WORKFLOW_CREDENTIAL_KEY` of at least 32 characters (or an allowed secret environment reference). `hellotest.sh` generates and retains this key in the stack environment. Do not rotate it during ordinary startup: saved encrypted connections depend on it. MCP public URL, hostname, signing key, projection database and capacity settings are passed into the API by the Compose files and retained by the launcher. Source changes still require image rebuilds.

Remaining deliberate limits: manual bearer onboarding only; no OAuth authorization server or automatic token refresh; no stdio/legacy SSE provider launching; no arbitrary SQL or generic writes. Only test-case creation and explicit-case execution creation have reviewed mutation wrappers. Other operations remain visible according to authorization with their wrapper/nondelegable status. A separate process, full write coverage, or OAuth support requires its own domain/identity implementation and verification.

## Internal context delivery checks

The shared AI gateway leaves the original text/image messages intact and inserts authorized MCP evidence immediately before the relevant user request. Enrichment is limited to eight seconds and at most one third of the model request's timeout; the model timeout includes retrieval time. A stalled optional read is cancelled and represented as an explicit evidence gap, while user cancellation stops generation. Chatbot and Smart Context forward their request signals through the SDK and the existing knowledge execution stages. Authorization failures and foreign-project packets are never bypassed with a broader fallback.

Regression evidence includes real PostgreSQL project evidence delivered into the shared LLM HTTP request with a controlled model response, and a check that internal retrieval creates no host credential rows. Gateway tests cover model integrations bound to background user/project scope, multimodal authoring, request cancellation and stalled retrieval. Browser fixtures cover visible status success/error feedback, both copy labels returning after two seconds, and clipboard errors. These checks prove context delivery and application behavior; they do not claim to evaluate a live model provider's answer quality.
