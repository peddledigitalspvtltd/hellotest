# Agentic model request audit

This audit follows the actual agent and workflow callers into the shared model boundary. Measurements below are serialized UTF-8 request bytes, not provider tokens, costs or model-quality scores. The native output validators, source permissions and saved node/agent configuration remain authoritative.

## Model-call paths and intentional stages

| Entry point | Model work | Input and authority | Bounds and retained stages |
| --- | --- | --- | --- |
| `agenticAssistant.requestLlmResult` | Specialist review/authoring, including saved agents, custom AI and workflow AI loops | Trusted native response schema and enabled skills; node/agent-owned primary instructions; USER task, cited context and labelled supplied input | One logical-step ledger counts each actual provider POST, including internal corrections. Existing revision, compatibility, context-size and follow-up limits remain within that ledger and deadline. |
| `agenticWorkflowExecution.executeNodeTask` | Calls the specialist adapter for an AI node or each explicit AI-loop item | Saved node snapshot owns task, instructions, guardrails and skills. Connected request/input have their own structured USER evidence field and provenance. | Each logical AI review shares its configured ledger across corrections and retries. Explicit item loops remain separate reviews under the bounded iteration count. HTTP/model failures do not invent a successful review. |
| `artifactTasks.execute` | Story assurance → Story-based Test Case generation → case assurance → automation generation | Current authorized Story and pinned revision, native draft lineage, selected node guidance, explicit upstream-review provenance | These are separate product stages with different native contracts. Stage/item iteration is intentional. Native builders retain their existing local phase/action/repair limits; no small generic budget is imposed across an entire Sprint. |
| `repositoryAgents.performRun` | Deterministic extraction, then source-backed review batches | Project-bound source revision/compiler cache, findings with file/line witnesses, labelled prior review summaries | Extraction may reuse its cache; nonempty findings receive a fresh review. All batches share one configured run call ledger, including repairs. Remaining findings stay visible and explicitly unreviewed when a limit is reached. |
| `qualityAgentPlanner.proposePlan` | Optional proposal for a web goal | USER `task_brief`, reviewed context and authorized same-origin locator metadata | No planning model runs when explicit reviewed steps are supplied or an autonomous observation mission is selected. A host-rejected proposal can receive one concrete correction before execution. |
| `browserMissionPlanner.decideMission` | One decision for a current browser observation | USER task brief, current observed element IDs/text, bounded prior observations and actual action receipts | One local correction can repair an invalid decision before dispatch. Browser phases/actions retain their native bounds. Saved decisions are reused for the same sequence when polling resumes; transport failure does not blindly replay provider work. |

Native task guidance continues to come from the saved node. Standalone feature guidance follows its own published feature configuration. Moving input data or removing a duplicate copy does not turn prior model analysis into current product evidence.

## Implemented corrections

Workflow specialists previously repeated configured instructions, skills and guardrails inside the USER task text, alongside the managed configuration frame. They also repeated slices of the workflow request and connected input in that text and in a separate input evidence record. The task string now stays concise for routing and the requested objective; each configured instruction and structured input has one canonical location. Upstream model reviews retain an explicit untrusted-analysis provenance label.

The previous input path sliced serialized workflow JSON at 16,000 characters and then compacted its evidence to 5,000 characters. This could discard later subjects or send incomplete JSON. Supplied workflow/task input is now sanitized as a complete document, limited to 32,000 UTF-8 bytes subject to stricter native input contracts, and kept intact before broad search excerpts. Exceeding the bound stops before the model request with guidance to split the input or use an item loop. Provider context-size correction also preserves this complete input and its citation; it can reduce optional retrieval instead. If the remaining required input cannot shrink, the same oversized request is not replayed. Existing secret redaction remains visible in the evidence metadata.

Native generation and case-assurance calls previously carried the same Story content both in their native `requirements`/`linkedEvidence` and in additional workflow context. The canonical native projections were cross-checked before removing that duplicate: single-Story generation retains up to eight criteria/custom-field items, and assurance uses the same Story snapshot as the former context copy. Workflow context still carries exact Story references/revisions, scope, supplied context, upstream findings and provenance. Automation retains the complete Story snapshot because its native draft call has no separate Story input. Its node instructions/guardrails are no longer repeated inside USER context when the managed node scope already owns them.

Browser planning and mission packets retain the full objective in `task_brief.goal`; planning also keeps the target URL in `task_brief.target_url`. The duplicate top-level copies were removed. Current observations, actionable controls, reviewed context, same-origin enforcement and typed outcome validation remain intact.

Empty repository extraction previously created an empty review batch and requested a model assessment without source findings. It now reports a skipped model stage and a partial, deterministic extraction result with explicit coverage limitations. It makes no model call and does not claim that relevant source behavior is absent. Cached model-review metadata is removed before every fresh review decision. Nonempty source batches now share a run ledger, so configured call limits no longer reset per batch.

The repository run summary reports the shared ledger's actual call total. A batch review's existing `model_execution.model_calls` can reflect the cumulative shared ledger at that point; do not sum those cumulative values across reviews. Use the run summary or actual dispatch traces. Usage receipts remain local to their actual provider calls.

The specialist ledger previously counted outer HTTP-helper calls. A helper could issue additional provider POSTs for native schema correction while the agent still reported one call. Budget, cancellation, current run access, evidence freshness and deadline checks now run at the actual dispatch hook. Each real POST receives a separate usage/status receipt from provider-dispatch trace metadata. A blocked preflight is not counted as a dispatched request; missing usage remains unknown rather than being replaced by an estimate.

## Request-size evidence

A deterministic fixture used the same native response schema, eight workflow items, eight connected subjects and configured guidance. Both variants ran through the current specialist request builder; the before variant used the prior `specialistPrompt` implementation and the after variant used the canonical input layout.

| Measurement | Before | After |
| --- | ---: | ---: |
| Serialized request UTF-8 bytes | 14,355 | 10,634 |
| Provider calls for one successful review | 1 | 1 |
| Complete connected subjects delivered | 8 | 8 |

This fixture removes 3,721 request bytes (25.9%) without dropping its task subjects or native schema. It is a caller-specific byte measurement, not a prediction for other prompts, a provider tokenizer result or a measured quality improvement. Larger exact inputs can appropriately produce larger requests than the old silently truncated path.

## Verification

Focused regressions cover complete valid workflow JSON above the former truncation threshold, final-subject retention, UTF-8 limits, source ACL revocation before corrections, preservation through context-size fallback, actual hidden dispatch accounting, one-call blocking, usage aggregation, node ownership, native Story provenance, shared repository batch limits, empty-source behavior, enabled/disabled skills, workflow loops, replay boundaries and browser outcome validation.

```sh
node --test --test-force-exit services/agentic/test/backend/agentContextFallback.test.js services/agentic/test/backend/specialistChain.test.js services/agentic/test/backend/nodeAiConfiguration.test.js
node --test --test-force-exit services/platform/backend/test/agentWorkflowExecution.test.js services/platform/backend/test/agentWorkspaceReliability.test.js services/platform/backend/test/nativeArtifactTasks.test.js services/platform/backend/test/repositoryAgentLifecycle.test.js
node --test --test-force-exit services/agentic/test/backend/browserMissionPlanner.test.js services/agentic/test/backend/qualityAgentPlanner.test.js services/agentic/test/backend/qualityMissionContext.test.js
```

These tests use controlled model/transport fixtures and real caller logic. They verify request construction, limits and native contract handling, not a live provider's answer quality. The shared request boundary and non-agentic application callers have separate audit and verification coverage.
