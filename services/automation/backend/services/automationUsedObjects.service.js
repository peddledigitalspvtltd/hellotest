const {createHash}=require('node:crypto');
const {isDeepStrictEqual}=require('node:util');
const {recordedSectionRequests,recordedSectionObjectTargets}=require('../lib/automationBrowserRecording');
const {recordedContractMetadata,readRecordedSectionArtifacts}=require('../lib/automationRecordedContract');
const {automationObjectSourceContext}=require('../lib/automationObjectSourceContext');
const {sameRecordedLocator,recordedLocatorIdentity}=require('../lib/automationLocatorIdentity');

const MIME='application/vnd.hellotest.automation-used-objects+json';
const MAX_BYTES=192*1024,MAX_TARGETS=250;
const hash=value=>createHash('sha256').update(value,'utf8').digest('hex');
const failure=(code,message,statusCode=409)=>Object.assign(new Error(message),{code,statusCode});
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const text=value=>typeof value==='string'&&value.length>0&&value.length<=200;
const safeUrl=value=>{try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&!url.search&&!url.hash&&url.href===value;}catch{return false;}};
const screenName=url=>{let path=new URL(url).pathname;try{path=decodeURIComponent(path);}catch{}return path.split('/').filter(Boolean).join(' ').replace(/[^\p{L}\p{N}_ -]/gu,' ').replace(/\s+/g,' ').trim().slice(0,80)||'Page';};
const objectName=target=>(target.name||target.role||target.tag||'Field').replace(/[^\p{L}\p{N}_ -]/gu,' ').replace(/\s+/g,' ').trim().slice(0,80)||'Field '+hash(target.locator).slice(0,8);
const serialize=value=>{const content=JSON.stringify(value);if(Buffer.byteLength(content)>MAX_BYTES)throw failure('AUTOMATION_OBJECT_MANIFEST_TOO_LARGE','Used object metadata exceeded its bounded size.',422);return content;};
const repositoryProjection=field=>({id:field.id,project_id:field.project_id,app_type_id:field.app_type_id,page_url:field.page_url,page_key:field.page_key,locator_intent:field.locator_intent,locator:field.locator,locator_kind:field.locator_kind,
  metadata:Object.fromEntries(['screen_name','object_name','object_role','screen_entry_id','record_kind','observed_route_sha256','instruction_usages'].filter(key=>field.metadata?.[key]!==undefined).map(key=>[key,field.metadata[key]]))});

function parseManifest(artifact,transaction,testCase){
  if(!artifact||artifact.transaction_id!==transaction?.id||artifact.mime_type!==MIME||typeof artifact.content!=='string'||Buffer.byteLength(artifact.content)>MAX_BYTES)return null;
  let value;try{value=JSON.parse(artifact.content);}catch{return null;}
  if(!object(value)||value.schema_version!==1||value.kind!=='confirmed_section_objects'||value.project_id!==testCase.project_id||value.app_type_id!==testCase.app_type_id||value.test_case_id!==testCase.id
    ||transaction.project_id!==value.project_id||transaction.app_type_id!==value.app_type_id||transaction.category!=='automation_build'
    ||!text(value.step_id)||!/^[a-f0-9]{64}$/.test(value.source_sha256)||!/^[a-f0-9]{64}$/.test(value.plan_sha256)
    ||value.context_sha256!=null&&!/^[a-f0-9]{64}$/.test(value.context_sha256)
    ||!['pending','synced','superseded'].includes(value.status)||!Array.isArray(value.targets)||value.targets.length>MAX_TARGETS)return null;
  for(const row of value.targets)if(!object(row)||!safeUrl(row.page_url)||typeof row.locator!=='string'||!row.locator||row.locator.length>2000
    ||/^ref:/.test(row.locator)||/\[(?:private parameter|redacted)/i.test(row.locator)||!Array.isArray(row.operation_indexes)||!row.operation_indexes.length
    ||row.operation_indexes.some(index=>!Number.isSafeInteger(index)||index<1||index>250)||new Set(row.operation_indexes).size!==row.operation_indexes.length
    ||Object.keys(row).some(key=>!['page_url','locator','name','role','tag','observation_id','observed_route_sha256','operation_indexes'].includes(key))
    ||row.observed_route_sha256!==undefined&&!/^[a-f0-9]{64}$/.test(row.observed_route_sha256)
    ||['name','role','tag','observation_id'].some(key=>row[key]!==undefined&&(!text(row[key])||/\[(?:private parameter|redacted)/i.test(row[key]))))return null;
  return value;
}

function createUsedObjectService(dependencies={}){
  const main=()=>dependencies.db||require('@hellotest/platform/backend/src/db');
  const observations=()=>dependencies.obsDb||require('@hellotest/platform/backend/src/obsDb');
  const transactions=()=>dependencies.transactions||require('@hellotest/platform/backend/services/workspaceTransaction.service');
  const repository=()=>dependencies.repository||require('./aiAutomationBuilder.service');
  const access=dependencies.getAccess||((userId,projectId)=>require('@hellotest/platform/backend/services/optionalEvidenceAccess.service').getOptionalEvidenceAccess({id:userId},projectId,['automation.repository.manage']));
  async function guard(input){input.executionGuard?.signal?.throwIfAborted();await input.executionGuard?.ensureOwnership();await input.assertAccess?.();input.executionGuard?.signal?.throwIfAborted();}
  async function transactionScope(transactionId,testCase){
    const transaction=await transactions().getTransaction(transactionId);
    if(transaction.project_id!==testCase.project_id||transaction.app_type_id!==testCase.app_type_id||transaction.category!=='automation_build')throw failure('AUTOMATION_OBJECT_SCOPE_CHANGED','Object bindings do not belong to this automation build.');
    return transaction;
  }

  /** Persist only a host-sealed source's actually used, pre-action targets.
   * This intent artifact precedes the Plan commit. A failed save cannot create
   * objects; later synchronization requires the exact source to exist in Plan. */
  async function stage(input){
    const {testCase,step,source,seal,browserObservations=[],transactionId,userId}=input;
    if(!transactionId||!seal)return null;
    await guard(input);
    if(!text(testCase?.id)||!text(testCase.project_id)||!text(testCase.app_type_id)||!text(userId)||step?.test_case_id!==testCase.id)throw failure('AUTOMATION_OBJECT_SCOPE_CHANGED','Used object bindings require the original case, application and actor.');
    const metadata=recordedContractMetadata(seal,{source,stepId:step.id,section:step,manualSpecification:input.manualSpecification});
    const plan=JSON.parse(readRecordedSectionArtifacts(seal).plan_json);
    const requests=recordedSectionRequests(browserObservations,step.id);
    if(!isDeepStrictEqual(requests,plan.operations))throw failure('AUTOMATION_OBJECT_RECORDING_CHANGED','The confirmed object targets no longer match the sealed instructions.');
    const targets=new Map();
    for(const target of recordedSectionObjectTargets(browserObservations,step.id)){
      if(plan.operations[target.operation_index-1]?.arguments.locator!==target.locator)throw failure('AUTOMATION_OBJECT_RECORDING_CHANGED','The confirmed target no longer matches its instruction.');
      const key=JSON.stringify([target.page_url,target.observed_route_sha256||null,recordedLocatorIdentity(target.locator)||target.locator]);
      const existing=targets.get(key);
      if(existing)existing.operation_indexes.push(target.operation_index);
      else {const {operation_index,...evidence}=target;targets.set(key,{...evidence,operation_indexes:[operation_index]});}
    }
    if(!targets.size)return null;
    const transaction=await transactionScope(transactionId,testCase);
    if(transaction.created_by&&transaction.created_by!==userId)throw failure('AUTOMATION_OBJECT_SCOPE_CHANGED','Object bindings must be staged by this build actor.',403);
    const value={schema_version:1,kind:'confirmed_section_objects',status:'pending',project_id:testCase.project_id,app_type_id:testCase.app_type_id,test_case_id:testCase.id,step_id:step.id,
      source_sha256:hash(source),context_sha256:automationObjectSourceContext({...input.sourceContext,stepId:step.id}),plan_sha256:metadata.plan_sha256,targets:[...targets.values()]};
    const content=serialize(value);
    if(!parseManifest({transaction_id:transaction.id,mime_type:MIME,content},transaction,testCase))throw failure('AUTOMATION_OBJECT_MANIFEST_INVALID','The confirmed objects could not be retained safely.',422);
    const targetIdentity=hash(JSON.stringify([value.context_sha256,value.targets.map(({observation_id,...target})=>target)]));
    const fileName=`used-objects-${testCase.id}-${step.id}-${value.source_sha256}-${targetIdentity.slice(0,24)}.json`;
    const prior=(await transactions().listTransactionArtifacts(transactionId)).find(row=>row.file_name===fileName&&row.mime_type===MIME);
    if(prior){const original=await transactions().getTransactionArtifact(prior.id);if(parseManifest(original,transaction,testCase))return {artifact_id:prior.id,object_count:value.targets.length};}
    await guard(input);
    const artifact=await transactions().createTransactionArtifact(transactionId,{file_name:fileName,mime_type:MIME,content});
    return {artifact_id:artifact.id,object_count:value.targets.length};
  }

  async function sync(input){
    const {artifactId,testCase,userId}=input;
    await guard(input);
    const artifact=await transactions().getTransactionArtifact(artifactId);
    const transaction=await transactionScope(artifact.transaction_id,testCase);
    const manifest=parseManifest(artifact,transaction,testCase);
    if(!manifest)throw failure('AUTOMATION_OBJECT_MANIFEST_INVALID','The retained object bindings are unavailable.',422);
    if(manifest.status==='superseded')return {status:'superseded',object_count:0,bindings:[]};
    if(manifest.targets.some(target=>target.observed_route_sha256)&&!manifest.context_sha256)return {status:'pending',object_count:manifest.targets.length,error_code:'AUTOMATION_OBJECT_ROUTE_CONTEXT_REQUIRED'};
    const permissions=await access(userId,testCase.project_id);
    if(!permissions['automation.repository.manage'])return {status:'pending',object_count:manifest.targets.length,error_code:'AUTOMATION_OBJECT_SYNC_PERMISSION_REQUIRED'};
    // The main and evidence stores may be distinct databases. Lock the current
    // Plan while committing one idempotent evidence-store transaction. The
    // durable pending artifact is retained if either side is unavailable.
    return main().transaction(async()=>{
      await guard(input);
      const currentCase=await main().prepare('SELECT tc.id,tc.app_type_id,tc.automation_start_url,app.project_id FROM test_cases tc JOIN app_types app ON app.id=tc.app_type_id WHERE tc.id=? FOR SHARE OF tc,app').get(testCase.id);
      const currentStep=await main().prepare('SELECT id,test_case_id,automation_code FROM test_steps WHERE id=? AND test_case_id=? FOR SHARE').get(manifest.step_id,testCase.id);
      if(!currentCase||currentCase.project_id!==manifest.project_id||currentCase.app_type_id!==manifest.app_type_id)throw failure('AUTOMATION_OBJECT_SCOPE_CHANGED','The case application or project changed before its objects were saved.');
      if(!currentStep||hash(currentStep.automation_code||'')!==manifest.source_sha256)return {status:'source_changed',object_count:0};
      if(manifest.context_sha256){
        const steps=await main().prepare('SELECT * FROM test_steps WHERE test_case_id=? ORDER BY step_order ASC,id ASC FOR SHARE').all(testCase.id);
        const currentContext=automationObjectSourceContext({caseStartUrl:currentCase.automation_start_url??null,steps,stepId:manifest.step_id});
        if(!currentContext)return {status:'pending',object_count:manifest.targets.length,error_code:'AUTOMATION_OBJECT_ROUTE_CONTEXT_REQUIRED'};
        if(currentContext!==manifest.context_sha256)return {status:'context_changed',object_count:0};
      }
      return observations().transaction(async()=>{
        await observations().prepare('SELECT pg_advisory_xact_lock(hashtext(?))').get('repository-screen:'+JSON.stringify([testCase.project_id,testCase.app_type_id]));
        // Serialize retries, re-read their receipt after acquiring the lock.
        const latest=parseManifest(await transactions().getTransactionArtifact(artifactId),transaction,testCase);
        if(!latest)throw failure('AUTOMATION_OBJECT_MANIFEST_INVALID','The retained object bindings changed before saving.',422);
        if(latest.status==='synced'){
          const rows=[];
          for(const [index,binding]of (latest.bindings||[]).entries()){
            await guard(input);
            if(!(await access(userId,testCase.project_id))['automation.repository.manage'])throw failure('AUTOMATION_OBJECT_SYNC_PERMISSION_REQUIRED','Repository access changed before its objects were read.',403);
            const field=await repository().getLearningCacheEntry(binding.entry_id);
            if(field.project_id!==testCase.project_id||field.app_type_id!==testCase.app_type_id||field.metadata?.platform&&field.metadata.platform!=='web'||!sameRecordedLocator(field.locator,latest.targets[index]?.locator))return {status:'repository_changed',object_count:0,bindings:[]};
            rows.push(repositoryProjection(field));
          }
          return {status:'synced',object_count:rows.length,bindings:latest.bindings||[],repository_rows:rows};
        }
        const bindings=[],repositoryRows=[],screens=new Map();
        for(const target of manifest.targets){
          await guard(input);
          if(!(await access(userId,testCase.project_id))['automation.repository.manage'])throw failure('AUTOMATION_OBJECT_SYNC_PERMISSION_REQUIRED','Repository access changed before its objects were saved.',403);
          const routeMetadata=target.observed_route_sha256?{observed_route_sha256:target.observed_route_sha256}:{};
          const screenIdentity=JSON.stringify([target.page_url,target.observed_route_sha256||null]);
          let screen=screens.get(screenIdentity);
          if(!screen){
            const name=screenName(target.page_url)+(target.observed_route_sha256?' '+target.observed_route_sha256.slice(0,12):'');
            screen=await repository().createLearningCacheEntry({project_id:testCase.project_id,app_type_id:testCase.app_type_id,test_case_id:testCase.id,page_url:target.page_url,screen_name:name,locator:'__screen__',locator_intent:'__screen__',source:'automation_engineer_confirmed',metadata:{record_kind:'screen',platform:'web',...routeMetadata}});
            screens.set(screenIdentity,screen);
          }
          if(screen.project_id!==testCase.project_id||screen.app_type_id!==testCase.app_type_id||(screen.metadata?.observed_route_sha256||null)!==(target.observed_route_sha256||null))throw failure('AUTOMATION_OBJECT_SCOPE_CHANGED','The repository screen belongs to another application or observed route.');
          const fieldScope={project_id:testCase.project_id,app_type_id:testCase.app_type_id,screen_name:screen.metadata?.screen_name||screen.page_key,locator:target.locator};
          const existing=await repository().findDuplicateLearningCacheEntry(fieldScope);
          const field=existing||await repository().createLearningCacheEntry({project_id:testCase.project_id,app_type_id:testCase.app_type_id,test_case_id:testCase.id,page_url:target.page_url,screen_name:screen.metadata?.screen_name||screen.page_key,
            locator:target.locator,object_name:objectName(target),object_role:target.role||target.tag||'field',source:'automation_engineer_confirmed',confidence:1,
            metadata:{screen_entry_id:screen.id,record_kind:'field',platform:'web',...routeMetadata}});
          if(field.project_id!==testCase.project_id||field.app_type_id!==testCase.app_type_id||field.metadata?.platform&&field.metadata.platform!=='web'||!sameRecordedLocator(field.locator,target.locator))throw failure('AUTOMATION_OBJECT_SCOPE_CHANGED','The repository field no longer matches its confirmed target.');
          const reference=`${field.metadata?.screen_name||field.page_key}.${field.metadata?.object_name||field.locator_intent}`;
          bindings.push({entry_id:field.id,reference,operation_indexes:target.operation_indexes});
          const usage={test_case_id:testCase.id,step_id:manifest.step_id,source_sha256:manifest.source_sha256,...(manifest.context_sha256?{context_sha256:manifest.context_sha256}:{}),operation_indexes:target.operation_indexes};
          const usages=Array.isArray(field.metadata?.instruction_usages)?field.metadata.instruction_usages:[];
          const updated=await repository().updateLearningCacheEntry(field.id,{metadata:{instruction_usages:[...usages.filter(row=>row.test_case_id!==usage.test_case_id||row.step_id!==usage.step_id),usage].slice(-250)}});
          repositoryRows.push(repositoryProjection(updated));
        }
        // Source-identical fields can belong to different prior routes. Retain
        // the reusable objects, but retire this section's old usage links.
        const usedIds=new Set(bindings.map(binding=>binding.entry_id));
        const priorUsages=await observations().prepare(`SELECT id,metadata FROM automation_learning_cache WHERE project_id=? AND app_type_id=?
          AND metadata->'instruction_usages' @> jsonb_build_array(jsonb_build_object('test_case_id',?::text,'step_id',?::text))`).all(testCase.project_id,testCase.app_type_id,testCase.id,manifest.step_id);
        for(const row of priorUsages){
          if(usedIds.has(row.id))continue;
          const usages=Array.isArray(row.metadata?.instruction_usages)?row.metadata.instruction_usages:[];
          if(!usages.some(usage=>usage.test_case_id===testCase.id&&usage.step_id===manifest.step_id))continue;
          await guard(input);
          if(!(await access(userId,testCase.project_id))['automation.repository.manage'])throw failure('AUTOMATION_OBJECT_SYNC_PERMISSION_REQUIRED','Repository access changed before old object usages could be retired.',403);
          await repository().updateLearningCacheEntry(row.id,{metadata:{instruction_usages:usages.filter(usage=>usage.test_case_id!==testCase.id||usage.step_id!==manifest.step_id)}});
        }
        await guard(input);
        if(!(await access(userId,testCase.project_id))['automation.repository.manage'])throw failure('AUTOMATION_OBJECT_SYNC_PERMISSION_REQUIRED','Repository access changed before its objects were saved.',403);
        await observations().prepare('UPDATE workspace_transaction_artifacts SET content=? WHERE id=? AND transaction_id=?').run(serialize({...manifest,status:'synced',bindings}),artifactId,transaction.id);
        await guard(input);
        return {status:'synced',object_count:bindings.length,bindings,repository_rows:repositoryRows};
      })();
    })();
  }

  async function resume(input){
    await guard(input);
    const {testCase}=input;
    if(!(await access(input.userId,testCase.project_id))['automation.repository.manage'])return {synced:0,pending:0,permission_required:true};
    const artifacts=await observations().prepare(`SELECT artifact.id,artifact.transaction_id,artifact.mime_type,artifact.content FROM workspace_transaction_artifacts artifact
      JOIN workspace_transactions activity ON activity.id=artifact.transaction_id WHERE activity.project_id=? AND activity.app_type_id=? AND activity.category='automation_build'
      AND artifact.mime_type=? AND artifact.file_name LIKE ? ORDER BY artifact.created_at DESC,artifact.id DESC LIMIT 100`).all(testCase.project_id,testCase.app_type_id,MIME,`used-objects-${testCase.id}-%`);
    let synced=0,pending=0;
    for(const artifact of artifacts){
      const transaction=await transactionScope(artifact.transaction_id,testCase);
      const manifest=parseManifest(artifact,transaction,testCase);
      if(!manifest||manifest.status!=='pending')continue;
      const result=await sync({...input,artifactId:artifact.id});
      if(result.status==='synced')synced+=result.object_count;else if(result.status==='pending')pending++;
    }
    return {synced,pending};
  }
  return {stage,sync,resume};
}

let service;
module.exports={MIME,createUsedObjectService,parseManifest,sourceFingerprint:hash,
  stage:input=>(service||=createUsedObjectService()).stage(input),sync:input=>(service||=createUsedObjectService()).sync(input),resume:input=>(service||=createUsedObjectService()).resume(input)};
