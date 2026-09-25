# Main workspace surfaces aligned with the admin portal

Reviewed and implemented on 10 September 2026.

## Evidence and design decision

The reference was the application's actual AdminApp, captured in an isolated browser session at 1440 × 1000 before implementation. The comparison used real AppShell routes for Analytics, Cases and Runs, including an expanded sidebar. These screenshots are in `/tmp/qaira-workspace-design/before-admin.png`, `before-expanded-main.png`, `before-expanded-cases.png` and `before-expanded-runs.png`.

The admin portal provides a clear visual system: a dark navy sidebar, a 70px context header, warm neutral content canvas, generous page insets, white cards with restrained borders and shadows, and readable navy type. The main app's Cases and Runs instead placed titles and metric strips against the main edge while their toolbars introduced separate insets. Gradient controls, blue surfaces and rounded pills differed between routes.

The new shared surface layer carries the admin system into the main workspace without replacing each feature's working layout. Page titles, section tabs, catalog toolbars, cards, tables and settings controls now share a palette and spacing rhythm. Existing status colors continue to distinguish failures, warnings and successes. The agent library, quality analytics and release review use their established local component tokens with the same base palette.

## Implementation

`services/platform/frontend/src/platform/components/workspace-surfaces.css` is imported after the main shell stylesheet. Every rule is scoped under `.workspace-experience-v2`; the separate admin application is unaffected. Ordinary pages use a 38px horizontal inset on wide screens, 24px at intermediate widths and 16px on narrow screens. Dedicated agent and analytics roots receive equivalent insets even though they do not use the shared `page-content` class.

The surface layer does not set editor height, outer shell grid, scrolling or virtual row sizes. Focused test authoring and case execution retain their existing full viewport behavior. Their own canvas/input tokens now use warm neutrals, existing selected tabs use green, and rich-text toolbars are neutral. The Gherkin source textarea and syntax overlay rules are untouched.

One real accessibility defect found during verification was fixed in `CatalogSearchFilter.tsx`: the filter dialog referenced the search input for its accessible name. It now references the visible dialog heading through its own stable ID. Existing focus movement and Escape behavior remain intact.

## Validation

The shared-component browser test uses the real PageHeader, SubnavTabs, CatalogSearchFilter, CatalogViewToggle, DataTable, StatusBadge and WorkspaceMasterDetail with an isolated session and local API fixtures. It verifies:

- Keyboard selection of tabs, searching, list selection, and opening/closing the filter dialog by its accessible name.
- Long title fit without page overflow at 1440, 1024, 768, 390 and 320px widths.
- The settled dark card background and primary action text before screenshot capture, avoiding intermediate colors from the application's existing theme transition.
- Fixed virtual row heights and successful scrolling after entering a focused detail view, including at 390px.
- No browser page errors.

Final shared browser test: **1 passed**. Related existing catalog, management and shared-step authoring contracts: **25 passed**. `git diff --check` passes.

```sh
PLAYWRIGHT_MODULE="$PWD/testengine/backend/node_modules/playwright" \
CHROME_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' \
VITE_TEST_URL=http://127.0.0.1:5179 \
node --test services/platform/frontend/test/browser/workspaceSurfaces.test.mjs

node --test services/testing/test/frontend/runScopeSelection.test.mjs \
  services/platform/frontend/test/sharedStepGroupSuiteRunAuthoringContract.test.mjs \
  services/platform/frontend/test/managementCrudContract.test.mjs
```

Shared-component screenshots are in `/tmp/qaira-workspace-surfaces/`, including `dark.png`, `catalog-table.png` and `long-title-320.png`. These fixtures test reusable surfaces; they are not substitutes for full route captures. The separate real-shell browser suite `services/platform/frontend/test/browser/workspaceShell.test.mjs` captures actual Analytics, Cases, Runs, Stories, Agents and Settings pages, plus focused case editing/execution, mobile and dark views in `/tmp/qaira-workspace-design/after-*.png`.

Actual route review found and corrected two additional cascade problems during integration: Analytics is a dedicated root and previously received no top inset on mobile, and the legacy mobile header rules overrode the intended header height. The surface layer fixes the analytics inset; the shell implementation owns the header correction. Computed mobile geometry after both fixes is a 62px context header followed by 20px content padding.

All verification used isolated fixtures. No live product records, integrations or external systems were changed by these tests. The work improves shared visual consistency; individual feature-specific toolbar groupings and workflow semantics remain owned by those features.

## Focused editor review

The actual TestCasesPage was also captured and visually reviewed after the focused palette changes. Both captures use the same isolated case fixture as the real-shell suite. The wide editor retains its two-column layout and footer; dark fields, editor toolbar text and selected navigation remain readable.

- [Focused case editor, light](screenshots/workspace-surfaces/case-editor-light.png)
- [Focused case editor, dark](screenshots/workspace-surfaces/case-editor-dark.png)
