const {createHash}=require('node:crypto');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const digest=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function summary(result,hash){
 return {node_id:result.node_id,kind:result.node_type,status:result.status,result_hash:hash,
 matched:result.node_type==='condition'?result.output?.matched:undefined,
 ...(result.output?.routes?{routes:Object.fromEntries(Object.entries(result.output.routes).map(([key,items])=>[key,items.length>0]))}:{}),
 ...(result.output?.loop_mode==='workflow'?{loop_mode:'workflow'}:{}),
 ...(result.node_type==='dataOperation'?{output:{item_count:result.output?.item_count}}:{}),
 fatal:Boolean(result.fatal),error_code:result.error_details?.code,
 needs_review:result.output?.readiness?.status==='insufficient_evidence',needs_attention:result.output?.verification?.status==='needs_input'};
}
module.exports={canonical,digest,summary};
