# Permissions and feature availability

A capability is available only when the user has the permission in the current project (or workspace for a workspace permission) and every feature required by that permission is enabled. Enabling a feature does not grant permissions. Disabling a feature does not remove configured role grants or saved relationships.

## Required and optional dependencies

The feature snapshot exposes three separate maps:

- `permission_features`: required flags for each known permission. An empty array means that permission has no feature prerequisite; it still requires an authorized role.
- `dependencies`: required feature prerequisites. Gherkin execution depends on Runs. The Automation workspace switch is an explicit master switch for its assets, repository, builder, and execution capabilities. Step code and preview keep their independent controls.
- `optional_dependencies`: related capabilities that enrich a host feature. These entries are informational and never disable the host.

Unknown permissions, unknown flags, malformed prerequisites, and dependency cycles fail closed. Administrators change only the switches they explicitly edit. No dependency is automatically enabled.

The administrative feature detail distinguishes required capabilities from optional enhancements. Role editing shows configured grants even while their feature is disabled, with an availability annotation. Saving the role preserves those grants unless the administrator explicitly removes them.

## Optional capability behavior

| Host | Unavailable related capability | Behavior |
| --- | --- | --- |
| Project switcher | Projects management | Membership-authorized project names and IDs remain available from `/metadata/workspace-scopes`; project management routes stay protected. |
| Stories | Test Cases, Bugs, Runs, Suites, integrations | Story reads and edits continue. Optional lookups and link writes are skipped. Run enrichment is requested only with Run and result access. |
| Test Cases and Suites | Stories, test data, integrations | Core authoring continues; unavailable pickers are disabled or omitted. Editing preserves stored links. |
| Shared Step Groups | Projects management, Stories, Test Cases, Run results, users, AI authoring | Core authoring and the selected application remain available. Optional history cannot block the catalog; unavailable lookups and related controls are omitted. |
| Bugs | Stories, Test Cases, Suites, Runs, environments | Core reporting and editing continue. Unavailable optional inputs are omitted from writes, preserving saved associations. |
| Saved Runs | Case/Suite authoring | Stored execution steps, results, and parameter snapshots remain available with Run permissions. Adding current authoring resources requires their own permissions. |
| Story AI | Linked case, Bug, attachment or comment evidence | Unavailable evidence sources are omitted before lookup and identified as unavailable in the evidence boundary. |
| AI composers | Knowledge | Manual input remains usable. Lost Knowledge access cancels retrieval and releases the composer from its busy state. |
| Agentic workflows | Integrations, Knowledge, specialist destinations | Workflow editing remains available. Optional provider lookups are cancelled on revocation, reviews use the default provider, and unavailable destination links are hidden. |
| Live AI context | Story coverage, Test Case traceability, Suites, Shared Steps, Run results, execution configuration | Available core records remain usable. Missing optional metrics are marked unavailable, and stored evidence is rechecked against current permissions and features before use. |
| Background job evidence | Automation batch processing | Job reads and artifact downloads depend on Background jobs. Batch management retains its additional switch. |

## Frontend implementation

`useCapabilityAccess` combines the current session grants with the feature snapshot. `useWorkspaceData` and its exported `useWorkspaceResource` hook apply this check to shared reads, cancel unavailable requests, disable retries, and return an empty, settled view for unavailable optional data. They retain the query cache for re-enabling while hiding it from unavailable controls. Custom optional queries use the same capability check and `optionalQueryView`.

The feature snapshot refreshes every minute and on focus when stale. Session grants refresh on visible focus and every minute while visible. Refresh does not set the form back to an initial loading state, and transient session refresh failures preserve the current session. API authorization remains authoritative on every request, including during the refresh interval.

The generated frontend fallback in `frontend/src/lib/featurePolicy.generated.json` supports rolling updates with older snapshots. Backend/frontend parity tests must pass whenever the permission or feature catalog changes.

## Verification

Backend tests cover permission/flag combinations, dependency cycles, role grant round trips, membership-only scope metadata, optional AI evidence, and saved versus live parameter-plan access. Browser tests exercise actual Bug and Story forms with optional features disabled, shared query cancellation and re-enabling, and the Test Case/Suite/Run flows. Existing catalog scrolling, Reporter permissions, and request-race tests remain part of regression coverage.
