# Local Recorder Setup

Use this when HelloTest should start recorder sessions against a local Test Engine.

## 1. Start Local Services

For the best desktop recording flow, run the normal HelloTest stack and the host
recorder helper. The host helper opens a real Chromium window on your machine.

```bash
cd local-run
cp .env.example .env
bin/start.sh
bin/start-host-recorder.sh
```

On Windows product installs, use the packaged recorder launcher instead:

```bat
bin\start-host-recorder.cmd
```

If `local-run/bin/hellotest-host-recorder.exe` is present, the Windows launcher runs
that binary and does not require testengine source files. If the binary is not
present, it falls back to the developer source flow.

To build the current platform binary from the repo, run:

```bash
cd testengine/backend
npm run package:host-recorder
```

Each source-based launch reconciles all dependencies from the lockfile, including
build tools, and installs Playwright Chromium into `local-run/.playwright-browsers`
when needed. Later runs reuse the browser download. Override it
with `HELLOTEST_PLAYWRIGHT_BROWSERS_PATH=/path/to/browsers` if your team wants to
preload or cache the browser binaries.

The runner reads the API's shared credential from the terminal environment,
then `.hellotest/local.env`, then `local-run/.env`. Terminal settings take
precedence, including either shared-secret alias. A runner and API with different
shared credentials cannot dispatch a run. One-click launches retain installation
and startup output in `local-run/artifacts/host-recorder/launcher.log`.

The Object Repository download command installs a separate inspection service
on port `4311`. It includes all inspection dependencies, including Acorn, but
does not execute saved test cases. The full host runner above uses port `4313`.
The status panel reports these capabilities separately. For hosted HelloTest,
starting an inspection agent on your laptop does not make its execution port
reachable from the cloud API. Configure an administrator-approved runner address
reachable from the API and a callback address reachable from the runner.

In a test case execution, **Live Run View** appears immediately before Report
defect and opens a separate browser tab for that case's exact engine run and
data row. The action stays visible with setup/waiting guidance when no browser
session is active; it never switches to another case or row. API-only and manual
cases do not have a live browser. The Compose web workers use `TESTENGINE_LIVE_PEER_HOST` to
locate the owning browser when the gateway selects another replica. Peer
requests require the engine credential, use bounded responses and deadlines,
and never forward recursively. Set the service hostname and port explicitly
when using a different engine deployment topology.

If you only want the Docker embedded live view, skip `bin/start-host-recorder.sh`
and keep using the Test Engine container on port `4301`.

```bash
bin/health.sh
```

Expected local endpoints:

- Frontend: `http://localhost:8080`
- API: `http://localhost:3000`
- Host recorder health: `http://localhost:4313/health`
- Host recorder capabilities: `http://localhost:4313/api/v1/capabilities`
- Docker Test Engine readiness: `http://localhost:4301/health/ready`
- Docker Test Engine capabilities: `http://localhost:4301/api/v1/capabilities`
- OPS board: `http://localhost:4301/ops-telemetry`

## 2. Configure HelloTest Test Engine Integration

In HelloTest, open Integrations and create or update a Test Engine integration.

Use these local values:

- Engine base URL for visible host browser: `http://host.docker.internal:4313`
- Recorder public base URL for visible host browser: `http://localhost:4313`
- Docker embedded fallback engine URL: `http://testengine:4301`
- Docker embedded fallback public URL: `http://localhost:4301`
- Shared secret: the configured `TESTENGINE_SHARED_SECRET` from `.hellotest/local.env` (or your explicit override); use the same value as the API and host runner
- Queue polling: `0.5` minutes or `30000` ms via env
- Dispatch mode: HelloTest pull
- Active web engine: Playwright
- Browser: Chromium
- Headless: enabled for Docker local run
- Live view URL: `http://localhost:4301`

Why two URLs: the API container reaches a host-side recorder on
`host.docker.internal`, while your browser reaches the same recorder on
`localhost`.

If the seeded local integration still points at `http://localhost:4301`, run:

```bash
cd local-run
bin/fix-recorder-integration.sh
```

## 3. Start Recording From HelloTest

1. Open a saved web test case.
2. Open the Automation builder section.
3. On desktop, click Start local recorder.
4. Click Check setup in the dialog.
5. Start the local recorder after the setup check passes.
6. Use the live view link when it appears.
7. Stop and create steps when done.
8. Click Run locally in the recorder panel or the test case header. The run opens
   under Test Runs -> Local Runs.

Phones and tablets show the remote recorder action only. Local recording is
desktop-only because it depends on a local Test Engine process and a full
browser-sized live view.

## 4. Troubleshooting

Run:

```bash
cd local-run
bin/status.sh
bin/health.sh
bin/logs.sh testengine
```

If the recorder starts but the browser is not visible, keep `RECORDER_HEADLESS=true`
and use HelloTest's live recorder view. Docker containers usually cannot open a
physical desktop browser window on the host.

If HelloTest cannot reach the Test Engine from inside the API container, verify:

```bash
docker compose -f local-run/docker-compose.yml exec api wget -q -O - http://testengine:4301/health/ready
```

If execution fails with `ECONNREFUSED 127.0.0.1:4444`, the local integration is
still using Selenium. Run `bin/fix-recorder-integration.sh` so local execution
uses the bundled Playwright engine instead of requiring a Selenium grid.

The repository inspection agent uses port **4311**; the host execution/recorder uses **4313**. These are separate services. If a previous host recorder runs on 4311, the backend can still probe it, but a repository inspection agent does not satisfy execution health checks. Keep `HELLOTEST_HOST_RECORDER_PORT` and `HELLOTEST_LOCAL_RUN_ENGINE_URL` aligned when selecting another port. Native callbacks use `HELLOTEST_LOCAL_CALLBACK_BASE_URL`.
