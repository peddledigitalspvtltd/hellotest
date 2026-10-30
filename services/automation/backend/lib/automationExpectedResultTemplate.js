/** Keep the authored expected-result template alongside resolved task prose.
 * The resolver owns the authorized names and private-value projection; inserted
 * values are never scanned to invent a source parameter reference. */
function automationExpectedResultTemplate(step, resolver) {
  const expected = step?.expected_result;
  if (typeof expected !== 'string' || !resolver.referencedParameterNames([{ action: '', expected_result: expected }]).length) return {};
  return { parameterized_expected_result: resolver.projectPrivateText(expected, { preserveReferences: true }) };
}

module.exports = { automationExpectedResultTemplate };
