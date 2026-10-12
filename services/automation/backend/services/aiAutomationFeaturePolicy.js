const BUILD_FEATURES = Object.freeze(['ai.automation.keyword_generation', 'ai.automation.review', 'ai.automation.gap_analysis', 'ai.execution.network_to_api_steps']);
function buildFeature(value) {
  const feature = value == null ? BUILD_FEATURES[0] : value;
  if (!BUILD_FEATURES.includes(feature)) throw Object.assign(new Error('Choose a supported automation AI feature.'), { statusCode: 400, code: 'AI_FEATURE_INVALID' });
  return feature;
}
module.exports = { BUILD_FEATURES, buildFeature };
