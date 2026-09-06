// Versioned, deterministic HelloTest product context. This catalog is kept
// separate from the retrieval engine so feature guidance can evolve without
// coupling product language to database/vector implementation details.
const PRODUCT_HELP_VERSION = "2026.09";

const PRODUCT_HELP_SECTIONS = Object.freeze([
  {
    id: "workspace-navigation",
    title: "Workspace, projects, and application navigation",
    aliases: ["workspace", "project", "application type", "navigation", "permissions", "roles"],
    content: "HelloTest is organized by workspace, project, and application type. A project can contain multiple application workspaces. Navigation and visible actions are governed by feature flags plus workspace and project permissions, so a missing area or action should first be checked against the user's current project, application, role, and enabled features."
  },
  {
    id: "knowledge-repository",
    title: "Knowledge Repository ingestion and search",
    aliases: ["knowledge repo", "knowledge repository", "context studio", "ingest", "upload document", "hybrid search", "collection"],
    content: "Knowledge Repo can index selected Stories, Test Cases, Test Runs, Bugs, text, chat notes, URLs, and supported files into reusable collections. Processing validates the input, extracts or accepts supplied text, redacts supported sensitive identifiers, neutralizes instruction-like content, versions the source, preserves document and section context, chunks the content, and builds hybrid lexical and semantic indexes. PDF and Office extraction uses the configured Apache Tika service. Images need a user-supplied caption; audio and video need a transcript. The source inventory shows whether content is searchable, needs extraction, or failed and can be retried. Search results are citation-ready and remain project and permission scoped."
  },
  {
    id: "ask-hellotest",
    title: "Ask HelloTest grounded assistant",
    aliases: ["ask hellotest", "chatbot", "assistant", "ai chat", "grounded answer", "context injection", "citations"],
    content: "Ask HelloTest classifies each question as product guidance, current project facts, project analysis, or a mixed request. It can combine permitted live project snapshots with matching Knowledge Repo chunks, expand retrieval when evidence is incomplete, and send only bounded citation-ready evidence to the configured project-safe LLM. Answers are structured into a summary, findings, recommended next steps, and evidence gaps. A second grounding check is used when available. If no LLM is configured or the provider is unavailable, Ask HelloTest returns a deterministic citation-backed live or extractive answer instead of inventing facts. Follow-up questions use recent conversation only to resolve references and still retrieve fresh project evidence."
  },
  {
    id: "stories-delivery",
    title: "Stories, Backlog, Sprints, and Releases",
    aliases: ["story", "requirement", "backlog", "acceptance criteria", "sprint", "release", "fix version", "traceability"],
    content: "Stories capture requirements, description, acceptance criteria or specifications, priority, delivery metadata, and traceability to Test Cases. Backlog, Sprint, Release, and fix-version fields organize delivery scope. Coverage views use linked Test Cases as traceability evidence; zero links is uncovered, while one link is a review signal rather than proof that every acceptance boundary is covered."
  },
  {
    id: "test-design",
    title: "Test Cases, Gherkin, Shared Steps, parameters, and datasets",
    aliases: ["test case", "gherkin", "scenario outline", "examples", "shared step", "test parameter", "test data", "dataset"],
    content: "Test Cases support structured and Gherkin authoring, including Feature, Background, Scenario or Scenario Outline, behavior steps, parameters, and Examples linked from datasets. When example data is present, the scenario is treated as a Scenario Outline. Shared Step Groups provide reusable behavior. Test data and parameters can be scoped to cases, groups, suites, and runs; sensitive values remain masked and should not be rendered into visible step text. Test Cases can link to Stories, suites, modules, authors, reviewers, automation metadata, and execution evidence."
  },
  {
    id: "suites-modules",
    title: "Suites, modules, and reusable test organization",
    aliases: ["suite", "module", "suite filter", "reorder module", "reorder test case", "create test case in module"],
    content: "Modules organize related Test Cases and can create or associate cases within that scope. Suites assemble selected Test Cases for repeatable execution and can use combined filters to narrow candidates. Suite modules and list-view Test Cases can be reordered where ordering controls are available; the stored order is used when building a run."
  },
  {
    id: "runs-execution-context",
    title: "Runs, environments, configurations, schedules, and results",
    aliases: ["test run", "execution", "environment", "configuration", "browser", "device", "schedule", "result", "failed run", "blocked"],
    content: "A Test Run snapshots its selected Test Cases and execution context so results remain reproducible. Execution context can include environment, configuration targets such as browser or device, dataset rows and parameter values, Release, Sprint, and Build. Run results record passed, failed, blocked, skipped, or other configured outcomes and can provide evidence for failure analysis, automation readiness, and Bugs. Schedules create repeatable run plans from an authorized project scope."
  },
  {
    id: "bugs",
    title: "Bugs, triage, duplicate review, and traceability",
    aliases: ["bug", "defect", "issue", "triage", "duplicate bug", "root cause", "regression", "attachment", "comment"],
    content: "Bugs capture title, description, type, status, severity, priority, root cause, regression flag, environment, build, release or fixed version, attachments, and comments. Impacted Test Cases, suites, modules, Stories, and Test Runs provide traceability. Before creation, duplicate review can narrow candidates using selected Test Cases or modules and let the user inspect matches or continue. Bug detail can retain comments and attachments and can map relevant Bug information into a new Test Case."
  },
  {
    id: "automation",
    title: "Automation, recorder, and object repository",
    aliases: ["automation", "recorder", "object repository", "locator", "selector", "binding", "playwright", "selenium"],
    content: "Automation features connect executable coverage to Test Cases and reusable steps. The recorder and object repository retain page or screen intent, locator bindings, platform metadata, source, confidence, and usage evidence. Low-confidence or duplicate bindings should be reviewed before reuse. Automation planning should consider case readiness, shared behavior, stable data boundaries, recent failures, and target environment constraints."
  },
  {
    id: "reports-quality",
    title: "Reports, dashboards, coverage, and quality readiness",
    aliases: ["report", "dashboard", "metric", "coverage", "quality", "readiness", "risk"],
    content: "HelloTest reports and quality dashboards summarize current authorized project evidence such as Story coverage, Test Case quality and automation readiness, Run outcomes, and open Bug risk. Metrics should be interpreted with their methodology and underlying records; a count is a signal, not by itself a release decision. Ask HelloTest can combine these current facts with cited Knowledge Repo context to explain risks and evidence gaps."
  },
  {
    id: "settings-integrations-ai",
    title: "Settings, integrations, and governed AI configuration",
    aliases: ["settings", "integration", "llm", "base url", "api key", "ai configuration", "feature flag", "prompt mapping"],
    content: "Workspace administrators govern roles, permissions, feature flags, localization, integrations, and prompt-to-LLM mappings. AI capabilities reuse an active, project-compatible LLM integration's model, Base URL, and API key. Knowledge embeddings use that same governed integration when its provider supports embeddings and automatically fall back to deterministic local vectors when it does not; there is no separate embedding model or endpoint configuration. Assistant retrieval and deterministic fallbacks continue to work when an LLM is absent."
  }
]);

const STOP_WORDS = new Set(["a", "an", "and", "are", "can", "do", "for", "from", "how", "i", "in", "is", "it", "me", "of", "on", "or", "the", "this", "to", "use", "what", "where", "with"]);
const TOKEN_ALIASES = Object.freeze({
  chatbot: ["assistant", "ask", "grounded"],
  defect: ["bug", "triage"],
  defects: ["bug", "triage"],
  issue: ["bug"],
  requirements: ["story", "acceptance"],
  requirement: ["story", "acceptance"],
  cases: ["test", "case"],
  execution: ["run", "result"],
  executions: ["run", "result"],
  repo: ["repository"],
  ai: ["llm", "assistant"]
});

const tokenize = (value) => String(value || "").toLowerCase().match(/[a-z0-9][a-z0-9_.-]{1,48}/g) || [];

const queryTerms = (value) => {
  const terms = tokenize(value).filter((term) => !STOP_WORDS.has(term));
  return [...new Set(terms.flatMap((term) => [term, ...(TOKEN_ALIASES[term] || [])]))];
};

const rankProductHelpSections = (query, limit = 6) => {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  const terms = queryTerms(normalizedQuery);
  if (!normalizedQuery || !terms.length) return [];
  return PRODUCT_HELP_SECTIONS.map((section) => {
    const searchable = `${section.title} ${section.aliases.join(" ")} ${section.content}`.toLowerCase();
    const searchableTerms = new Set(tokenize(searchable));
    const matchedTerms = terms.filter((term) => searchableTerms.has(term) || searchable.includes(term));
    const exactAlias = section.aliases.some((alias) => normalizedQuery.includes(alias.toLowerCase()));
    const titleMatch = terms.some((term) => section.title.toLowerCase().includes(term));
    const score = Math.min(1, (matchedTerms.length / terms.length) * 0.68 + (exactAlias ? 0.24 : 0) + (titleMatch ? 0.08 : 0));
    return { ...section, relevance: Number(score.toFixed(6)) };
  }).filter((section) => section.relevance >= 0.08)
    .sort((left, right) => right.relevance - left.relevance || left.title.localeCompare(right.title))
    .slice(0, Math.max(1, Math.min(10, Number(limit) || 6)));
};

module.exports = {
  PRODUCT_HELP_SECTIONS,
  PRODUCT_HELP_VERSION,
  rankProductHelpSections
};
