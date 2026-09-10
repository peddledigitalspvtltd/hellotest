// Module keys are an API contract: keep legacy selections valid as coverage grows.
const moduleSpec = (key, label, group, description, depends_on, features, routes, feature_keys = []) =>
  ({ key, label, group, description, depends_on, features, routes, feature_keys });
const modules = [
  moduleSpec('workspace', 'Projects & applications', 'Foundation', 'A private Commerce Launchpad with Web, API and Mobile application scopes.', [], ['Project scope', 'Application selection', 'Administrator access'], ['/projects']),
  moduleSpec('planning', 'Stories, sprints & releases', 'Product planning', 'Customer journeys, acceptance criteria and release scope with a deliberate coverage gap.', ['workspace'], ['Backlog', 'Active and future sprints', 'Release scope', 'Story relationships', 'Acceptance criteria'], ['/requirements', '/releases'], ['hellotest.manual.requirements']),
  moduleSpec('design', 'Test design & shared steps', 'Test management', 'Web, API and mobile cases organized into suites and modules with reusable Gherkin steps.', ['planning'], ['Modules', 'Suites', 'Gherkin steps', 'Preconditions', 'Parameters', 'Shared groups', 'Story traceability', 'Version history'], ['/test-cases', '/design', '/shared-steps'], ['hellotest.manual.test_cases']),
  moduleSpec('environments', 'Environments, data & configuration', 'Test management', 'Staging scopes, browser and mobile profiles, and varied customer and payment data.', ['design'], ['Environments', 'Configuration profiles', 'Data rows', 'Case data links', 'Parameter overrides'], ['/test-environments', '/test-data', '/test-configurations']),
  moduleSpec('issues', 'Bugs & collaboration', 'Product planning', 'Open, triaged and resolved defects with root causes, comments and a converted regression test.', ['design'], ['Root causes', 'Bug history', 'Comments', 'Case and story links', 'Convert to test case'], ['/issues'], ['hellotest.manual.bugs']),
  moduleSpec('execution', 'Runs & case execution', 'Execution', 'Saved sample runs with mixed outcomes, frozen steps, timing and linked defects.', ['environments', 'issues'], ['Suite runs', 'Case results', 'Step snapshots', 'Run context', 'Data iterations', 'Duration', 'Defect evidence', 'Lifecycle history'], ['/executions'], ['hellotest.manual.runs']),
  moduleSpec('knowledge', 'Knowledge repository', 'AI & automation', 'Searchable product rules, API contracts and repository guidance with source citations.', ['design'], ['Collections', 'Sources', 'Documents', 'Lexical retrieval', 'Case links', 'Ask AI context'], ['/knowledge-repo'], ['hellotest.ai.knowledge']),
  moduleSpec('automation', 'Object repository & API tests', 'AI & automation', 'Named screen objects with stable locators and API cases with requests and assertions.', ['design'], ['Object screens', 'Field locators', 'API requests', 'Assertions', 'Automation links', 'Mobile selectors'], ['/object-repository', '/test-cases'], ['hellotest.automation.workspace']),
  moduleSpec('agents', 'Agents & prompt templates', 'AI & automation', 'Editable manual workflows for story review, API test design and repository knowledge.', ['knowledge', 'automation'], ['Workflow canvas', 'Specialist selection', 'Manual triggers', 'Review outputs', 'Prompt templates'], ['/agentic-workflows', '/settings?tab=ai'], ['hellotest.ai.agentic_workflows']),
  moduleSpec('dashboards', 'Dashboards & release readiness', 'Insights & operations', 'Executive, Product and QA dashboards calculate metrics from the connected sample records.', ['execution', 'planning'], ['Executive dashboard', 'Product dashboard', 'QA dashboard', 'Coverage gaps', 'Run trends', 'Release readiness'], ['/?view=analytics', '/?view=readiness'], ['hellotest.analytics.dashboards']),
  moduleSpec('integrations', 'Integration setup examples', 'Insights & operations', 'Inactive, credential-free configuration examples for every supported integration type.', ['workspace'], ['Provider configuration', 'Connection testing setup', 'Inactive examples'], ['/integrations'], ['hellotest.api.integrations']),
  moduleSpec('testops', 'Schedules & activity', 'Insights & operations', 'Disabled run schedules and an explicitly labeled sample activity timeline.', ['execution'], ['Run schedules', 'Assignment scope', 'Activity timeline', 'Read notifications'], ['/executions?tab=schedules', '/testops'], ['hellotest.manual.runs'])
];
function resolveModules(requested) {
  if (requested !== undefined && (!Array.isArray(requested) || !requested.length || requested.length > 64 || requested.some(key => typeof key !== 'string'))) {
    throw Object.assign(new Error('Select between 1 and 64 sample modules.'), { statusCode: 400 });
  }
  const selected = [...new Set(requested === undefined ? modules.map(item => item.key) : requested)];
  const known = new Map(modules.map(item => [item.key, item]));
  const invalid = selected.filter(key => !known.has(key));
  if (invalid.length) throw Object.assign(new Error(`Unknown sample modules: ${invalid.join(', ')}`), { statusCode: 400 });
  const ordered = [], visited = new Set();
  const visit = key => { if (visited.has(key)) return; visited.add(key); known.get(key).depends_on.forEach(visit); ordered.push(key); };
  selected.forEach(visit);
  return { requested: selected, installed: ordered, dependencies_added: ordered.filter(key => !selected.includes(key)) };
}
module.exports = { modules, resolveModules };
