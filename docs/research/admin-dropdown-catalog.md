# Admin dropdown catalog

Implemented on 10 September 2026.

## Using the feature

Open **Admin → Dropdown values**, search for a field or filter by product area, then choose **Add value**. Set its display label, review the stored value, and save the field. Administrators can also reorder choices, change labels/descriptions, deactivate old choices, and choose the default test case type.

The catalog applies to the entire instance. Workspace metadata refreshes every 30 seconds while the page is active and when the window regains focus. Existing form drafts are preserved during refresh.

## Coverage and boundaries

The registry describes 58 fields or selector sources. Ten lists accept administrator additions:

| Area | Editable lists | Behavior |
| --- | --- | --- |
| Bugs | Primary Root Cause, QA Root Cause, Bug type | New selections must be active registered values. |
| Test design | Test case type | Active registered values, with a required default for new cases. |
| Labels | Bug, test case, suite and Story labels | Curated suggestions; free text remains supported. |
| Planning | Scrum teams | Curated suggestions; free text remains supported. |
| Planning | Story point estimates | Suggested whole-number estimates from 1 to 999. |

The remaining catalog entries explain their actual source. Execution states/results, severity, priority, engine modes, integration types, permission-related choices, and other behavioral enums retain their supported contracts. Adding a label cannot introduce a new workflow transition, execution engine, integration adapter, or permission. Record-backed selectors link to the existing project, member, design, planning, context, knowledge, agent, and dashboard management pages. Their choices still follow scope and access checks. Connected tracker workflows retain provider-supplied options.

This is a central vocabulary and source-management feature, not a generic custom-field or workflow designer. New configurable classifications can be registered with a validation contract and connected to their consumers through the shared metadata helpers.

## Data integrity and permissions

- Only the existing administrator authorization guard permits catalog reads and updates through the admin API. Workspace users receive the public option metadata through the existing authenticated domain metadata endpoint.
- Saved option codes are immutable. Removing a saved code is rejected; deactivate it instead. Existing records retain their historical or imported value, including when another field is edited. New assignments of inactive or unknown classification values are rejected by the API.
- The configured default applies to omitted test case types. Explicit empty values remain invalid. The default must be active.
- Admin labels are separate from stable stored values. Renaming a display label does not rewrite records, reports, or saved snapshots.
- All changes are stored in the existing `app_settings` table under `dropdown_catalog`. A global revision and PostgreSQL transaction advisory lock prevent concurrent editors from overwriting one another, including the first publication.
- A successful update records the actor, timestamp, affected field, revision, and before/after values in the admin audit log in the same transaction. Identical saves are no-ops.
- Each field supports up to 200 options, including inactive history; codes and labels are limited to 120 characters and descriptions to 500. Duplicate codes or labels are rejected without regard to letter case.

## Editor behavior

The editor matches the admin sidebar/workspace design. It includes field search, product-area filters, source links, stable code previews, keyboard-accessible ordering, live save announcements, draft indicators, and initial-load/error/retry states. Drafts survive switching fields and failed saves. A revision conflict preserves the draft and requires an explicit reload before another save. Navigation and closing the tab warn about unsaved changes. On narrow screens the save controls remain in normal document flow to avoid covering the editor.

## Contracts and implementation

- `GET /admin-portal/dropdowns` returns the catalog and revision.
- `PUT /admin-portal/dropdowns/:key` accepts `expected_revision`, an ordered `options` array, and `default_value` for fields that support it.
- `409 DROPDOWN_REVISION_CONFLICT` means another editor published first. System-managed mutations return `400 DROPDOWN_SYSTEM_MANAGED`; unknown keys return `404 DROPDOWN_FIELD_NOT_FOUND`.
- Definitions live in `services/platform/backend/src/domain/dropdownCatalog.js`; persistence/validation lives in `services/platform/backend/services/dropdownCatalog.service.js`.
- Frontend option resolution lives in `services/platform/frontend/src/platform/lib/domainOptions.ts` and `services/platform/frontend/src/platform/hooks/useDomainOptions.ts`; the admin editor lives in `services/platform/frontend/admin/DropdownValues.tsx`.
- Only the test case type database constraint expands to accept stable classification codes. Existing status, result, automation and other engine contracts remain unchanged.

## Validation

The full API suite passed with 724 passing tests and one existing skipped test; all 417 frontend tests passed. Eight additional disposable PostgreSQL integration tests exercised configured defaults, custom classifications through real Fastify routes, unchanged historical values, idempotent retries, bootstrap compatibility, concurrent publication, no-op updates, and auditing. Browser fixtures exercised the real admin and workspace forms, including failed save retries, conflicts, defaults, deactivation, draft preservation, renamed suggestions with stable stored values, free-text inputs, and narrow layouts. TypeScript and both production bundles passed.

Local deployment completed on 10 September 2026 with source/assets and a database backup. Both production entries and their JavaScript/CSS matched the build, including the `/admin/` proxy route. Runtime configuration and old hashed assets for open tabs were preserved. All 19 captured workspace-table fingerprints matched after the API restart. Live unauthenticated catalog reads and writes returned 401; both containers returned healthy. The read-only live catalog smoke reported 58 fields, 10 editable lists, revision 0, and the existing functional default. No sample catalog values were published into the live instance during verification. Updated local API/frontend images are persisted with the `dropdowns-20260910` tag.
