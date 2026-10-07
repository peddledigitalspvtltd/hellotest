# @hellotest/chatbot

Ask HelloTest, conversation planning, retrieval orchestration, progress and cited answers.

- `frontend/`: screens, components, hooks and the owning API client. `entry.ts` exposes lazy release views.
- `backend/`: API routes, use cases and owning workers. `server.cjs` starts this profile through the shared runtime.
- `test/`: focused backend, frontend and browser checks where available.
- `package.json`: explicit npm exports/code dependencies and `hellotest` product prerequisites/feature ownership.
- `dist/ui/`: generated UI manifest and assets; never commit these files.

From the repository root:

```sh
npm run dev --workspace @hellotest/chatbot
npm run dev:api --workspace @hellotest/chatbot
npm test --workspace @hellotest/chatbot
npm run build --workspace @hellotest/chatbot
```

Run `npm run setup` first. Development uses the shared shell; the API requires configured foundation infrastructure. Cross-owner imports use declared `@hellotest/...` exports. This private workspace still depends on repository runtime adapters and the shared schema.

Read [CONTRIBUTING](../../CONTRIBUTING.md) for setup/debugging and [capability packaging](../../docs/architecture/capability-packaging.md) for selection, flags, permissions and release compatibility.

### Answer delivery

The authenticated POST stream reports `RetrievalEvent` progress while the service searches, generates and validates its structured answer. After source access is rechecked and the answer is persisted, it immediately sends `answer_delta` events using `AnswerDelta` version `1.0`, followed by the authoritative `result`. This is validated-answer streaming, not raw provider token streaming. There are no playback delays. The browser checks the answer ID, contiguous sequence and exact final text; partial delivery never completes a turn. Older servers that return only progress and result remain compatible.

Stop cancels the connection and active work. Retry and pending checks retain the original `client_turn_id`, source filters, reviewed context and model. If delivery was interrupted after persistence, the same-turn retry retrieves and reauthorizes the saved answer. A draft can be written during generation; it is never submitted automatically. Scrolling to earlier evidence suspends automatic scrolling until Latest answer is selected.
