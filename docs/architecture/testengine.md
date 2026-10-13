# TestEngine consolidation

`testengine/backend` is the sole execution runtime. The redundant `apps/hellotest-execution-engine` prototype has been removed from the working tree, including its package, source, tests, build helper, local dependencies, and generated output. Its previously committed implementation remains available in Git history. No current checked-in deployment referenced it, and the supported queue/dispatch endpoints remain unchanged.

## Capability comparison

The comparison covered all 21 prototype TypeScript source files, its runner tests, package configuration, and deployment references. The prototype was a different implementation of the same responsibilities, not an identical-file copy.

| Prototype capability | Retained implementation or decision |
| --- | --- |
| Web actions and screenshots | `testengine/backend/src/lib/webEngine.ts` supports Playwright and Selenium, browser lifecycle, interactions, assertions, captures, and artifacts. |
| Android steps through WebdriverIO/Appium | `mobileEngine.ts` calls the configured Mobile Engine. `queueWorker.ts` executes contiguous Android blocks in authored order alongside API/web steps. |
| Unified API/web/Android cases | `queueWorker.ts` routes each concrete step, carries captured values forward, and rejects unsupported step types. A separate unified runner is unnecessary. |
| API requests, assertions, JSONPath captures | `apiEngine.ts` handles queued API steps; `executor.ts` handles direct dispatch. They now share `apiJsonPath.ts`, including quoted keys, wildcard selection, recursive descent, and array slices. Captures use the first match; selected array values remain arrays. |
| Per-request API deadline | `EngineApiRequest.timeout_ms` now survives backend normalization and reaches both execution paths. The default is 30 seconds, bounded to 1–120 seconds, covering response-body reading as well as connection/header waiting. |
| Run variables, captures, and case isolation | `runtimeContext.ts` resolves scoped parameters. Each queued job/direct execution owns its context; mixed steps share captures within that execution. |
| Parallel case scheduling | The control plane's `testEngineDispatch.service.js` owns run/suite concurrency and leases; `queueWorker.ts` owns bounded concurrent execution. The prototype's second BullMQ queue is removed. |
| Run/suite setup and teardown | The control plane builds execution hooks/plans, and `executor.ts` runs pre/post hooks with failure policies. Existing scheduling and hook contracts are retained. |
| Step/case results and evidence | Queue reports, direct callbacks, local artifacts, and the control plane's attachment persistence replace the prototype's in-memory result logger. |
| Observability and shutdown | `opsTelemetry.ts`, queue health/lifecycle controls, and the server's graceful shutdown remain the supported implementations. |

The prototype's `uploadArtifact` function was never called. Its heartbeat method, retry settings, and template-resolution helper were also disconnected from execution; their presence did not represent working capabilities to migrate. The prototype did not invoke its declared before/after-case hooks or retry configuration. Those unused declarations are not preserved as a second runtime.

JSONPath script/filter evaluation is deliberately disabled. The prototype's default evaluator could execute expressions; the retained engine supports data selection without enabling author-supplied JavaScript. Existing simple paths remain supported, and missing paths fail assertions.

## Regression checks

- `testengine/backend/test/apiExecutionParity.test.mjs` checks JSONPath selections, disabled expressions, direct/queued response parity, capture results, configured deadlines, and cancellation during response-body reading.
- `services/platform/backend/test/apiRequestTimeoutContract.test.js` checks persisted/snapshotted timeout preservation and bounds.
- `services/platform/backend/test/executionPlaneRetirementContract.test.js` requires the prototype directory to remain absent, checks deployment references, and verifies that root setup/tests use the retained engine.
- Existing engine tests cover mixed API/mobile ordering and captures, lease lifecycle, recorder controls, runtime health/authentication, and telemetry.

Run `npm run test:testengine` for the retained engine, or `npm test` for the platform suites plus repository/architecture checks. Live browser/Grid/mobile-provider execution still requires those configured external runtimes; unit and contract tests do not substitute for that deployment acceptance.
