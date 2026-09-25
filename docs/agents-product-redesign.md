# Agents product redesign

The Agents workspace now supports two concrete jobs: building reviewable assets from repository source, and reviewing quality decisions against workspace evidence. All fourteen agents share one searchable library with task categories, pinned agents, explicit inputs and deliverables, and starter tasks. Recent work combines source analyses and specialist reviews within the selected project and application.

## Audit and product changes

The previous library split agents into separate catalogs. Specialist pages repeated headings, showed an empty seven-stage process rail, and kept three competing columns visible before a result existed. Repository reviews retained large source controls beside their output. Workflow records marked sample values as completed execution, and the specialist acceptance control acknowledged a click without applying an artifact change.

The redesign provides focused task setup and brings the result forward when a review completes. Supporting evidence, recorded activity, history and workflow planning open when needed. Results separate decision summaries, cited findings, assumptions, gaps and next actions. Editing, copying and downloading a specialist brief are explicit actions. Publication is available for supported repository assets.

Audit screenshots use actual page components, production CSS and representative API fixtures, not signed-in customer records. Before screenshots: `/tmp/qaira-agents-product-before`. Final desktop, mobile and dark screenshots: `/tmp/qaira-agents-product-after` and `/tmp/qaira-repository-agents-design`. Disposable PostgreSQL integrations separately verify persistence and publication.

## Agent coverage

| Agent | Evidence | Reviewed output |
| --- | --- | --- |
| Object Repository Generator | Supported UI source | Screens and locators; selected objects publish to Object Repository |
| API Test Case Generator | OpenAPI or supported API source | Contract and negative-test drafts; selected cases publish to Test Cases |
| Repository Knowledge Builder | Repository code and documentation | Source-linked documents; published knowledge is indexed for retrieval |
| Component Test Generator | Supported component source | Test drafts and downloadable scaffolds; selected cases publish to Test Cases |
| Quality Orchestrator | Stories, tests, runs and defects | Prioritized quality review and proposed handoffs |
| Story Architect | Stories and knowledge | Acceptance-criteria review and proposed examples |
| Test Design Agent | Stories, tests and execution evidence | Coverage review and proposed scenarios |
| Automation Engineer | Automation, tests and runs | Automation readiness and improvement brief |
| Smart Run Planner | Stories, tests and run history | Risk-based run recommendation |
| Failure Analyst | Failed runs, cases and defects | Investigation brief separating observations from hypotheses |
| Bug Reporter | Failures, cases and stories | Reproduction and defect outline |
| Bug Triage Agent | Defects and delivery evidence | Defect prioritization brief |
| Quality Evaluator | Stories, tests, runs and knowledge | Evidence-readiness review and unresolved gaps |
| Object Repository Curator | Objects and automation | Locator-maintenance proposals |

Specialists prepare briefs. They do not automatically create or update stories, bugs, runs, locators or test cases. Workflow definitions can be drafted from a specialist task. Workflow previews validate the graph and show sample data flow; they do not execute tools or models, launch scheduled triggers or prove automation passed. The separately invoked API tester makes an actual HTTP request and requires run permission in its explicit project.

## Reliability and accuracy

- Live and indexed evidence are gathered concurrently within bounded deadlines. Failed sources do not discard other usable evidence. Model transport failures receive bounded retries, and malformed output gets one repair attempt within the same model budget.
- Reviews have a 70-second service deadline, 12-second context budgets and a 45-second overall model budget. The browser permits 80 seconds and propagates cancellation. No model call is made without usable task evidence.
- Results expose readiness, limitations, generation mode and provenance. A deterministic fallback is labeled an evidence summary, even if a configured model name is available. Secondary diagnostics explicitly do not represent execution pass rates or release readiness.
- Citations must match supplied evidence, including references inside findings and deliverables. Project-overview metadata alone does not establish grounded task findings.
- Review deep links use an authorized saved-session endpoint rather than searching only the latest twenty records. Legacy results are normalized safely. Pending, failed and missing outcomes have explicit states.
- Requests are scoped to project, application and specialist. Cancellation and stale-response guards prevent prior tasks replacing current work. Workflow drafts reset when project/application changes; late responses cannot reopen another workspace's draft.
- Repository reviews distinguish all findings, items to publish and published items. Review reasons and assumptions appear before publication. Partial analyses offer a fresh analysis instead of an invalid retry. Publication produces inline feedback.
- Repository details return artifact metadata; content is fetched for authorized downloads. Agent-filtered history loads on demand. Active polling pauses for hidden pages. API drafts include required headers and applicable authentication-negative scenarios. Published knowledge retains source metadata.
- Workflow saves validate identifiers, edges and cycles. Preview traversal is topological; bounded data envelopes prevent excessive growth at merges. Membership, exact-project permissions and application ownership protect saved workflows, previews and API tests.

Repository analysis remains static analysis with documented framework limits. Generated scaffolds and inferred locators require review and runtime validation in the target application. Knowledge publication preserves existing documents; automatic replacement of older document versions is not introduced by this change.

## Verification

`services/agentic/test/browser/agentWorkspace.test.mjs` exercises the library, specialists, successful/failed/cancelled/restored reviews, editing, exports and previews in isolated browser contexts. Specialist requests and saved-review retrieval use the real request helper with fixture HTTP responses. `services/platform/frontend/test/browser/repositoryAgents.test.mjs` covers source review and publication interactions.

Backend behavior is covered by `services/platform/backend/test/agentWorkspaceReliability.test.js`. Guarded disposable-database suites in `services/platform/backend/test/integration/agentWorkspace.postgres.test.js` and `repositoryAgents.postgres.test.js` exercise all ten specialists and four source builders, persisted results, permissions, publication, indexing and retrieval. Retry and citation checks use controlled provider responses; no external provider quality benchmark is claimed.

Final validation on 2026-09-10: 556 backend checks passed (one existing skip), 348 frontend checks passed, both browser suites passed, and both disposable PostgreSQL suites passed. The production frontend build succeeded. The local API and frontend were updated; liveness/readiness returned 200, the repository compiler reported available, and served entry/agent assets matched the verified build. Existing integration, execution, execution-result, test-case and test-step counts and content fingerprints were unchanged. Rollback references and verification records are retained in `/tmp/qaira-agents-product-backup-20260910`.

Specialist review history uses `GET /agentic-assistant/sessions` with exact-project `agentic_workflow.view` permission. It does not require separate TestOps transaction access. The saved-review endpoint applies the same project permission and supports reviews outside the latest history window.
