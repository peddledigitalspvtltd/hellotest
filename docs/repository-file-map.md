# Repository-wide file map

The repository-wide scan separates files by the system that owns them. A single flat folder would make deployment and local operation harder because the same file type is used by different systems.

## Documentation

Product, architecture, operations, research, and migration documents live under `docs/`. `README.md` and `CONTRIBUTING.md` remain at the repository root because Git hosting, package tooling, and new contributors use it as the entry point. A package-local `README.md` stays beside the package it documents: for example, `testengine/README.md`, `services/platform/backend/eval/knowledge/README.md`, and `services/platform/frontend/test/browser/README.md`. These are discoverability and release contracts, not scattered product documentation.

The product capability inventory is [`docs/product-coverage.csv`](product-coverage.csv), grouped with the product documents instead of being left as an ambiguous root-level export.

## YAML and Compose files

- Root `docker-compose.*.yml` files are operator entry points for complete platform stacks and the service-profile stack.
- `services/platform/backend/docker-compose.yml` owns the API and database development stack.
- `testengine/docker-compose*.yml` and `testengine/k8s/testengine-workers.yaml` belong to the execution plane and must deploy independently of the product API.
- `ops/**/*.yml` and `ops/**/*.yaml` are observability configuration consumed by Prometheus, Grafana, Loki, Jaeger, Alertmanager, HAProxy, and the OpenTelemetry Collector. They are grouped with those runtimes so an operator can change one subsystem without searching a generic configuration directory.
- `openapi.yaml` and `redocly.yaml` are API contract files and remain at the root for tooling convention and stable external links.

Moving all YAML into one folder would break relative mounts and make ownership unclear. The directory is part of each deployment contract; the architecture validator and `docker compose ... config` check those paths.

## Shell and command files

- `hellotest.sh` is the root operator entry point.
- `scripts/deploy/aws/` contains AWS deployment and status commands that share `aws-runtime.sh`.
- `local-run/bin/` contains local recorder, mobile, autoscaling, and lifecycle commands.
- `scripts/` contains repository validation and developer automation.
- `services/platform/backend/start.sh`, `services/platform/frontend/start.sh`, and `services/platform/frontend/docker-entrypoint.sh` are image-local startup contracts and must remain beside their Dockerfiles.
- `start-testengine-ops.sh` is the execution-plane operator entry point.

The scripts are separated by runtime ownership and environment. They are not interchangeable utilities, so flattening them would increase the chance of deploying a local-only command in production.

## Cleanup and quarantine decisions

- Removed the empty tracked file `Linked`.
- Removed the unreferenced top-level `replace_ag.js`, `replace_bp.js`, `replace_te.js`, and `replace_wt.js`. Each was a one-off source-rewriting migration helper with no caller, package script, or documentation reference.
- Retired the unauthenticated API demo script in favor of the validated instance dataset. The product inventory lives in `docs/product-coverage.csv`; root-level files remain operator entry points and repository contracts.
- Removed tracked local databases, recorder artifacts, autoscaler logs/PIDs, and environment files. They are ignored now and recreated locally from examples or service startup.
- Removed tracked dependency and generated output trees. `node_modules`, `dist`, `coverage`, `.cache`, TypeScript build info, local artifacts, and local environment files are excluded by `.gitignore`.
- The scan found no unreviewed exact-content duplicate source or repository files. Five duplicate groups are intentional: Python package marker files, the backend/docs copies of the portable feature fixture, and two approved research captures linked from separate narratives. The five repeated basenames are also intentional process, catalog, bootstrap, client, and bundler entry points; their paths and reasons are recorded by `npm run audit:source-layout -- --strict`.

## Review command

Run this before adding, moving, or deleting files:

```bash
npm run audit:source-layout
git ls-files | rg '(^|/)node_modules/|(^|/)(dist|coverage|\.cache)/|\.tsbuildinfo$'
```

The second command must return no output. The audit reports the complete repository file count, category totals (source, documentation, deployment, shell, data, runtime configuration, containers, and assets), files without extensions, API route ownership, exact duplicates, documentation placement, and intentionally repeated basenames. Large local binaries remain counted but are skipped from hashing.

Feature implementations are now colocated under backend/frontend service roots. See [the contributor guide](../CONTRIBUTING.md) and [the updated source audit](source-layout-audit.md) for the source tree, orphan decisions and dependency-graph checks.
