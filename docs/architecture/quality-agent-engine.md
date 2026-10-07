# Browser quality agents

The five shipped agents execute in isolated Playwright Chromium contexts. The model proposes a plan; the platform authenticates the user, records the reviewed plan and invokes the privileged engine API. The engine executes typed operations and returns observed evidence. It does not generate a quality score, infer business workflow coverage or execute model-provided JavaScript.

| Agent | Actual execution | Scope of the result |
| --- | --- | --- |
| Web | Reviewed `fill`, `click`, `assert_text` and `assert_url` steps; otherwise bounded same-origin navigation, HTTP/browser errors | Only the approved journey or navigation smoke checks |
| Security | Main response headers, transport, observed cookie attributes and mixed resource references | Passive posture; no exploit, dependency vulnerability or authorization penetration scan |
| Performance | Navigation, DOM/load/TTFB, provisional LCP/CLS, resource count and transfer sizes against explicit budgets | One browser navigation; not load testing or field Core Web Vitals |
| Accessibility | axe-core 4.14.0 WCAG 2 A/AA, 2.1 A/AA and 2.2 AA tagged rules | Automated violations and incomplete/manual checks; not complete WCAG conformance |
| Visual | Stable viewport PNG capture and deterministic channel-threshold pixel comparison against an explicitly reviewed baseline | Captured viewport pixels; no AI similarity or invented baseline |

## Configuration

Install dependencies with the checked-in lockfile and install the matching browser:

```sh
npm ci --prefix testengine/backend
cd testengine/backend
npx playwright install chromium
npm run build
npm start
```

Use the existing `TESTENGINE_SHARED_SECRET` production configuration. Every quality endpoint reuses `createPrivilegedRunGuard`; no direct public browser API is exposed. Platform user/project authorization is enforced by the platform orchestration service before this internal API is called.

| Variable | Default and effect |
| --- | --- |
| `QUALITY_AGENT_DATA_DIR` | `./data/quality-agents`, relative to the engine process working directory; mount a persistent volume |
| `QUALITY_AGENT_BROWSER_PATH` | Optional Chromium executable override; existing `PLAYWRIGHT_EXECUTABLE_PATH` is also supported |
| `QUALITY_AGENT_ALLOWED_PRIVATE_HOSTS` | Empty. Comma-separated **exact** QA hostnames/IPs permitted to resolve to private addresses |
| `QUALITY_AGENT_ALLOWED_ORIGINS` | Empty. Additional exact HTTP(S) origins allowed for resources/redirects; the submitted target origin is always included |
| `QUALITY_AGENT_RETENTION_DAYS` | Seven days, clamped to 1–365; old terminal runs are pruned before accepting new work |

Private-target permission and origin permission are separate. For example, a QA page at `http://qa.internal:8080` can access a private API at `http://api.internal:8081` only when the administrator allows both exact private hostnames **and** the API origin. Wildcards are unsupported. Each resolved address is checked; all browser connections use a dedicated proxy pinned to that validated address. Redirects, frames and subresources cannot bypass the origin/private-network policy. Service workers, downloads, extra windows and unproxied WebRTC are disabled or blocked. Policy-blocked resources are disclosed and prevent an unqualified passing result.

The runtime uses one engine process per data directory. Its concurrency is two, queue capacity 32, retained-run capacity 1,000, page limit five, request limit 250 and wall-time limit 120 seconds. Runs persist atomically with restricted filesystem permissions. A restart marks unfinished runs failed rather than repeating approved actions. Deploy multiple workers with separate data directories and route each run back to its owning worker; this file-backed runtime is not a distributed queue.

The local Compose deployments include a dedicated, single-replica `testengine-quality-worker` with the `hellotest-local-quality-data` named volume. HAProxy routes every `/api/v1/quality-agents` request to this worker, including polling, cancellation, artifacts and baseline review. General automation workers keep their existing least-connection/session-affinity routing. The quality worker has no general queue API configured and sets `TESTENGINE_QUEUE_REQUIRED=false`, so it does not claim ordinary automation jobs. The single-engine microservices deployment mounts `microservices-quality-data` at `/quality-data`. The existing Playwright Docker image matches package version 1.59.1 and installs the exact axe-core dependency from the lockfile. Image-based Compose users must publish/pull an image built from this improved version before using these routes.

## API and evidence

Canonical TypeScript contracts are in `src/contracts/qualityAgents.ts`. Input parsing rejects unknown properties, arbitrary actions, embedded credentials, sensitive URL query keys, recognized secret values and out-of-bound budgets. Browser filling also checks the actual matched element for password, OTP and token fields. Authentication state/credentials are not accepted by this first quality-agent runtime; authenticated journeys require a separately approved credential-binding workflow.

- `GET /api/v1/quality-agents/capabilities` reports checks, limits and browser binary presence. It does not claim a successful browser launch.
- `POST /api/v1/quality-agents/runs` accepts the reviewed request and returns HTTP 202. `client_run_id` is idempotent within project scope; a changed request using the same identifier returns 409.
- `GET /api/v1/quality-agents/runs/:id` returns persisted stages, observations, limits and artifact metadata.
- `POST /api/v1/quality-agents/runs/:id/cancel` stops active work. For a lost acceptance response, `POST /api/v1/quality-agents/runs/by-client/:clientRunId/cancel` takes the original `{scope:{project_id,app_type_id}}`.
- `GET /api/v1/quality-agents/runs/:id/artifacts/:artifactId` returns integrity-checked PNG/JSON evidence with `no-store`, `nosniff` and its SHA-256 header.
- `POST /api/v1/quality-agents/baselines` promotes a completed visual screenshot only after an identified reviewer explicitly approves it. Promotion retries are idempotent for the same source run/artifact.
- `GET /api/v1/quality-agents/baselines?project_id=...` lists reviewed baselines.
- `POST /api/v1/quality-agents/runs/:id/archive` removes terminal engine evidence. Runs supplying reviewed baselines cannot be archived; their source screenshots remain protected from automatic retention.

Visual runs without a reviewed baseline finish as `needs_review`. A baseline must match the exact validated target, project/application scope, viewport and masks. Captures disable animations/caret and use fixed locale/time zone/device scale/color scheme. Default comparison budgets are channel difference 16 and changed-pixel ratio 0.005; the report contains observed changed/total pixels and the rendered difference image. These conditions do not eliminate dynamic content or machine/font rendering differences.

Artifacts are capped at ten per run and 8 MiB each. Password inputs and `[data-sensitive]` elements are masked automatically; reviewed selectors can add masks. Captures include other visible target content and should be reviewed according to the application's data policy. Returned text redacts known credential patterns; cookie names/values and raw HTML are never reported. A failing assertion produces failure evidence where the browser remains available. Cancellation and timeout never produce a success completion.

axe execution is bounded to 20,000 DOM elements and ten seconds. If axe is unavailable or the page exceeds that bound, the report explicitly identifies a bounded DOM fallback and requires review. Incomplete axe checks also prevent an unqualified automatic pass. Performance reports explain cross-origin transfer visibility and constrained resources.

## Verification

`test/qualityAgents.test.mjs` uses a real local HTTP fixture with an explicit private-host allowlist and the installed Chromium binary. It verifies all five agents, reviewed actions, secret-field rejection, safe query identity, denied redirects/resources, cancellation, persisted state, reviewed baseline idempotency and exact PNG evidence. Set `CHROME_EXECUTABLE` only when using a compatible custom browser in this test. Production runs use the engine browser configuration above.
