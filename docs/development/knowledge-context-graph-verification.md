# Knowledge and Context Graph verification

This guide records verification scope for the
[graph architecture](../architecture/knowledge-context-graphs.md). Test counts
and deployment observations must come from the final integrated checkout;
unexecuted checks are not passing evidence.

## Focused checks

```sh
node --test services/knowledge/test/backend/knowledgeContextGraph.test.js services/knowledge/test/backend/knowledgeGraph.test.js services/knowledge/test/backend/knowledgeGraphManagement.test.js services/knowledge/test/backend/knowledgeGraphManagementBoundary.test.js services/mcp/test/backend/mcpContextGraph.test.js
node --test services/knowledge/test/frontend/knowledgeGraphView.test.mjs
npm run test:mcp
npm run check:mcp
npm --prefix services/platform/frontend run check:types
git diff --check
```

Backend dependency fixtures check owner/project isolation, feature/account
revocation, exact reference selection, immutable replay, event identities,
readable versus denied fragments, live snapshot permissions and temporal labels.
They check code contracts; they do not independently establish PostgreSQL ACL
predicate behavior. MCP tests also exercise actual SDK discovery/calls with
controlled domain dependencies.

## Real persistence and authorization

```sh
npm run test:mcp:postgres
npm run test:knowledge:postgres
```

The runners create, migrate and drop disposable local databases. The Knowledge
runner also owns a temporary vector collection. Coordinate database runners
serially when local resource pressure affects PostgreSQL. Do not treat an
infrastructure interruption as a completed authorization check.

Before declaring the Context Graph ledger verified, the real database evidence
must cover:

- Two users in one project and another project, with owner-private list/explore
  responses, scoped cursors and fresh account/project/feature permissions.
- Persistence across service reads; identical packet/event replay returns the
  original receipt, while changed selection/event payloads reject without an
  additional record.
- A source with two fragments, followed by denial of only the selected fragment:
  its source relationship and evidence/document/chunk identifiers are omitted.
- Source/document/fragment ACL changes, native deletion, archive, version change
  and effective-time boundaries, with exact version/hash joins.
- Live snapshot collaborator permission revocation and missing/truncated
  declaration metadata; snapshots never assert current-content equality.
- An earlier occurrence and later recording timestamp, plus recording-time
  filtering, trace pagination and bounded event truncation.
- Optional capture timeout/cancellation preserving valid feature work and
  exposing a missing receipt without replaying a model or external action.

Existing PostgreSQL MCP coverage is not a substitute for new ledger assertions;
report which graph cases the final run actually exercised. Optional provider
fixtures remain separate from real database/HTTP evidence.

## Browser checks

Run a local Vite test server and then:

```sh
VITE_TEST_URL=http://127.0.0.1:5197 node --test services/knowledge/test/browser/knowledgeGraph.test.mjs
```

The browser test uses controlled API fixtures. Verify Knowledge/Context mode
switching, typed directed edges, map/list selection, search, expansion and source
inspection; aliases/candidate review must retain management permissions. Inspect
desktop and mobile screenshots, keyboard controls and non-color state labels.
Check that denied endpoints do not appear, live/guide nodes have no false source
drawer action, and stale/unknown/partial states remain readable.

Confirm occurrence versus recording labels and the retrieval-stage limitation in
the Context inspector. Graph layout, a stored response or a citation does not
prove model reasoning, final provider input, business correctness or exhaustive
coverage. Fixture screenshots do not verify a deployed image or a live model.

## Final run record

Local verification on 2 November 2026:

| Check | Result |
| --- | --- |
| Knowledge backend plus MCP Context Graph boundary | 142 passed; one optional standalone PostgreSQL test skipped |
| Complete MCP suite | 116 passed |
| Chatbot and specialist context regressions | 55 passed |
| Graph projection/layout unit checks | 5 passed |
| Graph frontend helpers and application contracts | 12 passed, including the five helper checks |
| Component-browser regression | Passed across desktop, narrow and dark states |
| Full frontend TypeScript check | Passed |
| Knowledge production capability build | Passed |
| Architecture tests | 35 passed |
| Real PostgreSQL MCP/native graph integration | Passed, including automatic assistant capture and replay |
| Knowledge Repository lifecycle and PostgreSQL/Qdrant consistency | 4 passed |
| MCP contracts, feature inventory and service boundaries | Passed; no unresolved route declarations |

The disposable MCP PostgreSQL run also exercises the real new ledger, HTTP
routes and authenticated SDK graph tools. It checks exact-fragment denial while
another fragment remains readable, owner isolation, immutable selections/events,
old versions, live native permission revocation, and separate event clocks.
It also renames a source while leaving its graph projection title unchanged,
then verifies current-title resolution, preserved aliases and Context inspection.
A real assistant evidence-search turn verifies automatic retrieval capture,
the post-persistence outcome hook and idempotent client-turn replay. It uses no
model provider and therefore does not claim live synthesis quality.

Browser checks use the production components/CSS with controlled API fixtures.
The screenshots were inspected and retained:
[Knowledge Graph](screenshots/graphs/knowledge-graph-desktop.png) and
[Context Graph](screenshots/graphs/context-graph-desktop.png). Coverage includes
map/list, selection, exact source proof, alias/review actions, task/feature/date
filters, occurrence/recording labels, empty/revoked states, dark mode and narrow
viewports. Enter/Space select nodes and edges into the inspector, and Escape
clears the controlled selection. Fixture images establish presentation behavior rather than a
signed-in end-to-end deployment result.

These changes are workspace source and local build verification. The new ledger
schema was migrated in disposable databases; running API/frontend images and
the installation database were not deployed or upgraded by this verification.
