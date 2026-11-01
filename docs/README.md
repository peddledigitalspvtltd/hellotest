# Documentation

Current implementation guides are grouped by responsibility. Research documents retain source evidence and decision rationale; dated observations are reference material, not current acceptance results. Superseded rollout snapshots and duplicate reviews were removed; Git retains their history.

Start with [capabilities](product/capabilities.md), [source layout](architecture/source-layout.md), [sample data](development/sample-data.md), [debugging](development/debugging.md) and [verification](development/verification.md). Run `npm run check:docs` after changing local links.

## Current architecture and implementation contracts

- [HelloTest AI Context Platform](architecture/ai-context.md)
- [AI feature contracts and budgets](architecture/ai-feature-contracts.md)
- [API performance and database indexing](architecture/api-performance.md)
- [Automation authoring and execution](architecture/automation-workflow.md)
- [HelloTest Backend Architecture](architecture/backend.md)
- [Background operations](architecture/background-operations.md)
- [Capability packages and independent UI releases](architecture/capability-packaging.md)
- [Deployment, setup and script review](architecture/deployment-script-review.md)
- [Case execution and parameter policy](architecture/execution-runtime.md)
- [Capability implementation contracts](architecture/implementation-boundaries.md)
- [Knowledge Repository and AskHelloTest context engine](architecture/knowledge-context.md)
- [Knowledge Graph and Context Graph](architecture/knowledge-context-graphs.md)
- [HelloTest MCP](architecture/mcp.md)
- [Browser quality agents](architecture/quality-agent-engine.md)
- [Reliability and development refactor](architecture/refactor-review.md)
- [Source and documentation ownership](architecture/source-layout.md)
- [TestEngine consolidation](architecture/testengine.md)

## Current feature intent, flows and capability inventory

- [AI Controls](product/ai-controls.md)
- [Metric governance](product/metric-governance.md)

- [Agentic Studio](product/agentic-studio.md)
- [Product capabilities](product/capabilities.md)
- [Dashboard, Ask AI and case-run experience](product/dashboard-knowledge.md)
- [Permissions and feature availability](product/feature-availability.md)
- [HelloTest core feature and acceptance-story blueprint](product/hellotest-feature-stories.md)
- [Integration connection checks](product/integration-checks.md)
- [Incremental Knowledge Repo refresh](product/knowledge-refresh.md)
- [Object Repository browser inspection](product/object-repository.md)
- [Quality agents in AI Agents](product/quality-agents.md)
- [Repository agents](product/repository-agents.md)
- [Shared Step metrics](product/shared-step-metrics.md)
- [Story Readiness and Product Metrics](product/story-readiness-and-metrics.md)

## Setup, debugging and verification

- [Development debugging runbook](development/debugging.md)
- [Sample-data setup](development/sample-data.md)
- [Verification scope](development/verification.md)
- [Knowledge and Context Graph verification](development/knowledge-context-graph-verification.md)
- [Detail, run, login, and AI triage UI review](development/visual-qa.md)

## Deployment and operational procedures

- [Operating the compact monitoring stack](operations/operations.md)
- [HelloTest Platform Stack](operations/platform-stack.md)

## Reference research and decision evidence; verify dated observations before acting

- [Project access and delivery traceability audit](research/access-traceability-audit.md)
- [Admin dropdown catalog](research/admin-dropdown-catalog.md)
- [HelloTest agent experience: market research and product direction](research/agent-experience.md)
- [AI platform deep-research source record](research/ai-source-review.md)
- [Automation and agent workflow implementation review](research/automation.md)
- [Automation Engineer: Playwright MCP, browser-use patterns and capability disclosure](research/automation-engineer-agent.md)
- [Administration and companion API architecture review](research/backend-api-admin-engine-review.md)
- [Backend API architecture review — 2026-09-18](research/backend-api-architecture-review.md)
- [Catalog API architecture review — 2026-09-18](research/backend-api-catalog-review.md)
- [Execution, analytics, knowledge and integration API architecture review](research/backend-api-execution-ai-review.md)
- [Portable execution report](research/execution-html-report.md)
- [Instance setup and Product Management corrections](research/instance-setup-product-planning.md)
- [Knowledge ingestion and Ask AI reliability](research/knowledge-reliability-review.md)
- [Knowledge and Context Graph research](research/knowledge-context-graphs-2026-11-01.md)
- [Product access and feature availability research](research/product-access.md)
- [Product Management metrics review](research/product-management-metrics-audit.md)
- [HelloTest product maturity: research, decisions and implementation](research/product-maturity.md)
- [Large-project deletion reliability](research/project-deletion-reliability.md)
- [Quality Analytics and Release Readiness: backend evidence audit](research/quality-analytics-backend.md)
- [Quality Analytics and Release Readiness: product review and implementation](research/quality-analytics-readiness.md)
- [Release Readiness: evidence review redesign](research/release-readiness-design.md)
- [Run data and end-to-end product review](research/run-data-journey.md)
- [Shared workspace design](research/workspace-design.md)
- [Main workspace surfaces aligned with the admin portal](research/workspace-surface-design.md)
- [Workspace scope selector: implementation audit](research/workspace-switcher-review.md)

The top-level [debugging redirect](DEBUGGING.md) remains for existing links. Feature blueprint JSON and coverage CSV files are machine-readable inventories; the sample manifest is the installation authority.
