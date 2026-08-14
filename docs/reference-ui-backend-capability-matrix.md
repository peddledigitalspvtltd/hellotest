# QAira reference UI backend capability matrix

Source baseline: `/Users/jayarajumetta/Downloads/qaira-for-jira.zip`

The attached Forge frontend is the visual and interaction baseline. QAira keeps its standalone Fastify, PostgreSQL, MinIO/S3, native authentication, and project-membership architecture. Forge-only host behavior is translated to a native QAira contract instead of emulated.

| Reference screen or workflow | Native QAira backend support | Maturity controls |
| --- | --- | --- |
| Overview and release readiness | Project-scoped quality analytics, saved dashboards, deterministic insights, live dashboard PDF and email reports | Bounded queries, completeness/methodology disclosure, permission checks, human release decision |
| Projects | Native project CRUD, project membership, app types, provider sync | Project access validation and scoped permission catalog |
| People and roles | Native users, roles, permission groups, project membership, password recovery | Workspace-admin and project-role separation; no dependency on Atlassian identity |
| Admin Space | Live database, schema, object-storage, attachment, and permission health checks | `ops.view`, remediation detail, measured check evidence |
| Integrations | LLM, Jira/ALM, Test Engine, email, Google sign-in, OPS, and other provider configuration | Project scoping, encrypted/secret-aware configuration patterns, connection tests, import/export permissions |
| Stories | Native create/edit metadata, workflow statuses, paging/search, export, comments, attachments, traceability | Project access, field validation, authoritative exports, optimistic revisions |
| Story AI | Evidence-grounded grooming, rich-text rephrase, Gherkin preview, persistent generation jobs, test-design previews | Bounded evidence, provenance, deterministic fallback, sanitized HTML, explicit human review |
| Sprints | Native lifecycle and Story assignment plus health metrics | Atomic assignment, cursor paging, bounded completeness and methodology disclosure |
| Test design | Native suites, modules, suite-case and module-case assignment | Atomic mapping, optimistic suite revisions, cross-app-type validation |
| Test Cases | Existing mature CRUD, versions/restore, reviews, imports/exports, AI authoring/design | Revision conflicts, governed permissions, source/evidence limits |
| Test steps and shared steps | Single and bulk create/delete, reorder, grouping, reusable shared-step synchronization | Transactional ordering, bounded batch sizes, entity-scoped permission checks |
| Test Runs | Create, plan, assign, start, execute, complete, rerun, history, reports, and share | Immutable snapshots, run revisions, project membership, mode-specific permissions, audit records |
| Result evidence | Results, logs, step evidence, attachments, comments, defect linkage | Row locking and optimistic result revisions, scoped Bug validation, automatic/manual link provenance, stale automatic-link reconciliation |
| Automation | Existing case automation, repository learning, recorder, local/remote execution, generator jobs | Feature flags, explicit build/AI/recorder permissions, bounded jobs and auditability |
| Agentic workflows | Workflow graph CRUD, API-agent tests, governed runs, run snapshots | Per-action permissions, persisted snapshots, explicit agent-context handoff and human action before run |
| Environments and configurations | Native environment/configuration/app-type CRUD and run snapshots | Project/app-type scoping and immutable run-time snapshots |
| Test data | Native key/value and table sets, import/export, synthetic data preview | Fictional safe formats, bounded rows/fields, provenance and human review |
| Knowledge repository | Project knowledge search, context packages, relations, prompt templates | Project scope, permission separation, source-aware context |
| Bugs | Native Bug metadata, paging/search, AI draft and triage, export, bulk delete, links, comments, attachments | Atomic project-scoped bulk delete, bounded AI triage, provenance, field validation |
| TestOps and telemetry | Background transactions, artifacts, execution events, local agent status, OPS telemetry | Permission-separated view/manage actions and durable audit history |
| Notifications | Paginated user inbox, unread summary, mark read/all, delete one/all | Authenticated owner scope and notification preference grouping |
| Settings | Native workspace/localization/feature/API-key/preferences contracts | Permission and feature-flag enforcement; theme stored locally for standalone use |

## Forge-to-native translations

| Forge/Jira host concept | QAira implementation |
| --- | --- |
| Forge bridge invocation | Typed REST calls to `/api` with bearer authentication, timeout handling, cache invalidation, blob, and multipart support |
| Jira project activation | Native project membership and immediate project selection; no activation gate is mounted |
| Jira comments and attachments | Project- and entity-scoped PostgreSQL records plus MinIO/S3 binary storage |
| Jira issue create/edit metadata | Native QAira Story and Bug field/workflow metadata derived from the domain catalog |
| Jira profile theme | Local standalone theme preference with working header control |
| Atlassian identity authority | Native QAira users, roles, project members, login, signup, Google sign-in, and recovery |
| Rovo entry point | QAira QA Agent handoff into the governed Agentic Workflows screen with review context carried into run input |
| Forge realtime notification token | Authenticated notification polling and unread summary; no unavailable Forge token is required |

## Contract verification

- Frontend production build: TypeScript plus Vite.
- Reference frontend preservation: all 221 source files are present; 198 remain byte-identical and 23 are narrowly adapted for native authentication, REST contracts, and standalone functionality.
- Backend unit/contract suite: 15 tests.
- Fastify route registration: 359 route tree nodes on Fastify 5.11.2.
- OpenAPI: 104 parsed paths, including the imported reference workflows.
- Backend production dependency audit: zero known vulnerabilities.
- Docker-backed runtime smoke: PostgreSQL schema migration, Redis, MinIO/S3 upload/list/download/delete, authenticated session and permission loading, paged workspaces, admin health, Story create/update/export/delete, stale-write conflicts, execution-result revisions, case/step Bug linking, and automatic traceability unlink reconciliation all passed.
- Browser-rendered source/implementation comparison remains pending explicit permission to use the chosen browser or Playwright.
