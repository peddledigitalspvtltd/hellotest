# Portable execution report

Reference research: dated observations and verification counts describe the recorded review, not current acceptance. Use the current [verification runbook](../development/verification.md) for reproducible checks.


The detailed HTML export uses the authenticated `GET /executions/:id/report.html` endpoint. It is a self-contained document with a run summary, conclusive pass-rate denominator, suite outcomes, failures and blockers, frozen run context, suite/module groups, searchable case instances, per-step evidence, browser/API diagnostics, and attempt/lifecycle history. Native disclosures work without JavaScript; filtering, expansion and print helpers use one fixed script protected by an exact CSP hash.

The supplied `Generate-ConsolidatedReport.ps1` and sibling `generate_consolidated_report.py` were read as design references only. Neither attachment was executed. The implementation uses application snapshots and saved results rather than importing the reference framework or executing its scenario discovery logic.

## Result semantics

- One outcome per test case and data-row index, based on its latest result. Equal creation timestamps use descending result ID, matching the existing result-reader ordering.
- Retries remain visible in attempt history and contribute to cumulative active duration. Active timers are sampled once at export time.
- Frozen rows with no result appear as unexecuted; they are not treated as passed. Key-value datasets yield one instance.
- Conclusive pass rate is passed / (passed + failed). Empty evidence shows no percentage. Other states remain separately counted.
- Legacy result-only runs retain their recorded titles/results without reading mutable authored steps. Unindexed legacy results with multiple frozen rows are explicitly marked ambiguous.
- Parameter names and values are shown as recorded in the frozen test, suite and run layers. Data-source labels distinguish run, suite and test-case supplied rows. The export does not invent reconstructed runtime substitutions.
- Existing PDF/email models now retain row instances too. A single-case PDF includes every row for the selected case.

## Security and bounds

Run export requires project membership and scoped `run.report.export`. Embedding stored files additionally requires `attachment.view` and `result.view`, checked against both API-key scopes at the route and user permissions in the service. Attachment candidates are selected through their exact run/result association; untrusted IDs in logs never trigger a storage read. Download metadata is checked again before bytes are embedded.

No external URLs, scripts, styles, fonts or images are fetched. HTML content is escaped; credential field names, secret variable descriptors, bearer/basic credentials and common credential assignments are redacted. Image previews accept signature-checked PNG/JPEG/GIF/WebP only. SVG, HTML, archives and other unsupported binary types remain named omissions. Named-field redaction does not guarantee detection of a credential stored under an unrelated name or inside image pixels.

Stored previews allow 60 files, 2 MB per raster image, 128 KB per text attachment and 12 MB total with a 10-second storage-read budget (2.5 seconds per file). Up to 200 attachment metadata records are listed. Oversized, unavailable and denied files are reported without blocking the document. Legacy inline images have a separate 16 MB rendered-image budget. Text panels cap individual displayed text at 48,000 characters; nested structures/large arrays have visible limits. No worker jobs, LLM requests, live test execution or provider calls are needed for HTML generation.

## Validation

- `node --test services/platform/backend/test/executionReport.test.js`: 20 tests cover row/retry counts, pending/key-value/legacy cases, active timers, saved suite context, HTML injection and redaction, CSP, stored attachment binding, permission denials, oversized/cancelled streams, no-LLM generation, route scope boundaries and single-case PDF regression.
- `node --test services/platform/backend/test/browser/executionHtmlReport.test.mjs`: isolated Chrome verifies the actual rendered artifact offline, filters and clear/focus behavior, suite filtering, expand/collapse, print state restoration, no external HTTP requests, no browser errors and zero page-level horizontal overflow at 1440 and 390 pixels.
- Representative screenshots were visually reviewed at desktop/mobile widths and in the expanded detail view. Artifacts: `/tmp/qaira-execution-report.html`, `/tmp/qaira-execution-report-desktop.png`, `/tmp/qaira-execution-report-details.png`, `/tmp/qaira-execution-report-mobile.png`.
- Synthetic local generation with 1,000 distinct cases / 3,000 row instances / 15,000 saved steps took approximately 38 ms for the model and 55 ms for HTML rendering (6.6 MB document). This is a local smoke measurement, not a production latency guarantee; storage reads and browser rendering are excluded.

The in-app Browser bootstrap was attempted after reading its skill and returned `Browser is not available: iab`. Verification used a fresh isolated headless Chrome profile through the repository's Playwright dependency. No live accounts or application data were changed by these report tests.
