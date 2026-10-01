# Repository commands

Run commands from the repository root. `hellotest.sh` remains the stable product-stack entry point and `start-testengine-ops.sh` the execution-plane entry point. Subcommands delegate to the implementations below; there is no second deployment implementation in an old `deploymentscripts` directory.

| Directory / command | Responsibility |
| --- | --- |
| `dev/doctor.mjs` | Read-only development tooling, installed-package and workspace-link checks |
| `deploy/aws/deploy-app.sh` | EC2 app deployment, private internal binds, post-deploy readiness |
| `deploy/aws/deploy-testengine.sh` | EC2 worker deployment and explicit API/public engine connection |
| `deploy/aws/status.sh`, `logs.sh` | Inspect an EC2 host; `--help` is read-only |
| `deploy/aws/aws-runtime.sh` | Sourced AWS/container/readiness helpers, not an entry point |
| `deploy/provider-stack.sh` | Generate/run the provider-separated Compose or Kubernetes topology; this is infrastructure isolation, not customer capability selection |
| `ops/stack.sh` | Prepare monitoring credentials and start/status/stop the optional monitoring stack without host Node.js |
| `ops/stack.mjs` | Compatibility wrapper for the existing npm monitoring commands |
| `ops/verify.mjs` | Check a running monitoring stack and application integration; uses synthetic verification activity |
| `ops/resolve-testengine-config.mjs` | Resolve engine monitoring configuration from its supplied input |
| `checks/audit-source-layout.mjs` | Repository ownership, names, duplicates, documentation and tracked-artifact checks |
| `checks/check-service-boundaries.mjs` | Enforce declared npm dependencies/exports and prevent backend imports of frontend source |
| `checks/sync-capability-metadata.mjs` | Generate/check runtime capability metadata from package ownership declarations |
| `checks/test-workspace.mjs` | Discover shared and capability-owned unit tests for one runtime |
| `checks/test-capability.mjs` | Run focused capability tests plus central contracts naming that owner |
| `build/capability-ui.mjs` | Build a selected UI release with shared host providers and hashed assets |
| `build/minio.sh` | Prepare/reuse the default local MinIO image from pinned official source; leave custom image references unchanged |
| `checks/audit-module-graph.mjs` | Source imports, entry-point reachability, orphan/CSS enforcement and shared UI dependency direction |
| `checks/report-function-clones.mjs` | Advisory repeated-function report for owner review; not an automatic deletion rule |
| `checks/source-imports.test.mjs` | Import analysis and reachability regression tests |
| `lib/source-imports.mjs` | Pure source import resolution, analysis and graph traversal |
| `checks/validate-service-architecture.mjs` | Catalog, image source layout and composition roots |
| `checks/validate-microservices-contracts.mjs` | Validate rendered Compose JSON received on stdin |
| `checks/validate-deployment-contracts.sh` | Render and validate deployment variants without starting them; invokes startup regression checks |
| `checks/test-hellotest-startup.sh` | Stubbed startup/pull/build sequencing and optional-ops failure checks |
| `checks/test-service-gateway.mjs` | Disposable gateway containers for forwarding, streams and unavailable upstreams |
| `data/export-product-blueprint.cjs` | Deterministic export of reviewed sample references into product docs |
| `lib/docker.sh` | Single Docker availability/Compose v1-v2 adapter used by operator wrappers |

Runtime-owned commands stay beside their owners: `local-run/bin/` for the local stack and recorder; `testengine/backend/scripts/` for execution packaging; `services/platform/frontend/docker-entrypoint.sh` for Nginx runtime configuration; `services/platform/backend/start.sh` and `services/platform/frontend/start.sh` for their development Compose entry points. Repeated names such as `start.sh` are scoped entry points, not duplicate implementations.

## Common commands

```sh
npm run setup
npm run doctor
npm test
npm run build
sh scripts/checks/validate-deployment-contracts.sh
npm run test:service-gateway
npm run ops:status
scripts/deploy/aws/deploy-app.sh --help
scripts/deploy/aws/deploy-testengine.sh --help
```

The root package commands are the stable developer interface. Direct script callers should use the paths above. AWS deployment names now state the action first; `common.sh`, `host-isolated-services.sh`, and `demo-api.sh` were replaced by scoped names that explain their purpose. Docker/Compose detection in the services/platform/frontend/backend start wrappers now delegates to `lib/docker.sh`; unused AWS helper functions were removed. Independent validators were retained because static ownership checks, rendered deployment checks and live gateway checks verify different contracts.

`npm run doctor` checks the declared Node runtime minimum, Node 22.18+ for development tests, npm, direct dependencies in the root/backend/frontend/TestEngine/mobile installations, package versions against available lockfiles, and capability workspace links. Missing required tooling, packages or links exits 1. Docker and Compose CLI versions are optional checks; their absence only warns. `npm run doctor -- --help` performs no probes, and `npm run --silent doctor -- --json` emits `{ schemaVersion: 1, ok, checks }`. Invalid flags exit 2.

Doctor never imports application modules, installs packages, starts services, contacts Docker's daemon or changes containers. It reports only the existence of optional `.env` files and never reads their contents. Node does not load those files automatically: load the intended file explicitly in your command or debugger. Vite handles its frontend environment separately. A passing report confirms local setup metadata; it does not verify service, browser or device readiness. See the [development guide](../CONTRIBUTING.md) for startup commands and the loopback-only VS Code inspectors on ports 9230 (API), 9231 (TestEngine) and 9232 (mobile).

`npm run build:minio` runs [build/minio.sh](build/minio.sh) to prepare `hellotest/minio:RELEASE.2025-10-15T17-29-55Z` using [the source-build recipe](../ops/minio/Dockerfile). This follows the [official release guidance](https://github.com/minio/minio/releases/tag/RELEASE.2025-10-15T17-29-55Z). It needs a running Docker daemon; the first build downloads source/dependencies/base images and compiles for several minutes, then subsequent calls reuse the local image. The root launcher invokes preparation automatically; direct Compose users must run this command first. The helper does not replace a custom `MINIO_IMAGE` mirror or modify data volumes. Remove old Quay/Docker Hub overrides or set the default local tag; registry login does not restore withdrawn public images.

`npm run build:minio -- --offline` only accepts an already cached default image; a missing image fails with an actionable preparation command. The root launcher's `--skip-image-pull` uses this mode to prevent network preparation.

Vite configuration is authored only in TypeScript. The config type-check uses `noEmit`; generated `vite*.js` and declaration copies were removed so development cannot accidentally load a stale duplicate configuration.

`deploy/capabilities.mjs` powers `npm run services:up -- --capabilities automation --build`. Use `--print` to inspect the validated dependency closure and Docker command. It starts the selected capability set; it never removes an older deployment or its volumes. Selection is enforced in routes, workers, and feature availability. See [CONTRIBUTING](../CONTRIBUTING.md#schema-and-capability-releases).

The legacy unauthenticated demo-record shell walkthrough was removed. Use Administration → Instance setup, or `HELLOTEST_INSTANCE_SETUP_MODULES=all ./hellotest.sh up --stack local --build`. Local start/stop/status/log/reset wrappers share `local-run/lib/compose.sh`; each retains its command-specific behavior. [Full deployment inventory](../docs/architecture/deployment-script-review.md).
