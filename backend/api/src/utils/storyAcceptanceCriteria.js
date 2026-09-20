const { preserveReadinessFields, object } = require('./storyReadiness');

function normalizeAcceptanceCriteria(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 100 || value.some(item => typeof item !== 'string' || item.length > 2000)) {
    throw Object.assign(new Error('Acceptance Criteria must contain at most 100 text entries of 2,000 characters each.'), {statusCode:400});
  }
  return [...new Set(value.map(item => item.trim()).filter(Boolean))];
}

function storyAdditionalFields(incoming, acceptanceCriteria, existing = {}) {
  const fields = {...object(existing), ...object(incoming)};
  if (Object.prototype.hasOwnProperty.call(object(existing), '_story_import')) fields._story_import = object(existing)._story_import;
  else delete fields._story_import;
  const criteria = normalizeAcceptanceCriteria(acceptanceCriteria !== undefined ? acceptanceCriteria : fields.acceptance_criteria);
  if (criteria !== undefined) fields.acceptance_criteria = criteria;
  if (JSON.stringify(fields).length > 50000) throw Object.assign(new Error('Story custom fields and Acceptance Criteria exceed the 50,000 character limit.'), {statusCode:400});
  return preserveReadinessFields(fields, existing);
}

module.exports = {normalizeAcceptanceCriteria, storyAdditionalFields};
