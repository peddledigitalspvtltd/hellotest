# @hellotest/agentic

Agent workflows, repository inspection, specialist agents and their runtime assets.

The [Agentic Studio guide](../../docs/product/agentic-studio.md) covers the editor, source templates, node execution, saved results and runtime boundaries. Workflow UI components live together in `frontend/workflows/`.

The [Quality Agents guide](../../docs/product/quality-agents.md) describes the five executable browser presets, reviewed journeys, durable run history, permissions and visual baseline approval. These checks use the project's active Test Engine connection; an LLM can propose a bounded journey but does not produce execution evidence.

- `frontend/`: screens, components, hooks and the owning API client. `entry.ts` exposes lazy release views.
- `backend/`: API routes, use cases and owning workers. `server.cjs` starts this profile through the shared runtime.
- `test/`: focused backend, frontend and browser checks where available.
- `package.json`: explicit npm exports/code dependencies and `hellotest` product prerequisites/feature ownership.
- `dist/ui/`: generated UI manifest and assets; never commit these files.

From the repository root:

```sh
npm run dev --workspace @hellotest/agentic
npm run dev:api --workspace @hellotest/agentic
npm test --workspace @hellotest/agentic
npm run build --workspace @hellotest/agentic
```

Run `npm run setup` first. Development uses the shared shell; the API requires configured foundation infrastructure. Cross-owner imports use declared `@hellotest/...` exports. This private workspace still depends on repository runtime adapters and the shared schema.

Read [CONTRIBUTING](../../CONTRIBUTING.md) for setup/debugging and [capability packaging](../../docs/architecture/capability-packaging.md) for selection, flags, permissions and release compatibility.

### Reviewed specialist outcomes

Specialists keep their intent-specific brief, findings and original evidence when
handing work to applicable Story, Test Case and Defect authors. Next items displays
editable native proposals; explicit acceptance saves them through the native
domain routes. The project, proposal kind and existing Story identity/revision
come from the recorded review. Current access is checked again on acceptance.
Native writes and a durable proposal receipt share a transaction, so repeated or
concurrent accepts do not create duplicates. Decline does not save a domain record.

Model calls sit alongside Next items. Recorded activity events link to their own
request/response capture, including correction and compatibility attempts.
Browser mission model calls are scoped to the mission transaction. The AI calls
catalog opens its selected call in a right-side dialog with focus containment and
Escape/close behavior. Capture content retains the existing administrator access
restriction and redaction policy. Copy/download tools sit in Next items; the
separate brief-editing footer is removed.
