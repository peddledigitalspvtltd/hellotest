# Platform acceptance status

The target is a reliable platform whose domains can be developed, tested, deployed, and scaled independently. The current implementation is a migration toward that target. Service folders currently own transport composition and endpoint selection; they do not yet contain every implementation or provide independent data ownership.

## Verified in this architecture pass

- Unknown API profiles fail startup instead of silently enabling all routes.
- Every declared literal HTTP endpoint is checked against frontend service selection and its backend route manifest. Workspace requests, Chatbot streams, and administration integration reads use the resolver.
- Each profile loads and starts only its assigned recurring background workers. Tests exercise registration, execution, and shutdown for all profiles and the compatibility `all` profile.
- Both UI bundles receive validated, safely serialized runtime configuration. Malformed maps fail startup; quotes and backslashes in configuration remain data.
- The profile Compose contract supplies configuration names consumed by Tika and TestEngine, matching storage credentials and engine secrets, readiness grace periods, and loopback port bindings.
- A disposable Nginx test verifies query/body forwarding, PATCH, immediate stream progress, and continued UI/Manual access when the synthetic Chatbot upstream stops. Nginx also restarts while Chatbot is absent. Streaming is checked on both UI listeners in the existing single-API deployment as well.
- Repository checks reject tracked dependencies/generated output and unreviewed duplicate or naming warnings. The scan covers maintained files throughout the repository, including real source directories named `artifacts`; local recorder artifacts, dependencies, build output, and environment secrets are excluded.

## Acceptance areas that require further work or live validation

| Acceptance area | Current boundary and remaining validation |
| --- | --- |
| All AI features | Automated contract and failure-handling tests run in the backend/frontend suites. This pass did not make real provider calls or prove model quality, account quota, timeout behavior, or grounding across every workflow. |
| Chatbot retrieval and readable responses | Profile routing and streaming transport are verified. A live project conversation must still validate authorization, multi-source retrieval, citations, retry, and the rendered response with the configured provider. |
| Templates, Smart Run, assurance, grooming, defects | Existing automated tests run. Browser acceptance with representative project data and provider responses remains necessary; architecture checks alone do not certify these experiences. |
| Schedules, metrics, details, and tiles | Existing automated tests run. This pass did not repeat every browser workflow or execute scheduled jobs against a live database. |
| Realistic, traceable sample data | Setup API tests run; this pass did not create new sample records or verify all resulting relationships in a live instance. |
| Independent service source ownership | Manifests and frontend endpoint definitions are grouped by domain. Route implementations, application services, and most pages/components remain in shared trees. Knowledge Repo and Chatbot share one profile. |
| Independent deployment and failure isolation | Local routing and profile worker ownership are verified. Profiles share an image, application code, authentication, schema/bootstrap logic, and PostgreSQL. Full database-backed profile startup, rolling version compatibility, and domain failure isolation are not yet verified. |
| Repository maintainability | Structural audits, import/build checks, documentation placement, and exact-duplicate checks pass. They cannot establish that every file is semantically necessary or that every module follows SOLID. |

## Remaining extraction sequence

1. Move cohesive domain use cases, persistence adapters, frontend components, and tests behind explicit service contracts; remove direct imports of another domain's implementation.
2. Extract story/test-case authoring, defect generation, and Smart Run from Manual if the AI domain must own their deployment. Keep durable-job producers and consumers on compatible contracts throughout the move.
3. Separate Knowledge Repo ingestion/search from Chatbot orchestration if they need independent development and availability.
4. Replace cross-domain SQL joins and shared writes with owned data, versioned APIs/events, and retryable projections before separating databases.
5. Add real deployment tests for migrations, service loss, rolling upgrades, and recovery. Validate the AI and UI acceptance workflows with configured providers and representative project data.

See the [service runbook](../services/README.md) for setup, validation, runtime configuration, and gateway test commands; the [source audit](source-layout-audit.md) and [file map](repository-file-map.md) describe organization and cleanup rules.
