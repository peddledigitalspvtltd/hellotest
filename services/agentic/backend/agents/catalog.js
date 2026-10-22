const AGENTS = Object.freeze([
  { id: 'object_repository', name: 'Object Repository Generator', description: 'Find stable UI objects and locators in repository source.', outcome: 'Review source-backed objects before adding them to the Object Repository.' },
  { id: 'api_tests', name: 'API Test Case Generator', description: 'Turn API contracts and route evidence into test case drafts.', outcome: 'Review requests, observed expectations and missing contract details.' },
  { id: 'repository_knowledge', name: 'Repository Knowledge Builder', description: 'Build searchable repository documentation with source references.', outcome: 'Publish selected documents into the project Knowledge Repo.' },
  { id: 'component_tests', name: 'Component Test Generator', description: 'Derive component test contracts from UI structure and behavior.', outcome: 'Review component scenarios and export their test contracts.' }
]);
const LIMITS = Object.freeze({ max_archive_bytes: Math.max(20 * 1024 * 1024, Number.parseInt(process.env.REPOSITORY_ARCHIVE_QUOTA_BYTES, 10) || 1024 * 1024 * 1024), max_files: 30000, max_result_bytes: 6 * 1024 * 1024, max_selected_items: 50, worker_timeout_ms: 600_000, max_concurrent: 2 });
const FINDING_KEYS = Object.freeze({ object_repository: 'objects', api_tests: 'test_cases', repository_knowledge: 'knowledge', component_tests: 'test_cases' });
const PUBLISH_PERMISSIONS = Object.freeze({ object_repository: 'automation.repository.import', api_tests: 'testcase.create', repository_knowledge: 'knowledge.manage', component_tests: 'testcase.create' });
const PUBLISH_ADDITIONAL_PERMISSIONS = Object.freeze({ api_tests: ['automation.view', 'automation.code.view', 'automation.build'], component_tests: ['automation.view', 'automation.code.view', 'automation.build'] });
const error = (message, statusCode = 400, code = 'REPOSITORY_AGENT_ERROR') => Object.assign(new Error(message), { statusCode, code, publicMessage: message });
module.exports = { AGENTS, LIMITS, FINDING_KEYS, PUBLISH_PERMISSIONS, PUBLISH_ADDITIONAL_PERMISSIONS, error };
