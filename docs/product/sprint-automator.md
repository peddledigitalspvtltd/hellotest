# Sprint Automator

Choose **Agentic Studio → Workflows → Sprint Automator**. The template creates eight connected steps:

1. Manual Sprint trigger.
2. Read all Sprint Stories through an authenticated HTTP API connection.
3. For each Story, establish a project/Sprint-scoped packet and pin its current revision.
4. AI Story Assurance.
5. AI Test Case Generator.
6. AI Test Case Quality Assurance.
7. AI Automation Engineer.
8. Review Sprint drafts.

Select the project and application in the workspace. In **Read all Sprint Stories**, choose a managed HTTP connection pointing to this HelloTest installation's API base, for example `https://your-instance.example/api`. Configure that connection in Integrations with a project-authorized API key and GET access. Authentication is applied by the server and never copied into workflow input, model context or output. Private deployments require the connection's private-network setting. Do not paste an API key into the trigger JSON.

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

The HTTP step calls `/requirements?project_id=…&sprint_id=…&include_page=true&page_size=20` and follows every returned cursor. Repeated cursors, incomplete responses and Sprints over 100 Stories fail explicitly instead of silently omitting Stories. Generated output supports 1–10 cases per Story, up to 2 MB per native step, and a bounded workflow deadline up to one hour. Larger scopes must be split. Standard review workflows retain their existing three-minute and 128 KB limits.

Each native step sequentially processes every incoming Story packet and passes its actual typed output to the next step. Packets preserve the Story identifier/revision, assurance report, deterministic native metrics, comparison, generated cases, per-case quality review, and generated automation requests/code. A changed Story or changed case fingerprint prevents downstream use. Upstream model analysis is context, not new product authority. Native authoring and assurance prompts remain governed through Admin AI Controls, with optional node guidance saved in the workflow.

**Sprint drafts ready for review** displays the same Story/Test Case metric analysis as the native workspaces, their evidence, authored actions/expected outcomes, and generated automation steps. Accept a manual or automation draft into the Library after reviewing it. Acceptance uses the recorded workflow indices and current permissions; it does not accept replacement content from the request. Native Test Case creation and an idempotent receipt share a transaction, so repeated acceptance returns the original record. Automation is saved as incomplete/unverified. A passing Test Engine run is still required to establish executed behavior.

The normal API schema migration advances the main schema to version 12 and installs `workflow_draft_acceptances`. Version-11 installations must run the normal migration before starting the updated API in verify mode. The selected user needs workflow run/view access, Story view/AI access, Test Case AI access, and automation AI/build/code access for the full chain. Library acceptance also requires Test Case create access; automation acceptance requires automation view/build/code access. These are checked again during execution and acceptance.

No Sprint is fetched and no provider is invoked when merely selecting the template. Missing configuration is reported by readiness or trigger validation. Existing Temporal configuration can run the same native steps; a stopped activity with an uncertain result is not automatically replayed as a fresh model invocation. Completed node results and current-item progress remain inspectable after cancellation or failure.

Developers can run `node scripts/checks/test-sprint-automator-postgres.mjs` against the local stack to verify the version-11 to version-12 CLI upgrade and native Library acceptance in a disposable database. It covers concurrent requests, idempotent receipts, stale Story rejection, rollback and Story row locking without calling a model provider.
