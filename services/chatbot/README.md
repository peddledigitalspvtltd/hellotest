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

The authenticated POST stream reports `RetrievalEvent` progress while the service searches, generates and validates its structured answer. After source access is rechecked and the answer is persisted, it sends one authoritative `result` containing the complete answer, citations and evidence contract. The browser displays that response at once. Progress remains visible while the answer is prepared. Older servers that emit verified `AnswerDelta` frames remain compatible: the consumer validates their ordering and exact final text, while the UI waits for the terminal result.

Stop cancels the connection and active work. Retry and pending checks retain the original `client_turn_id`, source filters, reviewed context and model. If delivery was interrupted after persistence, the same-turn retry retrieves and reauthorizes the saved answer. A draft can be written during generation; it is never submitted automatically. Scrolling to earlier evidence suspends automatic scrolling until Latest answer is selected.

Recovery checks remain attached for up to 150 seconds, with a bounded number of requests, so a running two-minute turn can finish. Both JSON and streaming message routes propagate client disconnects to retrieval and synthesis. The public MCP context contract accepts the chatbot's complete 8,000-character question.

Smart Context narrows explicit source IDs and source kinds. Disjoint selections return an actionable validation error; they never broaden the evidence scope. Collection, application, historical-date and evidence filters remain in force, and retrieved source permissions are rechecked before an answer is shown.

Product usage questions retrieve versioned product documentation and display a **Product guide** with prerequisites, navigation, ordered steps, expected results and documented limitations. Possessives or navigation to failed records do not by themselves trigger project analysis. Current project facts, summaries, insights and mixed questions retrieve authorized current records and supporting Knowledge evidence through the same MCP context backplane. A model retrieval plan cannot expand a pure usage question into native project reads or override explicit source selections.

The host's optional intent model proposes evidence needs before calling the
typed `hellotest_context_build` tool. Planning, actual retrieval operations and
answer calls share the turn's original tool-call budget; small budgets preserve
retrieval and synthesis by skipping optional model planning. The MCP server
enforces project/source scope and assembles the permitted evidence rather than
starting another unbounded model loop.

**How this answer was built** shows the observed planner mode, MCP delivery,
retained evidence and document-version counts, witnessed Knowledge links and
the recorded task context. Its Context Graph link opens the exact retained
trace under current authorization. The assistant's persisted outcome receipt
survives history reload and same-turn replay; a concurrent losing turn cannot
attach its packet to a different saved reply. Recording an answer does not
approve a proposed action or establish that automation executed successfully.
Relationship presentations require exact directed, typed packet witnesses and
canonical endpoints, in addition to visible citations.
