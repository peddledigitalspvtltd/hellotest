# Quality Analytics and Release Readiness validation

Validated on 10 September 2026. The application is served at [Quality Analytics](http://localhost:8080/?view=analytics) and [Release Readiness](http://localhost:8080/?view=readiness).

## Automated checks

| Check | Result |
| --- | --- |
| Frontend unit and contract suite (`npm test` in `frontend`) | 378 passed, zero failures/cancellations |
| Backend unit and contract suite (`npm test` in `backend/api`) | 609 passed, zero failures/cancellations, one existing conditional test skipped |
| Analytics browser regression | Passed; one scenario covers metric names/denominators, chart/table, period scope, CSV, personalization, empty/restricted/error/disabled/no-project states, project switching, admin demotion, Explain findings/actions and hidden heuristic score, desktop/mobile/dark/Spanish |
| Readiness browser regressions | Four passed, including linked release membership, source pagination, pause/data-row evidence, keyboard tabs, error recovery, cross-project context rejection and admin demotion with a late Explain response |
| Readiness focused model/contracts | 31 passed |
| Backend focused analytics/readiness/API contracts | 51 passed |
| Disposable PostgreSQL integration | Passed: >100 inventory records, current project links, frozen missing rows, inherited datasets, retries, distinct data rows, lifecycle freshness, exact scope, future/window exclusions, restricted sources and legacy per-run counts |
| TypeScript application typecheck | Passed |
| Main and administration production builds | Passed |
| Whitespace validation | `git diff --check` passed |

The backend's skipped conditional test concerns PostgreSQL knowledge-revision promotion and was not enabled by the general unit-test command. The analytics/readiness PostgreSQL checks were run separately against disposable infrastructure. A pre-existing resilience-test cancellation was resolved with a bounded test-only connection lifetime; production retry behavior and assertions were preserved.

Browser screenshots use the production components with explicit test fixtures in isolated Chrome contexts. The in-app browser was unavailable. No normal browser profile or live account session was used. Dark-theme screenshots wait until the theme's transition reaches its final color. These tests do not represent a live-provider LLM evaluation or full accessibility certification.

## Local deployment checks

- Built API image `local-run-api:quality-analytics-20260910`; updated the local API service and retained existing environment values.
- Published verified main/admin assets before atomically replacing their HTML entry files. Existing assets and runtime API configuration were preserved.
- Verified that both served HTML files and their referenced JavaScript/CSS bytes match the production build.
- Verified the four deployed analytics/readiness backend implementation files against the working source.
- Direct API readiness and proxied readiness returned HTTP 200. An unauthenticated request to the new analytics endpoint returned HTTP 401.
- Ran the new summary service read-only across all three existing projects; every project returned a complete permitted-source aggregate and 30 trend days without a SQL error.
- Compared ordered row fingerprints before and after deployment for integrations, executions, execution results, test cases, test steps, users, projects and app settings. All eight matched exactly.
- Captured persistent local frontend image `local-run-frontend:quality-analytics-20260910`; kept rollback image tags and a private database/frontend backup at `/tmp/qaira-quality-backup-20260910`.

Temporary audit entry points and the owned Vite verification server were removed/stopped after verification. Prior workspace edits were preserved. No Git commit was created.

## Practical limits

The aggregate endpoint removes the previous capped browser synthesis. The wider application still has large shared bundles; Vite reports the existing chunk-size advisory. No production-scale latency benchmark was performed, so this report does not claim a measured percentage speedup. Release Readiness visibly bounds loaded evidence and does not issue a release approval. The [research report](quality-analytics-readiness.md) defines the metric scope and design rationale.
