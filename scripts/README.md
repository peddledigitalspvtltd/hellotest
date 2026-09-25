# Repository commands

Run commands from the repository root. `hellotest.sh` remains the stable product-stack entry point and `start-testengine-ops.sh` the execution-plane entry point. Subcommands delegate to the implementations below; there is no second deployment implementation in an old `deploymentscripts` directory.

| Directory / command | Responsibility |
| --- | --- |
| `deploy/aws/deploy-app.sh` | EC2 app deployment, private internal binds, post-deploy readiness |
| `deploy/aws/deploy-testengine.sh` | EC2 worker deployment and explicit API/public engine connection |
| `deploy/aws/status.sh`, `logs.sh` | Inspect an EC2 host; `--help` is read-only |
| `deploy/aws/aws-runtime.sh` | Sourced AWS/container/readiness helpers, not an entry point |
| `deploy/provider-stack.sh` | Generate/run the provider-separated Compose or Kubernetes topology; this is infrastructure isolation, not customer capability selection |
| `ops/stack.mjs` | Prepare monitoring credentials and start/status/stop the optional monitoring stack |
| `ops/verify.mjs` | Check a running monitoring stack and application integration; uses synthetic verification activity |
| `ops/resolve-testengine-config.mjs` | Resolve engine monitoring configuration from its supplied input |
| `checks/audit-source-layout.mjs` | Repository ownership, names, duplicates, documentation and tracked-artifact checks |
| `checks/check-service-boundaries.mjs` | Enforce declared npm dependencies/exports and prevent backend imports of frontend source |
| `checks/sync-capability-metadata.mjs` | Generate/check runtime capability metadata from package ownership declarations |
| `checks/test-workspace.mjs` | Discover shared and capability-owned unit tests for one runtime |
| `checks/test-capability.mjs` | Run focused capability tests plus central contracts naming that owner |
| `build/capability-ui.mjs` | Build a selected UI release with shared host providers and hashed assets |
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
npm test
npm run build
sh scripts/checks/validate-deployment-contracts.sh
npm run test:service-gateway
npm run ops:status
scripts/deploy/aws/deploy-app.sh --help
scripts/deploy/aws/deploy-testengine.sh --help
```

The root package commands are the stable developer interface. Direct script callers should use the paths above. AWS deployment names now state the action first; `common.sh`, `host-isolated-services.sh`, and `demo-api.sh` were replaced by scoped names that explain their purpose. Docker/Compose detection in the services/platform/frontend/backend start wrappers now delegates to `lib/docker.sh`; unused AWS helper functions were removed. Independent validators were retained because static ownership checks, rendered deployment checks and live gateway checks verify different contracts.

Vite configuration is authored only in TypeScript. The config type-check uses `noEmit`; generated `vite*.js` and declaration copies were removed so development cannot accidentally load a stale duplicate configuration.

`deploy/capabilities.mjs` powers `npm run services:up -- --capabilities automation --build`. Use `--print` to inspect the validated dependency closure and Docker command. It starts the selected capability set; it never removes an older deployment or its volumes. Selection is enforced in routes, workers, and feature availability. See [CONTRIBUTING](../CONTRIBUTING.md#11-select-customer-capabilities-and-debug-boundaries).

The legacy unauthenticated demo-record shell walkthrough was removed. Use Administration → Instance setup, or `HELLOTEST_INSTANCE_SETUP_MODULES=all ./hellotest.sh up --stack local --build`. Local start/stop/status/log/reset wrappers share `local-run/lib/compose.sh`; each retains its command-specific behavior. [Full deployment inventory](../docs/architecture/deployment-script-review.md).
