# HelloTest Host Recorder Binary Package

This folder contains the generated host-recorder binaries and the product
packaging contract for distributing the local host recorder without asking HelloTest
users to run source code.

## Runtime Contract

Build one binary per target OS:

- Windows: `hellotest-host-recorder.exe`
- macOS/Linux: `hellotest-host-recorder`

The local launchers prefer the binary when it exists:

- Windows: `bin/start-host-recorder.cmd`
- macOS/Linux: `bin/start-host-recorder.sh`

If the binary is absent, the launchers fall back to the developer source flow
from `testengine/backend`.

## Build

From `testengine/backend`:

```bash
npm run package:host-recorder
```

The script uses Node's single executable application support and writes the
current platform binary to:

```text
local-run/host-recorder-package/dist/<platform>-<arch>/
```

It also installs the current platform binary into `local-run/bin` so the local
launcher can use it immediately.

Run the same command on macOS, Linux, and Windows CI runners to produce all
platform binaries. The generated executable contains the HelloTest TestEngine server
bundle; no TypeScript source files are required on the user's computer.

## Required Environment

The binary must start the same Test Engine HTTP server currently started by
`node dist/server.js` and honor these environment variables:

- `PORT`, default `4313`
- `ENGINE_NAME`, default `hellotest-host-recorder`
- `ENGINE_PUBLIC_URL`, default `http://localhost:4313`
- `ARTIFACT_ROOT`, default `local-run/artifacts/host-recorder`
- `RECORDER_HEADLESS`, default `false`
- `PLAYWRIGHT_BROWSERS_PATH`, default `local-run/.playwright-browsers`

## Browser Runtime

The binary does not require HelloTest source code on the user's machine. It still
uses a sibling `.playwright-browsers` directory for Chromium because that keeps
the executable small and lets IT teams pre-seed browser binaries.

Recommended installer behavior:

1. Install `hellotest-host-recorder.exe` into `local-run/bin`.
2. Install or download Chromium into `local-run/.playwright-browsers`.
3. Create Start Menu/Desktop shortcut to `bin/start-host-recorder.cmd`.
4. Keep `http://localhost:4313/health` as the readiness check.

## Local Run Behavior

After recording, HelloTest stores generated web keyword steps on the test case.
Clicking `Run locally` creates an execution with `trigger = local`, dispatches
it to `http://host.docker.internal:4313`, and the Test Runs page classifies that
execution under `Local Runs`.
