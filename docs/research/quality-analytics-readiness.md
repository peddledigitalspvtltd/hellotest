# Quality Analytics and Release Readiness: product review and implementation

Reviewed 10 September 2026. This research supports an implemented change to QAIra's two built-in dashboards. It combines inspection of the current application, screenshots of the real components with representative fixtures, code and database analysis, and primary-source guidance. It is an expert product review, not a claim that customer interviews or usability studies occurred.

## Product decision

Quality Analytics answers: **What is happening to this project's quality work, and where should we focus next?** Release Readiness answers: **What evidence and unresolved work should we review for this release or sprint?** The two screens now have different jobs. Neither generates an approval probability or makes a deployment decision.

Analytics has a project context, an explicit 14/30/90-day execution window, four interpretable metrics, execution activity, prioritized follow-up signals, recent runs and current test inventory. Readiness has an applied release/sprint scope, an evidence review state, coverage/outcome counts, a prioritized review queue, Stories and Runs tabs, and visible evidence limits.

The layout puts context before numbers, numbers before investigation, and methodology behind an accessible disclosure or dialog. Numeric signals link to explanations; record-level readiness findings link to the corresponding defect, story or run. Aggregate Analytics signals label their destinations honestly: an aggregate count opens the relevant workspace, not a nonexistent filtered result set.

## Evidence from the previous implementation

The fresh Analytics capture selected a **Docs** tab despite showing Analytics, presented a 78% release posture alongside unrelated percentages, and devoted a large panel to repeating those percentages. Its headline showed an 83% pass rate while the nearby label said zero failed or blocked tests in the fixture. The implementation mixed different latest-result scopes and counted related gaps repeatedly as an overall risk number.

The source loaded capped story and test-case collections before calculating project metrics in the browser. A project with more than 100 items could therefore have a denominator based on a sample. The backend's legacy quality insight logic also reduced results globally by case before calculating individual run outcomes, which lost evidence belonging to older runs.

Readiness repeated a numeric verdict and a separate confidence score. The fixture exposed a paused case counted as executed and a failed data iteration hidden by another passing row. Its dense multi-pane presentation placed the next useful action below substantial summary content. See the [backend analysis](quality-analytics-backend.md) and [Readiness design review](release-readiness-design.md) for the corresponding implementation evidence and boundaries.

Before/after screenshots are representative fixture renders through production components. They show UI behavior, not real customer records or measured business improvement.

- [Analytics before](quality-analytics-readiness/analytics-before.png)
- [Analytics after](quality-analytics-readiness/analytics-after.png)
- [Analytics mobile](quality-analytics-readiness/analytics-mobile.png)
- [Readiness before](quality-analytics-readiness/readiness-before.png)
- [Readiness after](quality-analytics-readiness/readiness-after.png)

## Research that informed the design

DORA's guidance separates throughput from instability and cautions against replacing contextual interpretation with one overall metric or comparisons between unlike services. Applied here, this supports separate coverage, execution and defect measures. QAIra's test-result measures are **not DORA deployment metrics**; this implementation does not have the production deployment evidence needed to label them that way. [DORA, software delivery performance metrics](https://dora.dev/guides/dora-metrics/).

Google's monitoring guidance connects dashboards to diagnosis, investigation and trends, and discusses the cost of freshness and expensive queries. The product implication is to expose source freshness, give a signal a useful investigation path, and move repeated aggregation out of the browser. The result is an architectural reduction in requests and transferred records; it is not a claimed production latency improvement without a production benchmark. [Google SRE Workbook, Monitoring](https://sre.google/workbook/monitoring/).

W3C's guidance for complex images calls for both a brief description and access to the information behind a chart. Analytics therefore includes a text description, labeled counts and a data table for the same chart buckets. Color is supplemented by labels and numbers. Keyboard focus, dialog escape/return and responsive layouts are tested, but these checks do not constitute a full accessibility certification. [W3C WAI, Complex Images](https://www.w3.org/WAI/tutorials/images/complex/).

## Metric contract

| Metric | Scope and calculation | What it does not establish |
| --- | --- | --- |
| Story coverage | Current stories with at least one existing case linked in the same project / all current project stories | A link is coverage intent, not a passing execution |
| Conclusive pass rate | Passed / (passed + failed), among latest attempts for runs in the selected activity window | Blocked, unfinished, N/A and aborted work is not counted as passing |
| Failed or blocked | Failed plus blocked run/case/data-row instances in the selected window | It is not a unique defect count or a count of unique cases across runs |
| Open defects | Current project defects outside closed/resolved/done/accepted/cancelled states | The count is independent of the execution window and does not itself measure severity |
| Execution activity | Latest outcomes for runs grouped by end, otherwise start, otherwise creation date, using UTC | It is a run-cohort view, not a historical daily status snapshot |
| Cases with saved steps | Current cases with at least one persisted test step | It does not validate the quality or completeness of the test design |
| Cases marked automated | Current cases with an explicit automated designation | It does not prove that automation runs successfully |

A missing or zero denominator shows a dash, never a fabricated percentage. Unavailable sources return null and remain visually distinct from actual zero counts. Failed requests return errors rather than silently converting missing data into healthy results. Refresh failure retains the last loaded snapshot with an explicit notice.

The run/case/data-row identity preserves data-driven test instances. A retry replaces only its own instance. Frozen planned rows without a result remain unfinished. Readiness distinguishes conclusive pass/fail outcomes from paused, blocked, running, pending, skipped and aborted work, and surfaces incomplete evidence rather than declaring a clear state from a partial sample.

## Implementation and performance

`GET /analytics/overview` replaces the built-in Analytics screen's multi-resource list synthesis. The endpoint calculates full current inventory in SQL and scopes execution summaries to the selected window. The payload contains a maximum of 90 trend days, ten recent runs and eight aggregate attention signals; it does not transmit raw test steps, logs, parameter values or whole result collections. Source queries are skipped when permissions or feature settings exclude them.

The frontend uses a cancellable request keyed to project, user permissions, period and feature availability, with a short query freshness interval and an explicit refresh that bypasses the lower-level GET cache. Project or period changes do not reuse an unrelated snapshot. The 90-day chart groups consecutive seven-day buckets while preserving all underlying counts. No charting dependency or LLM call is needed to render the primary dashboard.

Readiness remains a bounded evidence review, with visible pagination, source totals and run/result limits. That boundary is intentional and must remain visible. Full aggregate inventory in Analytics does not imply that Readiness loaded every historical result.

The existing Explain action is retained as a separate read-only review of project evidence. Analytics labels its all-date scope explicitly. Backend checks now guard the source permissions before generating that review. Compatibility APIs and custom dashboards can still expose advisory heuristic fields; the redesigned built-in summary does not use them as measured release confidence.

## Usability, access and localization

The four summary metrics stay visible while users can reorder or hide supporting sections. Preferences are isolated by user and project, recover from corrupt storage and cannot hide all sections. A snapshot export includes its UTC window and methodology; formula-like user values are neutralized for spreadsheet safety.

The new screens use shared English/Spanish localization catalogs and regional number/date formatting. Record content and explanatory service output retain their source language. Visible actions, source loading and API responses respect permissions and feature availability; unavailable evidence cannot be inferred from hidden records.

Dialogs use the existing focus-management hook for initial focus, containment, Escape and focus return. Tables have headers and scroll regions. Mobile layouts stack panels, retain readable labels and keep horizontal overflow inside data tables. Light and dark themes receive explicit component styling where the global stylesheet would otherwise override contrast.

## Validation and limits

Targeted helper tests cover unavailable denominators, invalid window selection, corrupt/duplicated layouts, count-preserving trend grouping and CSV formula handling. Browser checks exercise period changes, a metric explanation and focus return, attention expansion, table access, export, persisted layout, failed-refresh recovery, empty/restricted/disabled/no-project states and Spanish mobile layouts. Database integration uses a disposable PostgreSQL instance, including more than 100 inventory records, retries, independent data rows, missing planned results, future/out-of-window runs and restricted sources.

Final build, suite counts and local deployment checks are recorded in [validation](quality-analytics-readiness-validation.md). No production-scale performance benchmark or live-provider prediction evaluation was conducted. Release decisions remain human owned; these dashboards expose evidence and review work rather than asserting that passing tests guarantee a safe release.
