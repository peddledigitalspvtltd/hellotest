# Product capabilities

The capability inventory is owned by `services/platform/frontend/src/platform/lib/workspaceCapabilities.ts`, the route registry and generated `services/capabilities.json`. Permissions and enabled features both apply; a navigation entry does not grant access. The setup blueprint connects these implemented feature intentions to source-reviewed Stories, modules, suites and acceptance/boundary cases.

The Automation navigation includes Test Automation, Shared Section Groups and Object Repository in that order. Shared Section Groups reuse the native Shared Step Group records and authoring contracts through `/shared-steps?view=automation`; no parallel group database is introduced. Test Runs uses `/executions`, whose default view is Suite Runs; Test Plans uses `/executions?view=scheduled-runs`. Quality Analytics uses `/?view=analytics`.

| Area | Feature intention | Native destinations | Setup Story |
| --- | --- | --- | --- |
| workspace | Create a project with explicit application scopes | `/projects` | `sample-v3-feature-project-applications` |
| workspace | Apply project membership and workspace role grants accurately | `/people`, `/admin-space` | `sample-v3-feature-membership-roles` |
| workspace | Navigate available capabilities without leaking project scope | `/projects`, `/stories` | `sample-v3-feature-navigation-scope` |
| workspace | Maintain authenticated sessions and recover expired access | `/auth` | `sample-v3-feature-authentication` |
| workspace | Delete large projects with recoverable background progress | `/projects` | `sample-v3-feature-project-deletion` |
| workspace | Persist workspace preferences and regional presentation | `/settings` | `sample-v3-feature-regional-settings` |
| planning | Author stories with actionable specifications and ownership | `/stories` | `sample-v3-feature-story-authoring` |
| planning | Prioritize unscheduled stories and move them into a sprint | `/backlog`, `/sprints` | `sample-v3-feature-backlog-planning` |
| planning | Plan sprint goals, dates, ownership and lifecycle | `/sprints` | `sample-v3-feature-sprint-lifecycle` |
| planning | Create release milestones with explicit and sprint-inherited scope | `/releases` | `sample-v3-feature-release-scope` |
| planning | Use available sprints and releases consistently across story dialogs | `/stories`, `/backlog`, `/sprints` | `sample-v3-feature-delivery-selectors` |
| planning | Relate stories to test cases, defects and dependencies | `/stories` | `sample-v3-feature-story-traceability` |
| planning | Import and synchronize stories while retaining delivery metadata | `/stories` | `sample-v3-feature-story-import-sync` |
| planning | Review AI-assisted story refinement and proposed test coverage | `/stories` | `sample-v3-feature-story-ai-design` |
| design | Author structured test cases with ordered steps and expected results | `/test-cases` | `sample-v3-feature-structured-cases` |
| design | Preserve Gherkin Features, Backgrounds and Scenario Outlines | `/test-cases`, `/executions` | `sample-v3-feature-gherkin-authoring` |
| design | Reuse shared step groups without losing parameter boundaries | `/shared-steps`, `/test-cases`, `/shared-steps?view=automation` | `sample-v3-feature-shared-steps` |
| design | Organize cases into modules and reusable ordered suites | `/design` | `sample-v3-feature-suite-modules` |
| design | Retain case revision history and review ownership | `/test-cases` | `sample-v3-feature-case-review-versioning` |
| design | Round-trip supported test case imports and exports | `/test-cases` | `sample-v3-feature-case-import-export` |
| design | Configure environment targets and scoped variables | `/test-environments` | `sample-v3-feature-environment-targets` |
| design | Select browser and mobile configuration profiles | `/test-configurations` | `sample-v3-feature-configuration-profiles` |
| design | Link datasets and apply parameter precedence consistently | `/test-data`, `/test-cases` | `sample-v3-feature-datasets-parameters` |
| design | Review AI case mapping, step rephrase and synthetic data drafts | `/test-cases`, `/test-data` | `sample-v3-feature-ai-authoring-data` |
| execution | Create a run from authorized suites and explicit delivery context | `/executions?view=suite-runs` | `sample-v3-feature-run-planning` |
| execution | Record manual case and step outcomes against frozen run snapshots | `/executions` | `sample-v3-feature-frozen-evidence` |
| execution | Calculate final case outcomes across dataset iterations | `/executions` | `sample-v3-feature-dataset-outcomes` |
| execution | Manage disabled, future and recurring run schedules | `/executions?view=scheduled-runs` | `sample-v3-feature-scheduled-runs` |
| execution | Inspect execution reports and AI-assisted failure analysis | `/executions` | `sample-v3-feature-execution-analysis-reports` |
| execution | Capture and triage Defects with severity, ownership and history | `/issues` | `sample-v3-feature-bug-lifecycle` |
| execution | Review duplicate Defects and linked evidence before creating another | `/issues` | `sample-v3-feature-bug-collaboration` |
| execution | Turn Defect findings into reviewed regression coverage | `/issues`, `/test-cases` | `sample-v3-feature-bug-regression-ai` |
| automation | Link executable automation to its manual coverage | `/automation` | `sample-v3-feature-automation-coverage` |
| automation | Review executable assets and step-level code before running | `/automation`, `/test-cases` | `sample-v3-feature-builder-step-code` |
| automation | Configure API requests, validations and captured parameters | `/test-cases`, `/automation` | `sample-v3-feature-api-requests` |
| automation | Curate stable object bindings with locator provenance | `/object-repository` | `sample-v3-feature-object-repository` |
| automation | Capture browser actions and review saved automation steps | `/automation`, `/test-cases` | `sample-v3-feature-step-recorder` |
| automation | Run supported automation locally and retain its evidence | `/executions?view=local-runs`, `/automation` | `sample-v3-feature-local-execution` |
| automation | Dispatch remote automation with bounded parallel execution | `/automation`, `/executions` | `sample-v3-feature-remote-parallel` |
| automation | Use configured Android and Appium execution targets | `/automation`, `/test-configurations` | `sample-v3-feature-android-appium` |
| automation | Generate reviewable automation artifacts from selected source | `/agentic-workflows?view=agents` | `sample-v3-feature-repository-specialists` |
| intelligence | Ingest supported project evidence and supplied content into knowledge | `/knowledge-repo` | `sample-v3-feature-knowledge-ingestion` |
| intelligence | Search versioned knowledge within authorized project scope | `/knowledge-repo` | `sample-v3-feature-knowledge-search` |
| intelligence | Answer project questions with current evidence and explicit gaps | `/knowledge-repo` | `sample-v3-feature-ask-hellotest` |
| intelligence | Compose specialist workflows with validated steps and outputs | `/agentic-workflows?view=workflows` | `sample-v3-feature-workflow-canvas` |
| intelligence | Inspect workflow attempts and per-step recovery states | `/agentic-workflows?view=runs` | `sample-v3-feature-workflow-history` |
| intelligence | Reuse prompt templates and governed AI provider mappings | `/admin-space`, `/settings?tab=ai` | `sample-v3-feature-prompt-governance` |
| operations | Explain quality metrics with consistent scope and denominators | `/?view=analytics` | `sample-v3-feature-quality-analytics` |
| operations | Build reusable Executive, Product and QA dashboards | `/?view=custom` | `sample-v3-feature-custom-dashboards` |
| operations | Review release readiness from traceability, execution and Defect risk | `/?view=readiness` | `sample-v3-feature-release-readiness` |
| operations | Keep Stories, Backlog, Sprint and Release cards mathematically consistent | `/stories`, `/backlog`, `/sprints`, `/releases` | `sample-v3-feature-product-metrics` |
| operations | Monitor background work and download reusable artifacts | `/testops` | `sample-v3-feature-background-jobs` |
| operations | Investigate operational health and distributed request traces | `/ops-telemetry` | `sample-v3-feature-telemetry-traces` |
| operations | Review relevant notifications and retain read state | `/notifications` | `sample-v3-feature-notifications` |
| operations | Install selected sample modules in dependency order without resetting edits | `/admin/?section=setup` | `sample-v3-feature-instance-setup` |
| operations | Govern feature availability and domain dropdown values | `/admin/?section=features`, `/admin/?section=dropdowns` | `sample-v3-feature-feature-dropdown-governance` |
| operations | Configure provider integrations and scoped API keys | `/integrations`, `/admin-space` | `sample-v3-feature-integrations-api-keys` |
| operations | Separate administrator access and retain setup audit activity | `/admin/?section=audit`, `/admin/?section=security` | `sample-v3-feature-admin-audit-security` |
| operations | Find support guidance without changing workspace data | `/support` | `sample-v3-feature-support-guidance` |
| intelligence | Execute reviewed browser quality checks with traceable evidence | `/agentic-workflows?view=quality` | `sample-v3-feature-browser-quality-agents` |

The two catalog-only flags for standalone plans/quality-gates do not describe independent routed pages. Current Test Plans/schedules, suites and readiness are covered by their actual registered destinations. Connection/device readiness and successful live execution remain separate from having a page or a synthetic dataset example.

See [the feature blueprint](hellotest-feature-blueprint.json), [sample-data setup](../development/sample-data.md), [AI contracts](../architecture/ai-feature-contracts.md), [Agentic Studio](agentic-studio.md), [quality agents](quality-agents.md) and [Automation workflow](../architecture/automation-workflow.md).
