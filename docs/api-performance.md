# API performance and database indexing

## Authentication and request handling

Password verification, password changes, sign-up and imports use asynchronous
PBKDF2 with the existing 600,000-iteration work factor. Administrator sign-in
verifies the password once. Session reads retain live user/grant checks and use
one database read for administrators or two for members. Suspension and grant
changes are not hidden by a server-side authentication cache.
The final login update checks that the verified password hash is still current,
so an in-flight verification or legacy upgrade cannot overwrite a password reset.

Concurrent browser focus/visibility/session refresh events share one verification
request. Expired, deleted and suspended identities clear their session; temporary
outages preserve open work. A screen cancelling its request cannot abort a
separate caller's request for the same URL. Disconnected responses release HTTP
capacity, and successfully finished responses are not counted as aborts.

## Screen review

| Screen | Data loading approach |
| --- | --- |
| Projects | Compact catalog first; portfolio metrics load independently with retry. Full description/details load for the opened project. Members, attachments and traceability load for their active section. |
| Project metrics | Relevant latest runs/outcomes replace all historical records. Large snapshots/logs are excluded, database concurrency is limited to three reads, grouping is linear. |
| Stories / Backlog / Bugs | Existing cursor pages and separate complete metric endpoints retained; optional linked context loads on demand. |
| Test Cases | Existing paged catalog and full selected-case fetch retained. Full run metadata waits for an opened case; opening a failure resolves that specific run so local/suite navigation stays correct. |
| Suites | Compact result history supports list metrics; full selected-case history loads separately. Optional history no longer holds the suite screen loader. |
| Shared Steps | Compact result history omits logs, screenshots and captured data while retaining outcome/attempt/timing identity. |
| Automation / Object Repository | Hidden authoring data and repository pages load when their relevant editor/view opens. Catalog history uses compact results; selected-case history retains full evidence. Repository pagination is cancelled when its observer leaves. |
| Runs / Schedules | Existing view-scoped reads retained. Results poll only for active runs and refresh once at completion. Full evidence and exports retain their detail responses. |
| Agentic Workflows / Workflow Runs | Existing active-surface reads, bounded lists and active-job polling retained. Shared request cancellation fixes apply. |
| Test Ops / Traces | Trace view avoids batch/editor/integration data requests. Completed transactions get final events/artifacts, then polling stops. Recorder/inspector polling does not overlap and pauses in hidden tabs. |
| Dashboards / Release readiness | Existing server aggregates, batched gadget queries and scoped pagination retained. |
| Test Environment | Existing active-view queries for environments, configurations and data retained. |
| People / Integrations / Settings | Existing resource/capability gates retained; project pickers now use compact project lists. |
| Knowledge Repo | Existing project-scoped content/context reads retained; content required by the current editor is preserved. |
| Notifications / Support / Admin | Existing pagination/section-specific reads retained. Admin adds the indexing job below. |

Shared dropdown metadata is reused across page navigation for five minutes and
refreshed when returning from another tab, instead of polling every 30 seconds.
Feature flag refresh and permission checks remain independent.

## Run performance indexing

Open **Administration → Setup → Shared database schema → Run performance indexing**.
The action returns immediately and displays progress and individual results.
Reloading the page resumes monitoring the current job.

The fixed catalog covers email/username lookup, membership/application scope,
recent project runs, completed outcomes, and Story/Test Case/Bug catalog ordering.
Equivalent indexes are reused. Missing indexes are built with
`CREATE INDEX CONCURRENTLY` on a dedicated PostgreSQL connection. A database
advisory lock prevents overlapping jobs across API instances. Each build has a
15-minute statement limit and a five-second lock limit. Failures are reported per
index and can be retried; conflicting index definitions are preserved.

The action requires a workspace administrator, accepts no SQL or index names,
and records start/completion in the admin audit log. API shutdown closes the
worker connection; interrupted jobs can be safely retried. Index creation was
verified in disposable databases, not automatically applied to existing data.

## Verification

Behavioral tests cover asynchronous password work, fresh grants, suspended users,
refresh coalescing, cancellation ownership, scoped result projections, index
permissions/concurrency/recovery/idempotency, and page demand loading. PostgreSQL
fixtures verify exact portfolio outcomes and actual concurrent index builds.
Browser tests cover slow/failed project metrics, selected-project loading, and
indexing progress/errors/reload at desktop and mobile widths.

In the portfolio fixture, 1,000 historical outcomes reduced to three relevant
rows with the same reported metrics. A local four-password contention benchmark
reduced event-loop delay from about 3,235 ms to 17 ms. These are focused fixture
and contention measurements; production latency also depends on data size,
database resources and concurrent load.

Live checks after rebuilding the local stack returned authenticated sessions in
4–68 ms, the compact project catalog in 14–44 ms, and portfolio metrics in
1.1–2.2 seconds. Sessions issued alongside metrics completed in 21–808 ms.
Administrator password login returned HTTP 200 in 221–233 ms; the workspace login's
invalid-password path completed password verification and returned HTTP 401 in
208–255 ms. A successful workspace password login was not exercised because the
configured bootstrap password does not meet that route's existing minimum length.
These local smoke measurements are not production latency guarantees.
