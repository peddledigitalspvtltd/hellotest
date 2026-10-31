const {createHash}=require('node:crypto');
const policy=require('../../../shared/aiRequestPolicy.json');

// JSON strings preserve code, whitespace and non-Latin content. Escaping tag
// delimiters prevents a document from closing its data envelope.
function dataBlock(name,value){
 if(!/^[a-z][a-z0-9_]{0,63}$/.test(name))throw new TypeError('Use a fixed, plain data-envelope name.');
 const encoded=JSON.stringify(value??null).replace(/[<>&]/g,char=>({'<':'\\u003c','>':'\\u003e','&':'\\u0026'}[char]));
 return `<${name}>\n${encoded}\n</${name}>`;
}
function taskMessage({context,documents,task}){
 return {role:'user',content:[...(context===undefined?[]:[dataBlock('context',context)]),...(documents===undefined?[]:[dataBlock('documents',documents)]),dataBlock('task',task)].join('\n\n')};
}
function dedupeInstructions(parts){
 const seen=new Set();
 return parts.filter(part=>typeof part==='string'&&part.trim()).filter(part=>{const key=part.trim().replace(/\r\n/g,'\n');if(seen.has(key))return false;seen.add(key);return true;});
}
function repairMessages(messages,{candidate,issues,instruction=policy.repair_task}){
 return [...messages,{role:'assistant',content:typeof candidate==='string'?candidate:JSON.stringify(candidate)},
  {role:'user',content:[dataBlock('validation',issues),dataBlock('task',instruction)].join('\n\n')}];
}
const bytes=value=>Buffer.byteLength(typeof value==='string'?value:JSON.stringify(value??null),'utf8');
function requestMetrics(payload={},raw){
 const messages=Array.isArray(payload.messages)?payload.messages:[];
 let trusted=0,user=0,images=0,duplicate=0;const seen=new Set(),prefix=[];let prefixOpen=true;
 for(const message of messages){
  const key=JSON.stringify(message),size=bytes(message);
  if(seen.has(key))duplicate+=size;seen.add(key);
  if(['system','developer'].includes(message.role)){trusted+=size;if(prefixOpen)prefix.push(message);}else{prefixOpen=false;if(message.role==='user')user+=size;}
  if(Array.isArray(message.content))images+=message.content.filter(part=>part?.type==='image_url'||part?.type==='input_image').length;
 }
 return {policy_revision:policy.revision,request_utf8_bytes:bytes(typeof raw==='string'?raw:payload),message_count:messages.length,trusted_message_utf8_bytes:trusted,user_message_utf8_bytes:user,
  schema_utf8_bytes:payload.response_format?bytes(payload.response_format):0,tool_definition_utf8_bytes:payload.tools?bytes(payload.tools):0,image_count:images,exact_duplicate_message_utf8_bytes:duplicate,
  trusted_prefix_sha256:createHash('sha256').update(JSON.stringify(prefix)).digest('hex')};
}
module.exports={policy,dataBlock,taskMessage,dedupeInstructions,repairMessages,requestMetrics};
