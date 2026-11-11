# Sprint Automator

Choose **Agentic Studio → Workflows → Sprint Automator**. The template creates ten connected steps:

1. Manual Sprint trigger.
2. Read all Sprint Stories through an authenticated HTTP API connection.
3. For each Story, enter the connected loop body with a batch of one.
4. AI Story Assurance authorizes the selected project/Sprint Story and pins its current revision.
5. AI Test Case Generator saves the generated manual cases as pending-review drafts.
6. For each Test Case, enter the nested connected loop body with one exact case.
7. AI Test Case Quality Assurance.
8. AI Test Data Generator prepares missing synthetic inputs or maps the selected Test Data Set.
9. AI Automation Engineer builds the current case using its prepared data and selected Test Environment.
10. Show saved Library cases, automation outcomes and missing inputs.

The Story loop's **loop** output connects to Story Assurance. Test Case Generator enters the inner Test Case loop, whose **loop** output connects to Test Case Quality Assurance, Test Data Generator and Automation Engineer in order. Automation Engineer returns to the inner **continue** port. The inner **done** output returns to the Story loop's **continue** port; the outer **done** output connects to Sprint results. Every case completes before the next case, and every Story completes before the next Story. Batch input, output and saved Library receipts remain inspectable for every iteration, including when a later Story fails.

Native task failures retain their node, Story and loop-batch identity. Case
assurance and automation failures also identify the exact zero-based
`case_index` and draft identity, without copying case contents or model output
into diagnostics. Exhausted JSON/schema correction is a validation failure;
it does not automatically replay the unchanged node. Provider transport and
capacity failures retain their separate retry policy. Completed model budgets,
output limits, refusals and execution deadlines are not reset by a node retry.

The original eight-step template upgrades to this connected loop when opened through the workflow service. Saved task guidance, connection, Sprint and explicit publication policies are retained. Customized graphs keep their connections. Accepted run snapshots keep their original graph.

Select the project and application in the workspace. The **Sprint Automator setup** panel preloads ten permitted Sprints and supports searching by name or ID. Choose the Sprint and configure the Stories API connection, model, case count, format and generation guidance in their nodes. Use **Configure AI Automation Engineer** to select a project/application Test Environment with the reviewed application URL and protected variables. Choose **Perform authored steps** when the builder should carry out browser actions; **Read-only inspection** observes the starting page, and **Offline** uses no browser. Manual and Gherkin cases use the same inferred runtimes as native automation generation. Saving preserves the Sprint scope and each node's configuration. Other arbitrary trigger fields are not copied into the saved Sprint defaults.

Create a personal key under **Settings → API Keys**. A **Read** key is sufficient for this template; **Design** or **User** scope is needed to create or update Stories and remains subject to the owner's current project permissions. In Integrations, create a managed HTTP connection pointing to this HelloTest installation's API base, for example `https://your-instance.example/api`, using `X-API-Key` authentication and GET access. Select it in the setup panel or **Read all Sprint Stories** node. Authentication is applied by the server and never copied into workflow input, model context or output. Private deployments require the connection's private-network setting. Do not paste an API key into the trigger JSON.

The manual input accepts:

```json
{
  "sprint_id": "the-saved-sprint-id",
  "integration_id": "optional-selected-model-id",
  "max_cases_per_story": 5,
  "authoring_mode": "structured",
  "automation_start_url": "https://your-reviewed-web-application.example",
  "generation_instructions": ""
}
```

Use the saved Sprint identifier, not its display label. Project/application scope comes from the workflow; optional input scope must match it. A node's model selection overrides the trigger model; otherwise each native feature uses its configured model default. Web automation needs a reviewed start URL. API-only cases use their supplied API URLs and assertions and do not require a browser start URL. Structured and Gherkin case drafts retain their authored behavior.

Readiness checks the current trigger values and the actual feature model for each native task. Changing the Sprint or model invalidates the displayed readiness result. Native AI tasks invoke the native artifact services; workspace specialist nodes review project evidence and perform their configured handoffs. They have separate node library groups and execution contracts.

The HTTP step calls `/requirements?project_id=…&sprint_id=…&include_page=true&page_size=20` and follows every returned cursor. Repeated cursors, incomplete responses and Sprints over 100 Stories fail explicitly instead of silently omitting Stories. Connected loops share a ceiling of 100 total batches and 1,000 body step executions, including nested loops. Before the first Story starts, Sprint Automator checks the complete returned Story count against the configured case count: the standard template supports at most 50 Stories with one case each, 16 Stories with five cases each, or nine Stories with ten cases each. Readiness reports the capacity for the saved graph. Split a larger Sprint or lower the case count; an oversized scope stops before any model generation or Library publication. Generated output supports 1–10 cases per Story, up to 2 MB per native step, and a bounded workflow deadline up to one hour. Standard review workflows retain their existing three-minute and 128 KB limits.

Each native step sequentially processes every incoming Story packet and passes its actual typed output to the next step. Packets preserve the Story identifier/revision, assurance report, deterministic native metrics, comparison, generated cases, per-case quality review, and generated automation requests/code. A changed Story or changed case fingerprint prevents downstream use. Upstream model analysis is context, not new product authority. Native authoring and assurance prompts remain governed through Admin AI Controls, with optional node guidance saved in the workflow.

Sprint Automator saves each successfully generated Test Case into the Library automatically before quality assurance or automation starts. Cases are marked **AI generated**, remain **Draft**, and have **Review pending**; saving is not a reviewer approval. No acceptance click is required. Missing automation inputs or a later model failure do not remove already saved cases. The output links to the saved Library records alongside their native metrics, evidence and assessments.

The template records `settings.template_id = "sprint-automator"` and `settings.library_publication_mode = "automatic"`. Publication uses the exact recorded generated cases, selected Story revision and current actor permissions. Native Test Case creation and an idempotent receipt share a transaction, so checkpoint or request replay returns the original record. Validated automation is additionally saved as incomplete/unverified and linked to its generated manual case; missing-input automation is not saved. A passing Test Engine run is still required to establish executed behavior. Other workflows keep their explicit draft-acceptance behavior.

Test Case assurance separately reports **Automation readiness** with evidence references and any missing API contracts, authentication context, test data or fixtures. Readiness must cite the linked product Story; the generated case and upstream model reviews cannot establish product authority alone. A well-formed, evidence-grounded review does not itself establish automation readiness. Under **Require ready**, only an explicit `ready` assessment advances to automation generation. The default **Verify inputs** policy lets the native builder independently check the same pinned Story/case contract; an upstream assessment cannot substitute for that check. Actual missing inputs and invalid readiness remain visible beside the saved case. They do not block Library publication or the output step, and no policy marks generated code as executed.

On supported models at the official OpenAI endpoint, assurance sends a strict generation schema for the review's required fields, finding categories and exact evidence references. String lengths, duplicate citations and the nonempty-assessment rule remain checked against the full native contract after generation. Advisory readiness may be null and then displays as unknown. Other compatible endpoints and older model snapshots retain JSON mode with the same native validation and one bounded format repair. The workflow never changes the selected model to recover from invalid output.

The workflow also checks generated inputs before an automation model call. Entire `[Missing: …]` or `[Required: …]` parameter values, exact self-references, circular reference declarations, and unavailable referenced Test Case or suite inputs are unmet inputs. These checks use native parameter names and namespace precedence, including bracketed names. They do not rewrite parameter values or add recursive substitution: finite aliases ending in concrete declared values retain their native literal meaning. JSON, embedded reference text and intentionally empty values remain test data, and future run captures may be supplied by earlier automation steps. **Automation needs input** lists parameter names and missing context beside each assessed case without disclosing configured values.

When the native builder identifies missing application context, runtime parameters or a browser Start URL, it produces the same missing-input outcome. Generated manual cases remain saved with review pending; blocked automation is withheld. Provider failures, denied access, cancellation and invalid or incomplete model output retain their failure behavior. Configure credentials through managed connections or secure test data rather than generation guidance.

Live validation and draft generation have separate outcomes. When the LLM observes an application failure or a mismatch with a fixed expected value, it can report a specific blocker. The host then stops live browser actions and asks the LLM to author the remaining unverified sections, preserving every confirmed action as an ordered prefix and retaining the original expected values. A complete source-validated draft can be published for review with **Draft generated · Live validation blocked · unverified** and its stopping reason. Missing executable contracts remain input gaps; uncertain actions and transport failures stop work without replay. A blocked live check never becomes a passing execution or triggers an automatic verification rerun.

The planner can request native console and network summaries to diagnose loading or application failures. Vision-capable integrations can also request the current screenshot; only authenticated host-masked pixels enter the model channel. Raw native image blocks, request bodies, headers and route-mocking tools are not exposed to the planner. These observations support LLM decisions and do not replace the authored business assertions.

The normal API schema migration includes `workflow_draft_acceptances` and advances the main schema to version 15. It also removes the obsolete receipt uniqueness rule that blocked a second effectful node iteration, while retaining existing operation receipts and their primary keys. Older installations must run the normal migration before starting the updated API in verify mode. The selected user needs workflow run/view access, Story view/AI access, Test Case AI/create access, and automation AI/build/code access for the full chain. Automatic automation publication also requires automation view access. Account status, current permissions, feature access, project/application ownership and Story revisions are checked again when saving.

Selecting the template loads the permitted Sprint choices; it does not fetch their Stories or invoke a model provider. Missing configuration is reported by readiness or trigger validation. Existing Temporal configuration can run the same native steps; a stopped activity with an uncertain result is not automatically replayed as a fresh model invocation. Completed node results and current-item progress remain inspectable after cancellation or failure.

Terminal status writes have a bounded recovery path through a separate database connection when the normal connection pool is unavailable. Recovery writes execution metadata only and never repeats a node, model call or external action. If persistence remains unavailable, the worker retains its terminal snapshot for recovery on a later read and logs a sanitized diagnostic.

The general HTTP Request node supports GET, POST, PUT, PATCH, DELETE, HEAD and OPTIONS when enabled on its managed connection. URL and JSON body mappings preserve typed values. GET and HEAD omit request bodies. Story writes use `/requirements` for POST and `/requirements/{id}` for PUT; PUT requires the current Story revision. An uncertain write outcome is recorded with its operation identifier and cannot be automatically replayed. A completed operation receipt is reused within the same workflow run and node; a deliberately new run is a new operation.

Developers can run `node scripts/checks/test-sprint-automator-postgres.mjs` against the local stack. It verifies schema upgrade, automatic pending-review publication, other workflows' manual acceptance, concurrent replay, immutable lineage, permission revocation, receipt rollback and Story row locking. The full native pipeline uses a local HTTP model fixture with actual services, MCP retrieval, encrypted Settings credentials and API-key Story access. It proves cases are saved before assurance begins, missing-input cases remain in the Library, and validated automation retains its manual link and unverified status. It also exercises terminal recovery while all normal database connections are held. No paid model provider is called by this verification script.
