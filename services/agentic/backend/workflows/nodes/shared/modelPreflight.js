const agentRegistry=require('../../../agents/agentRegistry.service');
const nodeAiConfiguration=require('../../nodeAiConfiguration');
const text=value=>typeof value==='string'?value.trim():'';
async function preflight({workflow,node,user}){
 const registered=String(node.data.agentId||'').startsWith('agent-')?await agentRegistry.resolve(node.data.agentId,node.data.agentVersion,workflow.project_id):null;
 await nodeAiConfiguration.runNode(node,{},()=>agentRegistry.resolveModel(workflow.project_id,user?.id,node.data.llmIntegrationId||registered?.definition.integration_id));
}
module.exports=preflight;
