const {createHash}=require('node:crypto');
const contracts=require('@hellotest/contracts/agents');
const specialists=require('@hellotest/contracts/agents/workflowSpecialists.json');
const repository=require('./catalog');
const quality=require('../../shared/qualityAgentSkills.json');
const configurations=require('@hellotest/platform/shared/aiFeatureCatalog.json');
const guardrailPacks=require('./agentGuardrails');
function configuredLimits(id){const policy=configurations.find(item=>item.id===id)?.defaults?.agent_execution||{};return Object.fromEntries(Object.entries(policy).filter(([,value])=>Number.isFinite(value)&&value>=0));}
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function build(system,id,{name,objective,instructions=[],tools=[],scopes=[],output,guardrails=system==='workflow'?guardrailPacks.workflow(id):guardrailPacks[system],limits={}}){
  const value=contracts.descriptor({schema_version:contracts.VERSION,system,id,name,objective,
    instructions:{version:'agent-instructions/1',parts:instructions},tools,guardrails,evidence:{scopes},output:{contract:typeof output==='string'?output:'registered-output/1',review_required:true,...(output&&typeof output==='object'?{schema:output}:{})},limits});
  return {...value,descriptor_hash:hash(value)};
}
function workflow(id,profile=specialists[id]){
  if(!profile)throw new Error('Unknown workflow specialist.');
  return build('workflow',id,{name:id==='automation-engineer'?'Automation Readiness Review':profile.name,objective:profile.description,instructions:[profile.prompt,...(profile.skills||[]).map(skill=>skill.instructions),profile.outputInstructions].filter(Boolean),
    tools:(profile.allowedTools||[]).map(name=>({name,effect:'read'})),scopes:profile.scopes||[],output:profile.contractVersion||'agent-review/3',limits:{...configuredLimits(`ai.agentic.${id}`),tool_calls:4}});
}
function repositoryAgent(id){const profile=repository.AGENTS.find(agent=>agent.id===id);if(!profile)throw new Error('Unknown repository agent.');return build('repository',id,{name:profile.name,objective:profile.description,instructions:[profile.outcome],tools:[{name:'repository_compile',effect:'compiler'}],scopes:['repository-source'],output:'repository-findings/1',limits:{timeout_ms:repository.LIMITS.worker_timeout_ms,result_bytes:repository.LIMITS.max_result_bytes,files:repository.LIMITS.max_files}});}
function qualityAgent(id){const profiles=quality.profiles||quality.skills||quality.agents||quality;const profile=profiles[id];if(!profile)throw new Error('Unknown quality agent.');return build('quality',id,{name:require('../services/qualityAgentContracts').AGENTS.find(item=>item.id===id)?.name||profile.id||id,objective:profile.default_goal||profile.role||id,instructions:[profile.role,...(profile.methods||[]),...(profile.evidence_rules||[])].filter(Boolean),tools:[{name:'testengine_browser_review',effect:'reviewed_action'}],scopes:['approved-browser-target','project-evidence'],output:'quality-agent-report/1',limits:{model_calls:26,tool_calls:12,timeout_ms:120000,pages:5,artifact_bytes:8388608}});}
function automation(){return build('automation','browser',{name:'Automation Engineer',objective:'Build executable automation from saved behavior and observed browser/API evidence.',instructions:['Preserve authored behavior and expected outcomes.','Use the live Playwright MCP catalog within the approved action scope.','Generated instructions require review; only execution receipts establish a passing run.'],tools:[{name:'playwright_mcp',effect:'reviewed_action'}],scopes:['test-case','object-repository','authorized-browser-target','api-contract'],output:'automation-program/1',limits:configuredLimits('ai.agentic.automation-engineer')});}
function catalog(){const profiles=quality.profiles||quality.skills||quality.agents||quality;return [...Object.keys(specialists).map(id=>workflow(id)),...repository.AGENTS.map(agent=>repositoryAgent(agent.id)),...Object.keys(profiles).filter(id=>profiles[id]?.role).map(id=>qualityAgent(id)),automation()];}
module.exports={build,workflow,repository:repositoryAgent,quality:qualityAgent,automation,catalog,hash};
