# Local Recorder Setup

Use this when QAira should start recorder sessions against a local Test Engine.

## 1. Start Local Services

For the best desktop recording flow, run the normal QAira stack and the host
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

If `local-run/bin/qaira-host-recorder.exe` is present, the Windows launcher runs
that binary and does not require testengine source files. If the binary is not
present, it falls back to the developer source flow.

To build the current platform binary from the repo, run:

```bash
cd testengine/backend
npm run package:host-recorder
```

The first source-based host-recorder run installs Playwright Chromium into
`local-run/.playwright-browsers`. Later runs reuse that directory. Override it
with `QAIRA_PLAYWRIGHT_BROWSERS_PATH=/path/to/browsers` if your team wants to
preload or cache the browser binaries.

If you only want the Docker embedded live view, skip `bin/start-host-recorder.sh`
and keep using the Test Engine container on port `4301`.

```bash
bin/health.sh
```

Expected local endpoints:

- Frontend: `http://localhost:8080`
- API: `http://localhost:3000`
- Host recorder health: `http://localhost:4311/health`
- Host recorder capabilities: `http://localhost:4311/api/v1/capabilities`
- Docker Test Engine health: `http://localhost:4301/health`
- Docker Test Engine capabilities: `http://localhost:4301/api/v1/capabilities`
- OPS board: `http://localhost:4301/ops-telemetry`

## 2. Configure QAira Test Engine Integration

In QAira, open Integrations and create or update a Test Engine integration.

Use these local values:

- Engine base URL for visible host browser: `http://host.docker.internal:4311`
- Recorder public base URL for visible host browser: `http://localhost:4311`
- Docker embedded fallback engine URL: `http://testengine:4301`
- Docker embedded fallback public URL: `http://localhost:4301`
- Shared secret: `qaira-testengine-dev-secret`
- Queue polling: `0.5` minutes or `30000` ms via env
- Dispatch mode: QAira pull
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

## 3. Start Recording From QAira

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
and use QAira's live recorder view. Docker containers usually cannot open a
physical desktop browser window on the host.

If QAira cannot reach the Test Engine from inside the API container, verify:

```bash
docker compose -f local-run/docker-compose.yml exec api wget -q -O - http://testengine:4301/health
```

If execution fails with `ECONNREFUSED 127.0.0.1:4444`, the local integration is
still using Selenium. Run `bin/fix-recorder-integration.sh` so local execution
uses the bundled Playwright engine instead of requiring a Selenium grid.
