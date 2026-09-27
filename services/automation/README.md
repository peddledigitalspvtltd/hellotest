# @hellotest/automation

Automation authoring, object repository, recorder controls and TestEngine dispatch/callbacks.

- `frontend/`: screens, components, hooks and the owning API client. `entry.ts` exposes lazy release views.
- `backend/`: API routes, use cases and owning workers. `server.cjs` starts this profile through the shared runtime.
- `test/`: focused backend, frontend and browser checks where available.
- `package.json`: explicit npm exports/code dependencies and `hellotest` product prerequisites/feature ownership.
- `dist/ui/`: generated UI manifest and assets; never commit these files.

From the repository root:

```sh
npm run dev --workspace @hellotest/automation
npm run dev:api --workspace @hellotest/automation
npm test --workspace @hellotest/automation
npm run build --workspace @hellotest/automation
```

Run `npm run setup` first. Development uses the shared shell; the API requires configured foundation infrastructure. Cross-owner imports use declared `@hellotest/...` exports. This private workspace still depends on repository runtime adapters and the shared schema.

Read [CONTRIBUTING](../../CONTRIBUTING.md) for setup/debugging and [capability packaging](../../docs/architecture/capability-packaging.md) for selection, flags, permissions and release compatibility.

## Automation authoring and execution

The Build tab has two entry points: **Build with automation agent** and **Record & playback**. Both produce editable case steps. Keyword authoring and executable Playwright JavaScript statements remain available in the step plan. A web step is a JavaScript body using `page`, `expect`, `web`, `params` and `capture`, rather than an imported Playwright test file. Configure before/after-test hooks for the next run; these selections are frozen with the run and retained by reruns. API steps execute their structured requests; saved JavaScript is a source reference, not a request override; Android/iOS steps retain the mobile runtime. Native Android is not executed by Playwright.

`backend/lib/automationBrowserAgent.js` owns the bounded LLM/browser conversation. `testengine/backend/src/lib/automationMcp.ts` provides a Playwright-powered MCP server at `/api/v1/automation/mcp`. This is HelloTest's restricted browser tool server, not a bundled copy of Microsoft's Playwright MCP package. The LLM chooses tools and generates code; the MCP server returns observed browser evidence. Browser navigation, snapshots and locator checks run in isolated sessions. Click/fill/keyboard/select tools and non-read HTTP requests require the explicit interaction option, which may submit forms in the target application.

A build includes the manual steps and expected results, group/shared-group references, the repository, selected environment/configuration/data, knowledge and accessible linked/related stories. Story evidence is checked against both permission and feature availability. Partial, duplicate, invalid or runtime-changing step mappings fail the build. Provider errors retain existing code. Changes made while generation is in progress cause a conflict instead of being overwritten. Generated code on a shared-group instance does not publish changes to the shared definition. Review and execute the result before approving it.

The browser loop is limited to six model turns and ten tool requests after its initial navigation/snapshot. Its reasoning phase has a four-minute deadline, with individual model and tool timeouts; sessions expire after five idle minutes, refreshed by requests. TestEngine admits at most two MCP browser sessions per process. The existing TestEngine shared secret protects every request. Remote inspection uses the existing egress proxy/private-network policy, and navigation stays on the configured application origin. Private test targets require an exact `RECORDER_ALLOWED_PRIVATE_HOSTS` entry. The standard TestEngine Docker image includes Chromium; native development can set `PLAYWRIGHT_EXECUTABLE_PATH`.

Repository inspection and playback share `testengine/backend/src/lib/repositoryLocator.ts`. Locators do not silently select the first match. Use a unique selector, an explicit `.first()`/`.nth(n)`, or `selector >> nth=n`. The inspector builds selectors from captured attributes, optional parent scope and zero-based index; editing invalidates previous validation. Case repository tabs show only owned or directly referenced fields, including pending keyword bindings. Recordings display all retained actions in sequence.

Awaited JavaScript operations report their actual line, status, duration and retry attempt. Loops can report multiple operations for the same line; other lines have no invented pass result. Trace retention, screenshots on failure, video and console/network capture follow execution policy. Inline trace contents are capped at 8 MiB and per-step line evidence at 1,000 events. Larger traces retain artifact references and need accessible artifact storage. Trace and video recording require an engine-owned Playwright context; attached CDP contexts do not receive equivalent recording. Actual artifact references are added after collection. Data iterations, preconditions, shared groups and before/after hooks continue through the existing dispatch/executor contracts.

Focused checks (after `npm run setup`):

```sh
node --test services/automation/test/backend/automationBrowserAgent.test.js
npm --prefix testengine/backend test
node --test testengine/backend/test/browser/automationMcpFlow.test.mjs testengine/backend/test/browser/automationPlaybackEvidence.test.mjs
```

Browser checks use isolated fixtures; they do not verify a customer's LLM credentials, private application, Android device or remote recorder deployment. After changing the recorder or shared locator runtime, run `npm --prefix testengine/backend run package:inspection-agent` so downloaded local agents receive the same behavior.

The [workflow and runtime design](../../docs/architecture/automation-workflow.md) covers the authoring layout, context handoff, reuse and execution contracts, and current boundaries. Agent instructions are optional when a saved behavior plan is present. Native recorder selection follows the targeted step or unique native runtime in a mixed plan and preserves the other platforms when saving.
