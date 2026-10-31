# LLM-guided Quality Agents

All five agents under `agentic-workflows?view=agents` now default to an LLM-guided review: Web Journey, Security Posture, Navigation Performance, Accessibility Review and Visual Regression. Each has its own versioned task, methods, evidence boundaries and public project references in [qualityAgentSkills.json](../../services/agentic/shared/qualityAgentSkills.json). The [skills guide](quality-agent-skills.md) records the sources and exact implementation boundaries.

## Execution and ownership

`execution_mode: "agent"` is the default. A blank goal receives the selected agent's concrete default goal. Unless a reviewed journey is supplied, the engine runs a bounded observation/action loop: the platform model selects one typed action against the observed page, the host validates it, the Test Engine performs it and returns the resulting observation and action receipt. Failed browser actions are visible to the next decision so the model can recover within the remaining action budget. A successful HTTP model request alone never establishes that an action executed.

All five engine scanners already support this mission loop. Previously only explicit browser missions used model decisions; the other agents could run checks without an LLM. They now use their own decision guidance and receive a final evidence-grounded LLM assessment after the engine finishes. `execution_mode: "checks"` explicitly selects scanner-only execution. The UI blocks agent mode when the connected engine does not advertise mission support, and does not silently substitute checks-only mode.

The implementation is a **host-managed observation/action loop**, identified by `agent_runtime.mode: "llm_observation_action_loop"`. It uses validated JSON decisions and a restricted browser action dispatcher, not an Anthropic SDK session or unrestricted provider tool execution. No provider or model ID is hardcoded from the pasted example; the saved project/node integration selects the model. Browser actions remain sequential because they share mutable page state.

The final report is separate from engine findings, measurements, screenshots and outcome. Its schema validates finding IDs, metric names, artifact IDs and supplied skill reference IDs. It cannot clear retained findings, invent an observed finding, or report a clean result when evidence was omitted. The report states its evidence omissions and limitations and remains a reviewable interpretation. References to ZAP, Lighthouse, k6, pixelmatch and other public projects are methodological guidance; the prompts forbid claiming those tools ran when the actual engine did not run them.

## Prompts, schemas and bounded calls

Versioned skills form stable SYSTEM instructions. Variable goals, retrieved material, page observations and tool receipts are untrusted data in the USER envelope. A correction includes the prior model candidate at ASSISTANT authority and validation feedback at USER authority. One bounded read-only correction is permitted for invalid JSON or a schema/evidence mismatch; refusal, truncation, network failure and an unknown provider outcome are not automatic regeneration paths.

Saved node instructions, context policies and execution limits remain authoritative. Custom final-output constraints apply to the final assessment, not intermediate action decisions; those use the host action contract. Obviously conflicting final schemas are rejected before model dispatch. Agent missions require enough configured model calls for at least one decision and one final assessment. The saved model-call limit is honored up to a code-owned cap of 26; reserved completion tokens are capped at 65,536. A saved zero-correction policy disables repair, and a configured execution timeout also bounds the whole agent run and each remaining model turn. Admissions are persisted immediately before each actual provider POST, including compatibility corrections. Actual provider usage is recorded when supplied. Knowledge retrieval retains its separate bounded retrieval policy and traces; its costs are not misreported as part of the mission-call counter.

Model dispatch identities are checkpointed before paid requests. A restarted worker encountering an unfinished dispatch records an unknown outcome and preserves existing evidence; it does not bill the same generation again. The worker renews its lease while a model is running, checks current project/application access before dispatch and aborts active model work on cancellation. The engine, each model turn and the overall job have bounded deadlines.

## Actual provider streaming

The shared [model transport](../../services/platform/backend/src/utils/llmHttpClient.js) requests streaming only for callers supplying live callbacks. [llmStreamingResponse.js](../../services/platform/backend/src/utils/llmStreamingResponse.js) incrementally decodes UTF-8 and buffers SSE lines across arbitrary network chunks, CRLF splits, comments and multiline data. It assembles a normal completion for the existing output validators and trace recorder.

Public content deltas are forwarded as they arrive. Hidden reasoning is not exposed. Tool argument fragments remain buffered; complete tool callbacks are admitted only after declared-tool/schema validation. A malformed or prematurely terminated stream is non-retryable after generation began. Finish reasons, refusals and output limits still apply. A provider that returns JSON remains usable without fabricated token events. An explicit pre-generation rejection of streaming can use one bounded buffered retry, with an endpoint/model capability cache to avoid repeated rejected probes.

This follows the transport and tool-completion principles in the official [OpenAI streaming guide](https://developers.openai.com/api/docs/guides/streaming-responses), [function-calling guide](https://developers.openai.com/api/docs/guides/function-calling) and [Claude streaming reference](https://platform.claude.com/docs/en/build-with-claude/streaming), while retaining HelloTest's configured OpenAI-compatible provider contract. It does not claim support for native Claude `pause_turn` sessions or a model name from the example.

## Durable progress and UI

`POST /agentic-quality/runs` returns the accepted run asynchronously. `GET /agentic-quality/runs/:id/events?after=N` accepts the same cursor through `Last-Event-ID`; conflicting or invalid cursors are rejected. Each durable `event: agent` contains `{id,seq,run_id,project_id,app_type_id,type,data,at}`. Types include model start/text/end, tool start/result, progress, error and done. Existing `event: progress` run snapshots and the final `event: complete` remain supported.

Events use the existing PostgreSQL workspace event table. A locked run row allocates monotonically increasing sequence IDs in the same transaction as the event insert. Terminal and cancellation state changes commit with their final events. The feed drains all retained pages before closing; refreshes, multiple tabs and replica changes can replay the same IDs. Every read rechecks project and application access. Disconnecting the browser closes the subscription without cancelling the durable job; cancellation uses the separate authenticated endpoint.

The browser parser handles arbitrary chunks, multiline frames and UTF-8 boundaries. It validates envelope identity, deduplicates cursors, resumes with bounded reconnects and falls back to authoritative status polling. The UI separates provisional model text, browser operation cards and the validated final report. Failed/cancelled runs retain partial activity and actionable error information. Desktop and mobile layouts preserve access to cancellation and evidence review.

The live transcript is bounded to 8,192 events and 512 KB of text per run, with control-event slots reserved for errors and final outcomes. A visible notice explains when the preview budget is reached. Coalescing avoids a database write per token. A fragment-aware redactor prevents credentials split across chunks from being reconstructed in the public event log. Event payloads reject oversized/deep data, strip credential fields and preserve protocol identity fields and ordinary whitespace.

SSE responses use `Cache-Control: private, no-store, no-transform`, `X-Accel-Buffering: no` and heartbeat comments while work is quiet. Existing gateway CORS permits `Last-Event-ID`; capability proxy locations disable buffering. Each feed rotates after three minutes and can reconnect by cursor. Production ingress/load-balancer timeouts must retain these streaming headers and idle semantics.

## Visual image evidence

Visual assessments can receive the actual current screenshot, approved baseline and optional diff through scope-checked artifact readers. Project/application identity, exact artifact IDs, SHA-256, MIME, byte counts, target, viewport and masks are verified. The model receives up to three unique PNG images, bounded by the shared encoded-image policy; identical pixels are sent once while retaining both evidence roles. External image URLs and provider-facing download credentials are not used.

When a selected model is configured without image support, required images exceed budget or screenshots are unavailable, a manifest-only mode forces explicit limitations. It cannot claim image-region inspection. The original artifacts and engine's measured diff remain independently reviewable; an incomplete current/baseline pair is never presented as a completed image comparison.

## Verification

- `npm run test:quality-agents`: streamed provider assembly, output validation, five-agent defaults/loop behavior, budgets, cancellation, schema repair, skills, image integrity, durable event replay and authorization.
- `npm run test:quality-agents:postgres`: a fresh local disposable PostgreSQL database verifies concurrent sequence allocation, cursor replay, rejected foreign scopes, atomic terminal rollback under an injected insert failure and cancellation guards. The runner refuses nonlocal databases and drops its temporary database.
- `npm --prefix testengine/backend run build` and `node --test testengine/backend/test/qualityAgents.test.mjs`: actual browser agents, retained artifacts and visual baselines.
- Frontend parser/default tests and the Quality Agent browser fixtures verify reconnect/deduplication, provisional markup safety, final results, all five default modes, unavailable-engine behavior and desktop/mobile layout.

These checks use fixture providers and local browser/database processes. They do not spend configured provider credits, prove live model quality or deploy the changes.
