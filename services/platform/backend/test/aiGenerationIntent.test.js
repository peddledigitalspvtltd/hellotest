const test=require('node:test'),assert=require('node:assert/strict');
const {splitGenerationContext,generationRetrievalQuery}=require('../src/utils/aiGenerationContext');
const {caseOutputSchema}=require('../src/utils/aiGenerationContracts');
const catalog=require('../../shared/aiFeatureCatalog.json');
const inspection=require('../services/aiRequestPreview.service');
const Ajv=require('ajv');
const request='Generate only NFR performance tests. Measure p95 <= 250 ms at 150 concurrent users.';
const context=`${request}\n\n---\n\n[HELLOTEST_TEMPLATE_CONTEXT_START]\nPrefer positive functional login cases.\n[HELLOTEST_TEMPLATE_CONTEXT_END]\n\n---\n\n[HELLOTEST_SMART_CONTEXT_START]\nObserved benchmark documentation [source-1].\n[HELLOTEST_SMART_CONTEXT_END]`;
test('images without semantic text do not supply an unrelated graph retrieval query',()=>{
 const task={generation_request:{user_request:'',selected_template:[],reviewed_context:['Private image source metadata']},stories:[],current_case:{title:null},reference_images:[{name:'Screenshot.png'}]};
 assert.equal(generationRetrievalQuery(JSON.stringify(task)),null);
 task.current_case.title='Sign in with valid credentials';assert.match(generationRetrievalQuery(JSON.stringify(task)),/Sign in with valid credentials/);
});
test('explicit user objectives, reusable templates and reviewed evidence remain separate',()=>{
 const input=splitGenerationContext(context);assert.equal(input.user_request,request);assert.deepEqual(input.selected_template,['Prefer positive functional login cases.']);assert.deepEqual(input.reviewed_context,['Observed benchmark documentation [source-1].']);
 const incomplete=splitGenerationContext(request+'\n[HELLOTEST_SMART_CONTEXT_START]unclosed evidence');assert.equal(incomplete.user_request,request);assert.deepEqual(incomplete.unclassified_context,['[HELLOTEST_SMART_CONTEXT_START]unclosed evidence']);
});
test('case request inspection uses configured NFR-neutral behavior and preserves objective, source refs and schema',async()=>{
 const item=catalog.find(item=>item.id==='ai.test_case.design');const config={...structuredClone(item.defaults),prompt:'Reviewed configuration: create only the explicitly requested coverage.',temperature:0.45};
 const result=await inspection.preview(item.id,{config,user_request:context,authoring_mode:'structured'});
 const system=result.messages[0].content,task=JSON.parse(result.messages.at(-1).content);
 assert.match(system,/Reviewed configuration/);assert.match(system,/take precedence over default coverage preferences and selected_template guidance/);
 assert.doesNotMatch(system,/Prioritize core acceptance|Prioritize critical positive|cover happy path/);
 assert.equal(task.generation_request.user_request,request);assert.equal(task.generation_request.selected_template.length,1);assert.equal(task.stories[0].ref,'R1');
 assert.equal(task.application_contract.output_schema.properties.testCases.items.properties.requirement_refs.items.enum[0],'R1');
 assert.equal(result.model_settings.temperature,0.45);assert.equal(result.inspection_scope,'generation-request');assert.ok(!result.active_templates.includes('recovery.context_size'));
 const reduced=await inspection.preview(item.id,{config,user_request:context,reduced_context:true});assert.ok(reduced.active_templates.includes('recovery.context_size'));assert.equal(JSON.parse(reduced.messages.at(-1).content).generation_request.user_request,request);
 const query=generationRetrievalQuery(JSON.stringify(task));assert.match(query,/NFR performance/);assert.doesNotMatch(query,/Prefer positive|output_schema|Observed benchmark/);
 task.generation_request.user_request='';assert.match(generationRetrievalQuery(JSON.stringify(task)),/Prefer positive functional/,'A selected template supplies retrieval focus only when the user provides no narrower objective');
});
test('authoring and step requests use separate native schemas and format guidance',async()=>{
 for(const id of ['ai.case_authoring.full_case','ai.case_authoring.step_rephrase','ai.automation.step_rephrase']) {
  const item=catalog.find(item=>item.id===id),result=await inspection.preview(id,{config:item.defaults,user_request:request,authoring_mode:'gherkin'});const task=JSON.parse(result.messages.at(-1).content);
  assert.equal(task.generation_request.user_request,request);
  if(id==='ai.case_authoring.full_case'){assert.ok(task.application_contract.output_schema.required.includes('gherkin_document'));assert.ok(result.active_templates.includes('format.gherkin'));}
  else {assert.ok(task.application_contract.output_schema.required.includes('action'));assert.ok(!result.active_templates.includes('format.gherkin'));}
 }
});
test('native NFR drafts remain valid without a functional-positive case requirement',()=>{
 const schema=caseOutputSchema('structured',{count:3,refs:['R1']}),validate=new Ajv({strict:false}).compile(schema);
 const nfr={applicable_domain:'performance',testCases:[{title:'Checkout p95 latency under concurrency',description:'Measure the supplied checkout latency target.',priority:3,test_case_type:'performance',parameter_values:{},requirement_refs:['R1'],authoring_mode:'structured',steps:[{action:'Run the checkout workload with 150 concurrent users',expected_result:'Measured p95 latency is at most 250 ms'}]}]};
 assert.equal(validate(nfr),true,JSON.stringify(validate.errors));assert.equal(validate({...nfr,testCases:[{...nfr.testCases[0],requirement_refs:['foreign']}]}),false);
});
test('inspection validates draft inputs, excludes reserved controls and does not make model calls',async()=>{
 const item=catalog.find(item=>item.id==='ai.test_case.design');
 for(const input of [{config:item.defaults,user_request:request,authoring_mode:'unsupported'},{config:item.defaults,user_request:request,arbitrary_command:'run'}, {config:{...item.defaults,temperature:3},user_request:request}])await assert.rejects(inspection.preview(item.id,input),error=>error.statusCode===400);
 await assert.rejects(inspection.preview('ai.execution.case_triage',{user_request:request}),error=>error.statusCode===422);
});
test.after(()=>require('../src/db').close());
