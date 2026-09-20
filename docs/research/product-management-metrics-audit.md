# Product Management metrics review

The Product Management navigation contains Stories, Backlog, Sprints and Releases. This review covers every page's header and metric cards, Sprint header metrics, Story tiles and detail metrics, and Release header and Story tile metrics.

| Surface | Population and denominator | Result |
| --- | --- | --- |
| Stories inventory | All matching project Stories, before pagination; backlog and Sprint assignment partition that population | Verified with off-page and filtered fixtures |
| Stories QA completion | Completed Sprint Stories / Sprint Stories; unscheduled backlog excluded | Preserved the documented denominator; normalized status separators consistently |
| Stories release scope | Distinct matching Stories with a saved Release/version, direct Release membership, or current Sprint inherited by a same-project Release | Fixed omitted live Sprint membership; Release/version filters and their options now use the same membership |
| Backlog grooming/specification/priority/team | Matching unscheduled Stories; empty rich text is not description/specification evidence | Verified full-scope counts and empty-content handling |
| Sprint completion/coverage/density/slippage | Matching assigned Stories; distinct linked Bugs / Stories; target dates strictly before today | Verified shared links, legacy Sprint names, filtered scope, completed status aliases and due-today handling |
| Sprint pass rate | Distinct linked cases with finalized outcomes; latest finalized case outcome, requiring all planned dataset rows | Verified pending retries and incomplete datasets do not replace finalized evidence; mixed dataset outcomes fail once |
| Story tiles/detail | One Story; distinct same-project linked cases and Bugs; passed / finalized cases; automated / linked cases | Verified complete server facts override paged supporting catalogs; missing execution permission and no outcomes remain distinct |
| Release portfolio | All Releases in the selected project; shared Stories counted once for completion | Kept portfolio scope explicit; fixed active overdue Releases disappearing from In progress |
| Release schedule | Persisted lifecycle plus UTC target date | Fixed Releases due today being overdue from midnight onward |
| Release quality and Story tiles | Exact stored Release fix-version run token, same project, linked cases only | Verified duplicate links, foreign-project exclusion and dataset outcomes; zero linked cases now shows no automation percentage |
| CRUD refresh | All metric and evidence caches affected by Release scope/stamp changes, within the selected project | Fixed stale Story details/Sprint children/pickers and project-wide dashboard evidence; stopped invalidating other projects' Release readiness |

Completion recognizes QA Done, Done, Closed, Resolved, Accepted, Complete and Completed. Whitespace, underscore and hyphen separators normalize consistently in frontend completion summaries and backend Sprint/Release completion guards. Dev Done remains incomplete for QA completion.

Readiness retains its documented policy: 30% Story coverage, 50% finalized-case pass rate and 20% open-Bug health. Automation is informational. A score remains unavailable without finalized run evidence. General Story metrics use project execution evidence and are labeled Story readiness; Release Story metrics use that Release's run evidence and retain the Release readiness label, so their scores can legitimately differ.

Validation:

- 24 focused frontend helper, cache-invalidation and tile-contract checks passed.
- PostgreSQL Story/Sprint and Release integration fixtures passed in a newly created disposable database, then the database was removed. They cover live inherited membership, moving an off-page Story into/out of a Sprint, matching Release/version filter counts, shared/foreign links, aliases, same-day targets, completion guards and finalized dataset outcomes.
- Browser regression passed for all four Product Management pages, including loading states, whole-catalog counts despite 25-row rendering, unique Release portfolio completion and zero-case Release Story automation. Screenshots are in `/tmp/qaira-product-metrics`.
- Actual project data was not changed.
