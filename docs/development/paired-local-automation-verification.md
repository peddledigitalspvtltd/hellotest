# Paired local automation verification

## Verified deployment state

The local API and frontend were rebuilt and refreshed. Both report healthy;
20 deployed backend/runtime source hashes match this workspace, and the primary
database has schema version 14 and all three paired transport tables. The local
frontend serves `index-CkY8LuKW.js`. The original browser token still authenticates
the upgraded agent, all 34 installed native modules match the packaged runtime,
and its exact-origin/private-network browser preflight succeeds. The saved
Sprint Automator JSON-mode regression also passes with zero provider calls.

The hosted `https://app.hellotest.ai` instance still serves the older
`index-DYvQUz74.js` and returns 404 for the new local-dispatch control route;
the updated local instance returns the expected scoped-grant 401. Hosted rollout
is pending a deployment host or CI connection. No SSH or cloud deployment
connection is configured in this workspace. Refreshing a browser alone cannot
update that hosted API. Deploy the updated API/frontend and apply migration 14
using the host's existing deployment configuration.

The paired agent previously supported inspection and recording only. Run local
still asked the API to reach a host runner on a laptop, so browser pairing did
not establish execution connectivity. The paired execution path now claims
immutable native plans over outbound HTTP(S). The API never probes laptop
localhost for this path.

## Covered behavior

| Flow | Local | Remote |
| --- | --- | --- |
| Record and playback | Browser talks to the paired recorder; authorized, revision-bound capture is compiled and imported into the saved case | Configured recorder transport remains available |
| Engineer / Build Agent | Scoped outbound MCP command and receipt bridge drives the paired browser; native isolated verification uses the same bridge | Existing TestEngine MCP and verification transport |
| Instructions | Saved native instructions execute through the same frozen case plan | Existing worker queue |
| Individual case or suite | One native attempt per selected case/data iteration, frozen scheduling, signed callbacks | Existing durable dispatch and result processing |
| Cancellation | Persist at the API immediately, signal the agent when reachable, and poll server state every two seconds | Existing worker cancellation |

The local browser runner supports Web and API steps. Native mobile steps require
their configured device runner. Scheduled local browser builds and local
Playwright CLI verification are rejected explicitly; local builds can use native
isolated verification. The installer includes Chromium, Firefox and WebKit.

## Verification performed

- Final automation backend suite: 1,167 passed, six skipped; the focused
  dispatch/security selection also passed nine tests.
- TestEngine suite: 161 passed, one optional FFmpeg check skipped.
- Installer, repository setup and paired capture selection: 19 passed.
- Pairing and frontend transport helpers: 15 passed. Real-browser transport checks
  cover individual/suite/saved-run starts, recorder capture, local Engineer,
  remote independence, lost acknowledgments and disconnected-agent cancellation.
- The 17 authoring browser scenarios passed, including sequential Engineer
  progress and the Studio's recording/build/run handoffs. One old Studio fixture
  needed a saved Start URL to satisfy the current browser-build prerequisite.
- A disposable PostgreSQL database exercised the real Fastify API, native local
  Playwright executor, callbacks and browser MCP relay: one individual case and
  a three-case suite completed and persisted passing results. Retrying an
  accepted dispatch produced no additional target request. No API-to-runner
  request was needed. The database is removed after the check.
  The final check also migrated and verified schema version 14.
  It verified uploaded screenshots and native ZIP traces for all three suite
  cases, including single-step cases, using real multipart validation,
  attachment records and SHA-256 checksums. Only the external object-store
  adapter was replaced with private fixture bytes.
- Shared frontend TypeScript and the 35 architecture checks passed. Documentation,
  service boundary and MCP contract/inventory checks passed. Module-graph auditing
  still reports two existing test-only compatibility helpers,
  `automationExportSource.ts` and `automationInstructionSummary.ts`.
- All 128 agent intent and outcome contract checks passed without live provider
  calls.

The database check found and fixed a reporting mismatch: the planner uses a
default iteration placeholder when there is no dataset, while the native
callback correctly sends no data iteration. Paired dispatch metadata now binds
the native envelope's exact iteration, preserving strict row isolation.

Paired attempts now report that execution is starting before the first step,
so even a single-step case has an exact result ready for evidence upload.
Artifact authorization uses the attempt's scoped signing key and current owner
permissions. Shared service credentials cannot authorize paired evidence.

Run the integrated check with PostgreSQL available locally:

```bash
npm --prefix testengine/backend run build
npm run test:paired-local:postgres
```

The check creates only a database named `agent_verify_paired_local_*`, refuses
nonlocal database hosts, uses fixture credentials, and does not call a model or
execute a user's saved automation. Browser authoring fixtures must run serially
on a shared Vite server: creating/removing a fixture HTML entry can trigger a
full reload in another fixture's browser.

## Operational contract

An inspection-only agent needs one update through Local agent setup. Keep its
existing browser token to retain the pairing. The updated status includes
`agent_id`, `execution_protocol_version: 1`, and local execution/build
capabilities. A basic paired status alone is not execution readiness.

The browser never receives the executable dispatch bundle or global engine
credential. Dispatch and bridge payloads are encrypted in the API database.
The agent claims using an owner/execution/machine-bound grant, receives separate
callback signing keys per attempt, and stores private receipts before executing.
An uncertain acknowledgment reconnects the original receipt, including after
the initial claim deadline if the agent already accepted it. An interrupted
agent never automatically replays browser actions. Callback retry eligibility
expires after seven days and also requires fresh owner/project authorization.

See [execution runtime](../architecture/execution-runtime.md),
[automation authoring](../architecture/automation-workflow.md), and
[local setup](../../local-run/RECORDER_LOCAL_SETUP.md) for the implementation
contracts and the separate legacy direct runner.
