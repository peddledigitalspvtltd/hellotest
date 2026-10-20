const {createHash}=require('node:crypto');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;

/** A source context digest describes the saved execution prefix, not a pass.
 * Future sections and the current source have separate version identities.
 * No URL, instruction, API payload or parameter value is returned or stored. */
const digest=value=>createHash('sha256').update(JSON.stringify(value),'utf8').digest('hex');
function automationObjectSourceContexts({caseStartUrl,steps}={}){
  if(caseStartUrl!==null&&typeof caseStartUrl!=='string'||!Array.isArray(steps)||steps.length>5000)return new Map();
  const ordered=[...steps].sort((a,b)=>(Number(a.step_order)||0)-(Number(b.step_order)||0)||String(a.id).localeCompare(String(b.id)));
  const ids=new Set();
  for(const row of ordered){if(typeof row?.id!=='string'||!row.id||ids.has(row.id))return new Map();ids.add(row.id);}
  const contexts=new Map();let previous=digest({schema_version:1,start_url:caseStartUrl});
  for(const row of ordered){
    contexts.set(row.id,previous);
    const source=typeof row.automation_code==='string'?row.automation_code:'';
    let request=row.api_request??null;
    if(typeof request==='string'){try{request=JSON.parse(request);}catch{previous=null;continue;}}
    if(!previous||!source.trim()&&(!request||typeof request!=='object'||Array.isArray(request))||row.reusable_group_id||row.group_kind&&row.group_kind!=='local'){previous=null;continue;}
    previous=digest({previous,step_id:row.id,step_type:row.step_type||'web',source,api_request:canonical(request)});
  }
  return contexts;
}
const automationObjectSourceContext=({stepId,...input}={})=>automationObjectSourceContexts(input).get(stepId)||null;

module.exports={automationObjectSourceContext,automationObjectSourceContexts};
