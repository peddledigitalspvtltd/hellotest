# Product maturity validation

Validated 10 September 2026 against the implementation described in [the research report](product-maturity-research.md). No test changes the user's live project records, integrations, roles or feature policy.

## Automated checks

| Check | Result and scope |
| --- | --- |
| Frontend unit/contract suite | **362 passed**, zero failed. `npm --prefix frontend test`. Includes regional preferences, capability availability/search, language-pack validation, permissions, feature-policy publication and inherited domain contracts. |
| Backend suite | **596 passed, 1 skipped**, zero failed or cancelled, using `node --test test/*.test.js` from `backend/api`. The skipped check requires its explicit integration environment. A prior run under concurrent build/test activity cancelled four resilience checks when its event loop ended; the full rerun passed without cancellations. |
| Main application and administration production builds | **Passed** TypeScript and both Vite builds via `npm run build:all`. Existing large-business-chunk warnings remain; this is not a claim of an application-wide bundle reduction. |
| Shared workspace browser | **Passed** actual shell/dialog components with isolated API fixtures. Verified search, no matches, disabled/restricted links, keyboard focus and Escape, mobile and dark layouts, per-user settings and reload persistence, initial failure/retry, preservation of an unsaved editor on failed background refresh, first-project access, RTL layout, and language-pack review before publication. |
| Agent execution browser | **Passed** actual workflow UI: readiness, unsupported configurations, idempotent start retry, progress, saved results, cancellation, deep links and narrow layout. |
| Existing agent workspace browser | **Passed** the 14-agent library and specialist/preview workflows. |
| Administration policy browser | **Passed** retry, dirty drafts, dependencies, failed-save preservation, independent concurrent updates, discard and mobile layout. |
| Existing layout, scrolling and dashboard browsers | **12 passed**: run scrolling over controls at 390/1024/1440px; master/detail opening and return transitions at four widths and two sidebar modes; dashboard creation, presets, layout and request behavior. The dashboard regression was additionally rerun with generation-provenance assertions. |
| Real PostgreSQL specialist/workflow checks | **Passed** in a newly created disposable database using the final built API image. Exercised all ten specialists, persisted reviews and source citations, scope checks, graph previews, actual review execution, idempotency and interrupted-run recovery. No external LLM was configured: results must truthfully identify deterministic evidence summaries. Database and private temporary environment files were removed. |
| Real PostgreSQL access checks | **Passed** atomic concurrent partial updates, omitted disabled flags, legacy storage, parent dependencies, invalid-update immutability and audit rollback in a disposable database. |
| Recorder target regression | **3 added checks passed** for exact target ownership, reordered exact matches and rejection of unrelated positional fallbacks. Included in final backend total. |

## Local deployment

The updated application is available at **http://localhost:8080** and the administration UI at **http://localhost:8081**.

- The running API's configuration was compared privately with Compose before recreation; no configured values differed.
- Database and frontend/admin files were backed up before deployment. Backup directory: `/tmp/qaira-product-maturity-backup-20260910` (database file restricted to the local user).
- API image: `local-run-api:product-maturity-20260910`. Rollback snapshot: `local-run-api:before-product-maturity-20260910`.
- Frontend assets were installed before atomically replacing each HTML entrypoint. Existing hashed assets were retained for open sessions. The updated runtime was saved as `local-run-frontend:product-maturity-20260910` and tagged for the local Compose service.
- Both served HTML entrypoints and their referenced JavaScript/CSS bytes match the production build outputs.
- Core deployed API service hashes match the verified source.
- API liveness and readiness returned **200** through the frontend proxy. The repository compiler reports available.

### Preserved live data

Complete ordered-row fingerprints and counts matched before and after the update:

| Table | Rows |
| --- | ---: |
| Integrations | 7 |
| Executions | 15 |
| Execution results | 22 |
| Test cases | 118 |
| Test steps | 21 |
| Users | 4 |
| Projects | 3 |
| Application settings | 1 |

This verifies these tables were unchanged by deployment. It does not claim a full backup/restore disaster-recovery exercise.

## Performance evidence and limits

The navigator's production component chunk is approximately **9.96 KB minified / 3.48 KB gzip**; the regional dialog is **4.09 KB / 1.41 KB gzip**, both loaded on demand. Opening the navigator performs local registry filtering without module-wide data queries. Feature snapshot reads were reduced from two to one, and grouped evaluation shares one policy read. Review-workflow history returns summaries and fetches full results only when opened. Runtime review work and formatter caches have explicit bounds.

No external LLM latency, model accuracy, sustained-load improvement, complete WCAG compliance or complete application translation is asserted. Specialized editors and administration catalog descriptions retain their existing language. Unsupported workflow tools remain preview-only. The research and capability inventory identify those boundaries and the next evaluation priorities.

## Retained evidence

Reviewed screenshots are in [research/product-maturity](research/product-maturity/). They show actual components/styles with explicit representative fixtures. Logs for this run are under `/tmp/qaira-product-*`; workflow and policy logs are referenced in their supporting research reports. The temporary browser fixture files were removed after validation. Exact verified production outputs are retained at `/tmp/qaira-product-maturity-verified-build/main` and `/tmp/qaira-product-maturity-verified-build/admin`; generated changes to tracked build artifacts were restored so the source review remains focused. The deployed containers and tagged images retain the new build.
