# Repository architecture review (historical)

This review predates the npm capability packages and runtime UI release work. Counts and packaging statements below record that earlier checkout. See [the current architecture decision](capability-packaging.md) and [implementation contracts](implementation-boundaries.md) for the implemented structure and remaining limitations.

Reviewed on 24 September 2026 against the working tree, including existing uncommitted changes. This review distinguishes source organization, process deployment, and independent service ownership.

## Assessment

The capability-first monorepo is a useful structure to retain. Frontend and backend discovery is substantially clearer, and route ownership and worker composition are explicit. However, this is still a modular monolith that can run selected API profiles in separate processes. It is not yet an architecture in which each capability can be built, changed, released and migrated independently.

The next improvement should be enforceable contracts and smaller use cases, rather than another broad folder migration. Passing import-resolution or route-registration checks does not establish service independence.

## Findings, ordered by architectural impact

### 1. High: capability dependency boundaries are not enforced in code

Static inspection found **230 backend cross-capability import edges across 45 directed owner pairs**, plus **193 frontend cross-capability import edges**. Backend ownership has a mutually dependent group containing Platform, Testing, Knowledge, Manual, Dashboard, Automation, AI, Trace and Integration.

This is a cycle at the capability level, not a claim that every individual module has a CommonJS initialization cycle. Frontend counts include type and stylesheet imports; backend counts include literal lazy `require` calls, whether or not every branch executes.

A separate read-only probe loaded the actual Automation route modules with both deployment selection and process profile set to `automation`. Only Automation route ownership was selected, but implementation modules loaded from eight capabilities:

| Owner | Loaded backend implementation modules |
| --- | ---: |
| Automation | 14 |
| Testing | 17 |
| Manual | 2 |
| Integration | 1 |
| Platform | 14 |
| Trace | 1 |
| AI | 1 |
| Knowledge | 10 |

Manifest files were excluded from these counts. The probe loaded modules without starting the server, workers or a database-backed workflow. It does **not** mean excluded HTTP routes are enabled. It does demonstrate that the deployment dependency list is not the implementation/package dependency graph.

For example, [execution.service.js](../../services/testing/backend/services/execution.service.js) imports Manual's `suiteExecutionContext.service`, while [executionResult.service.js](../../services/testing/backend/services/executionResult.service.js) calls Manual's defect synchronization. [testCases.routes.js](../../services/testing/backend/routes/testCases.routes.js) directly imports Manual, AI and Automation implementations.

**Consequence:** removing an excluded capability's source or changing its internal API can break a supposedly independent package. Folder ownership alone has not satisfied dependency inversion or interface segregation.

**Next action:** move genuinely misplaced suite-context logic to Testing; then replace cross-capability business calls with explicit ports and local adapters. Introduce remote adapters only where process independence is needed. Record permitted dependencies and prevent new unapproved edges in CI.

### 2. High: shared persistence and packaging prevent independent releases

**101 capability source modules directly import the common main database adapter.** All API profiles receive the same main database configuration in [docker-compose.microservices.yml](../../docker-compose.microservices.yml). The [API Dockerfile](../../services/platform/backend/Dockerfile) installs one dependency set and copies every capability backend into the image.

The [project deletion repository](../../services/platform/backend/services/projectDeletion.repository.js) knows table relationships across testing, stories, automation, Knowledge and Chatbot. The [AI context orchestrator](../../services/ai/backend/services/aiContextOrchestrator.service.js) reads multiple domains directly.

**Consequence:** separate containers do not establish database privilege isolation, independent schema evolution or release compatibility. A shared schema change or credential failure can affect multiple profiles.

**Next action:** assign table and migration ownership while retaining the current database. Publish repository/read-model contracts, replace cross-owner writes, and add compatibility tests. Separate credentials or databases only after those dependencies have been removed. Avoid a disruptive database split solely to match folder names.

### 3. High: Platform and Testing are not yet clean foundations

The declared graph makes Platform a foundation and Testing depend only on Platform. Actual dependencies point back into product features: [Platform projects routes](../../services/platform/backend/routes/projects.routes.js) import Dashboard analytics/report implementations; Platform users routes import Testing batch processing; Testing execution imports Automation and Manual implementations.

Some reuse is reasonable—for example, a generic PDF renderer—but its implementation should live behind a reusable contract rather than making identity/workspace composition load product internals. Portfolio analytics ownership also needs an explicit product decision.

**Next action:** extract infrastructure-neutral utilities and inject capability-specific integrations. Make foundational behavior usable without loading unrelated feature implementations. A stopped downstream process and an absent downstream implementation are different tests; cover both where independence is required.

### 4. Medium: large modules still dominate debugging and change risk

Approximate physical source sizes:

| Module | Lines |
| --- | ---: |
| Testing `TestCasesPage.tsx` | 15,000 |
| Testing `ExecutionsPage.tsx` | 14,000 |
| Manual `RequirementsPage.tsx` | 9,400 |
| Automation `AutomationPage.tsx` | 6,700 |
| Automation `aiAutomationBuilder.service.js` | 5,000 |
| Shared frontend `types.ts` | 3,800 |

File size alone is not a defect, but these are still the dominant maintenance units after folder segregation. They warrant responsibility-level review; relocation has not reduced their scope.

**Next action:** extract cohesive flows such as case authoring, case review, run planning and result entry, with their own state/query hooks and focused integration tests. Split shared DTOs by public contract ownership. Avoid arbitrary line-count cuts or layers that merely forward calls.

### 5. Medium: architecture checks currently establish less than the target requires

The [module audit](../../scripts/checks/audit-module-graph.mjs) checks unresolved imports, unexplained production orphans and imports from generic shared UI into features. It does not reject cross-capability cycles or enforce the declared capability dependency graph. [Composition tests](../../services/platform/test/backend/capabilityComposition.test.js) verify selected route ownership and availability flags, not absence of excluded implementations. Gateway checks use synthetic upstreams, so they do not prove database-backed workflows survive dependencies failing.

Service identity/composition is also maintained in several places: catalog, capabilities, backend profiles, manifests, worker loaders, frontend registry, Compose and Nginx. Existing consistency checks help, but this remains a source of drift.

**Next action:** add dependency-policy checks, real customer-selection workflow tests, migration compatibility checks and measured failure/resource tests. Generate the mechanical portions of deployment configuration from a validated manifest where useful.

### 6. Medium: resource ceilings are not demonstrated efficiency

The separate-profile stack bounds per-process memory, DB connections and log files. That is useful protection, but eleven copies of the shared API runtime still duplicate overhead. All API profiles also wait for PostgreSQL, Redis and MinIO in Compose, whether a particular route needs all three.

At current defaults, eleven API processes have a combined configured memory ceiling of 5.5 GiB and main/observability pool maxima totaling 66 connections, excluding other processes and dedicated clients. These are **limits, not measured consumption or reservations**.

**Next action:** measure representative selections under load and failure. Use the composed API where it is sufficient; separate expensive workers or capabilities when the operational benefit is demonstrated. Make mandatory infrastructure dependencies specific to each process rather than assuming all infrastructure is universally required.

## What is worth preserving

- Capability-first services/platform/frontend/backend colocation and explicit route ownership.
- Platform, Testing and Knowledge as named ownership boundaries, while correcting their remaining dependencies.
- Capability-owned clients and workers with shared HTTP/lifecycle mechanics.
- Server-side availability checks in addition to navigation controls.
- Existing contract tests, bounded gateway behavior, Git hygiene and schema/sample-data separation.
- The monorepo: separate repositories would not resolve the dependencies identified here.

## Empty-directory cleanup

The initial physical filesystem scan covered **5,035 directories and 60,352 file entries**, including hidden paths and installed dependencies. Directory symlinks were not followed. There were 35 empty leaf directories and 55 directories whose entire subtrees were empty.

Removed **45 empty directories**, including newly empty parents, using `rmdir` only. No source files were deleted. Removed roots:

- `backend/services` — old service layout.
- `services/platform/backend/agents` and `services/platform/backend/src/agents` — relocated Agentic implementations.
- `services/platform/backend/src/services/sampleData` — relocated Platform setup code.
- `services/chatbot/frontend/knowledge` — relocated Knowledge UI.
- `services/manual/backend/domain` — relocated Testing domain helper.
- `ops/promtail` — unused empty directory.
- `.firecrawl` — empty disposable scratch directory.

Retained ten empty directories/subtree parents: two Git reference directories, one installed dependency directory, and seven local recorder artifact directories/parents. These belong to Git, package-manager or potentially active runtime state. Their emptiness is not sufficient reason to alter them.

Corrected stale sample-data and Agentic documentation paths and made existing debugging source links relative to the repository instead of one developer's old checkout path.

## Verification and limits

After cleanup, module, source-layout and service-architecture checks passed, along with 22 targeted profile, worker, capability-composition and endpoint-routing tests. The source-import review covered 670 JavaScript/TypeScript files under capability sources and the application runtimes; it was not a line-by-line security audit of all languages or dependencies.

No deployment or database migration was performed. This turn removed empty directories and corrected documentation; the architectural findings above remain work to address, not fixes implied by a successful cleanup check.
