const catalog = require('./metricCatalog.json');

const DEFAULT_FORMULA_VALUES = Object.freeze(Object.fromEntries(catalog.filter(item => item.parameters?.length)
  .map(item => [item.key, Object.freeze(Object.fromEntries(item.parameters.map(parameter => [parameter.key, parameter.defaultValue])))])));

// This same normalization feeds both displayed effective settings and the
// server calculations. Published edits use stricter validation; the coercion
// here preserves bounded values saved by the former workspace editor.
function normalizeFormulaValues(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const normalized = {};
  for (const metric of catalog.filter(item => item.parameters?.length)) {
    const supplied = source[metric.key] && typeof source[metric.key] === 'object' && !Array.isArray(source[metric.key]) ? source[metric.key] : {};
    normalized[metric.key] = Object.fromEntries(metric.parameters.map(parameter => {
      const value = supplied[parameter.key];
      const parsed = typeof value === 'number' || typeof value === 'string' && value.trim() ? Number(value) : NaN;
      return [parameter.key, Number.isFinite(parsed) ? Math.min(parameter.max, Math.max(parameter.min, parsed)) : parameter.defaultValue];
    }));
  }
  const id = 'metric.project.portfolio_health', weights = normalized[id];
  const total = weights.story_weight + weights.automation_weight + weights.pass_weight;
  if (total <= 0) normalized[id] = { ...DEFAULT_FORMULA_VALUES[id] };
  else if (total !== 100) normalized[id] = Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, value * 100 / total]));
  return normalized;
}

module.exports = { DEFAULT_FORMULA_VALUES, normalizeFormulaValues };
