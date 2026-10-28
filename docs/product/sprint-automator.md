# Sprint Automator

Choose **Agentic Studio → Workflows → Sprint Automator**. The template creates eight connected steps:

1. Manual Sprint trigger.
2. Read all Sprint Stories through an authenticated HTTP API connection.
3. For each Story, establish a project/Sprint-scoped packet and pin its current revision.
4. AI Story Assurance.
5. AI Test Case Generator.
6. AI Test Case Quality Assurance.
7. AI Automation Engineer.
8. Show saved Library cases, automation outcomes and missing inputs.

Select the project and application in the workspace. The **Sprint Automator setup** panel preloads ten permitted Sprints and supports searching by name or ID. Choose the Sprint, Stories API connection, model, case count, format and generation guidance. Saving preserves these template fields and restores them when the workflow is reopened. Other arbitrary trigger fields are not copied into the saved Sprint defaults.

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

The HTTP step calls `/requirements?project_id=…&sprint_id=…&include_page=true&page_size=20` and follows every returned cursor. Repeated cursors, incomplete responses and Sprints over 100 Stories fail explicitly instead of silently omitting Stories. Generated output supports 1–10 cases per Story, up to 2 MB per native step, and a bounded workflow deadline up to one hour. Larger scopes must be split. Standard review workflows retain their existing three-minute and 128 KB limits.

Each native step sequentially processes every incoming Story packet and passes its actual typed output to the next step. Packets preserve the Story identifier/revision, assurance report, deterministic native metrics, comparison, generated cases, per-case quality review, and generated automation requests/code. A changed Story or changed case fingerprint prevents downstream use. Upstream model analysis is context, not new product authority. Native authoring and assurance prompts remain governed through Admin AI Controls, with optional node guidance saved in the workflow.

Sprint Automator saves each successfully generated Test Case into the Library automatically before quality assurance or automation starts. Cases are marked **AI generated**, remain **Draft**, and have **Review pending**; saving is not a reviewer approval. No acceptance click is required. Missing automation inputs or a later model failure do not remove already saved cases. The output links to the saved Library records alongside their native metrics, evidence and assessments.

The template records `settings.template_id = "sprint-automator"` and `settings.library_publication_mode = "automatic"`. Publication uses the exact recorded generated cases, selected Story revision and current actor permissions. Native Test Case creation and an idempotent receipt share a transaction, so checkpoint or request replay returns the original record. Validated automation is additionally saved as incomplete/unverified and linked to its generated manual case; missing-input automation is not saved. A passing Test Engine run is still required to establish executed behavior. Other workflows keep their explicit draft-acceptance behavior.

Test Case assurance separately reports **Automation readiness** with evidence references and any missing API contracts, authentication context, test data or fixtures. Readiness must cite the linked product Story; the generated case and upstream model reviews cannot establish product authority alone. A well-formed, evidence-grounded review does not itself establish automation readiness. Only an explicit `ready` assessment can advance to automation generation. `needs_input`, `unknown`, `not_applicable`, absent assessments and invalid readiness reports preserve the saved case and show the missing inputs. They do not block Library publication or the output step. Older case reviews without this assessment need reassessment before automation.

The workflow also checks generated inputs before an automation model call. Entire `[Missing: …]` or `[Required: …]` parameter values, exact self-references, circular reference declarations, and unavailable referenced Test Case or suite inputs are unmet inputs. These checks use native parameter names and namespace precedence, including bracketed names. They do not rewrite parameter values or add recursive substitution: finite aliases ending in concrete declared values retain their native literal meaning. JSON, embedded reference text and intentionally empty values remain test data, and future run captures may be supplied by earlier automation steps. **Automation needs input** lists parameter names and missing context beside each assessed case without disclosing configured values.

When the native builder identifies missing application context, runtime parameters or a browser Start URL, it produces the same missing-input outcome. Generated manual cases remain saved with review pending; blocked automation is withheld. Provider failures, denied access, cancellation and invalid or incomplete model output retain their failure behavior. Configure credentials through managed connections or secure test data rather than generation guidance.

The normal API schema migration advances the main schema to version 12 and installs `workflow_draft_acceptances`. Version-11 installations must run the normal migration before starting the updated API in verify mode. The selected user needs workflow run/view access, Story view/AI access, Test Case AI/create access, and automation AI/build/code access for the full chain. Automatic automation publication also requires automation view access. Account status, current permissions, feature access, project/application ownership and Story revisions are checked again when saving.

Selecting the template loads the permitted Sprint choices; it does not fetch their Stories or invoke a model provider. Missing configuration is reported by readiness or trigger validation. Existing Temporal configuration can run the same native steps; a stopped activity with an uncertain result is not automatically replayed as a fresh model invocation. Completed node results and current-item progress remain inspectable after cancellation or failure.

Terminal status writes have a bounded recovery path through a separate database connection when the normal connection pool is unavailable. Recovery writes execution metadata only and never repeats a node, model call or external action. If persistence remains unavailable, the worker retains its terminal snapshot for recovery on a later read and logs a sanitized diagnostic.

The general HTTP Request node supports GET, POST, PUT, PATCH, DELETE, HEAD and OPTIONS when enabled on its managed connection. URL and JSON body mappings preserve typed values. GET and HEAD omit request bodies. Story writes use `/requirements` for POST and `/requirements/{id}` for PUT; PUT requires the current Story revision. An uncertain write outcome is recorded with its operation identifier and cannot be automatically replayed. A completed operation receipt is reused within the same workflow run and node; a deliberately new run is a new operation.

Developers can run `node scripts/checks/test-sprint-automator-postgres.mjs` against the local stack. It verifies schema upgrade, automatic pending-review publication, other workflows' manual acceptance, concurrent replay, immutable lineage, permission revocation, receipt rollback and Story row locking. The full native pipeline uses a local HTTP model fixture with actual services, MCP retrieval, encrypted Settings credentials and API-key Story access. It proves cases are saved before assurance begins, missing-input cases remain in the Library, and validated automation retains its manual link and unverified status. It also exercises terminal recovery while all normal database connections are held. No paid model provider is called by this verification script.
