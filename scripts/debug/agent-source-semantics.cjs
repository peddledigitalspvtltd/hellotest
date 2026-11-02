// Fixture verification only. This does not execute generated selectors or call a model.
function fixtureTestIdCheck(files, reviews) {
  const declared = new Set();
  for (const content of Object.values(files)) for (const match of String(content).matchAll(/\bdata-testid\s*=\s*(["'])([^"'\r\n]+)\1/g)) declared.add(match[2]);
  const referenced = new Set();
  const visit = value => {
    if (typeof value === 'string') {
      for (const match of value.matchAll(/\bgetByTestId\s*\(\s*(["'`])([^"'`\r\n]+)\1\s*\)/g)) referenced.add(match[2]);
      for (const match of value.matchAll(/\[\s*data-testid\s*=\s*(["'])([^"'\r\n]+)\1\s*\]/g)) referenced.add(match[2]);
    } else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  for (const review of reviews) visit({ response: review.response, artifacts: review.artifacts, tables: review.tables, sections: review.sections });
  const unknown = [...referenced].filter(id => !declared.has(id)).sort();
  return { valid: unknown.length === 0, declared_test_ids: [...declared].sort(), referenced_test_ids: [...referenced].sort(), unknown_test_ids: unknown,
    message: unknown.length ? `Undeclared model test IDs: ${unknown.join(', ')}. Fixture declares: ${[...declared].sort().join(', ')}.` : 'All model test IDs are declared in the fixture source.' };
}
module.exports = { fixtureTestIdCheck };
