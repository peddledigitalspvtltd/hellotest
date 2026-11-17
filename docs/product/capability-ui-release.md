# Targeted Automation interface release

Use this path for a validated Automation-only UI change when the deployed host
and backend behavior remain compatible. It builds the existing capability bundle
and layers only `/app/capability-ui/automation` onto an inspected API image. It
does not use `docker commit`, edit a running container, rebuild the frontend host,
or change credentials or database volumes.

The current host supports protocol 1 and same-origin capability loading. An empty
`CAPABILITY_UI_URLS` map uses bundled screens, so publishing API assets alone does
not activate a release. The explicit overlay selects Automation while preserving
other configured capability locations.

## Prepare and validate

Finish the changed owners' TypeScript, UI and behavior checks first. Supply the
actual reviewed running image IDs; preparation rejects other API/frontend bases.

```sh
node scripts/deploy/automation-ui-release.mjs build \
  --api-image sha256:REVIEWED_API_IMAGE_ID \
  --frontend-image sha256:REVIEWED_FRONTEND_IMAGE_ID \
  --out .hellotest/releases/automation-ui-REVIEW_ID
```

Preparation uses the existing Automation capability builder and
`services/automation/Dockerfile.ui-release`. It pins local image references to
inspected IDs, preserves the base filesystem layers/runtime configuration, checks
all artifact hashes/imports/serving limits, and confirms that other capability
assets and old Automation chunks have unchanged bytes. Complete bundles live
under `releases/<inventory-sha256>/`; this prevents same-name Rollup chunks with
different source-map metadata from overwriting an old release. The manifest is
uncached; namespaced assets remain immutable. No app service is started.

The output includes `release.json`, `manifest.json` and `host-requirements.json`.
The manifest declares the actual rendered host module/export requirements. In
the existing reviewed browser, capture the following result as a JSON snapshot:

```js
const host = window.__HELLOTEST_UI_HOST__;
const snapshot = {
  protocol: host?.protocol,
  modules: Object.fromEntries(Object.entries(host?.modules || {}).map(([key, value]) => [
    key,
    Object.fromEntries(Object.keys(value).filter(name => value[name] !== undefined).map(name => [name, true]))
  ]))
};
```

The snapshot contains names and availability booleans, without functions,
sessions or credentials. Verify it before activating the release:

```sh
node scripts/deploy/automation-ui-release.mjs verify-host \
  --receipt .hellotest/releases/automation-ui-REVIEW_ID/release.json \
  --snapshot /path/to/deployed-host-snapshot.json
```

A missing module/export blocks activation. Changes to the host ABI or platform
route/controller require the normal source release instead.

## Apply and verify

```sh
node scripts/deploy/automation-ui-release.mjs apply \
  --receipt .hellotest/releases/automation-ui-REVIEW_ID/release.json \
  --env-file .hellotest/local.env
```

This local helper preserves the existing project and durable/ops composition,
requires the reviewed current images/UI map, and uses the explicit
`local-run/docker-compose.automation-ui.yml` overlay. It recreates only API and
frontend from existing images, waits for their health, and starts no dependency.
The frontend image bytes stay unchanged; its entrypoint writes the reviewed
same-origin Automation location. The private environment file is neither changed
nor printed. A later image or runtime-map change blocks this operation rather
than overwriting it.

Verify a fresh browser requests the Automation manifest and its namespaced JS/CSS
from `/api/capability-ui/automation/`, receives successful responses, reports no
page/console errors, and passes the changed desktop/mobile workflows. HTTP asset
success alone does not establish UI behavior. Keep the receipt and reviewed base
images for rollback.

```sh
node scripts/deploy/automation-ui-release.mjs rollback \
  --receipt .hellotest/releases/automation-ui-REVIEW_ID/release.json \
  --env-file .hellotest/local.env
```

Rollback restores the reviewed API/frontend images and original capability map.
It applies the same current-image/map guards and leaves database contents intact.

## Preserve the release on later workflow startup

While this overlay is active, workflow `start` or `migrate` requires its receipt:

```sh
node scripts/dev/local-workflow-runtime.mjs start \
  --ui-release .hellotest/releases/automation-ui-REVIEW_ID/release.json
```

The helper detects the active overlay from Compose labels, verifies the current
image IDs, and retains its image selection/UI map. Omitting the receipt stops
before recreating services. `build` still builds normal source images and refuses
a UI-receipt argument, so it cannot overwrite immutable release tags.

After a full source build incorporates the fix, deliberately return both API and
frontend to the normal composition, excluding the UI overlay. For the existing
local durable project (include the ops overlay only when already in use):

```sh
node scripts/dev/local-workflow-runtime.mjs build
TEMPORAL_ADDRESS=temporal-dev:7233 HELLOTEST_SOURCE_CONTEXT=.. \
  docker compose --env-file .hellotest/local.env -p local-run \
  -f local-run/docker-compose.yml -f docker-compose.agentic-durable.yml \
  -f local-run/docker-compose.temporal-dev.yml \
  -f local-run/docker-compose.ops-network.yml --profile local-durable \
  up -d --no-build api frontend agentic-durable
```

Use the actual existing project name. Recreating both services restores the
normal frontend runtime map from the unchanged private configuration and removes
the targeted overlay from their Compose labels. Subsequent workflow startup uses
the ordinary source composition.
