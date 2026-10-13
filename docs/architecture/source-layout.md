# Source and documentation ownership

| Location | Ownership |
| --- | --- |
| `services/<owner>/backend` | Capability routes, use cases, domain services, workers and adapters |
| `services/<owner>/frontend` | Capability pages, components, API client and browser/domain helpers |
| `services/<owner>/package.json` | Explicit dependencies, exports and product metadata |
| `services/platform/backend` | Shared runtime composition, PostgreSQL, security, schemas and foundations |
| `services/platform/frontend` | Workspace shell, administration and shared UI foundations |
| `services/mcp` | Permission-aware MCP protocol and reusable internal context bridge |
| `testengine/backend` | Saved-code execution, queues and provider orchestration |
| `local-run/mobile-engine` | Native device/Appium provider |
| `scripts/build`, `scripts/checks`, `scripts/debug`, `scripts/deploy` | Build, validation, diagnosis and deployment entry points |
| `docs/architecture`, `docs/product`, `docs/development`, `docs/operations` | Current engineering, product and operator guides |
| `docs/research` | Source-linked decision records; current contracts take precedence |

The root `README.md`, `CONTRIBUTING.md`, launchers, Compose files and package manifests remain conventional entry points. Package-local README files stay with the packages they describe. Generated output, dependencies, local environment files, recorder output and runtime databases belong outside committed source.

Use public foundation contracts and declared package exports for cross-capability imports. Share cohesive domain helpers rather than copying permission checks, paging loops or request-deadline logic. Similar callback shapes do not by themselves justify merging different domain policies.

Run `npm run check:boundaries`, `npm run audit:modules`, `npm run audit:source-layout` and `npm run test:architecture` after ownership changes. `npm run check:docs` verifies local Markdown links and the documentation catalog. [Implementation boundaries](implementation-boundaries.md) describes the shared-database limits; source folders do not imply physically independent data ownership.
