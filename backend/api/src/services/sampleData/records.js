const crypto = require('crypto');
const dashboardTemplates = require('../qualityDashboardTemplates');
const { modules } = require('./catalog');
const PROJECT = 'sample-project';
const APP = { web: 'sample-app-web', api: 'sample-app-api', mobile: 'sample-app-mobile' };
const LABELS = ['sample', 'commerce-launchpad'];
const scenarios = [
  ['login', 'Customer signs in', 'auth', 'web', 'smoke', 'a verified customer account', 'the customer signs in with <email>', 'the account overview is displayed'],
  ['checkout', 'Customer completes checkout', 'checkout', 'web', 'smoke', 'a basket with an in-stock product', 'the customer pays with <payment_method>', 'one order is created and a receipt is displayed'],
  ['keyboard', 'Checkout supports keyboard navigation', 'accessibility', 'web', 'accessibility', 'checkout is open without using a pointer', 'the customer tabs through each payment control', 'focus remains visible and reaches the confirmation button'],
  ['expired-session', 'Expired sessions preserve the basket', 'auth', 'web', 'security', 'a basket exists and the session has expired', 'the customer signs in again', 'the basket is restored without exposing another account'],
  ['declined-payment', 'Declined payments allow a safe retry', 'checkout', 'web', 'regression', 'the payment provider declines the first authorization', 'the customer retries with an approved payment method', 'one charge and one order are created'],
  ['stock-api', 'Inventory API returns available stock', 'inventory', 'api', 'integration', 'SKU <sku> exists in the staging inventory', 'GET /v1/inventory/<sku> is requested', 'the response is 200 and available quantity is non-negative'],
  ['duplicate-api', 'Order API rejects duplicate idempotency keys', 'checkout', 'api', 'integration', 'an order was created with idempotency key <request_key>', 'POST /v1/orders is repeated with the same key', 'the existing order is returned without a second charge'],
  ['unauthorized-api', 'Order API requires authentication', 'auth', 'api', 'security', 'no customer authorization is provided', 'GET /v1/orders is requested', 'the response is 401 without customer information'],
  ['mobile-cart', 'Mobile basket survives an app restart', 'mobile', 'mobile', 'regression', 'a customer added a product to the mobile basket', 'the app is closed and reopened', 'the product and quantity are retained'],
  ['mobile-offline', 'Mobile checkout explains an offline connection', 'mobile', 'mobile', 'functional', 'the basket has an in-stock product', 'the customer starts checkout without a network connection', 'an offline message is shown and the basket remains intact'],
  ['mobile-accessibility', 'Mobile controls have accessible labels', 'accessibility', 'mobile', 'accessibility', 'the accessibility reader is enabled', 'the customer navigates basket controls', 'each control announces its name and state']
];
const storyDefs = [
  ['auth', 'Secure customer sign-in', 'Customers can sign in, recover an expired session, and keep their private basket.', 1],
  ['checkout', 'Reliable checkout', 'Payment retries and idempotent order creation must never create a duplicate charge.', 1],
  ['accessibility', 'Accessible core journeys', 'Keyboard and assistive technology users can navigate and complete checkout.', 2],
  ['inventory', 'Accurate stock availability', 'The inventory API exposes current availability and rejects unknown product identifiers.', 2],
  ['mobile', 'Resilient mobile shopping', 'Customers keep their basket across restarts and receive clear offline recovery guidance.', 2],
  ['refunds', 'Partial refunds with clear receipts', 'Support staff can refund one line item without refunding the entire order. This next-release story intentionally has no tests yet.', 3]
];
function buildRecords(actorId, now = new Date()) {
  const packs = Object.fromEntries(modules.map(item => [item.key, []]));
  const at = (days, minutes = 0) => new Date(now.getTime() + days * 86400000 + minutes * 60000).toISOString();
  const date = days => at(days).slice(0, 10);
  const add = (pack, table, values, keys = ['id']) => { packs[pack].push({ table, values, keys }); return values; };
  add('workspace', 'projects', { id: PROJECT, display_id: 'DEMO', name: 'HelloTest Launchpad', description: 'Synthetic Commerce Launchpad for exploring connected product features.', visibility: 'private', created_by: actorId });
  for (const [platform, name, type, is_unified] of [['web', 'Customer Portal', 'web', false], ['api', 'Commerce API', 'api', false], ['mobile', 'Mobile Experience', 'unified', true]]) {
    add('workspace', 'app_types', { id: APP[platform], project_id: PROJECT, name, type, is_unified });
  }
  for (const [key, name, state, start, end] of [['launch', 'Launch sprint', 'active', -7, 7], ['next', 'Recovery improvements', 'future', 8, 21]]) {
    add('planning', 'requirement_iterations', { id: `sample-sprint-${key}`, project_id: PROJECT, name, description: 'Sample commerce delivery iteration.', goal: key === 'launch' ? 'Validate checkout and account recovery across channels.' : 'Close refund coverage and improve recovery paths.', state, start_date: at(start), end_date: at(end), assignee_id: actorId, created_by: actorId, labels: LABELS });
    add('planning', 'requirement_releases', { id: `sample-release-${key}`, project_id: PROJECT, name: key === 'launch' ? 'Commerce 1.0' : 'Commerce 1.1', fix_version: key === 'launch' ? '1.0.0' : '1.1.0', description: 'Sample release scope for readiness review.', state: key === 'launch' ? 'in_progress' : 'planned', plan_date: at(start), target_date: at(end), sprint_ids: [`sample-sprint-${key}`], created_by: actorId });
  }
  storyDefs.forEach(([key, title, description, priority], index) => {
    const next = key === 'refunds';
    add('planning', 'requirements', { id: `sample-req-${key}`, display_id: `DEMO-R${index + 1}`, project_id: PROJECT, title, description, priority, status: next ? 'draft' : 'ready', iteration_id: `sample-sprint-${next ? 'next' : 'launch'}`, sprint: next ? 'Recovery improvements' : 'Launch sprint', release: next ? 'Commerce 1.1' : 'Commerce 1.0', fix_version: next ? '1.1.0' : '1.0.0', labels: LABELS, specification_format: 'gherkin', specification_content: `Feature: ${title}\n\n  Scenario: Validate the customer outcome\n    Given a customer in the Commerce Launchpad\n    When the customer uses ${title.toLowerCase()}\n    Then ${description}`, created_at: at(-14 + index) });
    add('planning', 'requirement_release_items', { release_id: `sample-release-${next ? 'next' : 'launch'}`, requirement_id: `sample-req-${key}`, source: 'sprint' }, ['release_id', 'requirement_id']);
  });
  add('planning', 'requirement_relations', { requirement_id: 'sample-req-checkout', related_requirement_id: 'sample-req-inventory', relation: 'depends on' }, ['requirement_id', 'related_requirement_id']);
  const suiteId = platform => platform === 'web' ? 'sample-suite-smoke' : `sample-suite-${platform}`;
  const moduleId = platform => platform === 'web' ? 'sample-module-smoke' : `sample-module-${platform}`;
  const suiteName = platform => ({ web: 'Release smoke suite', api: 'Commerce API contract suite', mobile: 'Mobile recovery suite' })[platform];
  for (const platform of Object.keys(APP)) {
    add('design', 'test_case_modules', { id: moduleId(platform), app_type_id: APP[platform], name: { web: 'Release smoke', api: 'Commerce API', mobile: 'Mobile experience' }[platform], description: 'Connected sample coverage for customer journeys.', created_by: actorId });
    add('design', 'test_suites', { id: suiteId(platform), app_type_id: APP[platform], name: suiteName(platform), labels: LABELS, parameter_values: { region: 'us-east', email: 'suite.customer@example.test' } });
  }
  const cases = [], steps = [];
  scenarios.forEach(([key, title, story, platform, type, given, when, then], index) => {
    const parameters = { email: 'alex@example.test', payment_method: 'approved-card', sku: 'TRAIL-100', request_key: 'sample-order-001', region: 'eu-west' };
    const item = add('design', 'test_cases', { id: `sample-case-${key}`, display_id: `DEMO-T${index + 1}`, app_type_id: APP[platform], suite_id: suiteId(platform), title, description: `Sample scenario: ${given}. ${then}.`, authoring_mode: 'gherkin', gherkin_document: `Feature: ${title}\n\n  Background: Preconditions\n    Given ${given}\n\n  Scenario: ${title}\n    When ${when}\n    Then ${then}`, test_case_type: type, automated: 'no', automation_status: 'not_automated', parameter_values: parameters, priority: index < 2 ? 1 : 2, status: 'active', requirement_id: `sample-req-${story}`, author_id: actorId, labels: LABELS, created_at: at(-12 + Math.floor(index / 2)) });
    cases.push({ ...item, platform, moduleId: moduleId(platform), suiteName: suiteName(platform) });
    add('design', 'test_case_module_cases', { module_id: moduleId(platform), test_case_id: item.id, sort_order: index + 1 }, ['module_id', 'test_case_id']);
    add('design', 'suite_test_cases', { suite_id: suiteId(platform), test_case_id: item.id, sort_order: index + 1 }, ['suite_id', 'test_case_id']);
    add('design', 'requirement_test_cases', { requirement_id: item.requirement_id, test_case_id: item.id }, ['requirement_id', 'test_case_id']);
    [given, when, then].forEach((text, position) => {
      const step = { id: `sample-step-${key}-${position + 1}`, test_case_id: item.id, step_order: position + 1, action: `${['Given', 'When', 'Then'][position]} ${text}`, expected_result: position === 2 ? then : 'The precondition or action is completed.', step_type: platform === 'api' ? 'api' : platform === 'mobile' ? 'android' : 'web', group_id: position === 0 ? `sample-preconditions-${key}` : `sample-group-${key}`, group_name: position === 0 ? 'Preconditions' : title, group_kind: 'local' };
      if (platform === 'api' && position === 1) step.api_request = { method: key === 'duplicate-api' ? 'POST' : 'GET', url: key === 'stock-api' ? '{{base_url}}/v1/inventory/{{sku}}' : '{{base_url}}/v1/orders', headers: [{ key: 'Accept', value: 'application/json', enabled: true }], body: key === 'duplicate-api' ? '{"sku":"{{sku}}","quantity":1}' : '', body_mode: key === 'duplicate-api' ? 'json' : 'none', validations: [{ kind: 'status', expected: key === 'unauthorized-api' ? '401' : '200' }] };
      steps.push(add('design', 'test_steps', step));
    });
    add('design', 'test_case_versions', { id: `sample-version-${key}`, test_case_id: item.id, revision: 1, snapshot: { ...item, steps: steps.filter(step => step.test_case_id === item.id) }, change_summary: 'Initial sample scenario with acceptance criteria.', created_by: actorId });
  });
  // Shared background is reusable and has the same parameter syntax as a case.
  add('design', 'shared_step_groups', { id: 'sample-shared-session', app_type_id: APP.web, name: 'Verified customer session', description: 'Reusable sign-in preconditions.', authoring_mode: 'gherkin', gherkin_document: 'Background: Verified customer session\n  Given a verified account for <email>\n  And the customer is signed in', parameter_values: { email: 'alex@example.test' }, steps: [{ id: 'sample-shared-session-1', step_order: 1, action: 'Given a verified account for <email>', expected_result: 'The account is active.', step_type: 'web' }, { id: 'sample-shared-session-2', step_order: 2, action: 'And the customer is signed in', expected_result: 'The customer dashboard is open.', step_type: 'web' }] });
  const customerRows = [{ email: 'alex@example.test', segment: 'standard', region: 'us-east', payment_method: 'approved-card' }, { email: 'priya@example.test', segment: 'premium', region: 'eu-west', payment_method: 'approved-card' }, { email: 'sam@example.test', segment: 'new', region: 'ap-south', payment_method: 'declined-card' }];
  for (const platform of Object.keys(APP)) {
    add('environments', 'test_environments', { id: platform === 'web' ? 'sample-env-staging' : `sample-env-${platform}`, project_id: PROJECT, app_type_id: APP[platform], name: `${platform === 'web' ? '' : platform.toUpperCase() + ' '}Staging`, description: 'Synthetic endpoint; replace with your own application before execution.', base_url: `https://${platform === 'api' ? 'api.' : ''}staging.example.test`, browser: platform === 'web' ? 'Chrome' : null, variables: [{ key: 'base_url', value: `https://${platform === 'api' ? 'api.' : ''}staging.example.test` }, { key: 'region', value: 'us-east' }] });
    add('environments', 'test_configurations', { id: platform === 'web' ? 'sample-config-chrome' : `sample-config-${platform}`, project_id: PROJECT, app_type_id: APP[platform], name: { web: 'Chrome desktop', api: 'API contract profile', mobile: 'Android handset' }[platform], description: 'Sample configuration profile.', browser: platform === 'web' ? 'Chrome' : null, mobile_os: platform === 'mobile' ? 'android' : null, platform_version: platform === 'mobile' ? '14' : null, variables: [{ key: 'locale', value: 'en-US' }, { key: 'timeout_ms', value: '15000' }] });
  }
  add('environments', 'test_configurations', { id: 'sample-config-firefox', project_id: PROJECT, app_type_id: APP.web, name: 'Firefox desktop', description: 'Cross-browser coverage profile.', browser: 'Firefox', variables: [{ key: 'locale', value: 'es-ES' }] });
  add('environments', 'test_data_sets', { id: 'sample-data-customers', project_id: PROJECT, app_type_id: APP.web, name: 'Customer personas', description: 'Synthetic customer rows illustrating regional and payment variations.', mode: 'table', columns: Object.keys(customerRows[0]), rows: customerRows });
  add('environments', 'test_data_sets', { id: 'sample-data-api', project_id: PROJECT, app_type_id: APP.api, name: 'Order contract inputs', description: 'Known product and idempotency inputs.', mode: 'table', columns: ['sku', 'request_key', 'quantity'], rows: [{ sku: 'TRAIL-100', request_key: 'sample-order-001', quantity: '1' }, { sku: 'TRAIL-200', request_key: 'sample-order-002', quantity: '2' }] });
  for (const item of cases.filter(item => item.platform !== 'mobile')) add('environments', 'test_case_data_sets', { test_case_id: item.id, test_data_set_id: item.platform === 'api' ? 'sample-data-api' : 'sample-data-customers', sort_order: 1 }, ['test_case_id', 'test_data_set_id']);
  require('./featureRecords')({ packs, add, actorId, at, date, cases, steps, customerRows, PROJECT, APP, LABELS, dashboardTemplates, crypto });
  // Versioned content must not append new outcomes to a legacy demo run or
  // change a previously edited story. Reuse only the project/app anchors.
  const anchors = new Set([PROJECT, ...Object.values(APP)]);
  const ids = new Map(Object.values(packs).flat().map(record => record.values.id).filter(id => id && !anchors.has(id)).map(id => [id, id.replace(/^sample-/, 'sample-v2-')]));
  const remap = value => {
    if (typeof value === 'string') return value.replace(/sample-[a-z0-9-]+/g, id => ids.get(id) || id).replace(/^DEMO-/, 'DEMO2-');
    if (Array.isArray(value)) return value.map(remap);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [ids.get(key) || key, remap(item)]));
    return value;
  };
  for (const record of Object.values(packs).flat()) {
    record.values = remap(record.values);
    if (record.table !== 'projects' && record.values.display_id) record.values.display_id = record.values.display_id.replace(/^DEMO-/, 'DEMO2-');
  }
  return packs;
}
module.exports = { buildRecords, PROJECT, APP };
