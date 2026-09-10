# Shared workspace design

Date: 10 September 2026

The administration portal is the visual reference for the main application: a dark navigation rail, a quiet top bar, a warm canvas, clear page titles and restrained white surfaces. This change applies that structure through the shared application shell and reusable components. It keeps the existing route hierarchy and task-specific editors.

## Evidence and findings

Screenshots were captured before editing, using the actual `AdminApp`, `AppShell`, Analytics, Test Cases and Executions components with isolated fixture data. They demonstrate rendering and interaction, not the state of live customer records. The in-app browser was unavailable, so verification used a disposable Chromium session without accessing the user's browser profile.

| Finding | Effect | Implemented response |
| --- | --- | --- |
| Main app used a pale, decorated sidebar while Admin used a compact dark rail. | Navigation and content felt like different products. | One scoped shell with navy navigation, consistent typography, clear active states and a restrained utility bar. |
| Expanded project/application trees covered headings and metrics. | Selecting context required navigating an unnecessary hierarchy. | Separate Project and Application dropdowns with selection marks, full wrapping names, search for larger catalogs and viewport-bounded scrolling. |
| Catalog headings touched the page edge while inner controls used different insets. | Page hierarchy and alignment were inconsistent across routes. | Shared gutters, title rhythm, neutral toolbars, tabs, cards, metrics and focused editor surfaces. |
| Legacy CSS independently controlled sidebar widths, layout, dark backgrounds and mobile header heights. | The new palette alone could not produce a consistent layout. | Explicit shell geometry, scoped theme precedence and computed browser assertions for rail width, header height and scroll containment. |
| Sub-navigation compared the entire query string. | Filters and selected records could deselect the current section. | Destination matching compares route-defining parameters and retains default destinations. |
| Scope loading could silently choose or clear an application. | A background read could change the user's working context. | Only explicit selection commits scope; loading, errors and late responses preserve the current choice. |

Before: [Admin reference](workspace-design/admin-reference.png), [main workspace](workspace-design/main-before.png), [project picker](workspace-design/picker-before.png), [test cases](workspace-design/cases-before.png), [runs](workspace-design/runs-before.png).

## Product decisions

The sidebar remains the persistent place for project/application context. Desktop users can collapse it, and saved preferences are respected; new browsers start with readable navigation labels. Profile, theme, regional preferences, refresh and capability search share the top bar. The sidebar footer holds sign out, leaving more space for navigation.

Application choices belong to the selected project. The selector fetches one project's catalog, caches it for a minute, deduplicates rows and preserves each project's remembered application. The application cache includes account and permission identity. Changing identity or scope invalidates pending selections, so late requests cannot overwrite a newer choice. Query prefixes still support existing invalidation behavior.

Loading, retry, empty and unavailable-selection states are explicit. Long names wrap in dropdown options and have full trigger titles. Arrow keys, Home/End, Enter, Escape and Tab work with listboxes. In mobile navigation, Escape closes the listbox first; the next Escape closes navigation and returns focus to its opener. The dialog focus helper only delegates keys to a listbox whose actual trigger belongs to that dialog.

Shared presentation is scoped to `.workspace-experience-v2`. The administration portal retains its own styles. Full-screen case authoring and case-run views keep their viewport layout and scroll containers. Table virtualization retains its fixed row geometry. Semantic pass/fail/warning colors are preserved.

New controls use the localization catalog, including English and Spanish strings. Existing permission and feature-flag checks still govern visible destinations and route access. The selector cannot introduce projects outside the accessible project response.

## Review and validation

After: [main workspace](workspace-design/main-after.png), [project dropdown](workspace-design/project-after.png), [application dropdown](workspace-design/application-after.png), [test cases](workspace-design/cases-after.png), [runs](workspace-design/runs-after.png), [mobile page](workspace-design/mobile.png), [mobile navigation](workspace-design/mobile-navigation.png), [dark theme](workspace-design/dark.png), [focused editor](workspace-design/editor-after.png), [case run](workspace-design/case-run-after.png), [Stories](workspace-design/stories-after.png), [Agents](workspace-design/agents-after.png), [Settings](workspace-design/settings-after.png).

- **408 frontend tests pass**, including 28 focused scope, HTTP cache and authentication race tests.
- TypeScript application check and the production Vite build pass. Vite continues to report its existing large-chunk warning; this work does not claim a bundle-size reduction.
- Four isolated browser regression suites cover the real shell, shared surfaces, standalone project/application choices and nested dropdowns in the real mobile shell.
- Real route checks cover Analytics, Test Cases, Runs, Stories, Agents and Settings. Geometry checks verify 256/80px desktop sidebar widths, a 272px mobile drawer and 70/62px desktop/mobile header heights. Shared control tests cover widths from 320 to 1440px.
- Browser checks exercise independent sidebar scrolling, ordinary document scrolling, pinned chrome, long case-run scrolling, modal background locks, focus return, query-aware active navigation, Spanish breadcrumbs, dark rendering and fixed-height virtual rows.

Screenshots use representative fixture records. No end-to-end write was made against live application records. See the [surface review](workspace-surface-design.md) and [scope/cache review](workspace-switcher-review.md) for implementation details and focused checks.


## Local deployment

The verified main frontend is served at `http://localhost:8080`. Its HTML and referenced JavaScript/CSS match the production build. The admin portal file tree and main runtime configuration are unchanged; API readiness returns 200. Before/after fingerprints match for integrations, executions, execution results, test cases, test steps, users, projects and application settings.

Only the frontend was deployed. The persistent local image is `local-run-frontend:workspace-design-20260910`; `local-run-frontend` points to the same image. Rollback files, the previous image references and a database backup are retained at `/tmp/qaira-workspace-backup-20260910`. No Git commit was created.
