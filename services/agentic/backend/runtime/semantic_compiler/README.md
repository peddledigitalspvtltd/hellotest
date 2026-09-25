# Repository agents

This folder adapts the user-supplied `qaira_semantic_compiler.zip` into QAIra's
repository agents. The original Python sources are preserved in `vendor/`;
`vendor_manifest.json` records the archive and source-file SHA-256 hashes. Git
metadata, bytecode, macOS files, shell entrypoints, Docker configuration and
runtime configuration were not copied. Repository contents are input data.

The application runs `compile.py` in a bounded worker subprocess. It does **not**
invoke the attachment's orchestrator, Git finalization, automatic repair, LLM
gateway or generated test runners. It reuses the attachment's balanced source
readers and locator normalization, and adapts its API contract, object packaging,
component contract and source evidence concepts with explicit accuracy checks.

## Runtime and protocol

Python 3.9 or newer is sufficient. PyYAML is optional for OpenAPI YAML; without
it, JSON and source analysis work and YAML reports an explicit limitation. No
other third-party Python dependency is required.

```text
python3 agents/semantic_compiler/compile.py --input input.json --output result.json
```

Input selects `agent_type` (`object_repository`, `api_tests`,
`repository_knowledge` or `component_tests`) and exactly one source:
`files: [{path, content}]` or a server-controlled `archive_path`. Optional
`options` is reserved for validated future extensions and cannot configure
commands, network access, file destinations or the vendored runner.

Output contains `schema_version`, `agent_type`, `summary`, `warnings`,
`findings: {objects, test_cases, knowledge, components}`, `stages` and
`artifacts: [{name, mime_type, content}]`. Source progress is newline JSON on
stdout: `{event: "stage", stage: {id, label, status, detail, duration_ms}}`.
Errors return a nonzero exit status and a public JSON error on stderr.

Every finding has a stable ID, a title or name, source path/line evidence,
confidence in the static evidence, and `review_required: true`. Confidence does
not represent a successful runtime test. Source code, credentials and repository
instructions are not emitted in progress logs.

## Accuracy and limits

- API discovery reads OpenAPI JSON/YAML, literal Express/Fastify routes and
  Next.js app route function exports. It does not infer undocumented response
  schemas or invent success status codes. Router mount prefixes and dynamic
  routes require review. Missing fields and authentication cases are proposed
  only when a corresponding declaration is present.
  Swagger 2 request bodies preserve operation-level `consumes`, falling back to
  the document declaration; an absent media declaration is flagged for manual
  setup instead of assuming JSON. The application preserves declared JSON and
  `+json` media types, uses a reviewed complete `@t.request_body` for supported
  form/XML/text bodies, and keeps multipart/binary requests as manual drafts.
- Object discovery reads JSX/TSX/HTML and static markup in Vue/Svelte. It prefers
  test IDs, explicit roles and names, associated labels and placeholders.
  Code expressions and ambiguous candidates are omitted. Placeholder locators
  use `getByPlaceholder`; they are never treated as labels. Custom component
  attribute forwarding and runtime visibility are explicitly unverified.
- Component output is a contract with source-supported locators, state setup
  requirements and visibility/count assertions. It does not claim API success,
  error handling or component behavior that the source evidence cannot prove.
  The Playwright scaffold download uses `test.skip` for every case. It requires
  reviewed URLs, baseURL, authentication, fixtures and state before enabling tests.
- Repository knowledge contains a source inventory and redacted documentation
  and source excerpts. Publishing/indexing is handled by the application's
  existing Knowledge repository lifecycle.
- ZIP input is read in memory without extraction: 20 MB compressed, 40 MB
  expanded eligible source, 3,000 eligible files, 6,000 total ZIP entries and
  512 KB per supported file. Traversal, absolute paths,
  symlinks, special files, encryption and duplicate paths are rejected. Hidden,
  credential, generated, dependency and binary files are excluded. Exclusions,
  truncation and unsupported inputs are reported explicitly.
- Linux subprocesses enforce a 512 MB address-space limit, an 8 MB file-output
  limit and a 120-second CPU budget in addition to parent worker cancellation.
- Preview budgets are 250 API contracts, 600 object records, 160 source knowledge
  excerpts and 120 component groups. All results remain below 6 MB. The Node
  control plane also bounds execution time and isolates job storage by project.

Run focused verification from `services/platform/backend`:

```text
python3 -m unittest discover -s agents/semantic_compiler/tests -v
```
