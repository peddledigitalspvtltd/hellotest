const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createRequire}=require('node:module');
const catalog=require('../../shared/aiFeatureCatalog.json');
function service(records={},extras={}) {
 const file=require.resolve('../services/aiConfiguration.service'),local=createRequire(file),module={exports:{}};
 const db={prepare:sql=>({get:async key=>({value:records[key?.replace('ai_feature_configuration:','')]}),all:async()=>sql.includes('LIKE')?Object.entries(records).map(([id,value])=>({key:'ai_feature_configuration:'+id,value})):[]})};
 new Function('require','module','exports',fs.readFileSync(file,'utf8'))(id=>Object.hasOwn(extras,id)?extras[id]:id==='../src/db'?db:local(id),module,module.exports);
 return module.exports;
}
test('historical template fragments preserve reviewed edits in published values, drafts and list views',async()=>{
 const item=catalog.find(item=>Object.keys(item.instruction_block_migrations||{}).length);
 const [key,fragments]=Object.entries(item.instruction_block_migrations)[0];
 const old=Object.fromEntries(fragments.filter(item=>item.key).map((fragment,index)=>[fragment.key,`Reviewed fragment ${index}`]));
 const stored={...structuredClone(item.defaults),instruction_blocks:old};delete stored.instruction_format_version;
 const config=service({[item.id]:{revision:4,published:{version:2,config:stored},draft:{config:stored,at:'2026-10-12'}}});
 const expected=fragments.map(fragment=>old[fragment.key]??fragment.default).join('\n');
 assert.equal((await config.resolve(item.id)).config.instruction_blocks[key],expected);
 const detail=await config.detail(item.id);assert.equal(detail.draft.config.instruction_blocks[key],expected);
 assert.equal((await config.list()).features.find(value=>value.id===item.id).config.instruction_blocks[key],expected);
 assert.deepEqual(Object.keys(detail.config.instruction_blocks),Object.keys(item.defaults.instruction_blocks));
 // Saving the assembled template must not concatenate it a second time.
 const current=service({[item.id]:{published:{version:3,config:detail.config}}});
 assert.equal((await current.resolve(item.id)).config.instruction_blocks[key],expected);
});
test('shared published templates reach each agent until its own reviewed publication overrides them',async()=>{
 const parent=catalog.find(item=>item.id==='ai.agentic.workflow'),child=catalog.find(item=>item.id==='ai.agentic.test-designer');
 const key='agenticAssistant.messages.2';
 const parentConfig={...structuredClone(parent.defaults),instruction_blocks:{...parent.defaults.instruction_blocks,[key]:'Reviewed shared evidence guidance'}};
 const records={[parent.id]:{published:{version:7,config:parentConfig}}};
 const config=service(records);assert.equal((await config.resolve(child.id)).config.instruction_blocks[key],'Reviewed shared evidence guidance');
 const own=(await config.detail(child.id)).config;own.instruction_blocks[key]='Reviewed Test Designer guidance';records[child.id]={published:{version:1,config:own}};
 assert.equal((await config.resolve(child.id)).config.instruction_blocks[key],'Reviewed Test Designer guidance');
 parentConfig.instruction_blocks[key]='Updated shared guidance';assert.equal((await config.resolve(child.id)).config.instruction_blocks[key],'Reviewed Test Designer guidance');
});
test('template dependencies are registered and acyclic; defaults contain no extracted feature/block aliases',()=>{
 const profiles=new Map(catalog.map(item=>[item.id,item]));
 function visit(id,path=[]){assert.ok(!path.includes(id),`Instruction dependency cycle: ${[...path,id]}`);const item=profiles.get(id);assert.ok(item,id);for(const source of [item.parent_id,...(item.instruction_sources||[])].filter(Boolean))visit(source,[...path,id]);}
 for(const item of catalog){visit(item.id);for(const [key,value] of Object.entries(item.defaults.instruction_blocks)) {assert.ok(!profiles.has(value),`${item.id}:${key} is a feature ID, not instructions`);assert.ok(!Object.hasOwn(item.defaults.instruction_blocks,value),`${item.id}:${key} is a block alias`);}}
});
test('built-in selectable templates have admin-owned text and registered feature instructions',()=>{
 const templates=require('../../shared/aiPromptTemplateCatalog.json');
 for(const template of templates){assert.equal(template.prompt_text,undefined);const profile=catalog.find(item=>item.id===template.instruction_feature);assert.equal(typeof profile?.defaults.instruction_blocks[template.instruction_key],'string');}
});

test('optimization reviews templates, preserves untouched values and never publishes its proposal',async()=>{
 const item=catalog.find(item=>item.id==='ai.case_authoring.full_case'),key='format.structured';
 let sent,audited=false;
 const proposal=Object.fromEntries(['role','domain','task','prompt','guardrails'].map(key=>[key,item.defaults[key]]));
 proposal.instruction_blocks={[key]:'Reviewed author guidance that preserves valid user preferences.'};
 const config=service({}, {
  '@hellotest/integration/backend/services/aiLlmSelection.service':{resolveLlmIntegrationForUsage:async()=>({id:'model',model:'fixture',base_url:'https://fixture.invalid'})},
  '../src/utils/llmTraceContext':{run:async(scope,fn)=>fn()},
  '../src/utils/llmHttpClient':{fetchLlmWithRetry:async(url,init)=>{sent=JSON.parse(JSON.parse(init.body).messages[0].content);return Response.json({choices:[{message:{content:JSON.stringify({summary:'Clarified author guidance.',changes:['Preserved valid user preferences.'],proposal})}}]});}},
  './adminPortal.service':{recordAudit:async()=>{audited=true;}}
 });
 const result=await config.optimize(item.id,{config:structuredClone(item.defaults)},{actorId:'admin'});
 assert.deepEqual(sent.configuration.instruction_blocks,item.defaults.instruction_blocks);
 assert.equal(result.proposal.instruction_blocks[key],proposal.instruction_blocks[key]);
 assert.equal(result.proposal.guardrails,item.defaults.guardrails);
 assert.equal(result.published,false);assert.equal(audited,true);
});

test('default specialist skills use managed instructions and user-edited skills remain explicit inputs',()=>{
 const {profiles,instructionFor}=require('../../../agentic/backend/workflows/specialistPolicy');
 for(const [id,profile] of Object.entries(profiles))for(const skill of profile.skills) {
  const key=`specialist.skill.${skill.id}`;assert.equal(catalog.find(item=>item.id===`ai.agentic.${id}`).defaults.instruction_blocks[key],skill.instructions);
  assert.equal(instructionFor(skill,`ai.agentic.${id}`),`⟦HELLOTEST_AI:ai.agentic.${id}:${key}⟧`);
  assert.equal(instructionFor({...skill,instructions:'User-reviewed specialized guidance'},`ai.agentic.${id}`),'User-reviewed specialized guidance');
 }
});

test('guided case controls preserve reviewed v2 edits and upgrade stock coverage defaults without duplicating them',async()=>{
 const item=catalog.find(item=>item.id==='ai.case_authoring.full_case');
 const old={...structuredClone(item.defaults),instruction_format_version:2,prompt:item.prompt_default_migrations[0],guardrails:item.guardrail_migration.default,instruction_blocks:{...item.legacy_instruction_blocks,'platform.requestPolicy':item.guardrail_migration.request_policy}};
 old.instruction_blocks['aiCaseAuthoring.buildPrompt.30']='Previously reviewed NFR-only quality guidance.';
 old.instruction_blocks['aiCaseAuthoring.buildPrompt.45']='Previously reviewed structured output guidance.';
 const config=service({[item.id]:{published:{version:4,config:old},draft:{config:old}}});
 const updated=await config.detail(item.id);
 assert.equal(updated.config.instruction_format_version,3);assert.equal(updated.config.prompt,item.defaults.prompt);
 assert.match(updated.config.instruction_blocks['legacy.reviewed'],/Previously reviewed NFR-only quality guidance/);
 assert.equal(updated.config.instruction_blocks['format.structured'],'Previously reviewed structured output guidance.');
 assert.equal(updated.config.guardrails,item.defaults.guardrails);
 assert.equal(updated.config.instruction_blocks['platform.requestPolicy'],undefined);
 assert.equal(updated.legacy_instruction_blocks,undefined,'Migration scaffolding is not exposed as editable controls');
 assert.deepEqual(updated.draft.config,updated.config);
 const saved=await service({[item.id]:{published:{version:5,config:updated.config}}}).detail(item.id);
 assert.deepEqual(saved.config,updated.config,'A reviewed guided configuration is not migrated twice');
});

test('stock legacy Test Case priorities and regression templates upgrade while custom prompts remain unchanged',async()=>{
 const item=catalog.find(item=>item.id==='ai.test_case.design');
 const old={...structuredClone(item.defaults),instruction_format_version:2,prompt:item.prompt_default_migrations[0],instruction_blocks:{...item.legacy_instruction_blocks,'platform.requestPolicy':item.guardrail_migration.request_policy}};
 const migrated=(await service({[item.id]:{published:{version:1,config:old}}}).resolve(item.id)).config;
 assert.doesNotMatch(migrated.prompt,/Prioritize critical positive/);assert.match(migrated.prompt,/non-functional/);
 assert.doesNotMatch(migrated.instruction_blocks['template.builtin-risk-based-regression'],/Prioritize the critical happy path/);
 old.prompt='Our reviewed performance testing instructions.';
 assert.equal((await service({[item.id]:{published:{version:1,config:old}}}).resolve(item.id)).config.prompt,old.prompt);
});

test('stock browser evidence guidance upgrades in published and draft controls while reviewed custom blocks remain exact',async()=>{
 const ids=['ai.automation.keyword_generation','ai.agentic.automation-engineer','ai.automation.review','ai.automation.gap_analysis','ai.execution.network_to_api_steps'];
 for(const id of ids){
  const item=catalog.find(item=>item.id===id);
  for(const [key,previousDefaults] of Object.entries(item.instruction_default_migrations)){
   for(const previousDefault of previousDefaults){
    const old=structuredClone(item.defaults);
    old.instruction_blocks[key]=previousDefault;
    const stored={revision:5,published:{version:4,config:old},draft:{config:old}};
    const config=service({[id]:stored}),detail=await config.detail(id);
    assert.equal(detail.config.instruction_blocks[key],item.defaults.instruction_blocks[key]);
    assert.equal(detail.draft.config.instruction_blocks[key],item.defaults.instruction_blocks[key]);
    assert.equal(detail.published_version,4,'Reading defaults does not publish a new configuration');
    assert.equal(detail.instruction_default_migrations,undefined);
    const custom=structuredClone(old);custom.instruction_blocks[key]='Our reviewed screen and URL acceptance policy.';
    const reviewed=await service({[id]:{published:{version:5,config:custom},draft:{config:custom}}}).detail(id);
    assert.equal(reviewed.config.instruction_blocks[key],custom.instruction_blocks[key]);
    assert.equal(reviewed.draft.config.instruction_blocks[key],custom.instruction_blocks[key]);
   }
  }
 }
});
