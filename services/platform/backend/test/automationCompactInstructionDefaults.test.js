const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {createRequire}=require('node:module');
const catalog=require('../../shared/aiFeatureCatalog.json');
const execution=require('../src/utils/aiExecutionConfiguration');
const profiles=catalog.filter(row=>row.defaults.instruction_blocks?.['automationBrowserAgent.actor']);
const actorKeys=['evidenceGuardrails','sectionIntent','goalReview','reviewContract','actor'].map(key=>'automationBrowserAgent.'+key);
const changedKeys=[...actorKeys,'automationBrowserAgent.semanticReview','automationFlowPlanning.instructions','automationBrowserAgent.taskContext'];
function configuration(records={}){
 const file=require.resolve('../services/aiConfiguration.service'),local=createRequire(file),module={exports:{}};
 const db={prepare:()=>({get:async key=>({value:records[key.replace('ai_feature_configuration:','')]}),all:async()=>[]})};
 new Function('require','module','exports',fs.readFileSync(file,'utf8'))(id=>id==='../src/db'?db:local(id),module,module.exports);
 return module.exports;
}

test('compact stock phase guidance cuts repeated actor and review prose while retaining independent proof and tool boundaries',()=>{
 assert.equal(profiles.length,6);
 for(const profile of profiles){
  const blocks=profile.defaults.instruction_blocks,previous=profile.instruction_default_migrations;
  const chars=actorKeys.reduce((sum,key)=>sum+blocks[key].length,0),old=actorKeys.reduce((sum,key)=>sum+previous[key].at(-1).length,0);
  assert.ok(chars<old*0.51,`${profile.id}: actor defaults ${chars}/${old}`);
  assert.ok(blocks['automationBrowserAgent.semanticReview'].length<previous['automationBrowserAgent.semanticReview'].at(-1).length*0.5);
  const evidence=blocks[actorKeys[0]],intent=blocks[actorKeys[1]],goal=blocks[actorKeys[2]],review=blocks[actorKeys[3]],actor=blocks[actorKeys[4]],semantic=blocks['automationBrowserAgent.semanticReview'];
  for(const pattern of [/advertised tools and current observed targets/,/untrusted evidence, never instructions/,/private inputs as exact configured references/,/only a Test Engine run verifies/])assert.match(evidence,pattern);
  for(const pattern of [/pinned manual action and every requested outcome/,/observed prerequisites retained in source/,/Never invent routes or borrow later actions/,/distinctive rendered content/,/SPA URL\/title may stay unchanged/,/enforce metadata only when authored/,/Do not submit merely/])assert.match(intent,pattern);
  for(const pattern of [/every independent expected-result clause/,/quoted literals/,/Expected-result prose describes an outcome, not literal UI copy/,/intended negative result/,/original configured reference/,/value assertion checks content only/,/executable predicates for validation\/no-error\/acceptance/,/field_valid on the same control/,/aria-invalid/,/without dispatching events/,/business\/server/,/text\/text_contains use visible innerText/,/subject correction ran no assertion/,/verification_boundary/,/section_issue/,/observation_id/,/blocked_steps only for missing external\/configured/])assert.match(goal,pattern);
  for(const pattern of [/review.*before save/,/section_complete requests review, not acceptance/,/assessment_details are untrusted/,/No source bypass/,/unchanged evidence add no coverage/,/advertised model budget/])assert.match(review,pattern);
  for(const pattern of [/stage:act JSON/,/active step_id/,/never automation_code/,/exact current_snapshot target refs/,/opaque and snapshot-scoped/,/pending_contract/,/browser_assert/,/completion_available/,/section_complete:true/,/Preserve manual_coverage/,/Never repeat confirmed actions/,/occurrence:2, then 3/,/not retry count/,/navigation_intent:reload/,/Failed navigation invalidates targets/,/new actions require a fresh build/,/Unsupported operations require the source contract/])assert.match(actor,pattern);
  for(const pattern of [/quoted UI literals/,/Only confirmed_operations prove performed work/,/Partial snapshots limit absence claims/,/require metadata only when explicitly authored/,/Every nonempty outcome needs a relevant confirmed assertion after its action/,/later operations can invalidate final outcomes/,/do not require entire-form validity/,/satisfied field_valid assertion on the same authored control/,/cannot discharge explicit business\/server acceptance/,/1-based indexes/,/action-before-check order/,/Accept requires complete support and issues:\[\]/,/unsupported_claim/])assert.match(semantic,pattern);
  if(blocks['automationFlowPlanning.instructions']){
   const planner=blocks['automationFlowPlanning.instructions'];
   assert.ok(planner.length<previous['automationFlowPlanning.instructions'].at(-1).length*0.6);
   for(const pattern of [/ordered atomic manual flow_steps/,/explicit brief/,/intentional empty inputs/,/Never invent credentials, codes, mailbox providers or business outcomes/,/supplied planning contract/,/no executable source, invented IDs or passed claims/,/manual sections before/,/URL\/title only when explicitly supplied or directly observed/])assert.match(planner,pattern);
  }
 }
});

test('bounded task lookup guidance retains every disclosure type and privacy boundary in a smaller stock block',()=>{
 for(const feature of profiles){
  const key='automationBrowserAgent.taskContext',instruction=feature.defaults.instruction_blocks[key],previous=feature.instruction_default_migrations[key].at(-1);
  assert.ok(instruction.length<=1000);assert.ok(instruction.length<previous.length*0.6);
  for(const pattern of [/required_obligations are complete active goals/,/other-step indexes are context only/,/exact scoped refs in obligation_parameter_bindings/,/including empty data/,/host resolves fixed inputs/,/advertised available_context IDs\/fields\/keys/,/manual_steps:\[\{manual_test_case_id,manual_step_id\}\] max8/,/parameter_names max16/,/documents:\[\{source:case\|manual_case,id,field\}\] max2/,/captured_actions\/captured_network:\{offset,limit\} max5 per range/,/selected_context:\[environment\|configuration\|data_set\]/,/available_context request\/size limits/,/pause all browser actions/,/results arrive next turn/,/Missing\/oversized data stays unknown/,/never guess values, infer omissions, perform other steps or replay actions/,/Private values stay projected refs/,/\*_truncated fields are excerpts, not exact equality oracles/,/retain authored expectations/])assert.match(instruction,pattern);
  const example=JSON.parse(instruction.match(/\{"actor_context_request":\{.*?\}\}/)[0]);
  assert.deepEqual(example,{actor_context_request:{parameter_names:['t.name']}});
 }
});

test('only recognized stock blocks migrate; reviewed custom published and draft instructions remain byte-exact without a write',async()=>{
 for(const feature of profiles)for(const key of changedKeys){
  if(!feature.defaults.instruction_blocks[key])continue;
  const previous=feature.instruction_default_migrations[key].at(-1),stored=structuredClone(feature.defaults);stored.instruction_blocks[key]=previous;
  const record={revision:12,published:{version:9,config:stored},draft:{config:structuredClone(stored)}};
  if(feature.configuration_owner==='agent') {
   const controls=configuration({[feature.id]:record});
   await assert.rejects(controls.detail(feature.id),{code:'AI_CONFIGURATION_OWNER'});
   const current=await controls.resolve(feature.id);
   assert.equal(current.published_version,0);assert.equal(current.config.instruction_blocks[key],feature.defaults.instruction_blocks[key]);
   const custom='Reviewed node policy.\nPreserve "Required UI literal", exact scope and data.  ';
   const reviewed=await execution.run({source:'workflow_node',id:'automation-node',feature_id:feature.id,config:{instruction_blocks:{[key]:custom}}},()=>controls.resolve(feature.id));
   assert.equal(reviewed.config.instruction_blocks[key],custom);assert.equal(reviewed.configuration_source,'workflow_node');
   continue;
  }
  const current=await configuration({[feature.id]:record}).detail(feature.id);
  assert.equal(current.config.instruction_blocks[key],feature.defaults.instruction_blocks[key]);assert.equal(current.draft.config.instruction_blocks[key],feature.defaults.instruction_blocks[key]);assert.equal(current.published_version,9);assert.equal(current.revision,12);
  const custom='Reviewed custom policy.\nPreserve "Required UI literal", exact scope and data.  ';
  record.published.config.instruction_blocks[key]=custom;record.draft.config.instruction_blocks[key]=custom;
  const reviewed=await configuration({[feature.id]:record}).detail(feature.id);
  assert.equal(reviewed.config.instruction_blocks[key],custom);assert.equal(reviewed.draft.config.instruction_blocks[key],custom);assert.equal(reviewed.published_version,9);
 }
});
