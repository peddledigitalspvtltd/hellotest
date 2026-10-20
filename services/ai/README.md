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
context-size reduction. Optional text evidence can be dropped with an explicit response
notice. Requests containing screenshots do not use text-only size recovery, because
that would invalidate image citations. Case-authoring instructions up to 18,000 characters are accepted intact;
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

### Artifact and screenshot contracts

The shared model boundary validates the native artifact fields before feature-specific
grounding and domain validation. One format-only correction can run within the original
deadline, preserving the original evidence and images. Missing facts remain explicit
questions or field gaps; the application does not invent prose to satisfy a required field.

| Feature | Required model output |
| --- | --- |
| Story creation/completion | Title, description, acceptance criteria, priority 1–5; missing acceptance evidence needs an explicit open question. |
| Test Case generation/improvement | Title, description, priority, configured active type, parameter declarations and ordered actions with expected results, or the requested complete Gherkin. |
| Defect creation/improvement | Title, description (`message`), reproduction, expected/actual results, severity and canonical priority; unsupported factual fields remain empty with named gaps. |
| Defect triage | Supplied Defect IDs, permitted category, explanation and exact field citations. Priority and readiness remain host-owned. |
| Smart Run | Supplied Test Case IDs, concise reasons and allowed citations. Risk ranking, eligibility and acceptance remain host-owned. |

All seven authoring/review paths accept explicit reference screenshots. Defect Improve,
triage and Smart Run forward them through their actual API/model path. Saved attachments
are not fetched implicitly. The frontend prepares one raster at a time, bounds its
long edge to 1,280 pixels and adapts JPEG quality within the existing aggregate budget.
The API verifies canonical base64, PNG/JPEG/WebP headers and dimensions before dispatch;
deduplication precedes evidence-catalog construction. Original binary content is omitted
from LLM traces. Unsupported vision models fail explicitly instead of substituting
text-only generation. Smart Run requires a model when screenshots are selected.

AI Controls shows the native required fields separately from optional custom JSON
Schema constraints. Each supported feature exposes an image-count/encoded-size limit
and low/automatic/high image detail. Low detail is the token-conscious default; high
detail can help small screenshot text at greater provider cost. Provider image-token
accounting remains authoritative. Explicit integration `config.supports_vision: false`
blocks image dispatch without guessing capability from a model name.

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
