# @hellotest/manual

Product planning, stories, backlog, sprints, releases and work-item relationships.

AI Story creation and completion retain original prompt images and files as attachments when reviewed drafts are accepted. Only accepted Stories receive them; cancelling uploads nothing. A partial upload keeps a retry action tied to the saved Story, and verified checksums prevent duplicate attachments when a response is lost. Attachment permissions and storage limits apply before acceptance. Preview image compression does not replace the original file.

- `frontend/`: screens, components, hooks and the owning API client. `entry.ts` exposes lazy release views.
- `backend/`: API routes, use cases and owning workers. `server.cjs` starts this profile through the shared runtime.
- `test/`: focused backend, frontend and browser checks where available.
- `package.json`: explicit npm exports/code dependencies and `hellotest` product prerequisites/feature ownership.
- `dist/ui/`: generated UI manifest and assets; never commit these files.

From the repository root:

```sh
npm run dev --workspace @hellotest/manual
npm run dev:api --workspace @hellotest/manual
npm test --workspace @hellotest/manual
npm run build --workspace @hellotest/manual
```

Run `npm run setup` first. Development uses the shared shell; the API requires configured foundation infrastructure. Cross-owner imports use declared `@hellotest/...` exports. This private workspace still depends on repository runtime adapters and the shared schema.

Read [CONTRIBUTING](../../CONTRIBUTING.md) for setup/debugging and [capability packaging](../../docs/architecture/capability-packaging.md) for selection, flags, permissions and release compatibility.
