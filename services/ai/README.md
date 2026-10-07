# @hellotest/ai

AI assistance, story/case/defect generation, assurance and impact-review interfaces.

### Authoring and recovery behavior

The AI workbench separates editable instructions from inspected evidence packs,
keeps model and batch settings behind disclosure, and shows elapsed generation
time without manufacturing pipeline stages or confidence percentages. Draft
checks verify local completeness; a reviewer still decides correctness and
coverage. On small screens Context and Checks open as overlays while draft steps
use a readable stacked layout. Stop is available when the owning workflow supplies
an AbortController. Stopping a browser wait does not promise provider cancellation.

AI case improvement preserves the bounded original Story and authored steps,
Gherkin and parameter values during both inbound HTTP 413 reduction and provider
context-size reduction. Optional evidence can be dropped with an explicit response
notice. Case-authoring instructions up to 18,000 characters are accepted intact;
larger context returns 422 instead of silently cutting an evidence pack.

Scheduled generation retries only explicit HTTP 429 rejection or local circuit/
capacity rejection before dispatch. Rate recovery sets the durable queue's
`next_run_at`; it does not hold a worker asleep. Truncated/invalid output,
credentials failures, and ambiguous network/timeouts fail the job for review.
Check the job and any saved pending-review drafts before manually submitting a
new generation after an ambiguous failure: the provider may already have completed
or charged that request. This policy avoids up to twenty automatic paid repeats
that the previous broad HTTP 502/504 classification could trigger.

Live provider speed and grounding depend on configured integrations and available
project knowledge. Structured artifact generation presents validated complete
proposals, not raw provider token streams.

- `frontend/`: screens, components, hooks and the owning API client. `entry.ts` exposes lazy release views.
- `backend/`: API routes, use cases and owning workers. `server.cjs` starts this profile through the shared runtime.
- `test/`: focused backend, frontend and browser checks where available.
- `package.json`: explicit npm exports/code dependencies and `hellotest` product prerequisites/feature ownership.
- `dist/ui/`: generated UI manifest and assets; never commit these files.

From the repository root:

```sh
npm run dev --workspace @hellotest/ai
npm run dev:api --workspace @hellotest/ai
npm test --workspace @hellotest/ai
npm run build --workspace @hellotest/ai
```

Run `npm run setup` first. Development uses the shared shell; the API requires configured foundation infrastructure. Cross-owner imports use declared `@hellotest/...` exports. This private workspace still depends on repository runtime adapters and the shared schema.

Read [CONTRIBUTING](../../CONTRIBUTING.md) for setup/debugging and [capability packaging](../../docs/architecture/capability-packaging.md) for selection, flags, permissions and release compatibility.
