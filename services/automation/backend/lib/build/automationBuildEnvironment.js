const unavailable = () => Object.assign(new Error('Choose an available Test Environment.'), {
  code: 'AUTOMATION_ENVIRONMENT_UNAVAILABLE', statusCode: 422, failure_stage: 'context',
  nonRetryable: true, effect_dispatched: false, outcome_unknown: false
});

async function requireBuildEnvironment(id, load) {
  if (!id) return null;
  let environment;
  try { environment = await load(id); }
  catch (error) {
    if (error.statusCode !== 404 && error.message !== 'Test environment not found') throw error;
  }
  if (!environment) throw unavailable();
  return environment;
}

module.exports = { requireBuildEnvironment };
