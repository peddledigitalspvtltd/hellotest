const {policy}=require('../../specialistPolicy');
const assistant=require('../../../services/agenticAssistant.service');
module.exports=(node,{custom=false}={})=>{
 const data=node.data||{},errors=[];
 if(!custom&&!assistant.AGENT_CATALOG[data.agentId]&&!/^agent-[a-f0-9-]{36}$/.test(data.agentId||''))errors.push('Choose a registered workspace specialist in the step inspector.');
 if(!String(data.prompt||data.intent||'').trim())errors.push('Describe the task this specialist should review.');
 try{policy(data);}catch(failure){errors.push(failure.publicMessage||failure.message);}
 return errors;
};
