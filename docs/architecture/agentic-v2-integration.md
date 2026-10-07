# Agentic V2 integration

The supplied `QAIra-agentic-v2.zip` was merged into the existing application on 7 October 2026. Its original-file SHA-256 values match commit `a42390d0`, which was used as the three-way merge base. The archive manifest declares 150 modifications and 132 additions, with no deletions. The integration applies 278 of those files, including historical documentation assets, and preserves four sign-in-related files exactly as they existed at the start of the merge.

[The application ledger](agentic-v2-integration.json) records the archive hash, applied paths, resolved overlaps and unchanged sign-in hashes. Archive release guides remain historical reference material; their sign-in screenshots do not describe a change applied to this application.

## Retained behavior

- The current sign-in page, its stylesheet and carousel remain unchanged. The new product design layer excludes `.auth-page`, retaining the existing sign-in palette and controls.
- HelloTest remains the built-in authenticated MCP server under Agent Studio. External server configuration, project credentials, revoked access, permission and application isolation, read-only database projections, context provenance, immutable reviewed plans and durable receipts remain available.
- Smart Context, Ask Chatbot and scoped AI calls retain the MCP boundary, preserved authorization metadata, exact-citation validation, bounded regeneration and actionable model errors.
- Credentials remains the HTTP-only integration category. MCP configuration stays under Agent Studio.
- Automation retains section/precondition ordering, section and instruction overlays, execution context, draft preservation, AI build context, and local/remote Test Engine handoff. V2 adds lifecycle navigation, persisted-plan readiness, build evidence, plan-change detection and recovery of the same saved execution.

## Architecture and performance corrections

Knowledge catalog requests are separated into `useKnowledgeCatalog`, with cancellable transport, permission-sensitive source cache keys, active-job-only polling and source/collection invalidation when processing state changes. Hidden notes no longer load their full document bodies until opened. Existing loading, retry, read-only, source/revision and collection flows remain available. Browser verification asserts that initial source browsing makes zero note-body requests and that opening notes makes one.

MCP discovery now checks each distinct permission once per request and filters search candidates before those checks. Decisions are never cached across calls, so revocation remains immediate. Tests verify both reduced duplicate queries and a changed decision on the next request.

MCP internals have descriptive filenames (`mcpServer.js`, `mcpSchema.js`) without changing the public `@hellotest/platform/backend/src/mcp/server` import. This resolves strict source-layout naming collisions without weakening the audit.

Automation reuses the existing execution handoff adapter. The backend owns initial dispatch, so creation is followed by a scoped read of execution state rather than another start request. Known queued runs can be resumed explicitly using the same ID; missing/foreign/failed receipts require evidence review. The local engine endpoint is resolved by the existing configured backend rather than hard-coded to the API container's localhost. Readiness, transport recovery and rendering remain separate components/helpers.

The expanded desktop sidebar uses 280px, 14px primary navigation text, 13px submenu text and larger row targets. Collapsed navigation and mobile drawers retain their separate layouts. A browser check verifies expanded width, text size, keyboard behavior and mobile overflow.

The context-property menu focuses the requested section immediately rather than relying on a frame-dependent focus race. Automation header actions share one flex layout, avoiding the archive's negative-margin launcher overlapping the retained title and context control.

## Verification and rollout

Validation includes workspace backend/frontend tests, actual Chromium product fixtures, real local browser quality-engine tests, isolated PostgreSQL MCP integration, main/admin frontend and Test Engine builds, package boundaries, metadata, source-layout/module audits, and Compose configuration. Browser fixtures use controlled API responses; they do not certify a live external application or LLM provider. No production throughput benchmark is claimed.

The local running images must be rebuilt to load the merged API, UI and Test Engine changes together:

```sh
TESTENGINE_WEB_REPLICAS=1 ./hellotest.sh up --build --stack local --no-cache
```

The archive's dedicated quality worker and persistent evidence volume are included in Compose. Configure the existing project Test Engine integration and allowed targets before launching quality runs. Application data was not replaced with the archive's sample records; those files remain instance-setup fixtures.
