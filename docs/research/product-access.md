# Product access and feature availability research

Reference research: dated observations and verification counts describe the recorded review, not current acceptance. Use the current [verification runbook](../development/verification.md) for reproducible checks.


Reviewed 10 September 2026. This work covers the shared permission boundary, workspace feature availability and the administration feature-policy flow. It does not claim a complete penetration test or a complete redesign of every product page.

## Product decision

A person should see capabilities that are both enabled for the workspace and permitted for their active project. Disabling a capability must also stop a direct API call. An administrator should be able to understand dependencies, publish only their own edits, recover from a failed request and retain an attributable policy record.

Authorization remains a server decision on each request. Navigation and action visibility explain the same boundary. Feature flags determine availability; they do not grant authority.

## Primary research and how it changed the implementation

- OWASP recommends minimum privileges, explicit denial, permission checks on every request, safe failures, audit records and authorization tests. This informed the project-scope checks, GET/HEAD parity, direct-API denial tests, removal of the legacy role-ID bypass, and transactionally recorded policy changes. These are implementation choices informed by the guidance, not a certification of the product. [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)
- OpenFeature specifies typed flag evaluation with explicit defaults and details that distinguish successful evaluation from missing flags and failures. We retain the existing local provider, but now require actual boolean values, reject unknown edits and return consistent effective/local snapshots. No OpenFeature SDK or remote provider was added. [OpenFeature Flag Evaluation specification](https://openfeature.dev/specification/sections/flag-evaluation/)

## Verified implementation findings

| Finding from the initial implementation | Product consequence | Implemented change |
| --- | --- | --- |
| `featureFlag.service.js` replaced all stored flags after normalizing an update against defaults. | Editing one feature could re-enable an unrelated feature an administrator had disabled. | Validated atomic PostgreSQL patches preserve omitted flags and concurrent edits to different keys. The administrator sends only dirty keys. |
| Unknown flag lookups used `value !== false`. | Misspelled feature keys were enabled. | Boolean evaluation requires a known key with the value `true`; invalid edits return `INVALID_FEATURE_FLAGS`. Invalid persisted individual booleans evaluate as off. |
| Snapshot evaluation read configuration twice; group filtering read once per group. | A concurrent update could produce inconsistent effective/local values, and permission setup generated unnecessary database work. | A snapshot and a group-filter operation each read a single policy snapshot. |
| Object Repository read endpoints required general `automation.view`, without their granular feature flag. | The hidden page's data remained callable through its API while its feature was off. | Dedicated repository route flags apply to GET and automatic HEAD requests. Automation child features respect the Automation workspace parent. Manual-editor preview and code features remain independently available. |
| The automatic HEAD route had no GET permission mapping. | A framework-generated route could miss the shared permission/feature pre-handler. | HEAD resolves the same catalog permission and route flags as GET. |
| Resolving an unknown application returned a null project. | Permission evaluation could fall back to any project where the user had a grant. | Invalid application scope returns 404 before evaluating an aggregate permission. Async scope resolvers are awaited. |
| The browser treated `role_id: jira-admin` as an unconditional administrator, and could fall back to aggregate grants when project grants were absent. | The UI could expose controls that the current server would reject. | Only the server's admin role bypasses ordinary role checks; suspended users, incomplete project grants and project-derived workspace capabilities fail closed. |
| Path helpers used exact string lookup and a workspace fallback. | A trailing slash or an unregistered page could receive a weaker browser boundary. | Query/hash/trailing slash normalization; unknown pages receive no permission grant. The retained local-Playwright redirect has an explicit automation boundary. |
| Feature loading required a current project. | Initial project creation and workspace settings could stall before project selection. | Workspace flags load without a project, cancel unused requests, bypass transport caches and refresh every minute while visible. |
| The feature-policy UI had no initial error recovery, no discard, sent full snapshots and displayed very small labels. | Administrators could lose context, overwrite unrelated changes, or misread dependencies. | Explicit loading/error/retry, retained drafts after failure, dirty-only publication, discard, visible parent dependency explanations, readable labels and keyboard focus. |
| One automation job endpoint lacked its shared permission catalog entry. | API-key route scoping could reject a valid automation reader despite the handler's own permission check. | Added the automation-job mapping and mappings for actual agent workflow execution, readiness and cancellation. |

Implementation entry points:

- [Backend feature evaluation and persistence](../../services/platform/backend/services/featureFlag.service.js)
- [Shared request authorization](../../services/platform/backend/src/plugins/accessControl.js)
- [API permission catalog](../../services/platform/backend/src/security/permissions.catalog.js)
- [Browser permission boundaries](../../services/platform/frontend/src/platform/lib/permissions.ts)
- [Browser feature policy helpers](../../services/platform/frontend/src/platform/lib/featureFlags.ts)
- [Feature loading](../../services/platform/frontend/src/platform/hooks/useFeatureFlags.ts)
- [Administration feature policy](../../services/platform/frontend/admin/AdminApp.tsx)

## Product and API behavior

`GET /feature-flags` returns `local_flags` (administrator intent), `flags` (effective availability), and `dependencies`. It carries `Cache-Control: private, no-store`. If Automation workspace is off while Object Repository is locally on, the administrator sees that it is unavailable until its parent is enabled. The child setting is preserved and becomes effective when the parent returns.

`PUT /feature-flags` and `PUT /admin-portal/feature-flags` accept `{ "flags": { "known.key": false } }` as a partial update. Unknown keys and non-boolean values reject the entire update. The update and its audit record commit together. Independent keys merge in PostgreSQL; intentional concurrent changes to the same key use the last committed value. Existing callers sending all keys are still accepted, but the administration UI sends only changed keys.

Authorized cancellation remains available for work already in flight when the Agents feature is disabled. This narrow exception still requires authentication, the run grant and API-key scope; it cannot start new work.

An unavailable feature produces HTTP 403 with `FEATURE_DISABLED`. An absent role grant produces `ACCESS_DENIED`. Data/backend errors are not converted into a successful feature snapshot. The shared UI retains safe gating while a snapshot is unavailable; the application shell separately supplies recovery UI.

The normal runtime permission service remains a grant evaluator. Background agents must combine grants with feature checks and persisted resource scope, because a browser route pre-handler cannot protect work that continues in another process. The automation implementation in this product pass applies those checks to workflow execution and specialist evidence retrieval.

## Verification

- `services/platform/test/backend/productAccess.test.js`: 18 checks, including real Fastify injection for viewer denial, direct disabled-feature calls, HEAD parity, unscoped snapshots, invalid application scope and asynchronous persisted-scope authorization; also checks catalog coverage for ordinary product routes.
- `services/platform/frontend/test/productAccess.test.mjs`: 5 behavioral checks for scope isolation, legacy/incomplete sessions, normalized deep links, malformed snapshots, dirty patches, dependencies and first-project loading/cancellation.
- `services/platform/backend/test/integration/productAccess.postgres.test.js`: passed against an empty disposable PostgreSQL database. Tested parallel writes to different flags, omitted disabled flags, parent/child behavior, legacy flat storage, invalid update immutability and transactional rollback. The database and private temporary environment file were removed afterward.
- `services/platform/test/browser/featureAvailability.test.mjs`: passed using the actual administration components/styles with isolated representative API fixtures. Tests read failure/retry, search/empty state, dependencies, failed-save draft recovery, independent concurrent edits, keyboard toggling, discard and 390px layout. It does not modify live flags, roles, users or integrations.
- Visual evidence is at `/tmp/qaira-product-access-before/` and `/tmp/qaira-product-access-after/` (`feature-availability-desktop.png`, `feature-availability-mobile.png`). These compare the typography/control refinement with the same fixture; the behavioral baseline was established by code inspection. The in-app browser was unavailable, so the existing isolated Chrome/Playwright setup was used. Both desktop and mobile after images were visually inspected.

## Boundaries and remaining work

This pass does not migrate role grants or change live policy values. Backend checks remain authoritative if a role or feature changes during an open session. The browser refreshes workspace flags each minute when visible; it does not claim instant push synchronization.

Administration policy descriptions retain the existing English server catalog; translated policy descriptions are not introduced by this access work.

Availability is still workspace-wide, not a per-project rollout service. Percentage rollouts, scheduled releases, remote-provider integrations and policy version comparison are not implemented. Introducing them should preserve explicit typed fallback values and the distinction between local intent and effective availability.

The route coverage test enforces catalog registration for ordinary static route declarations; authentication, internal engine protocols, admin portal and public static files use separate trust boundaries and are explicitly excluded. It does not replace resource-level authorization tests for every route, and does not prove every historic service checks persisted scope correctly. Continue adding such tests when those services change.
