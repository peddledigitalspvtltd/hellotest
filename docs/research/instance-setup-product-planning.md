# Instance setup and Product Management corrections

Implemented on 2026-09-20.

## Setup and reusable content

Workspace roles now belong to Module sample data under People & access. That preset installs roles independently; Full product includes roles and content. Customized grants and existing memberships remain unchanged. New project creation uses the canonical detailed description and application definitions before adding missing Admin memberships for all active workspace administrators. Repeat setup includes newly eligible administrators and retains existing project, application and membership edits. Suspended accounts and project-only administrators are not enrolled.

The source-reviewed, AI-authored [feature blueprint](../product/hellotest-feature-blueprint.json) and [story catalog](../product/hellotest-feature-stories.md) cover all routed workspace capabilities and account for every feature flag, including two explicitly identified reserved flags. They contain 59 acceptance stories, seven sprints, three illustrative releases and ten unscheduled backlog stories. The installer creates parent planning records before stories and scope links. Knowledge installation adds cited lexical passages; Schedules & activity adds downloadable JSON/Markdown artifacts. Existing version 2 commerce examples and user edits are retained.

## Story planning fixes

- Story editing previously displayed only imported/global version choices even though local releases were available. Create and edit now resolve local release choices consistently, retaining current historical values.
- Native sprints carrying legacy imported metadata could be saved as text rather than `iteration_id`. Persisted local sprints now retain their canonical identity.
- Creation links could consume sprint/release context before capability loading finished. The dialog now waits for available context.
- Selecting a release now uses an optional `release_id` contract and updates direct membership inside the story transaction. It preserves independent manual scope and sprint-inherited scope. Closed targets, cross-project assignments and unauthorized changes are rejected.
- CSV imports resolve supported sprint/release names and identities through the same planning rules.

## Metrics

All four Product Management pages and Story tiles were audited. Fixes cover live sprint-inherited release membership, matching release filters, completion aliases, overdue date boundaries, active overdue release counts, missing automation denominators and related cache invalidation. See the [metric methodology and audit](product-management-metrics-audit.md).

## Verification

- Full backend suite: 980 passed, two opt-in tests skipped by the default command.
- Full frontend suite: 525 passed.
- TypeScript and the targeted admin, story dialog and four-page metrics browser regressions passed. Browser tests use intercepted API fixtures.
- Disposable PostgreSQL installation verified all 450 catalog records, metadata links, native cited retrieval and artifact downloads. Repeat installation inserted no duplicates and retained edited stories, dates, roles and memberships.
- Six PostgreSQL story-assignment cases verified atomic create/move/clear behavior, inherited scope, rollback and import handling. Separate Story/Sprint and Release metric PostgreSQL fixtures passed.
- Disposable databases and temporary browser fixtures were removed.

Local API and frontend images were rebuilt for the existing `local-run` stack. A read-only catalog check against the running API's database returned version 3, 13 modules, People & access roles and the 59/10/7/3 planning inventory. Content is added through **Instance setup → Install selected samples**; updating the application itself does not overwrite existing project records.

Both containers are healthy. The main page, the requested `http://localhost:8080/admin/?section=setup` page and the separate admin port return 200 with the new bundles; API readiness succeeds through the frontend proxy. Deployed backend source hashes match the tested files.
