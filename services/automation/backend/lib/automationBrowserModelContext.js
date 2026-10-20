const { createHash } = require('node:crypto');

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const targetFlags = Object.freeze(['visible', 'disabled', 'in_viewport']);
const defaultsPolicy = 'For each target, an omitted flag listed in target_defaults equals that observed default. Other omitted fields remain unknown. These flags are snapshot evidence, not completed assertions.';
// Reviewed against the versioned native tool fixture. Bind the ENTIRE wire
// contract, including prose and annotations; schema similarity is insufficient.
const nativeAssertionHash = '48113e611a6e6093bf77ec30b1a0433708e98e567b2e6b709eb08ebb3bf38182';
const nativeAssertionSummary = 'Bounded read-only predicates; inputSchema owns arguments. Unique current targets, except hidden permits zero/count permits many. text/text_contains: normalized visible innerText of whole target incl descendant buttons, not ARIA labels; retain authored equality, use text_contains for an authored fragment, omit unrequired volatile IDs. Snapshot text is a textContent excerpt. text_content modes: native DOM text incl hidden children. value/url/title exact; url_contains literal same-origin substring; title_normalized native whitespace. valid/invalid: input/textarea/select validity.valid with willValidate=true. field_valid: one visible native value-entry input/textarea/select; valid constraints, aria-invalid absent/false, no visible nonempty aria-errormessage or aria-describedby role=alert. Missing aria-describedby hints ignored. Explicit error IDs must resolve; associations need unique same-root IDs (max32 IDs/256 chars), otherwise unsupported. No events or submission. Does not prove server/business/form-wide success, absence of all application errors, or a passed test run. Values withheld.';
const stable = value => Array.isArray(value) ? value.map(stable)
  : record(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;

/** Only the exact reviewed native contract has interchangeable concise prose.
 * Unknown/external/updated tools retain their complete discovered metadata. */
function projectBrowserModelTool(tool) {
  if (!record(tool) || tool.name !== 'browser_assert') return tool;
  try {
    if (createHash('sha256').update(JSON.stringify(stable(tool))).digest('hex') !== nativeAssertionHash) return tool;
    return { ...structuredClone(tool), description: nativeAssertionSummary };
  } catch { return tool; }
}

/** Lossless prompt serialization only. The browser registry, retained receipts
 * and guards continue reading their original complete host evidence. */
function compactBrowserModelContext(current) {
  const copy = structuredClone(current);
  const snapshot = record(copy) && copy.current_snapshot;
  if (!record(snapshot) || !Array.isArray(snapshot.targets) || !snapshot.targets.length
    || Object.hasOwn(snapshot, 'target_defaults') || Object.hasOwn(snapshot, 'target_defaults_policy')) return copy;
  const original = structuredClone(copy);
  const defaults = {};
  for (const key of targetFlags) {
    // A missing/unknown field never inherits a boolean from another target.
    if (!snapshot.targets.every(target => record(target) && Object.hasOwn(target, key) && typeof target[key] === 'boolean')) continue;
    const trueCount = snapshot.targets.filter(target => target[key] === true).length;
    defaults[key] = trueCount > snapshot.targets.length / 2;
    for (const target of snapshot.targets) if (target[key] === defaults[key]) delete target[key];
  }
  if (!Object.keys(defaults).length) return copy;
  snapshot.target_defaults = defaults;
  snapshot.target_defaults_policy = defaultsPolicy;
  // Very small snapshots cost more to describe than their repeated flags.
  // Keep their full representation rather than adding prompt overhead.
  try { if (JSON.stringify(copy).length >= JSON.stringify(original).length) return original; }
  catch { return original; }
  return copy;
}

module.exports = { compactBrowserModelContext, projectBrowserModelTool };
