// Native APIs own persistence and validation. MCP pins the reviewed version and
// verifies a scoped read-back; an HTTP acknowledgement alone is not completion.
const ignored = new Set(['project_id','created_by','updated_by','expected_revision','expected_version','source_idempotency_key','idempotency_key']);
const own = (value,key) => value && typeof value==='object' && Object.hasOwn(value,key);
const at = (value,path='id') => path.split('.').reduce((item,key)=>Array.isArray(item)&&/^-[1-9][0-9]*$/.test(key)?item.at(Number(key)):item?.[key],value);
function version(value,digest) {
  for(const field of ['revision','version','current_version','updated_at','content_hash'])if(value?.[field]!=null)return {field,value:value[field]};
  return {field:'content_fingerprint',value:digest(value)};
}
function matches(expected,actual) {
  if(Array.isArray(expected))return Array.isArray(actual)&&expected.length===actual.length&&expected.every((item,index)=>matches(item,actual[index]));
  if(expected&&typeof expected==='object')return actual&&typeof actual==='object'&&Object.entries(expected).every(([key,value])=>own(actual,key)&&matches(value,actual[key]));
  return typeof expected==='string'&&typeof actual==='string'?expected.trim()===actual.trim():expected===actual;
}
function supportedFields(op) {
  const rule=op.policy?.verification;
  if(!rule||rule.async||rule.response==='proposal')return null;
  return new Set([...ignored,...rule.matchFields||[],...rule.allowedControls||[],...(rule.fieldMappings||[]).map(item=>item.bodyField),
    ...(rule.memberships||[]).map(item=>item.bodyField),...(rule.relatedReads||[]).map(item=>item.bodyField),
    ...(rule.membership?[rule.membership.bodyField]:[]),...(rule.activation?[rule.activation.bodyField]:[]),
    ...((rule.memberships||[]).some(item=>item.mode==='append')?['append']:[])]);
}
function createVerification({registry,invoke,fail,digest,bound=value=>value,readMembership,permit=async()=>{},membershipPermissions=()=>[]}) {
  const verificationFor=op=>op.policy?.verification || {method:'GET',path:op.path+'/:id',targetParameter:'id',idFromResponse:'id'};
  function validateArguments(op,args) {
    const accepted=supportedFields(op);if(!accepted)return;
    const unknown=Object.keys(args.body||{}).filter(key=>!accepted.has(key));
    if(unknown.length)throw fail(`These fields have no verified native effect through this operation: ${unknown.join(', ')}. Inspect the supported contract or use the native application flow.`,400,'MCP_UNSUPPORTED_EFFECT');
    const rule=verificationFor(op);
    if(op.policy?.effect==='update'&&!rule.expectedValues?.length&&!rule.responseFields?.length&&!Object.keys(args.body||{}).some(key=>!ignored.has(key)&&!rule.allowedControls?.includes(key)&&key!=='append'))throw fail('Supply at least one supported field or membership to change.',400,'MCP_INVALID_ARGUMENT');
    for(const read of verificationFor(op).relatedReads||[])if(read.bodyField==='steps'&&own(args.body,'steps')){
      const steps=args.body.steps;
      if(!Array.isArray(steps)||steps.some((step,index)=>!step||typeof step!=='object'||step.step_order!=null&&step.step_order!==index+1))throw fail('Supply steps in their intended order, with step_order omitted or numbered consecutively from 1.',400,'MCP_INVALID_ARGUMENT');
    }
  }
  function readOperation(path) {
    const op=registry.all().find(item=>item.method==='GET'&&item.path===path&&item.read);
    if(!op)throw fail('A scoped read-back is unavailable for this action. Use its native application workflow.',422,'MCP_WRAPPER_REQUIRED');
    return op;
  }
  async function preflight(actor,op,args={}) {
    const rule=verificationFor(op);if(rule.response==='proposal')return;
    const read=readOperation(rule.path);if(read.permission)await permit(actor,read.permission);
    for(const related of rule.relatedReads||[])if(own(args.body,related.bodyField)){
      const child=readOperation(related.path);if(child.permission)await permit(actor,child.permission);
    }
    for(const membership of rule.memberships||[])if(membership.storage&&own(args.body,membership.bodyField))for(const permission of membershipPermissions(membership.storage))await permit(actor,permission);
  }
  function sourceOperation(op) {
    if(!op.policy?.scope?.path_parameter)return null;
    if(op.policy?.verification?.collection)return readOperation(op.policy.verification.path);
    return registry.all().filter(item=>item.method==='GET'&&item.read&&item.path_parameters?.length
      && (item.path===op.path||op.path.startsWith(item.path+'/')))
      .sort((a,b)=>b.path.length-a.path.length)[0] || null;
  }
  async function capture(actor,op,args,signal) {
    const source=sourceOperation(op);
    if(!source)return null;
    const selected={path:{...args.path},query:{...args.query}};
    const response=await invoke(actor,source,selected,signal);
    const observed=op.policy?.verification?.collection?selectRecord(response,args.path?.[op.policy.scope.path_parameter],op.policy.verification):response;
    const memberships=[];
    for(const membership of op.policy?.verification?.memberships || [])if(membership.storage&&own(args.body,membership.bodyField)){
      const id=args.path?.[op.policy.scope.path_parameter];
      const ids=await readMembership(membership.storage,id,actor);
      memberships.push({storage:membership.storage,id,fingerprint:digest([...new Set(ids)].sort())});
    }
    const related=[];
    for(const read of op.policy?.verification?.relatedReads||[])if(own(args.body,read.bodyField)){
      const operation=readOperation(read.path),arguments={query:{[read.queryParameter]:args.path[op.policy.scope.path_parameter]}};
      related.push({operation_id:operation.id,arguments,fingerprint:digest(await invoke(actor,operation,arguments,signal))});
    }
    const mapped=(op.policy?.verification?.fieldMappings||[]).filter(mapping=>own(args.body,mapping.bodyField)).map(mapping=>mapping.observedPath.split('.')[0]);
    const fields=[...new Set(['id','project_id','app_type_id',...Object.keys(args.body || {}).filter(key=>!ignored.has(key)),...mapped])].filter(key=>own(observed,key));
    const observedId=at(observed,verificationFor(op).observedIdPath||'id');
    return {operation_id:source.id,arguments:selected,...(observedId?{id:observedId}:{}),version:version(observed,digest),content_fields:fields,content_fingerprint:digest(Object.fromEntries(fields.map(key=>[key,observed[key]]))),...(memberships.length?{memberships}:{}),...(related.length?{related}:{}),...(op.policy?.verification?.collection?{collection:op.policy.verification}:{})};
  }
  async function check(actor,target,signal) {
    if(!target)return;
    const source=registry.get(target.operation_id);
    const response=await invoke(actor,source,target.arguments,signal);
    const observed=target.collection?selectRecord(response,target.id,target.collection):response;
    if(digest(version(observed,digest))!==digest(target.version))throw fail('The reviewed target changed. Prepare and review a new plan; no action was submitted.',409,'MCP_STALE_PLAN');
    if(target.content_fingerprint&&digest(Object.fromEntries(target.content_fields.map(key=>[key,observed[key]])))!==target.content_fingerprint)throw fail('The reviewed fields changed without a matching native revision. Review a new plan.',409,'MCP_STALE_PLAN');
    for(const membership of target.memberships || []){
      const ids=await readMembership(membership.storage,membership.id,actor);
      if(digest([...new Set(ids)].sort())!==membership.fingerprint)throw fail('The reviewed membership changed. Prepare a new plan; no action was submitted.',409,'MCP_STALE_PLAN');
    }
    for(const related of target.related||[])if(digest(await invoke(actor,registry.get(related.operation_id),related.arguments,signal))!==related.fingerprint)throw fail('The reviewed child records changed. Prepare a new plan; no action was submitted.',409,'MCP_STALE_PLAN');
  }
  async function verify(actor,op,row,result,signal,{delivery:initialDelivery}={}) {
    const rule=verificationFor(op);
    if(rule.response==='proposal')return {state:'succeeded_proposal',verification:{kind:'native_proposal_response',persisted:false,approved:false,observed_at:new Date().toISOString()},data:result,delivery:initialDelivery||{truncated:false,redacted:false,omitted_items:0,truncated_strings:0}};
    const id=at(result,rule.idFromResponse || 'id') || row.arguments.path?.[op.policy?.scope?.path_parameter || rule.targetParameter || 'id'];
    if(typeof id!=='string'||!id)throw fail('The domain response did not identify a verifiable record. Reconcile the original plan.',502,'MCP_UNVERIFIED_COMPLETION');
    const reviewedId=row.arguments.preconditions?.target?.id||row.arguments.path?.[op.policy?.scope?.path_parameter||rule.targetParameter||'id'];
    if(['update','delete'].includes(op.policy?.effect)&&reviewedId&&id!==reviewedId)throw fail('The domain acknowledged a different record from the reviewed target. Reconcile the original plan.',502,'MCP_UNVERIFIED_COMPLETION');
    const read=readOperation(rule.path);
    const args={path:{...row.arguments.path,[rule.targetParameter || 'id']:id},query:{}};
    if(rule.deleteAbsence){
      try{await invoke(actor,read,args,signal);}catch(error){if(error.statusCode===404)return {state:'succeeded_verified',domain_id:id,verification:{kind:'record_absence',record_id:id,observed_at:new Date().toISOString()}};throw error;}
      throw fail('The deleted record remains visible. Reconcile this plan before retrying.',502,'MCP_UNVERIFIED_COMPLETION');
    }
    const response=await invoke(actor,read,args,signal);
    const observed=rule.collection?selectRecord(response,id,rule):response;
    const observedId=at(observed,rule.observedIdPath || 'id');
    if(observedId!==id)throw fail('The read-back record differs from the reviewed action.',502,'MCP_UNVERIFIED_COMPLETION');
    const fields=rule.async?[]:rule.matchFields || Object.keys(row.arguments.body || {}).filter(key=>!ignored.has(key)&&own(observed,key));
    for(const field of fields)if(own(row.arguments.body,field)&&!matches(row.arguments.body[field],observed[field]))throw fail('A persisted field differs from the reviewed action. Inspect the original plan receipt.',502,'MCP_UNVERIFIED_COMPLETION');
    if(rule.membership){
      const expected=row.arguments.body?.[rule.membership.bodyField] || [];
      const members=rule.membership.listPath?at(response,rule.membership.listPath):response;
      const actual=(Array.isArray(members)?members:members?.items || []).map(item=>at(item,rule.membership.idField || 'id'));
      if(!Array.isArray(expected)||!expected.every(id=>actual.includes(id))||rule.membership.mode==='equals'&&new Set(expected).size!==new Set(actual).size)throw fail('The reviewed membership change could not be verified.',502,'MCP_UNVERIFIED_COMPLETION');
    }
    for(const membership of rule.memberships || []){
      if(!own(row.arguments.body,membership.bodyField))continue;
      const input=row.arguments.body?.[membership.bodyField],expected=membership.scalar?(input==null||input===''?[]:[input]):input;
      const list=membership.storage?await readMembership(membership.storage,id,actor):membership.listPath?at(observed,membership.listPath):Array.isArray(response)?response:response?.items;
      if(!Array.isArray(expected)||!Array.isArray(list))throw fail('Membership verification is unavailable for the reviewed action.',502,'MCP_UNVERIFIED_COMPLETION');
      const actual=list.map(item=>typeof item==='string'?item:at(item,membership.idField || 'id'));
      const mode=membership.mode==='append'?(row.arguments.body?.append===false?'equals':'contains'):membership.mode;
      if(mode==='absent'?expected.some(id=>actual.includes(id)):!expected.every(id=>actual.includes(id))||mode==='equals'&&new Set(expected).size!==new Set(actual).size)throw fail('The persisted membership differs from the reviewed action.',502,'MCP_UNVERIFIED_COMPLETION');
    }
    for(const mapping of rule.fieldMappings || [])if(own(row.arguments.body,mapping.bodyField)&&!matches(row.arguments.body[mapping.bodyField],at(observed,mapping.observedPath)))throw fail('The persisted mapped field differs from the reviewed action.',502,'MCP_UNVERIFIED_COMPLETION');
    const comparedCollections=[];
    for(const read of rule.relatedReads||[])if(own(row.arguments.body,read.bodyField)){
      const operation=readOperation(read.path),value=await invoke(actor,operation,{query:{[read.queryParameter]:id}},signal);
      const actual=read.listPath?at(value,read.listPath):value;
      if(!matches(row.arguments.body[read.bodyField],actual))throw fail('The persisted child records differ from the reviewed action.',502,'MCP_UNVERIFIED_COMPLETION');
      comparedCollections.push(read.bodyField);
    }
    for(const expected of rule.expectedValues||[])if(!matches(expected.value,at(observed,expected.path)))throw fail('The native record does not show the expected lifecycle state.',502,'MCP_UNVERIFIED_COMPLETION');
    for(const mapping of rule.responseFields||[])if(!own(result,mapping.resultPath.split('.')[0])||!matches(at(result,mapping.resultPath),at(observed,mapping.observedPath)))throw fail('The native acknowledgement does not match its persisted lifecycle result.',502,'MCP_UNVERIFIED_COMPLETION');
    if(rule.activation&&own(row.arguments.body,rule.activation.bodyField)){
      const active=at(observed,rule.activation.activeVersionPath),current=at(observed,rule.activation.versionPath);
      if(Boolean(row.arguments.body[rule.activation.bodyField])!==(active===current))throw fail('The saved agent activation differs from the reviewed plan.',502,'MCP_UNVERIFIED_COMPLETION');
    }
    if(!rule.async&&op.policy?.effect==='update'&&!fields.length&&!rule.membership&&!rule.memberships?.length&&!rule.fieldMappings?.length&&!rule.expectedValues?.length&&!rule.responseFields?.length&&!comparedCollections.length&&!rule.activation)throw fail('The native response does not expose the requested update for verification.',502,'MCP_UNVERIFIED_COMPLETION');
    const delivery={truncated:false,redacted:false,omitted_items:0,truncated_strings:0};
    return {state:rule.async?'submitted':'succeeded_verified',domain_id:id,verification:{kind:rule.async?'durable_command_accepted':'scoped_record_readback',record_id:id,compared_fields:fields,...(comparedCollections.length?{compared_collections:comparedCollections}:{}),observed_at:new Date().toISOString()},data:bound(observed,op,delivery),delivery};
  }
  function selectRecord(response,id,rule) {
    const collection=rule.collectionPath?at(response,rule.collectionPath):Array.isArray(response)?response:response?.items;
    const record=Array.isArray(collection)?collection.find(item=>at(item,rule.observedIdPath || 'id')===id):null;
    if(!record)throw fail('The exact record is absent from the scoped read-back.',404,'MCP_RECORD_NOT_FOUND');
    return record;
  }
  return {capture,check,verify,verificationFor,readOperation,supportedFields,validateArguments,preflight};
}
module.exports={createVerification,matches,version,supportedFields};
