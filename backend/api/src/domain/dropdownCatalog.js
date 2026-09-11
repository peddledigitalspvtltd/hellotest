const domain = require('./catalog');
const options = values => values.map(value => typeof value === 'string' || typeof value === 'number'
  ? { value: String(value), label: String(value) } : value);
const usage = (label, path) => ({ label, path });
const field = (key, label, group, values, config = {}) => ({
  key, label, group, description: config.description || '', kind: 'configurable', value_format: 'text',
  can_add: true, can_edit: true, required: false, supports_default: false, default_value: null,
  usage: [], options: options(values).map(option => ({ ...option, description: option.description || '', active: true, builtin: true })), ...config
});
const system = (key, label, group, values, pages, reason = 'These values select implemented behavior. New values require a supported workflow or capability.') =>
  field(key, label, group, values, { kind: 'system', can_add: false, can_edit: false, usage: pages, reason });
const suggestions = (key, label, group, pages, config = {}) => field(key, label, group, [], {
  kind: 'suggestions', usage: pages, description: 'Workspace suggestions appear before values already used in this project. Users can still enter their own values.', ...config
});
const cases = [usage('Test cases', '/test-cases'), usage('Suite design', '/design')];
const bugs = [usage('Bugs', '/issues')];
const stories = [usage('Stories', '/stories')];
const runs = [usage('Runs and case runs', '/executions')];
const environments = [usage('Environment and configuration', '/test-environments'), ...runs];

const fields = [
  field('issues.root_causes', 'Primary Root Cause', 'Bugs', ['Code Defect','Requirements Gap','Design Defect','Configuration','Test Data','Environment','Integration','Dependency','Deployment','Performance / Capacity','Security','Human Error','Duplicate','Not Reproducible','Unknown'], { usage: bugs, description: 'Classify the primary cause of a native Bug.' }),
  field('issues.qa_root_causes', 'QA Root Cause', 'Bugs', ['Missed test scenario','Missed in execution','Edge case not covered','Unique data variation','Third party scenario'], { usage: bugs, description: 'Classify the test coverage or execution gap behind a Bug.' }),
  field('issues.bug_types', 'Bug type', 'Bugs', ['Functional','UI / UX','Performance','Security','Accessibility','Compatibility','Integration','Data','API','Reliability','Localization','Installation / Deployment','Documentation'], { usage: bugs }),
  field('test_cases.types', 'Test case type', 'Test design', ['functional','regression','smoke','integration','acceptance','exploratory','performance','security','accessibility','ios'].map(value => ({ value, label: value === 'ios' ? 'iOS' : value[0].toUpperCase() + value.slice(1) })), { value_format: 'slug', required: true, supports_default: true, default_value: 'functional', usage: cases, description: 'Describe the purpose of a case. Stored codes remain stable when display labels change.' }),
  suggestions('issues.labels', 'Bug labels', 'Bugs', bugs),
  suggestions('test_cases.labels', 'Test case labels', 'Test design', cases),
  suggestions('test_suites.labels', 'Suite labels', 'Test design', [usage('Suites', '/design')]),
  suggestions('requirements.labels', 'Story labels', 'Planning', stories),
  suggestions('requirements.scrum_teams', 'Scrum teams', 'Planning', stories),
  field('requirements.story_points', 'Story point estimates', 'Planning', [1,2,3,5,8,13,21], { value_format: 'integer', kind: 'suggestions', usage: stories, description: 'Suggested positive whole-number estimates from 1 to 999.' }),
  system('requirements.statuses', 'Story status', 'Planning', domain.REQUIREMENT_STATUS_OPTIONS, stories, 'Delivery completion and readiness use these workflow codes. Connected tracker transitions come from the tracker.'),
  system('requirements.priorities', 'Story priority', 'Planning', domain.PRIORITY_SCALE.map(value => ({ value: String(value), label: `P${value}` })), stories, 'Priority scores use the supported numeric scale from 1 to 5.'),
  system('iterations.states', 'Sprint state', 'Planning', ['future','active','closed'], [usage('Sprints', '/sprints')]),
  system('releases.states', 'Release state', 'Planning', ['planned','in_progress','released'], [usage('Releases', '/releases')]),
  system('test_cases.statuses', 'Test case status', 'Test design', domain.TEST_CASE_STATUS_OPTIONS, cases),
  system('test_cases.priorities', 'Test case priority', 'Test design', domain.PRIORITY_SCALE.map(value => ({ value: String(value), label: `P${value}` })), cases, 'Risk and ordering use the supported numeric scale from 1 to 5.'),
  system('test_cases.automated_options', 'Automated coverage', 'Test design', domain.TEST_CASE_AUTOMATED_OPTIONS, cases),
  system('test_cases.authoring_modes', 'Authoring mode', 'Test design', ['structured','gherkin'], cases),
  system('test_steps.types', 'Step platform', 'Automation', domain.TEST_STEP_TYPE_OPTIONS, cases),
  system('test_steps.group_kinds', 'Step group kind', 'Automation', domain.TEST_STEP_GROUP_KIND_OPTIONS, cases),
  system('issues.statuses', 'Bug status', 'Bugs', domain.ISSUE_STATUS_OPTIONS, bugs, 'Resolution and risk calculations use these workflow codes. Connected trackers own their transition choices.'),
  system('issues.severities', 'Bug severity', 'Bugs', ['critical','high','medium','low'], bugs, 'Severity codes drive risk calculations and AI triage.'),
  system('issues.priorities', 'Bug priority', 'Bugs', ['Highest','High','Medium','Low','Lowest'], bugs, 'Priority values drive risk calculations. Tracker-specific priorities come from its metadata.'),
  system('executions.modes', 'Run mode', 'Execution', ['manual','local','remote'], runs),
  system('executions.statuses', 'Run status', 'Execution', domain.EXECUTION_STATUS_OPTIONS, runs),
  system('executions.final_statuses', 'Run completion result', 'Execution', domain.EXECUTION_FINAL_STATUS_OPTIONS, runs),
  system('executions.result_statuses', 'Case execution result', 'Execution', domain.EXECUTION_RESULT_STATUS_OPTIONS, runs),
  system('executions.impact_levels', 'Impact level', 'Execution', domain.DOMAIN_METADATA.executions.impact_levels, runs),
  system('test_data_sets.modes', 'Test data mode', 'Execution', domain.TEST_DATA_SET_MODE_OPTIONS, environments),
  system('test_environments.browsers', 'Browser families', 'Execution', domain.DOMAIN_METADATA.test_environments.browsers, environments, 'Options must map to supported local or remote browser engines. Browser versions remain configuration data.'),
  system('test_environments.mobile_os', 'Mobile platform', 'Execution', domain.DOMAIN_METADATA.test_environments.mobile_os, environments),
  system('test_configurations.operating_systems', 'Configuration operating system', 'Execution', domain.TEST_CONFIGURATION_OPERATING_SYSTEM_OPTIONS, environments),
  system('app_types.types', 'Application platform', 'Workspace', domain.APP_TYPE_OPTIONS, [usage('Projects and applications', '/projects')]),
  system('projects.visibility', 'Project visibility', 'Workspace', ['public','private'], [usage('Projects', '/projects')], 'Visibility changes project access behavior.'),
  system('integrations.types', 'Integration type', 'Connections', domain.INTEGRATION_TYPE_OPTIONS.map(({value,label,description}) => ({value,label,description})), [usage('Integrations', '/integrations')]),
  system('automation.http_methods', 'HTTP method', 'Automation', ['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'], [usage('API test steps', '/test-cases'),usage('Automation', '/automation')]),
  system('automation.engines', 'Web automation engine', 'Automation', ['playwright','selenium'], [usage('Integrations', '/integrations')]),
  system('automation.parameter_scopes', 'Parameter scope', 'Automation', [{value:'r',label:'Run'},{value:'s',label:'Suite'},{value:'t',label:'Test case'}], [...cases,...runs]),
  system('automation.gherkin_keywords', 'Gherkin keyword', 'Automation', ['Given','When','Then','And','But'], cases),
  system('automation.schedule_modes', 'Integration schedule cadence', 'Automation', ['manual','daily','weekly','monthly'], [usage('Integrations', '/integrations')]),
  system('executions.schedule_cadence', 'Run schedule cadence', 'Execution', ['once','daily','weekly','monthly'], runs),
  system('automation.trace_modes', 'Trace capture', 'Automation', ['off','on','retain-on-failure','on-first-retry'], [usage('Integrations', '/integrations')]),
  system('automation.video_modes', 'Video capture', 'Automation', ['off','on','retain-on-failure'], [usage('Integrations', '/integrations')])
];

for (const [key,label,group,path,reason] of [
  ['records.projects','Projects and applications','Workspace','/projects','Create actual projects and applications. Available options follow project membership and application scope.'],
  ['records.users','Assignees, reporters and reviewers','Workspace','/people','Manage members and roles; selectors show users allowed in the selected project.'],
  ['records.roles','Roles and permissions','Workspace','/people','Manage roles and granted permissions through Access. Dropdown entries cannot grant access.'],
  ['records.stories','Linked Stories','Planning','/stories','Choices come from visible Stories in the selected project.'],
  ['records.sprints','Sprints and iterations','Planning','/sprints','Create sprint records to make them available in scoped selectors.'],
  ['records.releases','Releases and fix versions','Planning','/releases','Create release records; linked tracker versions come from tracker metadata.'],
  ['records.design','Modules, suites and test cases','Test design','/design','Create design records. Run and case selectors preserve their existing project/application permissions.'],
  ['records.shared_steps','Shared step groups','Test design','/shared-steps','Create reusable step groups in the application to populate group selectors.'],
  ['records.context','Environments, configurations and test data','Execution','/test-environments','Create context records. Execution selectors use the current project and application.'],
  ['records.runs','Runs and results','Execution','/executions','Run selectors use saved runs and their recorded execution scope.'],
  ['records.connections','Connection profiles and provider choices','Connections','/integrations','Providers, models, remote devices and required tracker fields are supplied by supported integrations.'],
  ['records.knowledge','Knowledge collections, sources and revisions','Knowledge and AI','/knowledge-repo','Create knowledge sources and collections; selectors reflect accessible published records.'],
  ['records.agents','Agents, tools and workflow policies','Knowledge and AI','/agentic-workflows','Choices require installed agent/tool implementations and supported workflow contracts.'],
  ['records.dashboards','Dashboards, widgets and chart types','Analytics','/','Saved dashboards and supported widget renderers supply these options.'],
  ['records.regional','Languages, dates and time zones','Workspace','/settings','Supported locales and time zones come from localization and runtime capabilities.']
]) fields.push(field(key,label,group,[],{kind:'records',can_add:false,can_edit:false,manage_path:path,reason,usage:[usage(label,path)]}));

module.exports = { DROPDOWN_FIELDS: fields, DROPDOWN_FIELDS_BY_KEY: new Map(fields.map(item => [item.key,item])) };
