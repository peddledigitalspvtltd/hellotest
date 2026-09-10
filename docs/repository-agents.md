# Repository agents

Repository agents turn a source snapshot into reviewable QAIra assets. Open
**AI Agents**, choose a source builder from the **Agent library**, select the
project and application, then upload a ZIP or choose a GitHub repository. The
workspace is also available at
`/agentic-workflows?view=repository&agent=object_repository`.

Analysis produces findings and downloadable artifacts. **Publish selected** is
the action that creates application records. Opening an agent, starting analysis
or downloading its results does not publish anything.

## Available agents

| Agent | Source evidence | Review output | Publication destination |
| --- | --- | --- | --- |
| Object Repository Generator | Static JSX, TSX and HTML; static markup in Vue/Svelte | Screens, locator candidates, fallback locators and source locations | Object Repository in the selected application |
| API Test Case Generator | OpenAPI JSON/YAML, literal Express/Fastify route calls, Next.js app route function exports | Requests, parameter/body schemas, observed response statuses, positive and justified negative test drafts | Draft Test Cases, optionally assigned to a module |
| Repository Knowledge Builder | Source files and documentation, with a repository inventory and declared API operations | Redacted source/documentation excerpts with file and line references | Knowledge Repo, followed by its normal indexing lifecycle |
| Component Test Generator | The UI evidence used by Object Repository discovery | Component contracts, proposed visibility/count checks and a skipped Playwright scaffold | Draft Test Cases; component inventory remains review context |

Each finding has an identity, source evidence, confidence in that static evidence
and a review requirement. Confidence is not a pass rate or a claim that a
generated test has run. This version uses deterministic analysis; an LLM
integration is not required and no LLM is called by these four agents.

## Provide source

Choose an application before starting if the results will be published to Object
Repository or Test Cases. Repository knowledge can also be analyzed and published
at project scope.

**ZIP upload** accepts one `.zip` file. The archive is stored privately for the
background job and future retries. Its files are read without extraction. The
compiler does not run package scripts, load repository configuration, import
repository code or execute generated tests. README files and other repository
text are source material, not instructions to the worker.

**GitHub** accepts a canonical `https://github.com/owner/repository` URL and an
optional branch, tag or commit SHA. Without a revision, the default branch is
resolved. Before downloading, the worker resolves a commit SHA and records that
identity in the run. Public repositories do not require an integration. Private
repositories use a saved GitHub connection that belongs to the current project
and matches the repository owner/name. The connection must use GitHub.com's API;
use a ZIP for GitHub Enterprise, GitLab, Bitbucket, SSH or other source hosts.

Credentials remain on the server. API credentials are not forwarded to archive
redirects. The downloader accepts only the expected GitHub archive host and
resolved repository revision. It performs read requests, with at most two
attempts per request within a 60-second download budget.

### Input and result limits

| Limit | Value |
| --- | --- |
| Uploaded/downloaded ZIP | 20 MB compressed |
| Total ZIP entries | 6,000 |
| Eligible files | 3,000 |
| Expanded eligible source | 40 MB |
| Individual supported source file | 512 KB |
| API contract preview | 250 contracts |
| Object preview | 600 screen/field records |
| Knowledge preview | Repository overview plus 160 file excerpts |
| Component preview | 120 groups; at most five proposed scenarios per group |
| Compiler result | Less than 6 MB |
| Publication selection | 1–50 findings per request |
| Concurrent worker analyses | Two across API workers sharing the database |
| Queued/running analyses per user/project | Three |

Hidden paths, dependency/generated folders, lockfiles, credential files, binary
files and unsupported extensions are excluded. Oversized individual source files
are skipped. Ignored ZIP entries do not consume the expanded eligible-source
budget, but all entries are checked for invalid paths and unsafe metadata.
Absolute paths, traversal, normalized duplicates, symlinks, special files and
encryption reject the archive. ZIP entries must use stored or deflated
compression. Exclusion counts and preview truncation appear in run warnings.

Common credential patterns are redacted before evidence or knowledge is
generated. The supported-file allowlist and exclusion rules are defined in
[`safe_source.py`](../backend/api/agents/semantic_compiler/safe_source.py).

## Understand and review findings

The **Source** step shows supported frameworks and preview limits beside the
repository input. Once analysis starts, **Review & publish** uses the full
workspace with a compact source, revision and destination receipt. Choose
**New analysis** to provide another source. **Recent analyses** opens history
for the current agent, project and application; that history is loaded only
when opened.

The result area provides search, pages of 20 findings, expandable source
evidence, a review checklist and selection across pages. **All findings**,
**To publish** and **Published** filters distinguish generated drafts from
created assets. Switching publication filters clears the current selection.
Publication success and errors appear beside the publication controls.

Evidence labels describe static source quality, rather than presenting a
percentage as an execution result. Each finding's checklist includes both
assumptions and specific review reasons. Truncated Knowledge excerpts identify
their covered line range. Review analysis notes before
publishing. **Ready to review** means analysis completed; **Review with gaps**
means an exclusion, unsupported input, truncated preview or empty finding group
needs attention. A partial result can still contain useful findings to publish.

For API drafts, inspect the endpoint, required parameters, body schema and
expected status. An undocumented status stays unset. Dynamic routes, unresolved
external schema references, router mount prefixes, service-level validations and
deployment authentication can require manual review. Request bodies contain
placeholders, not invented production data. Negative drafts are proposed only
when the relevant required-field or authentication declaration exists; a
documented rejection code can still require confirmation for that scenario.

For Object Repository, inspect the screen grouping and each locator. Static
test IDs, supported role/name combinations, associated labels and placeholders
are preferred; an explicit ID can provide a lower-confidence fallback.
Placeholders use `getByPlaceholder`. Ambiguous locators within a source file and
unresolved dynamic names are omitted. ARIA content becomes an accessible name
only for roles that support that naming method: an unlabeled `status` region's
message, for example, is not used as its role name. This follows the
[WAI-ARIA naming rules](https://www.w3.org/TR/wai-aria-1.2/#namefromcontent).

Browser visibility, composed-component uniqueness, custom component attribute
forwarding, CSS-dependent names and runtime state remain unverified. A page URL
is left unset when no supported literal route establishes it. Screen names can
come from file names; inspect similarly named components from different folders
before importing them into an existing application repository.

For component drafts, arrange the required route, authentication, providers,
fixtures and visible state. Generated assertions check locator count and
visibility; they do not claim business transitions or API error handling without
evidence. `component-tests.review.spec.ts` deliberately uses `test.skip` for every
case. Review and configure the application before enabling a scaffold; unresolved
page URLs retain an explicit error requiring setup.

Knowledge excerpts preserve source locations and identify truncation. Review
their relevance and completeness before publishing. They describe what is
present in supplied source; undeclared business intent and runtime behavior are
not presented as established facts.

## Publish and revisit

Select up to 50 findings and choose **Publish selected**. Test drafts may also be
assigned to a module in the same application. A publication receipt links to the
created records. Previously published findings remain associated with the run.

- **Object Repository:** selected fields use the existing repository service and
  screen context. Existing matching locators or object names in a screen are
  skipped with a reason; the agent does not overwrite them. Runtime verification
  remains pending.
- **API Test Cases:** cases are created as structured drafts. The request step
  retains the method and endpoint, uses `@r.base_url` and test parameters, and
  adds a status assertion only when the source established one. Supply typed
  test data, review authentication and finish assertions before execution.
  Required declared request headers become test parameter references. Malformed
  header names and transport-managed headers are omitted. Missing-authentication
  drafts retain only the declared body content type; review noncredential header
  requirements while keeping credentials absent.
  JSON schemas with numbers, booleans, arrays or scalar bodies use a complete
  `@t.request_body` payload to preserve JSON types through the existing request
  runtime. Supply valid serialized JSON and retain any intentionally omitted
  field required by a negative scenario.
  Declared JSON and `+json` content types are preserved. Supported form, XML and
  text requests use `@t.request_body` for the complete reviewed wire payload;
  multipart/binary requests remain manual drafts requiring body setup. Swagger 2
  honors operation-level `consumes` before the document default. A missing or
  invalid media declaration is flagged and does not silently become JSON.
- **Component Test Cases:** proposed steps become draft cases. Component
  contracts and assertions remain available for review and export. No generated
  browser test is executed during publication.
- **Knowledge Repo:** selected documents are created as active knowledge items
  with repository/revision metadata and source evidence. File identity, content
  hash, excerpt line range and truncation metadata are retained. Publication queues
  synchronization in the existing durable Knowledge Repo indexing outbox.
  Successful publication does not mean indexing has already finished. Check the
  source's processing status in Knowledge Repo before expecting Ask AI retrieval.

Publication uses a database transaction and a lock for the project/application.
Repeating publication of the same finding in a run returns its existing receipt.
Identical API/component findings across analyses reuse the existing test case
through its source idempotency key. Knowledge uses an equivalent content-derived
key. These keys include the finding's content and scope: changed findings can
produce new records and do not automatically update previously published assets.

## Background jobs, cache and cancellation

Runs, stage progress, results, warnings and publication receipts are persisted in
PostgreSQL. Uploaded source archives are retained in object storage for retries;
temporary compiler files are removed after execution. This feature does not add
an automatic retention or deletion schedule for persisted runs or source uploads.

The background queue is polled every two seconds. Database leases, row locks and
a shared concurrency check prevent different API workers claiming the same job.
The worker rechecks the initiating account, project access and run permission
before analysis. Running jobs send a heartbeat every ten seconds; a heartbeat
older than 90 seconds marks an interrupted run failed and makes it retryable.

An unchanged archive can reuse a validated completed/partial result when project,
application, agent type, archive-byte SHA-256 and compiler version all match.
The new run records its cache source. Cache reuse still creates a separate run
and does not publish results automatically. Request idempotency also prevents
duplicate run creation when the same request identifier and settings are sent
again; reusing that identifier for different settings returns a conflict.

**Cancel** applies to queued/running analyses. Local work is aborted, and a worker
on another API instance observes cancellation through its heartbeat. **Retry**
creates a new run from a failed or cancelled run; the previous run remains in
history. ZIP retries reuse the stored source. GitHub retries use the resolved
commit when it is available, otherwise the original revision request. Start a
new analysis to inspect a fresh revision after a completed run.

The compiler has a 180-second wall-clock limit; retrieval and the complete job
are also bounded. On Linux, the subprocess additionally limits address space to
512 MB, file output to 8 MB and CPU use to 120 seconds. The UI polls active runs
only while visible and stops polling terminal runs.

## Permissions

Project membership and application/project ownership are checked separately from
the permissions below. A readable run does not grant permission to publish it.

| Action | Required permission |
| --- | --- |
| View agents, runs, results and artifacts | `agentic_workflow.view` |
| Start, cancel or retry analysis | `agentic_workflow.run` |
| Use a saved GitHub connection | `integration.view`, plus matching project/repository binding |
| Publish objects | `agentic_workflow.run` and `automation.repository.import` |
| Publish API/component cases | `agentic_workflow.run` and `testcase.create` |
| Publish API/component cases into a mobile application | Also `mobile.manage` |
| Assign published cases to a module | Also `testcase.update` |
| Publish knowledge | `agentic_workflow.run` and `knowledge.manage` |

Artifacts are authenticated downloads with private/no-store headers; generated
source is served as an attachment, not executed in the application origin.
Run responses contain artifact names, MIME types and byte sizes. Artifact
content is fetched only through the authenticated download endpoint, avoiding a
second copy of the generated findings in every run response.

`GET /repository-agents/runs` accepts optional `agent_type` and `status` filters
in addition to `project_id`, `app_type_id` and `page`. Both filters apply inside
the authorized project/application scope and to the pagination total. Status
values are `queued`, `running`, `completed`, `partial`, `failed` and `cancelled`.
Failed and cancelled analyses can be retried from their saved source. Partial
results remain reviewable; use **New analysis** with a narrower or revised source
to address evidence gaps.

## Runtime installation and deployment

The Node control plane is in [`backend/api/src/agents`](../backend/api/src/agents).
The isolated compiler and its preserved attachment source are in
[`backend/api/agents/semantic_compiler`](../backend/api/agents/semantic_compiler).
The provenance manifest contains SHA-256 hashes of the supplied archive and
vendored Python files. The original Git, LLM, repair and execution orchestrator
is not used by the application adapters.

The API needs Python 3.9 or later. PyYAML enables OpenAPI YAML; without it, JSON
and source parsing still work and YAML gets an explicit warning. For a host
installation, use a virtual environment and point the API at its Python:

```sh
python3 -m venv /absolute/path/to/qaira-agent-runtime
/absolute/path/to/qaira-agent-runtime/bin/python -m pip install PyYAML
export REPOSITORY_AGENT_PYTHON=/absolute/path/to/qaira-agent-runtime/bin/python
```

Both existing API Dockerfiles install `python3` and `py3-yaml`, copy `agents/`
into `/app/agents`, and run the API as the existing non-root `node` user. Rebuild
through the deployment's normal Docker build context. The application runtime
schema bootstrap creates the additive `repository_agent_runs` table and indexes.
PostgreSQL, object storage and the background-task plugin must be available.

Restart the API after changing the compiler package or Python environment: its
compiler fingerprint is cached per API process, and runtime availability checks
are cached for one minute.

## Validation commands

From `backend/api`, run the deterministic compiler and Node control-plane tests:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s agents/semantic_compiler/tests -v
node --test test/repositoryAgentSources.test.js test/repositoryAgentLifecycle.test.js
```

The opt-in PostgreSQL integration test is
`backend/api/test/integration/repositoryAgents.postgres.test.js`. It requires an
empty disposable database named `agent_verify_*`, `REPOSITORY_AGENTS_POSTGRES=1`,
`DATABASE_URL`, `REPOSITORY_AGENT_SCHEMA_PATH` pointing to
`backend/db/schema.sql`, `REPOSITORY_AGENT_FIXTURE` pointing to a small source ZIP,
`KNOWLEDGE_VECTOR_STORE=postgresql` to isolate vector records in that disposable
database, and the normal object-storage test configuration. It initializes
fixtures and verifies persistence, real publication, replay and cache reuse.
It also publishes four knowledge documents, consumes their indexing outbox and
checks retrieval of two source hits. Do not point it at an application database.

The responsive frontend test is
`frontend/test/browser/repositoryAgents.test.mjs`. Run it with the frontend Vite
server available at `VITE_TEST_URL` (default `http://127.0.0.1:5178`), an installed
Playwright module and a Chromium executable. `PLAYWRIGHT_MODULE` and
`CHROME_EXECUTABLE` can point to existing local installations.

For direct compiler diagnosis, its CLI accepts a server-controlled input JSON
with `agent_type` and either `archive_path` or `files: [{path, content}]`:

```sh
python3 backend/api/agents/semantic_compiler/compile.py --input /tmp/agent-input.json --output /tmp/agent-result.json
```

Standard output contains bounded JSON stage events; failures return a nonzero
status and a public JSON error on standard error. This low-level CLI produces
artifacts only. Publication remains an authenticated application action.
