# Verification scope

Choose checks that exercise the changed contract and state what they prove. Unit, browser-fixture, real-protocol, disposable PostgreSQL and live-provider checks establish different evidence.

| Change | Useful checks |
| --- | --- |
| Catalog/navigation/layout | Type check, owning capability build, browser flow and viewport checks |
| Sample data | Offline manifest/coverage verification, each module's dependency plan, actual installer against disposable PostgreSQL, repeat-install/customization preservation |
| Grouping and shared conversion | Transaction rollback, same-application references, continuous/full-instance selection, permissions, shared/local conversion and frozen-history preservation |
| Chatbot/MCP | SDK context calls, permission revocation, normalized deadlines/cancellation, evidence validation, paragraph-safe stream delivery and rendered output |
| Debugging scripts | Actual inspector traffic over the tunnel, target mapping, occupied ports and mutation-free check mode |
| Documentation | Read/classify each Markdown file, compare contracts to source, validate local links and regenerate the catalog |

Run the owning package's checks from the repository root. Representative commands:

```sh
node services/platform/backend/instance-setup-data/verify.cjs
node --test services/mcp/test/backend/*.test.js services/chatbot/test/backend/*.test.js
node --test scripts/debug/attach.test.mjs
npm run check:boundaries
npm run test:architecture
npm run check:docs
```

PostgreSQL integration suites have explicit opt-in flags and disposable database-name guards. Supply the same disposable database to `DATABASE_URL` and `OBS_DATABASE_URL`; do not point these tests at persisted workspace records. Existing schema/bootstrap contracts remain authoritative.

Record the exact command, source revision, result, test fixture/provider scope and unresolved failures in the change's verification log. Prior passing counts and old deployment screenshots are not evidence that the current checkout or running Docker images were reverified. Mocked model output does not establish live provider accuracy, relevance calibration or physical-device execution.

## Local verification on 12 October 2026

The sample-data and section-grouping changes were verified with 11 passing disposable PostgreSQL installer checks, 27 passing MCP/real-SDK checks, 35 passing architecture checks and passing package/source/module audits. Chrome component tests cover grouping and conversion, the shared instruction library, saved executable assets, overdue Sprint colors and streamed multi-paragraph chatbot answers. Inspector verification was read-only against the existing API. TypeScript, the owning capability builds and workspace/admin production builds passed. The existing large-chunk build advisories remain.

The full backend run has 1,486 passing checks, 53 failures and two skips; the failing identities match the earlier baseline. The full frontend run has 682 passing checks and eight failures; the failing identities match an isolated checkout of the starting revision. Focused checks do not replace those unresolved full-suite failures. Provider responses are fixtures, sample execution evidence is synthetic and physical-device readiness was not measured. The existing Docker application and live sample records were not replaced by this verification.
