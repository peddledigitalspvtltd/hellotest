const AGENTS = Object.freeze([
  { id: 'object_repository', name: 'Object Repository Generator', description: 'Find stable UI objects and locators in repository source.', outcome: 'Review source-backed objects before adding them to the Object Repository.' },
  { id: 'api_tests', name: 'API Test Case Generator', description: 'Turn API contracts and route evidence into test case drafts.', outcome: 'Review requests, observed expectations and missing contract details.' },
  { id: 'repository_knowledge', name: 'Repository Knowledge Builder', description: 'Build searchable repository documentation with source references.', outcome: 'Publish selected documents into the project Knowledge Repo.' },
  { id: 'component_tests', name: 'Component Test Generator', description: 'Derive component test contracts from UI structure and behavior.', outcome: 'Review component scenarios and export their test contracts.' }
]);
const LIMITS = Object.freeze({ max_archive_bytes: 20 * 1024 * 1024, max_files: 3000, max_result_bytes: 6 * 1024 * 1024, max_selected_items: 50, worker_timeout_ms: 180_000, max_concurrent: 2 });
const FINDING_KEYS = Object.freeze({ object_repository: 'objects', api_tests: 'test_cases', repository_knowledge: 'knowledge', component_tests: 'test_cases' });
const PUBLISH_PERMISSIONS = Object.freeze({ object_repository: 'automation.repository.import', api_tests: 'testcase.create', repository_knowledge: 'knowledge.manage', component_tests: 'testcase.create' });
const error = (message, statusCode = 400, code = 'REPOSITORY_AGENT_ERROR') => Object.assign(new Error(message), { statusCode, code, publicMessage: message });
module.exports = { AGENTS, LIMITS, FINDING_KEYS, PUBLISH_PERMISSIONS, error };

const REVIEW_CONTRACTS = Object.freeze({
  object_repository: "Produce an object-by-object review table: source path/line, screen/component, locator intent, existing selector, stability concerns, duplicate candidates and validation steps. Propose source-supported improvements without inventing runtime DOM observations.",
  api_tests: "Provide the API testing rationale and complete reviewable case drafts: source route/method, prerequisites, inputs, numbered request actions, contract-supported status/response assertions, negative and boundary cases, cleanup and source links. Mark undocumented responses or auth requirements as questions. Never claim the requests were executed.",
  repository_knowledge: "Produce a source-backed documentation outline and draft sections covering component responsibilities, API/data relationships, setup and important constraints, with file/line references and explicit missing evidence. Separate code observations from design recommendations; never invent product policy.",
  component_tests: "Explain the component testing rationale and provide actual case drafts: component/prop/state/event under test, setup, concrete inputs, numbered user actions, observable expected behavior, negative/boundary/accessibility coverage and source references. Do not invent a test framework or claim execution."
});
module.exports.REVIEW_CONTRACTS = REVIEW_CONTRACTS;
