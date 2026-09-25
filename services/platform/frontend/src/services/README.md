# Frontend service composition

This directory holds the endpoint registry (`index.ts`) and its shared types (`shared.ts`). It is part of the application shell, not a second home for feature implementations.

Each capability owns its pages, components, hooks, helpers and endpoint definition under `services/<capability>/frontend` at the repository root. The registry imports endpoint definitions only; do not eagerly export UI pages here.

See the [service catalog](../../../../README.md) and [contributor guide](../../../../../CONTRIBUTING.md) for ownership and build instructions.
