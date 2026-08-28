# Archived: HelloTest Execution Engine Prototype

This package is retained only as historical source and is not a supported,
deployable, or releasable HelloTest execution plane.

The sole supported implementation is [`testengine/backend`](../../testengine/backend),
with deployment definitions under [`testengine/`](../../testengine). New runtime,
security, worker, runner, health, observability, packaging, and deployment work
must be implemented there.

## Archive rules

- Do not build or publish a container image from this package.
- Do not add Kubernetes, Compose, Helm, Terraform, or release definitions here.
- Do not restore `start` or `dev` package scripts.
- Keep the TypeScript source only for historical comparison or bounded code
  archaeology.
- `npm run build` is allowed solely to verify that the archived source still
  compiles. It deletes `dist` first and emits one canonical tree directly under
  `dist`; `dist/src` is never valid.
- `npm test` is a maintenance check, not a production qualification signal.

The former Job and KEDA ScaledJob manifests were removed because they referenced
an unsupported image and a queue/dependency contract that is not part of the
current HelloTest platform.
