import { canAccessPath, type PageAccessMap } from "./permissions";
import { areFeatureFlagsEnabled, requiredFeatureFlagsForPath } from "./featureFlags";
import type { FeatureFlagSnapshot, SessionPayload } from "../types";
export type CapabilityGroup = "plan" | "design" | "automate" | "execute" | "investigate" | "manage";
export type WorkspaceCapability = { id: string; to: string; name: string; group: CapabilityGroup; description: string; keywords?: string; requiresProject?: boolean; flags?: string[] };
export const WORKSPACE_CAPABILITIES: WorkspaceCapability[] = [
  { id: "analytics", to: "/?view=analytics", name: "Quality analytics", group: "investigate", description: "Track coverage, execution trends and quality signals." },
  { id: "readiness", to: "/?view=readiness", name: "Release readiness", group: "investigate", description: "Assess release evidence and unresolved risk." },
  { id: "dashboards", to: "/?view=custom", name: "Custom dashboards", group: "investigate", description: "Build executive, product and QA views with reusable widgets.", keywords: "metrics leadership", requiresProject: true },
  { id: "stories", to: "/stories", name: "Stories", group: "plan", description: "Connect acceptance criteria to test coverage.", requiresProject: true },
  { id: "backlog", to: "/backlog", name: "Backlog", group: "plan", description: "Prioritize upcoming product work.", requiresProject: true },
  { id: "sprints", to: "/sprints", name: "Sprints", group: "plan", description: "Organize delivery and track iteration progress.", requiresProject: true },
  { id: "releases", to: "/releases", name: "Releases", group: "plan", description: "Plan delivery milestones and linked stories.", requiresProject: true },
  { id: "cases", to: "/test-cases", name: "Test cases", group: "design", description: "Author structured or Gherkin scenarios and parameters.", keywords: "given when then bdd manual", requiresProject: true },
  { id: "groups", to: "/shared-steps", name: "Shared step groups", group: "design", description: "Reuse common actions across test cases.", requiresProject: true },
  { id: "suites", to: "/design", name: "Test suites", group: "design", description: "Assemble cases into reusable execution plans.", keywords: "modules", requiresProject: true },
  { id: "automation", to: "/automation", name: "Automation cases", group: "automate", description: "Build and maintain executable test steps.", keywords: "playwright scripts recorder", requiresProject: true },
  { id: "objects", to: "/object-repository", name: "Object repository", group: "automate", description: "Review and reuse locators across automated tests.", requiresProject: true },
  { id: "agents", to: "/agentic-workflows?view=agents", name: "AI agents", group: "automate", description: "Generate objects, API tests and knowledge from source; review project evidence.", keywords: "generator repository zip github specialist", requiresProject: true },
  { id: "workflows", to: "/agentic-workflows?view=workflows", name: "Agent workflows", group: "automate", description: "Connect specialists and run bounded reviews with recorded results.", requiresProject: true },
  { id: "workflow-history", to: "/agentic-workflows?view=runs", name: "Workflow history", group: "automate", description: "Review each workflow attempt and its step outcomes.", requiresProject: true },
  { id: "runs", to: "/executions?view=suite-runs", name: "Suite runs", group: "execute", description: "Execute test cases, capture evidence and investigate defects.", requiresProject: true },
  { id: "local-runs", to: "/executions?view=local-runs", name: "Local runs", group: "execute", description: "Review locally recorded Playwright executions.", requiresProject: true, flags: ["hellotest.automation.workspace", "hellotest.automation.local_execution"] },
  { id: "scheduled-runs", to: "/executions?view=scheduled-runs", name: "Scheduled runs", group: "execute", description: "Plan recurring and future test execution.", requiresProject: true },
  { id: "jobs", to: "/testops", name: "Background jobs", group: "execute", description: "Monitor imports, builds and asynchronous processing.", requiresProject: true },
  { id: "environments", to: "/test-environments", name: "Environments", group: "design", description: "Define application targets and environment variables.", requiresProject: true },
  { id: "data", to: "/test-data", name: "Test data", group: "design", description: "Prepare parameter values and data rows for execution.", requiresProject: true },
  { id: "configurations", to: "/test-configurations", name: "Configurations", group: "design", description: "Choose browsers, platforms and execution variables.", requiresProject: true },
  { id: "bugs", to: "/issues", name: "Bugs", group: "investigate", description: "Triage defects, review history and convert gaps into tests." },
  { id: "knowledge", to: "/knowledge-repo", name: "Knowledge repository", group: "investigate", description: "Curate the sources used by Ask AI and quality specialists.", keywords: "chat context documents rag" },
  { id: "telemetry", to: "/ops-telemetry", name: "Telemetry", group: "investigate", description: "Inspect operational health and processing signals.", requiresProject: true },
  { id: "traces", to: "/traces", name: "Distributed traces", group: "investigate", description: "Follow operations across services.", requiresProject: true },
  { id: "projects", to: "/projects", name: "Projects", group: "manage", description: "Create a project, configure applications and membership." },
  { id: "integrations", to: "/integrations", name: "Integrations", group: "manage", description: "Connect providers and verify their connection." },
  { id: "people", to: "/people", name: "People and roles", group: "manage", description: "Manage workspace membership and access." },
  { id: "settings", to: "/settings", name: "Workspace settings", group: "manage", description: "Adjust preferences, automation defaults and language packs." },
  { id: "notifications", to: "/notifications", name: "Notifications", group: "manage", description: "Review activity and updates relevant to your work." },
  { id: "support", to: "/support", name: "Support", group: "manage", description: "Get help with the workspace." }
];
export function capabilityAvailability(capability: WorkspaceCapability, context: { session: SessionPayload | null; projectId?: string; flags?: FeatureFlagSnapshot | null; pageAccess?: PageAccessMap; flagsError?: boolean }): "restricted" | "project" | "unavailable" | "available" | "disabled" {
  if (!canAccessPath(context.session, capability.to, context.pageAccess, context.projectId)) return "restricted";
  if (capability.requiresProject && !context.projectId) return "project";
  const flags = [...requiredFeatureFlagsForPath(capability.to), ...(capability.flags || [])];
  if (flags.length && (!context.flags || context.flagsError)) return "unavailable";
  return areFeatureFlagsEnabled(context.flags, flags) ? "available" : "disabled";
}
export function searchCapabilities(query: string, capabilities = WORKSPACE_CAPABILITIES) {
  const tokens = query.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim().split(/\s+/).filter(Boolean);
  return capabilities.filter(item => {
    const haystack = `${item.name} ${item.description} ${item.keywords || ""} ${item.group}`.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase();
    return tokens.every(token => haystack.includes(token));
  });
}
