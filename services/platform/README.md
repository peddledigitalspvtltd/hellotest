# @hellotest/platform

Identity, projects, workspace administration, permissions and instance setup. Platform also owns the shared browser shell and API process runtime. There are no separate root frontend/backend source trees.

- `frontend/`: screens, components, hooks and the owning API client. `entry.ts` exposes lazy release views.
- `frontend/src/`: shared session, navigation, transport, UI primitives and capability loading. The adjacent `pages/` and `admin/` own Platform screens.
- `backend/src/`: shared process lifecycle, database/auth adapters and route composition.
- `backend/instance-setup-data/`: sample records; `schema-setup/` supplies bootstrap SQL independently of sample installation.
- `backend/`: API routes, use cases and owning workers. `server.cjs` starts this profile through the shared runtime.
- `test/`: focused backend, frontend and browser checks where available.
- `package.json`: explicit npm exports/code dependencies and `hellotest` product prerequisites/feature ownership.
- `dist/ui/`: generated UI manifest and assets; never commit these files.

From the repository root:

```sh
npm run dev --workspace @hellotest/platform
npm run dev:api --workspace @hellotest/platform
npm test --workspace @hellotest/platform
npm run build --workspace @hellotest/platform
```

Run `npm run setup` first. Development uses the shared shell; the API requires configured foundation infrastructure. Cross-owner imports use declared `@hellotest/...` exports. This private workspace still depends on repository runtime adapters and the shared schema.

Read [CONTRIBUTING](../../CONTRIBUTING.md) for setup/debugging and [capability packaging](../../docs/architecture/capability-packaging.md) for selection, flags, permissions and release compatibility.
