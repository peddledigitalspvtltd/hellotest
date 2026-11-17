# Optional local durable workflow runtime

The local app can run unattended triggers and verified resume with a dedicated
Temporal development server plus the Agentic durable worker. This is an explicit
local opt-in. Production continues to use an externally managed persistent
Temporal service through `docker-compose.agentic-durable.yml`.

The local overlay pins the official CLI image to version **1.10.1** and digest
`sha256:b228dadf9cdb6c7c02a1394b89dd76f827aac9760e458fce42f0899a10141225`.
The [official release](https://github.com/temporalio/cli/releases/tag/v1.10.1)
and [development-server setup](https://docs.temporal.io/cli/setup-cli) were
checked on 17 November 2026. The pulled image reports CLI 1.10.1, Server 1.32.2
and UI 2.56.4. Its development SQLite history lives in the separate
`hellotest-local-temporal-data` named volume owned by the existing Compose
project. Host ports 7233 and 8233 bind only to `127.0.0.1`; containers reach
`temporal-dev:7233` on that same project's default network.

## Prepare without restarting the app

Run from repository root with the existing private `.hellotest/local.env`.
The wrapper reads the running local API's Compose project and keeps its existing
ops network when present. It refuses a different project identity. On a new
installation without an API container, pass `--project` with the intended local
Compose project name. `--env-file` supports a different existing private file;
the wrapper never rewrites it or prints its values.

```sh
node scripts/dev/local-workflow-runtime.mjs validate
node scripts/dev/local-workflow-runtime.mjs prepare
node scripts/dev/local-workflow-runtime.mjs build
```

`prepare` validates Compose and pulls the pinned development image. `build`
then builds **API → frontend → Agentic durable worker** one image at a time with
the same existing project, private environment and overlays. It stops immediately
if any build fails. Use this serial command on memory-limited hosts rather than a
parallel three-service Compose build: concurrent type checks and Vite/Rollup
bundling can produce heavy paging and long stalls. No global Docker/RAM setting
is changed. Both commands start no app service and do not recreate API/frontend
containers. No paid model request is made.

For a focused worker-only refresh, `prepare --build-worker` remains available;
use it after other image builds finish. `npm run local:workflows -- build` runs
the same serial build command.

## Migrate and start after the app build

```sh
node scripts/dev/local-workflow-runtime.mjs migrate
node scripts/dev/local-workflow-runtime.mjs start
node scripts/dev/local-workflow-runtime.mjs status
node scripts/dev/local-workflow-runtime.mjs logs
```

`migrate` runs the standard additive migration in the updated API image; it does
not reset a database. `start` uses existing built images, enables the same local
Temporal address/namespace/task queue for API and worker, and waits for server
health before starting the worker. It intentionally recreates the API when its
Temporal configuration changes. The optional runtime uses the existing database,
storage and managed-connection credentials. Neither app volumes nor the private
environment file are replaced. The local overlay explicitly disables cloud TLS
and API-key settings for both API and worker; the production overlay retains
those settings. The local worker explicitly uses development mode and local
application routing, matching the API's existing credential policy. Its engine
credentials and local callback/engine addresses match the API; no encryption key
is regenerated. The durable image retains production mode for the external
production overlay.

If a targeted Automation UI overlay is active, `start`/`migrate` also require
`--ui-release /path/to/reviewed-release.json`. The helper detects the active
composition and refuses to silently drop its image selection. See
[the targeted release guide](capability-ui-release.md) for preservation,
rollback and the explicit transition back to a full source build.

Keep this same composition when recreating the API while the local durable
runtime is enabled. A base-only `hellotest.sh up --stack local` invocation does
not include this optional runtime and can intentionally return the API to its
manual development mode. For a combined app/frontend rollout, use the same
three overlay files and existing project identity, adding the frontend service
to that explicit invocation rather than changing project directories:

```sh
TEMPORAL_ADDRESS=temporal-dev:7233 HELLOTEST_SOURCE_CONTEXT=.. \
  docker compose --env-file .hellotest/local.env -p local-run \
  -f local-run/docker-compose.yml -f docker-compose.agentic-durable.yml \
  -f local-run/docker-compose.temporal-dev.yml \
  -f local-run/docker-compose.ops-network.yml --profile local-durable \
  up -d --no-build api frontend temporal-dev agentic-durable
```

Replace `local-run` only with the actual existing project name. Include the ops
network overlay when that existing network is in use; the wrapper detects it
automatically. Host port overrides are `HELLOTEST_LOCAL_TEMPORAL_PORT` and
`HELLOTEST_LOCAL_TEMPORAL_UI_PORT`; internal address/ports remain unchanged.

## Stop and retained history

```sh
node scripts/dev/local-workflow-runtime.mjs stop
```

This stops only the durable worker and Temporal server. It keeps the app, engine
workers and all volumes, including Temporal history. `start` resumes the same
local history. While stopped, the configured API cannot deliver new durable work;
it does not silently switch an accepted run to the in-memory runner. Restore the
runtime before expecting trigger delivery or durable resume. To deliberately
return the API to manual development mode, recreate it with the normal local
composition after stopping the optional runtime; retained durable history remains
in its volume for the next opt-in. The wrapper provides no volume-deleting down
command.

## Verification boundary

Preparation verified the exact official image, startup/health, named-volume
permissions and namespace persistence across a real isolated container restart.
Compose validation verified localhost-only host bindings, shared network,
matching API/worker Temporal settings and the repository worker build context.

On 17 November 2026 the updated API and worker were deployed with main schema 24
and observability schema 3. The actual worker's workflow and activity pollers
were verified against the configured namespace and queue. Authenticated app
checks passed signed webhook delivery and replay protection, a scheduled run,
read-only timer cancellation and receipt-verified resume, and the canonical
activity projection. Owned temporary workflows were removed after verification.
No model call was used by that durable-runtime probe.

The final worker image also passed schema verification and retained matching API
credential/address settings. Startup failures report a safe phase/code and static
remediation, close opened resources, and exit. Production credential requirements
remain in the production overlay; the local overlay uses explicit development
mode with the existing encryption key.
