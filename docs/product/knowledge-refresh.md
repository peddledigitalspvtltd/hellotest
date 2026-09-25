# Incremental Knowledge Repo refresh

The Knowledge Repo opens with search, source health and compact metrics. **Refresh now** queues a project-wide scan of stories, test cases and defects. The adjacent settings icon enables an automatic interval in milliseconds (5,000–86,400,000; default 300,000). Both controls require `knowledge.manage`; readers see status without management actions.

The existing Knowledge worker performs one bounded batch of 30 records every five seconds. A database row lock with `SKIP LOCKED` serializes each project's refresh across replicas. A cursor persists progress through large projects and restarts safely. The worker waits while the project has queued or running ingestion work, so short intervals do not accumulate embedding jobs. `Refresh now` coalesces while a scan is active. Refresh is not tied to an open browser tab.

Before each batch, the worker reloads the refresh owner's current user, permission and feature state. Records outside that owner's source permissions are skipped. Revoked management permission or a disabled Knowledge capability blocks and disables the schedule. A failure records a safe error and retries after a one-minute backoff. The scan's counts distinguish checked, unchanged, queued and inaccessible records; queued records finish through the existing Processing activity pipeline.

Refresh compares the complete bounded application snapshot with the active document's fingerprint, including linked child content that may not update the parent timestamp. Unchanged records do not repeat extraction or embeddings. Changed/new records use the existing ingestion pipeline and its stable source identities, revision activation checks, redaction, ACLs, indexing and recovery. Archived sources stay archived. Deleted application records are not part of this scan; source archival remains an explicit source-lifecycle operation.

## Deployment

Run the normal database migration before starting the updated API profiles:

```sh
npm --prefix services/platform/backend run migrate
```

This adds `ai_knowledge_refresh` and advances the main-schema compatibility receipt to version 2. Existing ingestion/source tables and data remain intact. The Knowledge worker must be running for both manual and periodic scans. The combined API owns this worker in the default deployment; capability deployments load it through `services/knowledge/backend/workers.js`. No new service is introduced.

## Chatbot response flow

Ask HelloTest makes one intent-planning call, performs bounded permission-checked live and indexed retrieval (including additional rounds when needed), and passes the combined ContextPacket plus a compact retrieval summary to final synthesis. The intent-to-synthesis pause is 300 ms. Progress events are streamed using the existing SSE transport as actual stages complete; they are operational summaries, not private model reasoning.

The final model contract remains structured JSON with cited claims and optional supported presentations. Claims are ordered paragraphs of one response, not alternative answers to retrieval query variants. Authorization and citation validation still run before the answer is saved or displayed. If synthesis is unavailable, raw retrieved excerpts appear in a collapsed evidence section with an explicit model-failure message and the existing retry controls. They are not labelled as a completed model answer.

## Ownership and checks

- Backend coordinator: `services/knowledge/backend/services/knowledgeRefresh.service.js`
- Owned additive schema: `services/knowledge/backend/refreshSchema.js`
- Fingerprint reuse: `services/knowledge/backend/services/knowledgeRag.service.js`
- UI control: `services/knowledge/frontend/components/KnowledgeRefreshControl.tsx`
- Backend tests: `services/knowledge/test/backend/knowledgeRefresh.test.js`
- Browser checks: `services/knowledge/test/browser/knowledgeRefreshWorkspace.test.mjs`

Provider and server integration tests use controlled fixtures; deployment-specific credentials and provider availability require verification in the target environment.
