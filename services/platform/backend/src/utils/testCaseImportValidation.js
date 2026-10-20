const { TEST_CASE_STATUS_VALUES, TEST_CASE_AUTOMATED_VALUES } = require('../domain/catalog');
const { normalizeDataOptions } = require('./scopedTestData');
const { normalizeAutomationStartUrl } = require('./automationStartUrl');
const fail = message => { throw Object.assign(new Error(message), { statusCode: 400 }); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
exports.validateTestCaseImportRow = row => {
  if (!object(row) || !String(row.title || '').trim()) fail('Test Case title is required');
  if (row.priority !== undefined && (!Number.isInteger(Number(row.priority)) || Number(row.priority) < 1 || Number(row.priority) > 5)) fail('Priority must be an integer from 1 to 5');
  for (const [field, allowed] of Object.entries({ status: TEST_CASE_STATUS_VALUES, automated: TEST_CASE_AUTOMATED_VALUES, authoring_mode: ['structured', 'gherkin'], automation_status: ['not_automated', 'ready', 'incomplete'] })) {
    if (row[field] && !allowed.includes(String(row[field]).toLowerCase())) fail(`Invalid ${field}: ${row[field]}`);
  }
  if (row.authoring_mode === 'gherkin' && !String(row.gherkin_document || '').trim()) fail('Gherkin Document is required for Gherkin authoring');
  for (const key of ['steps', 'shared_groups']) {
    if (row[key] !== undefined && (!Array.isArray(row[key]) || row[key].some(value => !object(value)))) fail(`${key} must be an array of objects`);
  }
  if (row.parameter_values !== undefined && (!object(row.parameter_values) || Object.values(row.parameter_values).some(value => value !== null && typeof value === 'object'))) fail('Parameter Values must be an object of scalar values');
  if (row.automation_start_url !== undefined) normalizeAutomationStartUrl(row.automation_start_url);
  if (row.test_data_options !== undefined) normalizeDataOptions(row.test_data_options);
  for (const group of row.shared_groups || []) {
    if (group.test_data_set_id !== undefined && group.test_data_set_id !== null && typeof group.test_data_set_id !== 'string') fail('Shared Step Group Test Data Set ID must be a string');
    if (group.test_data_row_index !== undefined && (!Number.isSafeInteger(group.test_data_row_index) || group.test_data_row_index < 0)) fail('Shared Step Group Test Data row index must be a non-negative integer');
  }
  for (const [index, step] of (row.steps || []).entries()) {
    if (![step.action, step.expected_result, step.automation_code, step.api_request].some(Boolean)) fail(`Step ${index + 1} has no action, expected result or API request`);
    if (step.step_type && !['web', 'api', 'android', 'ios'].includes(step.step_type)) fail(`Step ${index + 1} has an unsupported step_type`);
    if (step.api_request && !object(step.api_request)) fail(`Step ${index + 1} API Request must be an object`);
  }
  // Imported rows are new authoring records; review decisions remain permission-checked actions.
  if (row.review_status && !['pending', 'not_requested'].includes(row.review_status)) fail('Import cannot approve or reject a Test Case review');
  return row;
};
