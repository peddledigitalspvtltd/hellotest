# Automation authoring and execution

An automation case is an ordered behavior plan with an implementation for each step. Manual cases and stories remain the coverage sources. Agent generation, recording and keyword/code authoring all update that plan; suites and runs execute its saved version.

## Runtime contract

| Test type | Conventional implementation | Automation agent | Evidence |
| --- | --- | --- | --- |
| Web | Playwright JavaScript, browser keywords, local/remote recording | Uses a Playwright-backed MCP browser to observe the application, select tools and generate code | Awaited operation outcomes and source lines, assertion failures, screenshots, trace and video according to policy |
| API | Structured HTTP requests, authentication, assertions and response captures | Builds the request contract from manual behavior, stories and supplied API context | Request/response details, duration, assertions and captured values |
| Android | Appium / UiAutomator2 keywords and driver code; device recording | Generates native code from supplied selectors and recordings | Step outcomes and configured failure screenshots |
| iOS | Appium / XCUITest keywords and driver code; device recording | Generates native code from supplied selectors and recordings | Step outcomes and configured failure screenshots |

Playwright is the primary Web runtime; the existing Selenium provider remains selectable. A shared envelope and parameter context coordinate mixed API/Web/native plans. Native apps need Appium drivers and a connected device, simulator, emulator or device-cloud connection. Configure `MOBILE_ENGINE_URL`, matching `MOBILE_ENGINE_SHARED_SECRET` values and a reachable Appium endpoint; XCUITest requires a macOS Appium host. Browser MCP cannot inspect native app controls. This follows the platform distinction in the [Appium driver documentation](https://appium.io/docs/en/2.3/ecosystem/drivers/).

The MCP endpoint is a HelloTest implementation at `/api/v1/automation/mcp`, protected by the TestEngine shared secret. It uses Playwright and exposes a bounded browser tool set. It is not Microsoft's packaged server. The LLM owns the decision loop; MCP returns observations. This separation follows the [Playwright MCP model](https://github.com/microsoft/playwright-mcp).

## Workspace

1. **Details:** case identity, manual coverage, stories, modules, suites and data-set links.
2. **Plan:** preconditions and ordered steps, expected outcomes, runtime, keywords or source, local groups and shared groups.
3. **Test Data:** case, suite and run parameters; selected data rows become execution iterations.
4. **Before / After:** setup and teardown for the next run from this workspace. These selections persist with the run and survive reruns.
5. **Build tools:** “Build with automation agent” and recording. Optional instructions augment the saved behavior; the user need not repeat the manual case.
6. **Objects:** fields owned by or directly referenced from this case. The application-wide repository remains available separately for reuse and inspection.
7. **Runs:** attempts, outcomes, code-operation details, hook results and permission-controlled evidence.

Execution setup stays collapsed until needed. Platform-specific controls avoid offering browser recording for API-only or native-only plans. Mobile navigation keeps the selected tab visible. Repository inspection supports attribute composition, parent scope and explicit match index; changing a locator invalidates its earlier validation.

## Build handoff

The backend assembles saved actions and expected results, source manual cases, accessible linked and related stories (including acceptance criteria and specifications), repository objects, groups, knowledge, selected execution configuration/environment, scoped data and user guidance. Both feature availability and permissions govern optional evidence. Context is bounded; it is not an unlimited export of project content.

For Web, the build opens an isolated browser session and provides tool schemas and observations to the configured LLM. Navigation stays within the configured application origin and follows existing private-network policy. Browser interaction is an explicit build option. A build without it can inspect but cannot click, fill, press keys or select options. Single and batch builds carry the same option.

The agent returns a complete step mapping. Runtime changes, duplicate/missing mappings and malformed executable contracts reject the build. Existing code survives provider failures. Concurrent case changes cause a conflict instead of being overwritten. A generated implementation is ready to review; execution is a separate action that verifies it.

## Reuse, execution and results

Local groups organize one plan. Shared-group instances retain their source identity and scoped parameters; generating code for an instance does not publish a shared-library edit. Cases can belong to suites while retaining their own data and run history.

Run creation freezes hook sources and their parameters. Before/after hooks run around each case. Teardown runs after setup or case failure, and hook failure policies control continuation. Reruns retain the frozen hooks. Failed-only reruns consider the latest attempt for each data row. Secrets in frozen hook data are redacted from public reads and restored only in the internal execution path.

The Playwright provider uses native Playwright page/locator behavior and retrying assertions. Execution instruments awaited operations and reports their original source line, status, duration and attempt; loops can emit multiple events on the same line. It does not invent pass results for comments, declarations or unexecuted branches. Trace/video retention follows policy for engine-owned Playwright contexts; attached CDP contexts do not get equivalent recording. Actual artifact references are attached after collection. Inline traces are capped at 8 MiB; larger traces need accessible artifact storage. [Playwright tracing](https://playwright.dev/docs/api/class-tracing) records browser operations; step outcomes and assertion results are also kept in the application run contract.

Recordings keep actions in chronological order. Typing can coalesce only within an uninterrupted edit; a later click or navigation is a boundary. The UI displays all retained actions in playback order, with a count when a backend retention limit is reached.

## Current boundaries

- Agent generation uses the configured LLM; runtime retries execute saved code again. There is no runtime LLM repair or automatic locator publication. Unbuilt `web.aiStep` and native AI instructions fail explicitly.
- Web code is an executable step body. A simple Playwright `test(...)` wrapper can be unwrapped; arbitrary multi-test suites, imported fixtures and test-runner hooks belong outside that body. Use plan groups and execution hooks.
- API steps execute their structured request. Saved JavaScript references are not API runtime overrides; edit the request JSON or request form to change execution.
- Hooks support before/after each test. Coordinated once-per-suite/run hooks and independent hook data-set iteration are not implemented.
- Native video and native per-line traces are not implemented. Native screenshots require the configured failure-capture policy.
- Isolated test fixtures verify authoring and engine behavior. Live provider credentials, private targets, remote recorder deployment and physical devices require validation in the configured environment.

See [automation setup and focused checks](../../services/automation/README.md) and the [TestEngine runtime guide](../../testengine/README.md).
