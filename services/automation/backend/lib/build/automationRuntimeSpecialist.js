const { aiInstructionBlock } = require('@hellotest/platform/backend/src/utils/aiInstructionBlocks');
const { normalizeTestStepType } = require('@hellotest/platform/backend/src/utils/testStepAutomation');

const SPECIALISTS = Object.freeze({
  web: { id: 'web', name: 'Web Automation Engineer', instruction_key: 'automationBuild.specialist.web', transport: 'playwright_mcp', output: 'automation_code' },
  api: { id: 'api', name: 'API Automation Engineer', instruction_key: 'automationBuild.specialist.api', transport: 'native_http', output: 'api_request' },
  android: { id: 'android', name: 'Android Automation Engineer', instruction_key: 'automationBuild.specialist.android', transport: 'appium', output: 'automation_code' },
  ios: { id: 'ios', name: 'iOS Automation Engineer', instruction_key: 'automationBuild.specialist.ios', transport: 'appium', output: 'automation_code' }
});

function runtimeSpecialist(type) { return SPECIALISTS[normalizeTestStepType(type)] || null; }
function runtimeSpecialistInstructions(types) {
  return [...new Set(types)].map(type => runtimeSpecialist(type)).filter(Boolean)
    .map(specialist => aiInstructionBlock('ai.automation.keyword_generation', specialist.instruction_key)).join('\n\n');
}
module.exports = { runtimeSpecialist, runtimeSpecialistInstructions };
