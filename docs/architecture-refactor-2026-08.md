# QAira architecture refactor — August 2026

## Scope and invariants

This pass preserves the attached QAira/Jira reference UI as the visual contract. It changes navigation lifecycle, shared selection behavior, persistence boundaries, and database access without redesigning screens or changing native QAira ownership of backend data.

The principal invariant is that every sidebar destination remains reachable in any order, including routes that render the same page component with different modes.

## Frontend boundaries

### Route registry

`frontend/src/lib/workspaceRoutes.ts` is the canonical path registry. Router declarations, primary navigation, section navigation, and route prefetching consume this registry rather than maintaining independent path literals.

The shell now owns:

- persistent sidebar lifecycle;
- page-local lazy loading, so loading a new page does not replace the shell;
- a page-local error boundary keyed by pathname, so one failed page cannot disable the remaining navigation;
- closing mobile navigation for pathname, search, and hash transitions;
- a bounded React Query cache policy that avoids immediate refetch storms when users revisit pages.

### Catalog selection

`useCatalogSelection` owns selection state independently of tile/list rendering. `DataTable` accepts controlled row keys and emits selection changes. Test Environments, Test Data, and Test Configurations therefore expose the same row and select-all checkbox behavior in both view modes.

Only the active Test Environment subpage fetches its resource collection. Moving between its three subpages no longer launches three parallel list requests or carries a hidden detail-selection state from the previous route.

## Backend boundaries

### PostgreSQL adapter

Main and observability databases now use one `createPostgresAdapter` implementation. It provides:

- one placeholder compiler and structured-parameter serializer;
- a bounded SQL compilation cache;
- deterministic named prepared statements for static repository queries;
- nested transaction reuse through `AsyncLocalStorage`;
- tuned, configurable pools with connection timeout, idle timeout, keepalive, and connection recycling.

This removes two drift-prone database implementations and separates connection policy from domain services.

### Domain services and repositories

`projectScope.service.js` owns project/app-type aggregate validation. Environment, configuration, and data-set services now depend on that single policy and validate both records in one round-trip. Deletes are atomic `DELETE ... RETURNING` operations rather than read-then-delete sequences.

`batchHydration.js` provides relation grouping for list read models. The following endpoints no longer hydrate relations one record at a time:

| Read model | Previous query growth | Current query growth |
| --- | ---: | ---: |
| Requirements + cases/defects | `1 + 3N` | `3` |
| Test cases + suites/requirements/modules/defects | `1 + 4N` | `5` |
| Executions + assignees/suites | `1 + N + assignees` | `3` |
| Execution schedules + assignees | `1 + assignees` | `2` |
| Test-case modules + case IDs | `1 + N` | `1` |
| Workspace transactions + creators | `1 + N` | `2` |

`GET /test-cases` now also honors module/unassigned-module filters and the paged response contract already consumed by the frontend.

### Index strategy

Runtime schema bootstrapping adds composite indexes aligned with the highest-frequency scope and activity sorts for requirements, cases, executions, and all three Test Environment catalogs.

## SOLID alignment

- Single responsibility: navigation lifecycle, selection state, DB mechanics, scope validation, and batch hydration each have one owner.
- Open/closed: new catalog list views can opt into controlled row selection without changing `DataTable` internals.
- Liskov substitution: controlled and uncontrolled table selection retain the same checkbox behavior.
- Interface segregation: domain services use the small shared scope-validation and batching utilities rather than a broad infrastructure service.
- Dependency inversion: domain services depend on shared policies and the DB adapter contract; connection and prepared-statement details stay below them.

## Verification evidence

Automated and runtime checks completed on the rebuilt local stack:

- frontend route-contract tests: 3/3 passed;
- backend architecture and service-contract tests: 19/19 passed;
- TypeScript production build: passed (6,680 modules);
- backend production dependency audit: 0 vulnerabilities;
- OpenAPI YAML parse and repository whitespace validation: passed;
- authenticated test-case paging and unassigned-module filter contracts: passed;
- API, frontend, PostgreSQL, Redis, test engine, mobile engine, and all test-engine workers: healthy.

The frontend dependency audit still reports two high-severity advisories inherited from the current latest `react-router-dom` release (`7.18.2`). The reported path concerns React Server Components mode, which this Vite SPA does not use. npm currently offers only a forced breaking downgrade, so this was documented instead of applying an unsafe dependency change.

Local Docker performance smoke data was isolated in a dedicated temporary project, benchmarked through authenticated API routes, then fully removed. Results on the local development stack:

| Endpoint | Records | Median | p95 |
| --- | ---: | ---: | ---: |
| Requirements | 250 | 9.42 ms | 17.06 ms |
| Test cases | 250 | 13.55 ms | 24.59 ms |
| Executions | 100 | 7.23 ms | 8.82 ms |
| Execution schedules | 100 | 5.58 ms | 10.57 ms |
| Test-case modules | 10 / 250 assignments | 3.54 ms | 4.06 ms |

These values are a regression smoke benchmark, not a production capacity claim. The structural improvement is the bounded query count shown above.

## Follow-up architecture stages

The next performance stage should move cursor slicing and totals fully into PostgreSQL for every remaining legacy list endpoint, add production query histograms and slow-query exemplars, and load-test with production-shaped data distributions before sizing pools per deployment tier.
