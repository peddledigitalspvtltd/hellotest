# @hellotest/testing

Shared cases, suites, steps, test data, environments, runs, results, schedules and defects.

- `frontend/`: screens, components, hooks and the owning API client. `entry.ts` exposes lazy release views.
- `backend/`: API routes, use cases and owning workers. `server.cjs` starts this profile through the shared runtime.
- `test/`: focused backend, frontend and browser checks where available.
- `package.json`: explicit npm exports/code dependencies and `hellotest` product prerequisites/feature ownership.
- `dist/ui/`: generated UI manifest and assets; never commit these files.

From the repository root:

```sh
npm run dev --workspace @hellotest/testing
npm run dev:api --workspace @hellotest/testing
npm test --workspace @hellotest/testing
npm run build --workspace @hellotest/testing
```

Run `npm run setup` first. Development uses the shared shell; the API requires configured foundation infrastructure. Cross-owner imports use declared `@hellotest/...` exports. This private workspace still depends on repository runtime adapters and the shared schema.

Read [CONTRIBUTING](../../CONTRIBUTING.md) for setup/debugging and [capability packaging](../../docs/architecture/capability-packaging.md) for selection, flags, permissions and release compatibility.

## Bulk bug import

In Defects, **Bug template** and **Import Bugs** sit beside Export. Upload a CSV with Title and Description, review the normalized rows, and import up to 500 bugs / 4 MB. Optional fields cover reproduction, expected/actual results, status, severity, priority, environment/build, people, labels, Sprint/Release/Fix version, root causes, defect type, regression and an external defect key. This workflow creates bugs; it does not update existing records.

Reported by defaults to the authenticated creator. Explicit people must resolve uniquely within the project by name, email or ID; selecting others requires member-view access. Invalid fields, duplicate rows and ambiguous users block queueing. Background progress remains visible in the dialog, and Batch Process provides a JSON result report. Queue retries reuse the upload ID, and worker retries reuse stable row IDs so completed rows and later human edits remain intact.
