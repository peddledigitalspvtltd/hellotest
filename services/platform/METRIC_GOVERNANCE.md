# Metric governance

Administration → **Metric governance** manages the 44 metric definitions in grouped families. Seven formulas expose numeric parameters. The workspace Settings editor and its legacy metric write path are retired.

The editor separates the deterministic definition and numeric formula values from organization review criteria and version history. Native formula structure, project authorization, evidence selection and denominators stay application-enforced. Administrators can change only registered weights, thresholds, limits and bounded review text. Values must satisfy the catalog's range/step constraints; portfolio weights must total exactly 100%. Existing legacy configuration remains effective until publication.

`shared/metricCatalog.json` is the common source for metric descriptions, criteria defaults and numeric parameter definitions. The frontend registry and portfolio calculator read the same catalog. Published metric values overlay the existing workspace-preference read contract, so native portfolio calculations and metric review surfaces receive the published values without changing their project access boundaries. AI prompt/context/model settings remain in AI Controls. The frontend prompt/criteria hook refreshes on focus and polls every 60 seconds.

Save draft does not change live calculations. Publish requires an expected revision and uses a PostgreSQL transaction-scoped advisory lock to prevent lost updates. Conflicts return HTTP 409; Reload latest makes reconciliation explicit. Publications and restores retain an administrator audit entry and configuration fingerprint. Thirty separate version snapshots are retained. Restore publishes a historical configuration as a new version. The admin editor protects unsaved changes during navigation and page unload.

Every `/admin-portal/metric-governance` endpoint requires a current authenticated workspace administrator. The old `/settings/workspace-preferences` endpoint returns `METRIC_GOVERNANCE_MOVED` for metric writes, including whitespace-normalized keys. Other workspace preferences keep their existing behavior.

Validation:

- `node --test --test-concurrency=1 services/platform/backend/test/metricGovernance.test.js services/platform/backend/test/portfolioAnalytics.test.js services/platform/backend/test/deliveryPermissionContract.test.js`
- `npm run test:mcp:postgres` exercises real PostgreSQL/native routes: admin authorization, legacy value preservation, unchanged live values after draft save, invalid formulas/weights, concurrent publication, calculator consumption, rollback, audit and retired preference protection. The database is disposable.
- `node --test --test-concurrency=1 services/platform/frontend/test/browser/metricGovernance.test.mjs` against the repository Vite server exercises all 44 entries, tab/keyboard navigation, validation, drafts/publication and desktop/mobile overflow. API responses are mocked in this browser test.
- `npm --prefix services/platform/frontend run build:all` and `node scripts/checks/check-service-boundaries.mjs`.

Story backlog and release readiness checklists are included as fixed deterministic metrics. Their organization review criteria appear beside the checklist methodology and use the same published preference contract. Review text cannot change the five-check denominator, content-hash validation, evidence checks, or release approval authority.
