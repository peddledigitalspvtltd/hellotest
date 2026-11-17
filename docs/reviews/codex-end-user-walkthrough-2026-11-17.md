# Codex end-user walkthrough and product improvement plan

Implementation follow-up: see the [current gap implementation ledger](walkthrough-gap-implementation-2026-11-17.md) for source, validation and deployment receipts. The walkthrough results and proposed decisions below retain the original observations; their approval boundaries are historical.

Date: 17 November 2026, Asia/Kolkata. Target: `http://localhost:8080`, signed in as the authorized Admin User.

Status: manual and API workflows, reports and final health checks completed. The user-approved two-line API editor correction is implemented, regression-tested and deployed. The real API run passed all four case instances and all ten authored assertions. Signup AI grooming remains blocked by connection/timeouts; the other improvements below remain a review plan.

## Retained requested work

| Item | Record |
|---|---|
| Project / application | `codex` / `codexuser`; private project, Admin User membership and admin role verified |
| Project ID | `4c5fd6c4-0a3a-4164-8272-65228f24a6d5` |
| Sprint | `2026.11.17`, 17–30 November; `ff5a274b-8daf-46b4-ba45-08554fba6c02` |
| Release | `26.11`, linked to the Sprint and its present/future Stories; `cf1ec2e6-ffef-48c9-8b49-ed2e784645ab` |
| Login Story | `Req_842`, manually authored, then improved with reviewed AI Complete Story changes; `76f1ffa5-0bd4-43d1-8e39-9cb99cba12ca` |
| Signup Story | `Req_843`, AI-generated and reviewed; `541b7f85-6cd0-4e79-85ec-4a0dc6caf542` |
| Login module | `login`: TC_810 valid login, TC_811 incorrect-password rejection |
| Signup module | `signup`: TC_812 malformed email, TC_813 duplicate-account rejection; both AI-generated cases approved through the review workflow |
| Manual suite | `sanity`, all four cases from both modules; `7d4dbde5-a9d5-44d9-ae93-1d12c722f65a` |
| Environment | `Codex Local`; public base URL `http://localhost:8080`, masked secret password and separate worker-reachable API base; `f69a6faf-1ce0-4b71-b890-8d099da990a0` |
| Configuration | `Codex Chromium API`, Linux / Chrome, one matrix row; `ecbd0331-566c-48f2-9955-5628747884f1` |
| Test data | `Codex Sanity Data`, one public row linked to each case; `5af47ca8-8a5d-49c1-b8dd-2cc739dc8936`. The real password is excluded. |
| Manual run | [Codex sanity manual — intentional failure review](http://localhost:8080/executions?execution=d0e1bd4e-f94d-4bfb-9012-649a2f226e07) |
| Automation suite | `Automation sanity`, TS-720, exactly four native API cases; `7e4061b9-1cb0-4ae5-be26-0ea36ca4a2bf` |
| Automation run | [Automation sanity — Login and Signup API](http://localhost:8080/executions?execution=cda12256-c9af-4cb3-b1be-388ac1b3530e), Completed and locked; four passed instances, five HTTP steps, ten passed assertions |
| AI-assisted defect | [BUG-818](http://localhost:8080/issues?issue=93e1bcb9-96be-4031-ae9c-92e0f6e141f9), Login drill; model proposal disclosed evidence-bound deterministic field replacements before review |
| Manual defect | [BUG-819](http://localhost:8080/issues?issue=83647a03-e758-417c-b7dc-02647f790fcc), Signup drill; screenshot attached |

Both defects have Low severity/priority, Admin User assignment, and case/Story/module/suite/run/delivery context. They explicitly state that the underlying authentication rejection behaved correctly. They are intentional traceability exercises, not confirmed Login or Signup regressions.

## Requested task coverage

| Task | Result at this checkpoint |
|---|---|
| 1. Project, app, admin assignment | Done; membership and application reread in the app. |
| 2. Sprint | Done. |
| 3. Release and Sprint link | Done; Release Health confirms one inherited Sprint and two Stories. |
| 4. Manual Login Story | Done and linked to Sprint/Release. |
| 5. AI Signup Story | Done, reviewed and linked to Sprint/Release. |
| 6. AI Complete Login | Done; reviewed title/description changes applied. Sprint, Release and assignee preserved. |
| 7. Signup AI grooming | Blocked: three GPT-5 attempts, including one after API recreation, and one configured alternative returned connection/timeout failures; no grooming review was returned. The fresh-runtime attempt returned HTTP 504 at 60.2 seconds. |
| 8. Manual Login test cases | Done: TC_810 and TC_811. |
| 9. AI Signup test cases | Done: TC_812 and TC_813, reviewed and accepted. An invented sample email in an expected result was replaced with the actual parameter reference before saving. |
| 10–11. Modules and case links | Done: two cases in each module, no ungrouped manual cases. |
| 12. Manual sanity suite | Done: four cases. |
| 13. Valid data/configuration/environment | Done; public case data and private environment value are separated. |
| 14. Manual run with selected resources | Done; Release 26.11, Sprint 2026.11.17, environment/configuration and inherited case data frozen. |
| 15. Execution with intentional failures | Done: two passed, two intentionally failed, all four finalized; comments and screenshots retained. |
| 16. AI defect | Done: BUG-818, reviewed before creation. |
| 17. Manual defect | Done: BUG-819. |
| 18. API automation of the same cases | Done: AT_79/81/80/82, each linked to its exact manual origin, Story and module. All contracts, data and links survived reload. The approved fix removed the captured HTTP 400 editor blocker. |
| 19. Automation sanity suite | Done: TS-720, four Ready API cases, five request steps. |
| 20. Automation suite run | Done on the real remote API worker: four passed instances, five HTTP requests, ten passed assertions and private capture/session chaining. |
| 21. Manual and automation run details | Both live details and deterministic HTML reports validated. Manual PDF also inspected. Reporting discrepancies remain in the plan below. |
| 22. Sprint health | Validated before and after automation; final 6/8 direct linked identities passed, 100% Story coverage, two drill Defects. |
| 23. Module health | Independently refreshed after the real run: both modules show 100% latest pass and linked automation coverage across two manual cases each. |
| 24. Release health | Final readiness 83%, At risk with two open drill Defects; pass 75% across eight direct identities. |
| 25. Project details | Final Watch; admin/app verified, two Stories, two modules, eight catalog cases and two Defects. Latest run pass 100%; mixed case/Defect confidence 60%. |

## What was actually executed

In separate clean browser sessions, valid credentials returned HTTP 200 and opened the authorized workspace; an incorrect synthetic password returned HTTP 401 and kept the user signed out. A one-character Signup email produced the UI validation message and **zero Signup POST requests**. An existing-account Signup request returned HTTP 409 and existing-account guidance, with no verification-success state or new session. No registration email was sent during these checks.

The manual run recorded TC_810 and TC_812 as Passed, TC_811 and TC_813 as intentionally Failed. The latter retained five passed predecessor steps and one deliberately failed final step. Overall: **4 case instances, 2 passed, 2 failed; 14 passed steps and 2 failed steps; 100% completion and 50% case pass rate**. The run finalized as Failed and locked result editing, as expected.

The detailed HTML report opened successfully in about 0.5 seconds, retained the exact case/data-row scope, comments and screenshots, and did not expose the authorized password in visible content or full markup. The PDF export also returned HTTP 200, in about 40 seconds; a downloaded three-page copy was rendered and all pages inspected. PDF text did not expose the password. Its header omitted known start/end times, it added AI analysis, and Poppler reported malformed stream lengths despite recovering the pages. Both formats printed literal rich-text markup in manually authored steps. These findings are included below. Recorded active case time measures the time spent entering run results; it is not an authentication performance benchmark.

Successful new-account email verification was not executed: that path needs a fresh controlled inbox and its received code. Signup validation and duplicate-account protection are the exercised scope. Administrator account provisioning would not prove the OTP Signup path.

### API automation executed and verified

The code trace confirmed the real authentication routes and response semantics. The public app uses `/api` at the gateway; the API worker uses the configured internal base and source route paths.

| Manual origin | Native API assertions |
|---|---|
| TC_810 valid Login | POST `/auth/login`: 200, token present, matching user email; capture token privately and GET `/auth/session`: 200 and matching identity. Do not assume a JWT shape. |
| TC_811 incorrect password | POST `/auth/login`: 401 and exact Invalid credentials message, no successful session. |
| TC_812 malformed/short input | POST `/auth/signup/request-code` with email `a`: 400 and exact minimum-length error. This verifies the backend boundary; the browser's malformed-email rule prevents the POST entirely. |
| TC_813 existing-account Signup | POST `/auth/signup/request-code` with the existing account email: 409 and existing-account guidance. The code rejects this before OTP/SMTP, so no new Signup email is sent. |

| Native case | Canonical ID | Manual origin |
|---|---|---|
| AT_79 Login and authenticated session | `6a449bbf-e5d8-4c0e-9bc5-f2af3803a574` | TC_810 |
| AT_81 incorrect-password Login | `57b1f1b3-1729-48f9-81d1-c62179b3bba1` | TC_811 |
| AT_80 short-email Signup | `af6776c9-5595-48c8-8f20-5fc5dd64a826` | TC_812, `7969d78e-5203-422d-a99f-7f5aec268271` |
| AT_82 duplicate-account Signup | `bbc12dc7-cd0c-4e77-96c5-91f2282f5e73` | TC_813 |

The real run completed on 17 November at **09:08:53–09:09:01 UTC**. Persisted TestOps lease/start/completion events identify the API worker, and all four API-class transactions completed. It retained four case instances and five HTTP traces: Login 200, authenticated session 200, incorrect password 401, short email 400 and duplicate email 409. Each request's status and response-field assertion passed: **10/10 assertions**. Required token capture followed by the successful authenticated session request proves session chaining; no separate token-exists assertion is claimed. Active case time totals approximately 2.8 seconds, displayed as 3 seconds; this single sanity sample is not a performance benchmark.

The live detail and portable HTML report independently agree on **4/4 Passed**, one data row per case and login/signup module scope of two instances each. Captured `t.auth_token`, response tokens and the Authorization header are masked in the exported per-step traces. The authorized password is absent from full report markup and text; an independent check also confirmed all five stored SVG artifacts and no password in their decoded content. The combined positive-case log panel reaches its disclosed size limit; the five separate per-step API evidence blocks retain all ten assertions. Original manual verdicts, comments, screenshots and the two drill defects remain preserved.

The API currently validates email length without the frontend's email-format rule. A syntactically malformed string longer than three characters can reach the delivery path; it was not sent as a test. Shared server/client format validation before SMTP is an additional P1 contract correction to review, with tests proving no account, OTP or email side effect for invalid input. Preserve the genuine controlled-inbox requirement for successful verification.

### Health checkpoint after manual completion

| Surface | Observed result | Interpretation |
|---|---|---|
| Sprint | 2 Stories, 100% linked coverage, 4 executed cases, 50% pass, 2 Defects, density 1.00, QA completion 0%, At Risk 0 | Stories remain Open. Sprint At Risk measures its stated workflow/target/high-priority-uncovered policy; it does not count every failed case. |
| Each module | 2 cases, 50% latest pass, 1 at risk, 100% traceability/executable/execution coverage, one Defect, density 0.50 | Both modules agree with their one-pass/one-fail manual results. |
| Release | 2 inherited Stories, 4 finalized cases, 50% pass, 2 open Defects, readiness 70%, At risk | The 30/50/20 coverage/pass/Defect-health calculation is explained. Open Defects prevent Ready. |
| Project | 100% Story coverage; latest-run pass 50%; combined case/Defect measure 33%; Risky | Project detail currently calls the mixed case/Defect measure Pass Rate; naming improvement below. |
| Run | 50% pass, 100% completion, but Defects 0 | The zero conflicts with saved defects that explicitly select this run; confirmed projection gap below. |

### Final health after the genuine API run

| Surface and population | Final observed result | Interpretation |
|---|---|---|
| Manual run, four frozen manual instances | 2 passed, 2 intentionally failed, locked | Automation did not rewrite the requested drill outcomes. |
| API run, four frozen native instances | 4 passed, 0 failed; ten passed assertions | Live detail and HTML report agree; run-list aggregate does not, as recorded in METRIC-05. |
| Each module, two manual catalog cases with linked-automation projection | Latest pass 100%, At Risk 0, traceability/executable/execution/automation coverage 100%; one Defect, density 0.50 | Latest native outcomes provide effective coverage for the original manual identities. They preserve the historical manual results. Displayed duration averages remain 41s/13s from the two manual-duration samples. |
| Manual Case Library | Four catalog cases; linked automation 100%, latest failed/blocked 0; Recent Pass 75% (6/8 historical direct/derived outcomes) | Recent history and the module's latest effective outcome are different populations. |
| Sprint | Eight linked/executed direct identities, 6/8 passed (75%); two Stories, coverage 100%, two Defects, QA completion 0%, At Risk 0 | Four original TC and four native AT identities are directly Story-linked. The policy does not automatically complete Stories or count drill failures as blocked/slipped Stories. |
| Release | Eight scoped identities, 75% pass, automation 50%, readiness 83%, At risk; two open Defects | Coverage 30 + pass 37.5 + Defect health 15 = 82.5, rounded to 83. Open Defects prevent Ready even above 80. |
| Project | Watch; eight catalog cases, two Stories/modules/Defects; Story coverage 100%, latest run pass 100%, mixed confidence 60% | Confidence is 6 passed ÷ (8 finalized case identities + 2 Defects). Its current Pass Rate label still needs correction. |

These percentages are not interchangeable: module scope excludes native AT catalog rows and projects their results onto manual origins; delivery/project scope retains eight directly linked identities; each run preserves its own four frozen instances.

## Confirmed findings and proposed changes

P1 means required for trustworthy authoring/execution/reporting. P2 means a concrete usability, accessibility or design improvement. The automation editor blocker is resolved; the remaining entries are proposed changes.

| ID / priority | Evidence and impact | Concrete change and acceptance condition |
|---|---|---|
| AUTO-01 / resolved in this change | API editor manufactured `operator: eq` on a status assertion; Save returned HTTP 400 from the correctly strict native validator. | Approved two-line fix deployed. Actual UI saved/reloaded 200/401/400/409 contracts, symbolic bodies, JSON assertions and private captures. Real worker passed all four cases and ten assertions; unsupported explicit status operators remain rejected by regression tests. |
| AUTO-02 / P1 | After valid API steps are saved, a metadata-only Details Save can reset the catalog's automation state to Incomplete. The update always sends `automated: yes`; the server then discards the previous automation-state fallback and derives readiness from absent payload steps. AT_79 exposed the inconsistent state. | Preserve readiness on metadata-only updates, or recompute it from the complete authoritative saved step set when structural inputs change. Keep authoring status and executable mapping state distinct. Cover metadata edits, native API contracts, mixed/partially mapped cases and refreshed query state. Existing UI workaround used here: finish metadata, then Save the unchanged API section so the normal mapping calculation persists Ready; no secret/data duplication or backend bypass. |
| DATA-01 / P1 | Selecting the public dataset at run level says `r.admin_password` and `r.api_base_url` are missing even though Codex Local supplies them. The UI suggests downloading a template. | Validate the effective layered parameter plan, distinguishing environment/configuration bindings, case defaults and explicit dataset overrides. Never require a secret to be copied into public data. Test missing-column fallback, intentional blank override, frozen snapshots and secret redaction. |
| AI-01 / P1 | Signup grooming failed across explicit attempts. First GPT-5 trace: network ETIMEDOUT before a response. Second: approximately 59 seconds and the feature deadline, no body. The alternative had a socket failure. One fresh-runtime request after API recreation again returned HTTP 504 at 60.2 seconds (support `8ba0e781f29136e00fe4e2edcdf8da61`). Other Story/defect/report AI proposals succeeded. | Diagnose this operation's resolved transport, input/output budget and deadline with the existing trace boundary. Share the proven dispatch path and preserve context with actionable recovery information. For work exceeding the interactive deadline, use bounded durable generation with real progress/cancellation. Do not blindly replay uncertain accepted work or merely extend every timeout. A successful returned grooming review is the closure criterion. |
| AUTH-01 / P1 | Signup's browser checks email format, while the traced server request-code boundary checks minimum length. Only the safe one-character and existing-account boundaries were exercised; a longer malformed value could reach mail delivery. | Apply a shared, explicit server/client email-format contract before OTP persistence or mail delivery. Verify invalid-format responses and zero account/OTP/email side effects. Retain a controlled-inbox integration test for successful verification; administrative account creation is not a substitute. |
| TRACE-01 / P1 | BUG-818/819 show run/case/Story/module/suite links. Module and Sprint count the defects; the fresh Run still shows zero. | Add a permission-scoped, deduplicated run-defect projection that includes directly linked Defect records and result/step references, with provenance. Validate a supplied exact result/step origin; do not attach the defect to every historical attempt. Preserve immutable verdicts/evidence. Run, case, module and export must agree after create, relink and delete. |
| METRIC-01 / P1 | Sprint Completion Status explains a finalized-case formula despite counting QA-completed Stories. Defect Evidence Completeness counts four authored fields but explains a 65/20/15 run-evidence formula. Library Automation Coverage counts genuine linked automation too, while its inferred methodology says explicitly marked cases only. | Bind governed metrics by stable identity **and population/scope**, not display labels or substring matching. Create distinct Sprint QA-completion and Defect authored-field-completeness definitions, and make the Library automation definition include its actual linked-case policy. Evidence clicks must show the actual numerator/denominator/units/cohort; unmapped metrics disclose missing methodology. |
| PROJECT-CONTEXT-01 / P1 | Creating codex opened its details but left/reverted the global selector to amazon; subsequent feature navigation could use the wrong scope. Source confirms activation before the authoritative scope cache refresh and a stale fallback to the first project. | Seed/refresh authoritative workspace scopes before activation, or guard the stale fallback during creation. Preserve ACL/revocation checks. New project plus its app must remain selected through feature navigation and reload; no cross-project records should be created. |
| REPORT-01 / P1 | A manual run's portable report says Run mode remote. | Use the hydrated canonical run intent in all displays/exports. Keep engine transport/lifecycle fields separate. Cover manual, local, remote, scheduled and historical receipts rather than changing an unrelated storage enum. |
| METRIC-02 / P2 | Login tiles with Stability No runs still say Stable recent coverage. | Add an explicit unexecuted/unknown guidance branch before stability claims. Keep authoring/automation-candidate advice separate from execution evidence. |
| METRIC-03 / P2 | Project Pass Rate mixes test passes with resolved Defects (33%), while actual case pass rate is 50%. | Name the composite quality confidence and show test pass rate and Defect resolution separately. Explain configured weights without changing policy silently. Distinguish manual and Automation Case catalog counts. |
| METRIC-04 / P1 | The finalized Run shows Impacted Stories 2/2 but its evidence says no Stories are linked to failed cases. Count uses server metrics while the evidence reducer uses unhydrated run-list rows rather than the selected frozen run detail. | Use one selected-run frozen-scope evidence DTO for the count, list and drill-through. Fetch missing detail explicitly; distinguish unavailable/loading from a verified empty scope. Test lazy picker metadata and direct run-detail navigation. |
| METRIC-05 / P1 | The terminal API run list reports eight passed outcomes, while loaded detail and HTML report correctly show four actual instances. The list's Recent Pass Rate becomes 10/12 (83%) rather than the actual two-run 6/8 (75%). Live backend and repository both already guard derived results by frozen scope. The frontend independently summarizes unfiltered `allExecutionResults`, including linked-manual projections; its distinct Cases value uses separate server metrics. | Scope the list summary and evidence to canonical frozen case/data-row/attempt identities, or consume one authoritative server instance-summary DTO. Keep linked-manual projections as lineage, rather than extra executed instances. Preserve the existing backend guard. Distinguish unique cases from planned instances, and reconcile list/detail/exports across multiple origins, retries and legitimate data/configuration matrices. |
| DATA-02 / P2 | Run summary says Test data Not attached while each frozen case uses Codex Sanity Data. The case inspector correctly shows it. | Show Run override: none separately from Effective data: inherited case datasets, with names/row counts and frozen provenance. Keep the existing inheritance help and instance preview accessible. |
| REPORT-02 / P2 | Portable report prints literal `<p>` tags for manually authored descriptions/actions/expected results; plain-text AI cases render normally. | Normalize authored rich text safely into report paragraphs/lists/newlines before redaction and escaping. Do not insert unsanitized HTML. Test both authoring modes, malicious markup and credential masking. |
| REPORT-03 / P1 | All three downloaded PDF pages produce Poppler “Missing endstream or incorrect stream length” warnings; readers recover the content. Source counts UTF-8 bytes but serializes Latin-1 bytes: declared stream lengths exceed actual lengths by 12, 9 and 5 bytes. PDF header also omits known start/end timestamps. | Derive each stream's `/Length` from the exact serialized byte buffer and support the chosen Unicode font/encoding consistently. Feed canonical timestamps to every exporter. Verify independent parsers, non-ASCII content, current correct xref offsets and all rendered pages. A recoverable HTTP 200 file is insufficient structural validation. |
| REPORT-04 / P2 | PDF export took about 40 seconds and included a generated AI analysis; the deterministic detailed HTML export took about 0.5 seconds. | Make exporting recorded evidence independent of a new model response. Offer optional, explicitly requested/cached AI commentary with its provenance, and report real preparation progress. Preserve export availability during provider outages. |
| REPORT-05 / P2 | Benign false values are already redacted in persisted API diagnostics, including `success`, `retryable` and `body_truncated`; the export inherits them. The diagnostic redactor treats the metadata key `is_secret` as a credential field, adds its public false flag to the sensitive-value inventory, then masks unrelated false values. A minimal public-variable fixture reproduced this without credentials. | Exclude privacy-control metadata from the sensitive-value inventory. Keep masking aware of field paths/types, preserving unrelated booleans/numbers while protecting actual private values, tokens and credential headers. Verify callback persistence and exports with public/private booleans and short/common private values. Preserve historical redaction provenance rather than inventing lost values. |
| A11Y-01 / P2 | AI Story Count/Sprint/Release selects lack programmatic labels. The context-shell transform wraps a single field child in an array, preventing FormField from injecting the select ID. Environment variable Key/Value inputs have only table headers. | Preserve singleton element shape through the context transform, or safely normalize one-child arrays in FormField; add row-specific variable labels. Test named combobox lookup inside the real context overlay, keyboard navigation, focus recovery and announced validation. |
| UX-02 / P2 | Suite creation exposes a flat case picker rather than selecting the two requested modules directly. | Add module selection with visible resolved case counts, duplicate suppression, and explicit snapshot versus future-membership semantics. Preserve per-case ordering. |
| IMPORT-01 / P2 | API intake rewrites an exact private scoped password reference into an imported Test parameter and does not retain arbitrary JSON-message assertions. | Preserve valid existing scoped references without interpreting them as literal credentials; continue redacting actual secrets. Explain which assertion/script constructs are retained versus omitted, and present an actionable import review before Save. |

### Evidence/source owners

- API normalization: [stepAutomation.ts](../../services/automation/frontend/lib/stepAutomation.ts), [StepAutomationEditor.tsx](../../services/automation/frontend/components/StepAutomationEditor.tsx); strict native contract: [testStepAutomation.js](../../services/platform/backend/src/utils/testStepAutomation.js).
- Metadata/readiness: [testCase.service.js](../../services/testing/backend/services/testCase.service.js), [useAutomationCaseDataActions.tsx](../../services/automation/frontend/workspaces/case/useAutomationCaseDataActions.tsx), [useAutomationCaseServices.tsx](../../services/automation/frontend/workspaces/case/useAutomationCaseServices.tsx), [automationStepPersistence.ts](../../services/automation/frontend/lib/automationStepPersistence.ts).
- Layered data validation: [runParameterPlan.service.js](../../services/testing/backend/services/runParameterPlan.service.js).
- Sprint metric surface: [RequirementsPage.tsx](../../services/manual/frontend/pages/RequirementsPage.tsx); Defect surface: [IssuesPage.tsx](../../services/testing/frontend/pages/IssuesPage.tsx). Shared metric lookup and catalog need explicit identities, not merely removal of substring aliases: the Defect collision uses an exact label.
- Project creation/scope: [ProjectsPage.tsx](../../services/platform/frontend/pages/ProjectsPage.tsx), [AppShell.tsx](../../services/platform/frontend/src/platform/components/AppShell.tsx).
- Case guidance and module health: [TestCasesPage.tsx](../../services/testing/frontend/pages/TestCasesPage.tsx).
- Run-defect projection: [issues.service.js](../../services/testing/backend/services/issues.service.js), [execution.service.js](../../services/testing/backend/services/execution.service.js). Portable formats: [executionReportHtml.js](../../services/testing/backend/services/executionReportHtml.js), [executionReport.service.js](../../services/testing/backend/services/executionReport.service.js).
- Run list and impact reducers: [ExecutionsPage.tsx](../../services/testing/frontend/pages/ExecutionsPage.tsx). The already-correct live backend derived-result guard was compared with repository source before proposing the list-summary correction.
- Persisted diagnostic redaction: [automationExecutionDiagnostics.js](../../services/automation/backend/lib/build/automationExecutionDiagnostics.js).

## Approved correction and proposed implementation sequence

The focused editor correction is deployed. The pre-fix source passed two of eight new [regression checks](../../services/automation/test/frontend/apiEditorOperatorContract.test.mjs) and failed six; the correction passes all eight, with no skips. Together with the existing focused checks, **15/15 pass**, and both application and Node TypeScript checks pass. The checks exercise the real TypeScript normalizer, strict native backend validator and rendered Add validation handler. They preserve explicit JSON/header/latency comparisons and prove that unsupported status operators remain rejected.

The two production changes preserve an absent assertion operator during normalization and omit it on newly added status rows. No server or engine validation was weakened. The fresh browser independently loaded the new Automation capability entry with matching hashes and protocol compatibility. API and host containers are healthy, the host frontend image is unchanged, and the existing base-plus-ops composition is preserved. Deployment receipt: `.hellotest/releases/codex-api-editor-focused/release.json`. Deployed editor Save/reload, real worker execution, private capture/header masking and preserved manual history have all passed their separate verification gates.

1. **Completed: unblock and execute the API workflow.** The narrowly reviewed correction is live, all four native API cases are saved and linked, Automation sanity ran on the actual API worker, and request/assertion/capture evidence plus final health were inspected. No generated source or draft case was counted as an execution pass.
2. **Restore grooming reliability and correct execution setup.** Diagnose the failed grooming transport and deadline using the saved traces, then verify a returned, reviewable result with preserved Story context and bounded cancellation/recovery. In parallel, fix effective data-source validation, metadata-only readiness transitions, the run-defect projection and Signup format validation. Add contracts at the actual persistence/authorization boundaries, plus browser checks for selecting a secret-bearing environment with public data and creating a defect from a failed result. Verify case/run/Story/module/Release associations, deduplication and invalid-email side-effect prevention.
3. **Make health and exports trustworthy.** Use typed metric identities/cohorts; correct report mode and rich-text conversion. Reconcile native linked-automation outcomes with Sprint/Release/project aggregation using preserved source identities and delivery scope. Separate older manual failures from newer passing automation evidence rather than silently erasing history.
4. **Improve daily workflow and accessibility.** Fix project activation, module-based suite selection, effective data summaries and accessible field names. Show pending states while configuration/membership queries load instead of briefly claiming absent configuration or members. Keep long-running AI work reviewable and its progress tied to actual server stages.

Each phase should end with targeted contracts/types, actual deployed end-user regression, and renewed scope/secret/evidence checks. A source-only test is insufficient proof that the deployed UI and worker work together. Use the existing reviewed targeted UI release for a compatible Automation-only fix; do not rebuild/reconfigure unrelated services or rotate credentials.

## Items that need a reproducer before an implementation change

An AI proposal and an unsaved suite disappeared during the broader session. A focused desktop → phone → desktop repeat **preserved** the suite draft. Source shows a stable responsive Outlet and scope/permission-based AI resets; there is no established resize or linked-case cause. Keep this as an investigation, not a confirmed responsive defect.

The all-blank dataset-row editor may drop an intentionally blank negative-test row; this is source-supported but was not exercised against a separate retained dataset in this walkthrough. Shared-case outcomes from other delivery scopes and differing closed-Defect status vocabularies also require dedicated consistency cases before changing current business policy.

The automation owner observed rapid unsaved metadata selections resetting while a prior step-save refresh was still pending. Stable Save followed by authoritative reload preserved all relationships, independently confirmed in another browser. Reproduce the draft/refresh timing separately before changing state synchronization; do not describe it as a broken relationship-persistence contract.

## Verification and change boundary

The in-app browser connector returned no browsers; the actual app was exercised through background Chromium with visible forms, menus, authoring, execution, uploads and reports. Resource/module/automation work used separate scoped sessions. Requested records are retained. Screenshots and redacted receipts are under `/tmp/codex-walkthrough-2026-11-17`, `/tmp/codex-modules-ui`, and the resource/automation owners' receipts. No password or session token is included in this report.

The initial walkthrough changed requested product records while leaving implementation unchanged. The user then explicitly approved applying, testing and deploying only the focused API-editor correction to finish tasks 18–21; those tasks are now complete. Broader fixes remain proposed for review. Signup AI grooming is still blocked, and successful new-account inbox verification remains outside the exercised scope.

Separate concurrent changes appeared during final verification in the testing backend's `execution.service.js` and new `executionDefectMetrics.test.js` / `executionDeletion.test.js` files. They were left intact and were not part of this focused implementation, deployment or validation. Reconcile the existing run-defect draft with TRACE-01's acceptance conditions before adding overlapping work.
