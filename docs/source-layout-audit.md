# Source layout and ownership audit

The repository uses service composition roots so a developer can start with one bounded capability without searching the whole monolith.

## Ownership map

| Capability | Backend composition root | Frontend composition root | Runtime contract |
| --- | --- | --- | --- |
| Platform | `services/platform/backend` | `services/platform/frontend` | `api-platform` |
| Testing foundation | `services/testing/backend` | `services/testing/frontend` | `api-testing` |
| Knowledge repository | `services/knowledge/backend` | `services/knowledge/frontend` | `api-knowledge` |
| Manual workspace | `services/manual/backend` | `services/manual/frontend` | `api-manual` |
| Dashboard | `services/dashboard/backend` | `services/dashboard/frontend` | `api-dashboard` |
| Automation and execution control | `services/automation/backend` | `services/automation/frontend` | `api-automation` |
| Agentic workflows and repository agents | `services/agentic/backend` | `services/agentic/frontend` | `api-agentic` |
| Chatbot conversations and synthesis | `services/chatbot/backend` | `services/chatbot/frontend` | `api-chatbot` |
| AI quality assistance and assurance | `services/ai/backend` | `services/ai/frontend` | `api-ai` |
| Telemetry and trace correlation | `services/trace/backend` | `services/trace/frontend` | `api-trace` |
| External providers and integrations | `services/integration/backend` | `services/integration/frontend` | `api-integration` |

Feature route handlers and use cases now live in `services/<profile>/backend/routes` and `services`. Only route aggregation/registration remains in `services/platform/backend/src/routes`. Composition, database/SDK adapters and error contracts remain under `services/platform/backend/src`; identity and workspace use cases live in Platform. The image preserves the same repository-relative layout as the checkout, and all 52 route modules are loaded in an isolated image check.

Frontend pages, components/CSS, hooks and pure helpers now live under their feature owner in `services/<profile>/frontend`. Workspace composition lives under `platform`; reusable primitives live under `shared`. Knowledge source management lives under `services/knowledge/frontend`. Shared UI must not import feature implementations. The API facade composes capability-owned clients; shared HTTP primitives and transport types remain explicit integration boundaries.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the detailed source map, architecture diagrams and change workflow. This is a source-ownership refactor; profiles still share schemas, dependencies and some use-case calls.

## Naming policy

- Backend transport files use `<bounded-context>.routes.js`; backend use cases use `<bounded-context>.service.js`; persistence uses `<bounded-context>.repository.js`; provider adapters use `<provider>.adapter.js`.
- Frontend service composition files use `index.ts`; feature components use `<Feature><Role>.tsx` and hooks use `use<Feature><Action>.ts`.
- `index`, `README`, and `service.manifest` are allowed composition names. Generic names such as `utils`, `helpers`, `common`, or an unqualified `types` file are not allowed inside a service folder.
- A file can be shared only when it has no feature ownership. Shared code belongs in an explicitly named `shared` or platform package and must not import a service implementation.
- Do not create a second route, API client, or provider implementation when an existing service contract already owns that capability.

## Automated checks

Run `npm run audit:source-layout` before moving or deleting files. It scans the maintained repository file set, including tracked dotfiles, Dockerfiles, executable assets, and non-source contracts, as well as the source roots. It reports category totals, files without extensions, exact content duplicates and ambiguous basenames, verifies that every API route has exactly one service owner, checks that documentation is centralized or explicitly package-local, validates relative Markdown links, rejects tracked dependency/generated/local files, and checks that catalog entries have backend and frontend composition roots. Known fixture, package-marker, and research-capture mirrors are recorded with reasons. The root command runs in strict mode: new duplicates or unreviewed naming/placement warnings fail it. These structural checks do not prove semantic equivalence, unused code, or full service independence.

The audit records repeated names that are still valid boundaries, such as the API server and mobile server both being named `server.js`, or separate `main.tsx` entry points, with an explicit reason. They are not duplicate implementations. An unknown repeated basename or duplicate content group is a strict-audit warning. Generated artifacts, local recorder output, dependency trees, and build output are excluded from the scan and are ignored by Git.

## Safe cleanup completed

- Removed the duplicate `services/platform/services/platform/backend/Dockerfile`; `services/platform/backend/Dockerfile` is the canonical API image definition.
- Removed empty, unreferenced `services/platform/backend/src/utils/response.js` and `services/platform/backend/src/utils/uuid.js`.
- Renamed the ambiguous agent type module to `services/agentic/frontend/agents/agentTypes.ts` and updated all imports.
- Removed the redundant execution prototype after checking its capabilities against `testengine/backend`; the retained engine is included in root tests.
- Removed tracked dependency and generated output trees; installs and builds recreate them from package manifests.

## Feature segregation and orphan review (September 2026)

The scan covered all maintained repository categories, then traced production imports, route composition, offline tooling, test references and preview dependencies. Domain implementations were physically moved; no production compatibility copies were created. `users.js` is now `services/platform/backend/routes/users.routes.js`.

Removed nine unreferenced modules and two associated stylesheets after checking filenames, exported symbols, runtime registries, tests and documentation:

- Unused AI context-pane and evidence-preview components.
- Superseded Test Case AI draft inspector and its private stylesheet.
- Unused workspace scope bar and generic StatCard.
- Unused Forge host-context and user-CSV helpers.
- Unused project-activation admin screen/style and activation query hooks.

Preview source/styles, including the activation presentation and Analytics Mission Control implementations, live in `services/platform/frontend/test/fixtures/previews`. `WorkspaceSectionTabs` was removed after confirming it had no product or preview caller; route and permission coverage remains on the active AppShell and analytics components. The sample-data `catalog.js` and `records.js` compatibility wrappers were removed and their test callers use the authoritative repository directly. Setup export helpers and the knowledge evaluation service remain used offline entry points.

`npm run audit:modules` now reports relative import failures, forbidden shared-to-feature imports, dynamic import sites, offline/test consumers and unexplained orphan candidates. It fails on unresolved imports and shared-to-feature dependencies. Candidate detection is a review aid, not proof that dynamic or external consumers cannot exist.

The repository-wide audit covered 1,655 maintained files (769 source/data modules across the audited source roots). All 51 routes have exactly one owner. The import graph after cleanup contains 765 executable/style modules, with no unresolved imports, shared-to-feature dependencies or unexplained candidates. Runtime profiles, schema ownership and provider boundaries still require focused work before complete deployment independence can be claimed.


## Follow-up implementation review

The whole maintained repository is scanned for exact file duplicates, source ownership, broken references and generated files. An additional `npm run audit:clones` command reports repeated function token sequences across runtime source. This is advisory: identical callback text can close over different state, and shared-looking code in separate deployed runtimes does not automatically belong in a common dependency. The report preserves identifiers and string literals and ignores comments/whitespace; it does not establish semantic equivalence or find every near-duplicate implementation.

Refactors made after that review:

- Manual shared-step creation, group updates and synchronization use `services/testing/backend/domain/sharedStepDefinition.js`. The pure policy preserves step aliases, ordering, automation code and request content.
- Automation dispatch and callbacks use `services/automation/backend/domain/executionArtifacts.js`. Artifact storage is supplied as a function rather than imported as a workspace dependency; a storage failure continues to leave execution completion intact.
- Run-hook types and request mapping live in `services/testing/frontend/lib/runHooks.ts`, shared by both run creation flows. The Manual caller retains its permission filtering before mapping.
- Manual case and execution views use one `StepKindIconBadge` component.
- Preview-only production modules were moved to fixtures; unused compatibility and navigation code was removed after checking callers.

`npm run audit:modules` now fails on disconnected production modules or CSS, including modules referenced only by tests. Offline exports/evaluation tools are traced separately. It validates actual imports in scripts and preview fixtures and understands the capability UI aliases and TestEngine's TypeScript ESM imports. The import scanner and cycle-safe reachability logic have their own regression tests (`npm run test:architecture`). Preview modules have an explicit `npm --prefix services/platform/frontend run check:previews` type-check and remain outside production builds.

Dynamic imports, Python subprocess entry points, runtime-selected assets and external callers still require owner review. An automated clean result is not proof that every possible runtime path or business dependency is isolated. Remaining clone candidates include local UI callbacks, normalization policies and code in separate execution environments; review their contracts before consolidating them.

Verification for this follow-up: 1,661 maintained files scanned; no unreviewed exact-file duplicates or audit warnings; 761 runtime source modules analyzed with no unresolved imports or detected production orphans. The full test command passed 1,854 tests with two existing skips. Workspace, admin and TestEngine builds, preview type-checks, two authoring/Smart Run browser checks, and a 51-route API image load check passed. A temporary negative probe confirmed that the module audit rejects both unused CSS and test-only production code; the probe files were removed. Existing frontend bundle-size warnings remain.

## Capability boundaries follow-up

Platform, Testing and Knowledge now have distinct profiles and source ownership. Agent implementations and Python runtime assets live under Agentic. Shared prompt templates and project sync belong to Integration. Capability clients and recurring worker declarations live beside their use cases. `services/capabilities.json` controls validated dependency expansion and server-enforced deployment availability.

The current scan covers 793 executable/style modules and 52 uniquely owned route modules. It reports no unresolved imports, production orphans, unreviewed file duplicates or warnings. The full runtime test command passes 1,862 tests with two existing skips (1,193 backend, 613 frontend, 53 TestEngine and three architecture tests). The backend image loads all 52 route modules, the instance dataset and Agentic runtime assets. Gateway checks verify continued Platform, Testing and Knowledge access after stopping Manual and Chatbot.

Counts above describe this check, not guarantees about future additions. Shared database ownership, cross-capability internal calls, large feature screens and shared frontend DTOs remain explicit follow-up work; see the [architecture decision](architecture/capability-packaging.md).
