# Story Readiness and Product Metrics

Story tiles and details use **Story Readiness** only while neither a Sprint nor a Release is assigned. Native Sprint IDs, legacy Sprint names, Release/version stamps, direct Release memberships, and Sprint-derived Release memberships select **Story Release Readiness**.

Each checklist contains five equally weighted checks. Each verified check contributes 20%; missing evidence earns no credit. All five checks must be met for 100%. An entirely unverified checklist has no score.

Backlog checks cover persona/value, acceptance criteria, an attached wireframe, resolved dependencies, and team-agreed estimates. Saved persona/value structure and complete Given/When/Then scenarios can supply record evidence. Placeholder or incomplete scenarios do not qualify; a reviewer can reject superficial structural matches.

Release checks cover acceptance testing, reviewed/merged code, passing automated unit/integration tests, no linked open high/blocker defects, and Product Owner sign-off. Case outcomes alone cannot prove complete acceptance coverage or CI/code approval. Those checks require recorded review evidence. Reviewed acceptance coverage also requires every linked case to have a finalized passing outcome. Missing execution permission leaves this check unverified. Open high-priority defects override positive reviews.

Review changes require `requirement.update` in the Story's project and its current revision. The server records the reviewer, timestamp, and content fingerprint. Content edits invalidate prior reviews. Wireframe reviews require an attachment belonging to the same Story; deletion invalidates that check. Ordinary Story saves cannot inject review approvals.

## Project Tiles

- **Overall Story Coverage** = distinct project Stories linked to at least one valid project Test Case / all project Stories. Direct and mapping-table links are deduplicated. Every application, Sprint, and Release participates.
- **Latest Run Pass Rate** = passed Test Cases / all Test Cases scoped to the newest created run. Each Test Case contributes once; retries replace the previous attempt for the same data iteration. Unfinished data rows cannot become a full pass. Pending, failed, blocked, N/A, skipped and other statuses remain visible in the bar and denominator. With no run or recorded result, the percentage is unavailable.
- Compact colored bars show counts on segments where space allows. A small legend sits at the right edge; exact counts and run details remain in tooltips without duplicate summary text.

## Backlog Metrics

**Priority Distribution** reports combined P1/P2 percentage across all matching backlog Stories, with separate Critical/High counts in its evidence. Critical below 20% is healthy; combined High/Critical at or above 60% is a danger signal. Thresholds use exact fractions before display rounding.

**Backlog Growth Rate** reports monthly additions : (completions + removals), plus net change. Created, reopened and returned active Stories are additions. Completion removes an item once; assigning a Sprint/Release or deleting an active backlog Story counts as removal. Removing an already-completed Story is not counted twice. This card always uses the complete project independently of search/filter results.

The PostgreSQL history follows direct edits, imports, synchronization, and Release membership changes, survives Story deletion, and is cleaned in batches during Project deletion. Periods use UTC. Tracking begins when this migration is installed; earlier history is unavailable and the first month is explicitly partial. No historical monthly growth percentage is invented from current rows.

Release portfolio cards use the existing Release quality policy and show separate evidence for Total Releases, Release Ready, At Risk, and Overdue. Their scope is the complete project, independently of filtering the Release list.

## Native Delivery Scope

Release Readiness uses native Release and Sprint IDs across selectors, URLs, API requests, execution records and exports. The `requirement_release_sprints` junction stores Release-to-Sprint membership. Direct Story membership and current Sprint membership are deduplicated; stale derived rows cannot retain a Story that left its Sprint. Legacy text is resolved only when it identifies one project-scoped record. Renaming a Release or Sprint preserves historical run membership.

Release bars report **Dev Story Completion** and **QA Story Completion** separately. Explicit Dev Done and later QA/completed stages count as development complete. QA Done and completed aliases count as QA complete. Generic Ready does not prove development completion. Both denominators use the complete distinct Release Story scope.

## Story Test Modules and AI Review

The `test_case_effective_module_cases` PostgreSQL view combines explicit module membership with current Story-to-module relationships inside the same project/application. Lists, filters, module metrics and run planning share that view. Execution snapshots choose one stable primary module per case to preserve historical results without duplicates. Story-linked tiles display the Story short ID and title.

AI context/body limit failures retry once with shorter context while preserving entity IDs, output constraints and the request deadline. Unrelated authentication, permission and server failures are not retried as context failures. Preview metadata distinguishes reduced context from a deterministic fallback. Story citations, source excerpts and review limitations appear in the Intelligence pane. Edited fields retain their review limitations.

## Terminology and Compatibility

User-facing labels, prompts, default feature copy and export headers use Defect/Defects. Existing database columns, API keys, permission codes, agent IDs, external Jira issue types and historical short IDs remain compatible. Story CSV import accepts both legacy linked-bug headers and linked-defect headers.
