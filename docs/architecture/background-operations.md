# Background operations

HelloTest keeps durable product records in PostgreSQL and executes long work through its existing workers. A saved authoring draft, a queued operation, a run snapshot and a final execution result are separate records.

| Work | Owning implementation | Receipt and outcome |
| --- | --- | --- |
| Sample-data installation | `services/platform/backend/services/instanceSetup.service.js` | `instance_setup_jobs`; ordered file checkpoints, inserted/existing counts and final audit |
| AI Test Case generation | `services/ai/backend/services/aiTestCaseGeneration.service.js` | Durable generation job; reviewable case drafts, bounded provider attempts |
| Automation building | `services/automation/backend/services/aiAutomationBuilder.service.js` | Workspace transaction and build receipt; saved code remains reviewable |
| Remote execution | `services/automation/backend/services/testEngineDispatch.service.js` | Execution jobs, leases and immutable run/case/step/data snapshots |
| Native execution | `testengine/backend` and `local-run/mobile-engine` | Compatible Android/iOS provider, run progress and verified terminal callback |
| Knowledge ingestion and refresh | `services/knowledge/backend/services` | Source revision, canonical index activation, retry/degradation and refresh progress |
| Project deletion | `services/platform/backend/services/projectDeletion.service.js` | Durable deletion/cleanup receipt; unrelated records and shared objects retained |

The model can propose a plan or executable artifact; it cannot approve its own changes. Product authorization precedes admission and is rechecked at the relevant write or retrieval boundary. An acknowledgement timeout is an unknown outcome: reconcile the original receipt before issuing another command.

Workers own bounded leases, retries and cancellation. Frontends follow persisted progress and retain the user's draft after failures. Browser disconnection does not imply a durable job was cancelled; use its explicit cancellation contract. For assistant requests, disconnect does abort the current read-only turn.

Use [the debugging runbook](../development/debugging.md) for request/trace/job IDs and worker diagnosis, [Automation workflow](automation-workflow.md) for execution behavior, and [sample-data setup](../development/sample-data.md) for installation semantics. No second queue or parallel permission implementation is introduced by these workflows.
