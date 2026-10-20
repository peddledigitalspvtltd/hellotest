# @hellotest/trace

OPS telemetry, monitoring consoles, infrastructure health and trace correlation.

AI-call details in TestOps and agent activity provide separate Copy request and Copy response actions. They copy the displayed, sanitized capture and require the same content access as viewing it. Missing response bodies cannot be copied; clipboard failures keep the visible text available for manual selection.

- `frontend/`: screens, components, hooks and the owning API client. `entry.ts` exposes lazy release views.
- `backend/`: API routes, use cases and owning workers. `server.cjs` starts this profile through the shared runtime.
- `test/`: focused backend, frontend and browser checks where available.
- `package.json`: explicit npm exports/code dependencies and `hellotest` product prerequisites/feature ownership.
- `dist/ui/`: generated UI manifest and assets; never commit these files.

From the repository root:

```sh
npm run dev --workspace @hellotest/trace
npm run dev:api --workspace @hellotest/trace
npm test --workspace @hellotest/trace
npm run build --workspace @hellotest/trace
```

Run `npm run setup` first. Development uses the shared shell; the API requires configured foundation infrastructure. Cross-owner imports use declared `@hellotest/...` exports. This private workspace still depends on repository runtime adapters and the shared schema.

Read [CONTRIBUTING](../../CONTRIBUTING.md) for setup/debugging and [capability packaging](../../docs/architecture/capability-packaging.md) for selection, flags, permissions and release compatibility.
