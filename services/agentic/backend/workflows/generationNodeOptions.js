const { fail } = require('./endpointPolicy');
// Saved node fields take precedence, including an intentionally empty context.
// Older workflows can still run against their recorded trigger input.
function generationOptions(data = {}, input = {}) {
  const chosen = (key, legacy, fallback) => Object.hasOwn(data,key) ? data[key] : input[legacy] ?? fallback;
  const maxCases = chosen('maxCasesPerStory','max_cases_per_story',5);
  if (maxCases === '' || maxCases == null || !Number.isInteger(Number(maxCases)) || Number(maxCases) < 1 || Number(maxCases) > 10) throw fail('Choose 1–10 Test Cases per Story on the Test Case Generator node.',422);
  const authoringMode = chosen('authoringMode','authoring_mode','structured');
  if (!['structured','gherkin'].includes(authoringMode)) throw fail('Choose structured or gherkin authoring on the Test Case Generator node.',422);
  const instructions = chosen('generationInstructions','generation_instructions','');
  if (typeof instructions !== 'string' || instructions.length > 12000) throw fail('Test Case Generator additional instructions must be text up to 12,000 characters.',422);
  return {maxCases:Number(maxCases),authoringMode,instructions};
}
function pinnedGenerationOptions(run) {
  const node = run.workflow_snapshot?.nodes?.find(item=>item.data?.kind==='artifactTask'&&item.data.artifactTask==='test-case-generation');
  return generationOptions(node?.data || {},run.input_payload || {});
}
module.exports = { generationOptions,pinnedGenerationOptions };
