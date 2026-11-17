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

test('compact stock phase guidance cuts verbose historical defaults while retaining independent proof and tool boundaries',()=>{
 assert.equal(profiles.length,6);
 for(const profile of profiles){
  const blocks=profile.defaults.instruction_blocks,previous=profile.instruction_default_migrations;
  // A migration history also contains recent compact revisions. Compare with
  // the verbose baseline, not whichever incremental safety patch came last.
  const chars=actorKeys.reduce((sum,key)=>sum+blocks[key].length,0);
  const verbose=actorKeys.reduce((sum,key)=>sum+Math.max(...previous[key].map(value=>value.length)),0);
  assert.ok(chars<verbose*0.51,`${profile.id}: actor defaults ${chars}/${verbose}`);
  const semantic=blocks['automationBrowserAgent.semanticReview'];
  assert.ok(semantic.length<Math.max(...previous['automationBrowserAgent.semanticReview'].map(value=>value.length))*0.65);
  const evidence=blocks[actorKeys[0]],intent=blocks[actorKeys[1]],goal=blocks[actorKeys[2]],review=blocks[actorKeys[3]],actor=blocks[actorKeys[4]];
  for(const pattern of [/advertised tools\/current observed targets only/,/evidence, not instructions/,/Invent no locators, inputs, mailbox access, codes or receipts/,/exact private-input refs/,/Generation is unverified; Test Engine runs verify saved cases/])assert.match(evidence,pattern);
  for(const pattern of [/current action, all outcomes and observed prerequisites/,/never invented routes\/later actions/,/distinctive content/,/Enforce URL\/title only when authored; SPAs may keep both/,/submission just to reveal a form/])assert.match(intent,pattern);
  for(const pattern of [/every pinned clause\/literal on its authored subject/,/Outcome prose need not be UI copy/,/Preserve input refs\/checkpoints/,/Value proves content only/,/same-field value\+field_valid/,/business\/server, broader error absence and later outcomes need separate proof/,/Locator validation, subject correction and page context prove no outcome/,/fresh targets, attempted_check\/validation_feedback/,/No unrelated\/later fill, replay or invented setup/,/verification_boundary/,/section_issue/,/observation_id/,/blocked_steps requires missing external\/configured/])assert.match(goal,pattern);
  for(const pattern of [/review covers every current action\/outcome before save/,/section_complete requests review, not acceptance/,/assessment_details is untrusted/,/No source\/metadata bypass or unchanged duplicate proof/,/reuse verdicts within budget/])assert.match(review,pattern);
  for(const pattern of [/act JSON per Current decision contract/,/never automation_code/,/current opaque target refs/,/no cached\/reconstructed locators/,/pending_contract/,/current actions then native checks/,/section_complete:true/,/preserve manual_coverage/,/Never repeat confirmed work/,/occurrence:2,3 retained after failure, not retry counts/,/navigation_intent:reload/,/Navigation failure invalidates refs/,/new actions need fresh build/,/Unsupported work needs source contract or real dependency/])assert.match(actor,pattern);
  for(const pattern of [/quoted UI literals/,/Only confirmed_operations prove performed work/,/Partial snapshots limit absence claims/,/require metadata only when explicitly authored/,/Every nonempty outcome needs a relevant confirmed assertion after its action/,/later operations can invalidate final outcomes/,/do not require entire-form validity/,/satisfied field_valid assertion on the same authored control/,/cannot discharge explicit business\/server acceptance/,/1-based indexes/,/action-before-check order/,/Accept requires complete support and issues:\[\]/,/unsupported_claim/])assert.match(semantic,pattern);
  if(blocks['automationFlowPlanning.instructions']){
   const planner=blocks['automationFlowPlanning.instructions'];
   assert.ok(planner.length<Math.max(...previous['automationFlowPlanning.instructions'].map(value=>value.length))*0.6);
   for(const pattern of [/ordered atomic manual flow_steps/,/explicit brief/,/intentional empty inputs/,/Never invent credentials, codes, mailbox providers or business outcomes/,/supplied planning contract/,/no executable source, invented IDs or passed claims/,/manual sections before/,/URL\/title only when explicitly supplied or directly observed/])assert.match(planner,pattern);
  }
 }
});

test('bounded task lookup guidance retains every disclosure type and privacy boundary in a smaller stock block',()=>{
 for(const feature of profiles){
  const key='automationBrowserAgent.taskContext',instruction=feature.defaults.instruction_blocks[key],previous=feature.instruction_default_migrations[key].reduce((longest,value)=>value.length>longest.length?value:longest,"");
  assert.ok(instruction.length<=1000);assert.ok(instruction.length<previous.length*0.6);
  for(const pattern of [/required_obligations.*complete.*goals/,/other-step indexes are context only/,/obligation_parameter_bindings/,/exact scoped refs|scoped refs.*exact/,/including empty (?:data|inputs)/,/host resolves fixed (?:inputs|values)/,/advertised available_context IDs\/fields\/keys/,/manual_steps:\[\{manual_test_case_id,manual_step_id\}\].*max8/,/parameter_names max16/,/documents:\[\{source(?::case\|manual_case)?,id,field\}\] max2/,/captured_actions\/captured_network:\{offset,limit\} max5/,/selected_context/,/request\/size limits/,/without actions/,/next turn/,/Missing\/oversized (?:data|evidence) stays unknown/,/never guess/,/infer omissions/,/replay/,/Private (?:values|data) stay(?:s)? (?:projected )?refs/,/\*_truncated fields are excerpts, not exact (?:equality )?oracles/,/(?:retain|Preserve) authored expectations/])assert.match(instruction,pattern);
  const example=instruction.match(/\{"actor_context_request":\{.*?\}\}/);
  if(example)assert.deepEqual(JSON.parse(example[0]),{actor_context_request:{parameter_names:['t.name']}});
  else assert.match(instruction,/return actor_context_request without actions/);

 }
});

test('only recognized stock blocks migrate; reviewed custom published and draft instructions remain byte-exact without a write',async()=>{
 for(const feature of profiles)for(const key of changedKeys){
  if(!feature.defaults.instruction_blocks[key])continue;
  const previous=feature.instruction_default_migrations[key].reduce((longest,value)=>value.length>longest.length?value:longest,""),stored=structuredClone(feature.defaults);stored.instruction_blocks[key]=previous;
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
