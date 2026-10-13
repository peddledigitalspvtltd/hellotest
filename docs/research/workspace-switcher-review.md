# Workspace scope selector: implementation audit

Reference research: dated observations and verification counts describe the recorded review, not current acceptance. Use the current [verification runbook](../development/verification.md) for reproducible checks.


The supplied design target was the existing administration portal, captured at
`/tmp/qaira-workspace-design/before-admin.png`. The replacement follows its navy
navigation, quiet labels, compact spacing and restrained corners. The project
and application are now separate controls rather than an expandable project tree.

## Findings and changes

The previous inline selector in `services/platform/frontend/src/platform/components/AppShell.tsx` fetched
applications for each expanded project. Its effects selected the first returned
application and could clear a remembered value after a failed fetch. The new
`WorkspaceProjectSwitcher.tsx` requests only the selected project's catalog,
retains per-project application memory and commits changes exclusively after an
explicit selection passes the supplied pure navigation/access guard.

The component rejects foreign-project rows even if another caller supplied a
mixed cached catalog. Its query key includes the authenticated access context;
delayed responses from another project, user or permission context cannot replace
the displayed catalog. A synchronous scope-event revision also prevents an
awaited selection guard overwriting a newer selection before React renders it.

The menus support loading, failure with retry, empty catalogs and unmatched
searches. Search appears only above seven options. Keyboard arrows, Home/End,
selection, Escape, Tab and outside dismissal are covered. Long names wrap in
options and truncate in the compact trigger. Fixed portal placement follows the
visual viewport, including collapsed navigation and narrow screens.

Mobile navigation required a small `useDialogFocus.ts` correction: a focused
portalled dropdown may handle Escape/Tab first only when its expanded trigger
actually belongs to the active dialog. Escape closes the dropdown before the
drawer; Tab returns to the drawer sequence. Foreign popovers retain the dialog's
normal keyboard behavior.

An associated authorization review found two additional cache/session races.
`api.ts` previously reused GET responses and in-flight requests by method/path
alone. They are now partitioned by a revision of token, user identity, role,
status and effective grants. Profile-only changes preserve normal reuse. Late
results cannot repopulate the replacement context's cache; a late 401 cannot
clear its session. The same expiry check covers knowledge streaming requests.
`AuthContext.tsx` now guards refreshes against a newer refresh, login or logout,
while still propagating current-session expiry when the API has already cleared
storage.

## Validation

The following focused unit checks passed: 10 catalog/viewport tests in
`workspaceSwitcher.test.mjs`, 12 public API HTTP-response tests in
`requestSessionIsolation.test.mjs`, and 6 authentication refresh tests in
`authRefreshIsolation.test.mjs` (28 total).

`test/browser/workspaceProjectSwitcher.test.mjs` runs the real selector against
isolated APIs and storage. It covers delayed/mixed catalogs, permission changes,
atomic remembered values, failed and empty loads, guard rejection/races, search,
keyboard interaction, and long labels at 1440, 390 and 320 pixels.
`test/browser/workspaceSwitcherShell.test.mjs` mounts the actual AppShell to cover
expanded/collapsed positioning and mobile nested-focus behavior. Captures were
reviewed under `/tmp/qaira-workspace-design/switcher/`.

Both browser fixtures avoid backend requests and remove their temporary files.
The root task owns the comprehensive frontend tests, final typecheck/build and
broader shell/surface review. The component retains the existing backend
authorization contract and does not modify project permissions or application
records.
