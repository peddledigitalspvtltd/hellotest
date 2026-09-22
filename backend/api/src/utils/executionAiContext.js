// Keep evidence parseable and prioritize failures even when they occurred late
// in a long run. Never truncate a serialized JSON document in the middle.
const compact = (value, depth = 0) => {
  if (typeof value === 'string') return value.length > 600 ? `${value.slice(0, 560)} [text shortened]` : value;
  // PostgreSQL returns timestamptz values as Date instances. Preserve the JSON
  // timestamp rather than reducing their empty enumerable properties to {}.
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= 4) return '[nested evidence omitted]';
  if (Array.isArray(value)) return value.slice(0, 8).map(item => compact(item, depth + 1));
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 16).map(([key, item]) => [key, compact(item, depth + 1)]));
  return null;
};

const boundedExecutionAiContext = (input, limit = 18000) => {
  const steps = Array.isArray(input.steps) ? input.steps : [];
  const result = {
    reviewer_request: compact(input.reviewer_request), execution: compact(input.execution),
    test_case: compact(input.test_case), result: compact(input.result), steps: [],
    evidence_boundary: { total_steps: steps.length, included_steps: 0, omitted_steps: steps.length,
      note: 'Text and nested telemetry are bounded excerpts. Missing detail does not prove absence.' }
  };
  // Case parameter pools can be large; retain the identity and failure summary.
  if (JSON.stringify(result).length > limit / 2 && result.test_case) {
    result.test_case.parameter_values = '[parameter values omitted for input budget]';
  }
  if (JSON.stringify(result).length > limit / 2) {
    const testCase = input.test_case || {};
    const outcome = input.result || {};
    result.test_case = compact({ id: testCase.id, title: testCase.title, description: testCase.description, status: testCase.status });
    result.result = compact({ status: outcome.status, duration_ms: outcome.duration_ms, error: outcome.error });
    result.evidence_boundary.note += ' Additional case metadata and result references were omitted.';
  }
  const ranked = [...steps].sort((a, b) => Number(['failed', 'blocked'].includes(b.status)) - Number(['failed', 'blocked'].includes(a.status)));
  for (const step of ranked) {
    const next = compact(step);
    result.steps.push(next);
    if (JSON.stringify(result).length > limit) {
      result.steps.pop();
      // Large telemetry must not crowd out its actual failed assertion.
      const brief = compact({ id: step.id, step_order: step.step_order, status: step.status, action: step.action, expected_result: step.expected_result, note: step.note });
      result.steps.push(brief);
      if (JSON.stringify(result).length > limit) { result.steps.pop(); break; }
    }
  }
  result.steps.sort((a, b) => Number(a.step_order) - Number(b.step_order));
  result.evidence_boundary.included_steps = result.steps.length;
  result.evidence_boundary.omitted_steps = steps.length - result.steps.length;
  return result;
};

module.exports = { boundedExecutionAiContext };
