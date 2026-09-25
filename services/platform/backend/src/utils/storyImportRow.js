const {REQUIREMENT_STATUS_OPTIONS} = require('../domain/catalog');
const {normalizeAcceptanceCriteria} = require('./storyAcceptanceCriteria');

const fail = message => {throw Object.assign(new Error(message), {statusCode:400});};
function normalizeStoryImportRow(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Each CSV row must be a Story object.');
  const row = {...input};
  if (typeof row.title !== 'string' || row.title.trim().length < 2 || row.title.length > 1000) fail('Title must contain 2–1,000 characters.');
  row.title = row.title.trim();
  for (const key of ['story_id','iteration_id','release_id','sprint','release','fix_version','scrum_team']) if (row[key] !== undefined && (typeof row[key] !== 'string' || row[key].length > 255)) fail(`${key} must be text of at most 255 characters.`);
  for (const key of ['description','specification_content']) if (row[key] !== undefined && (typeof row[key] !== 'string' || row[key].length > 100000)) fail(`${key} must be text of at most 100,000 characters.`);
  for (const key of ['labels','external_references','linked_test_cases','linked_bugs']) if (row[key] !== undefined && !(typeof row[key] === 'string' || (Array.isArray(row[key]) && row[key].length <= 1000 && row[key].every(value => typeof value === 'string' && value.length <= 2000)))) fail(`${key} must contain text values (at most 1,000 entries).`);
  if (row.priority !== undefined && (!Number.isInteger(row.priority) || row.priority < 1 || row.priority > 5)) fail('Priority must be an integer from 1 to 5.');
  if (row.status) {
    const selected = REQUIREMENT_STATUS_OPTIONS.find(option => [option.value,option.label].some(value => value.toLowerCase() === String(row.status).trim().toLowerCase()));
    if (!selected) fail(`Status "${row.status}" is not available in Story creation.`);
    row.status = selected.value;
  }
  if (row.story_id && (!Number.isInteger(row.expected_revision) || row.expected_revision < 1)) fail('An explicit Story ID update requires its current Expected Revision.');
  if (row.acceptance_criteria !== undefined) row.acceptance_criteria = normalizeAcceptanceCriteria(row.acceptance_criteria);
  if (row.additional_fields !== undefined && (!row.additional_fields || typeof row.additional_fields !== 'object' || Array.isArray(row.additional_fields) || Object.keys(row.additional_fields).some(key => key.startsWith('_')))) fail('Additional Fields must be a JSON object without reserved keys beginning with _.');
  if (row.specification_format && !['gherkin','speckit'].includes(row.specification_format)) fail('Specification Format must be gherkin or speckit.');
  if (row.gherkin_scenarios !== undefined && (!Array.isArray(row.gherkin_scenarios) || row.gherkin_scenarios.length > 20 || row.gherkin_scenarios.some(value => typeof value !== 'string' || value.length > 4000))) fail('Gherkin Scenarios must contain at most 20 text entries of 4,000 characters each.');
  for (const key of ['dev_completion_target_date','qa_completion_target_date']) if (row[key]) {
    const value = String(row[key]);
    const date = new Date(value);
    if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) || !Number.isFinite(date.getTime()) || (!value.includes('T') && date.toISOString().slice(0,10) !== value)) fail(`${key} must be a valid ISO date.`);
  }
  if (row.dev_completion_target_date && row.qa_completion_target_date && new Date(row.qa_completion_target_date) < new Date(row.dev_completion_target_date)) fail('QA completion target must be on or after the development target.');
  return row;
}

module.exports = {normalizeStoryImportRow};
