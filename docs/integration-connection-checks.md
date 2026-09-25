# Integration connection checks

Updated 10 September 2026. Every integration type in the application catalog has
a connection check in its editor. A single selected saved profile can also be
tested from the catalog. Creation forms test their current draft without needing
to save it first. Existing Jira profiles remain editable and testable; their
existing restriction on new profile creation is unchanged.

## What each check verifies

| Integration | Checks | Limits |
| --- | --- | --- |
| AI / LLM | Authenticated Chat Completions request to the configured model, using the application's OpenAI-compatible protocol | Uses a small generation budget. Accepted requests without visible text are reported as limited. |
| Email | SMTP connection, TLS negotiation and authentication through Nodemailer's `verify()` | Sends no email; sender acceptance and delivery are not verified. |
| Google sign-in | OAuth web client ID format and Google OpenID discovery | Client existence, authorized browser origins and actual sign-in require the browser sign-in flow. The result is limited. |
| Google Drive | Token access to the exact configured, active folder and its reported `canAddChildren` capability | No backup is uploaded. Token write scopes still apply. |
| GitHub | Configured repository and branch access, repository state and reported account push permission | Supports repository-scoped installation tokens without requiring `/user` access. Content-write scopes and branch policies still apply; no commit is created. |
| Jira | Authenticated user and optional configured project through REST v2, supporting the existing Cloud and Data Center profiles | No issue is changed; issue-creation and workflow permissions are not verified. |
| Test engine | Exact configured host's `/health` and `/api/v1/capabilities`, including selected web-engine support | Does not substitute a different local host. Dispatch, capacity and callbacks require a run. |
| Local desktop | The configured bridge's health and execution capabilities | Does not start a desktop run. |
| Cloud run | Provider-specific authenticated API followed by the configured WebDriver hub status | Never creates a test session. Device/browser availability and session capacity require execution. |
| OPS | Effective configured host, health endpoint and readable events endpoint, with the configured authentication header | No telemetry event is written; delivery is not verified. |

Cloud checks use BrowserStack's Automate plan API, LambdaTest's Automation user
files API, the Sauce Labs jobs API for the configured region, and the legacy
CrossBrowserTesting account API. Other grids use WebDriver status and explicitly
report that a public status response cannot prove authentication. The legacy
CrossBrowserTesting endpoint can be unavailable on retired accounts/services;
that is surfaced as a failed check rather than assumed support.

The native HelloTest QA Agent entry separately checks feature availability and
the signed-in account's access to the current project's workflow API. Manual
rechecks bypass the client GET cache. Workspace availability does not imply
working LLM credentials; the UI directs users to check the selected AI provider.

## Results, credentials and timeouts

`POST /integrations/test-connection` requires `integration.manage` and accepts
either a draft or `{ integration_id, type }`. The backend loads stored credentials
without returning them. Empty or masked credentials can reuse a stored secret
only while the endpoint and account remain the same. Changing the destination,
SMTP host/port/TLS settings, account or cloud provider requires a replacement
credential. The check never updates the integration record.

Responses distinguish passed, limited and failed checks, include elapsed time,
and provide actionable next steps. Authentication, permission, quota, rate-limit,
resource, TLS, timeout and incompatible-response failures are handled separately.
Provider response bodies and echoed credential values are not exposed. HTTP
redirects are not followed with credentials. Responses are bounded to 128 KB and
checks share an overall 20-second budget (30 seconds for LLMs). The frontend allows
40 seconds for the backend response. LLM token-field compatibility retries once
only when the provider explicitly rejects the initial field.

Changing draft settings, selecting another profile/project or closing the editor
aborts an active check and discards stale results. The connection panel supports
keyboard controls, accessible status announcements, light/dark themes and widths
down to 320 pixels.

The `ok` field remains true for a limited result; callers must use `status` and
the individual checks to understand what was verified. Invalid input uses HTTP
400; a completed provider failure returns a structured HTTP 200 report.

## Verification

The focused API suite covers all ten catalog types, four named cloud providers,
custom grids, saved-secret binding, permission checks, bounded responses,
timeouts, redirects, redaction, invalid folder access and LLM compatibility.
External provider responses are mocked; these tests do not claim successful
connections to the user's real external accounts.

The browser regression mounts the actual Integrations page with production CSS
and isolated API/authentication fixtures. It checks all ten saved editors, all
nine available creation forms, catalog selection, unsaved overrides, retries,
stale-result cancellation, project changes and responsive layouts at 320, 390,
768 and 1440 pixels. Fixtures assert that no integration is saved by a check.
See [browser test instructions](../services/platform/frontend/test/browser/README.md).

Final verification passed 348 frontend tests and 458 API tests, with one existing
API skip. TypeScript and the production frontend build passed; Vite retains its
existing large-bundle warning. The browser regression passed for all provider
forms and the four viewport widths.

The implementation is deployed at `http://localhost:8080/integrations`. The local
engine's health and capability endpoints and OPS health/events endpoints passed
live read-only checks from the API container. The local-desktop adapter was also
checked against that same local engine; this does not verify a separate desktop
installation. Run dispatch and telemetry writes were deliberately not triggered.
All 205 deployed API source hashes and the served integration/shared assets were
verified. Integration, run and result row checksums remained unchanged.
Deployment backups and the verification manifest are in
`/tmp/qaira-integration-api-backup-20260910`; screenshots are in
`/tmp/qaira-integration-design`.

## Provider references

- [Nodemailer SMTP verification](https://nodemailer.com/smtp)
- [Google Drive file metadata](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/get)
- [GitHub repository API](https://docs.github.com/en/rest/repos/repos#get-a-repository)
- [BrowserStack plan API](https://www.browserstack.com/docs/automate/api-reference/selenium/plan)
- [LambdaTest / TestMu user files API](https://www.testmuai.com/support/api-doc/selenium-automation-api/user-files/fetch-all-user-files-uploaded-by-the-user/)
- [Sauce Labs API authentication and regions](https://docs.saucelabs.com/dev/api/)
- [Jira Data Center authenticated-user API](https://developer.atlassian.com/server/jira/platform/rest/v10000/api-group-myself/)
