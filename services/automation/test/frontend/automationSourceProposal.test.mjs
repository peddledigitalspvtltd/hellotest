import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import * as mapping from '../../shared/automationInstructionMapping.mjs';
import {createGenerationManifest} from '../../backend/lib/automationGenerationManifest.js';

const require=createRequire(new URL('../../../platform/frontend/package.json',import.meta.url));
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const read=file=>readFileSync(new URL(file,import.meta.url),'utf8');
const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const helper={};new Function('require','exports',compile(read('../../frontend/lib/automationSourceProposal.ts')))(()=>mapping,helper);
const target='11111111-1111-4111-8111-111111111111',older='22222222-2222-4222-8222-222222222222';
const code='// @hellotest-parameter-bindings expressions-v1\nawait expect(page.frameLocator("#jobs").getByRole("listitem")).toHaveText(["10","25","50"]);';
const input={test_case_id:'case',step_id:'section13',source_call_id:'source-call',evidence_transaction_id:target};
const baseline='await expect(page).toHaveTitle("Saved baseline");';
const proposal=patch=>({schema_version:1,kind:'automation_source_proposal',test_case_id:'case',step_id:'section13',step_order:13,
 automation_code:code,proposed_source_sha256:mapping.automationSourceSha256(code),automation_instructions:{schema:'hellotest.playwrightInstructions.v1',step_id:'section13',source_sha256:mapping.automationSourceSha256(code),operations:[],instructions:[]},
 generation_manifest:createGenerationManifest({testCaseId:'case',step:{id:'section13',step_order:13,step_type:'web',action:'Check rows',expected_result:'All configured row counts are present'},update:{step_type:'web',automation_code:code,api_request:null}}),baseline_sha256:"f".repeat(64),baseline_source_sha256:mapping.automationSourceSha256(baseline),
 source_call_id:'source-call',evidence_transaction_id:target,target_transaction_id:target,
 validation_status:'validated',save_status:'not_saved',verification_status:'unverified',side_effects:{browser_actions:0,cases_saved:0},warnings:[],...patch});

test('proposal requires exact case/step/build/call/hash identity and an unverified no-write contract',()=>{
 assert.equal(helper.validateAutomationSourceProposal(proposal(),target,input).automation_code,code);
 for(const patch of [{step_id:'foreign'},{test_case_id:'other'},{target_transaction_id:older},{evidence_transaction_id:older},{source_call_id:'other'},
  {automation_code:code+'\n// changed'},{proposed_source_sha256:'0'.repeat(64)},{proposed_source_sha256:undefined},{generation_manifest:{source_sha256:'invalid'}},{save_status:'saved'},{verification_status:'verified'},
  {side_effects:{browser_actions:1,cases_saved:0}},{side_effects:{browser_actions:0,cases_saved:1}}])assert.throws(()=>helper.validateAutomationSourceProposal(proposal(patch),target,input),/does not match/);
});


test('the actual generation manifest preserves its structured source hash separately from proposed code bytes',()=>{
 const candidate=proposal(),structuredHash=candidate.generation_manifest.source_sha256,codeHash=mapping.automationSourceSha256(code);
 assert.notEqual(structuredHash,codeHash,'The manifest hashes step type, code, and API request together');
 const accepted=helper.validateAutomationSourceProposal(candidate,target,input);
 assert.equal(accepted.proposed_source_sha256,codeHash);assert.equal(accepted.generation_manifest.source_sha256,structuredHash);
 assert.throws(()=>helper.validateAutomationSourceProposal({...candidate,proposed_source_sha256:structuredHash},target,input),/does not match/);
 const editor=helper.automationProposalEditorStep({id:'section13',test_case_id:'case',automation_code:baseline},accepted);
 assert.equal(editor.automation_code,code);assert.equal(editor.automation_instructions.source_sha256,codeHash);
});

test('Source editor review retains mapped instructions in a local clone and rejects changed baselines or unsaved source',()=>{
 const step={id:'section13',test_case_id:'case',step_order:13,automation_code:baseline,action:'Check rows'},original=structuredClone(step),candidate=proposal();
 const draft=helper.automationProposalEditorStep(step,candidate);
 assert.equal(draft.automation_code,code);assert.equal(draft.automation_instructions,candidate.automation_instructions);assert.deepEqual(step,original);
 for(const changed of [undefined,{...step,test_case_id:'other'},{...step,automation_code:'newer source'}])assert.throws(()=>helper.automationProposalEditorStep(changed,candidate),/changed/);
 assert.throws(()=>helper.automationProposalEditorStep(step,candidate,'unsaved edits'),/unsaved source/);
});

test('the public API client encodes its target and sends only explicit retained-evidence IDs with cancellation',async()=>{
 const source=ts.createSourceFile('client.ts',read('../../../testing/frontend/api.client.ts'),ts.ScriptTarget.Latest,true);
 const find=node=>ts.isPropertyAssignment(node)&&node.name.getText(source)==='proposeAutomationSectionSource'?node:ts.forEachChild(node,find);
 const node=find(source),calls=[],controller=new AbortController();assert.ok(node);
 const invoke=new Function('request',compile(`return (${node.initializer.getText(source)});`))((...args)=>{calls.push(args);return Promise.resolve(proposal());});
 await invoke('build/with space',input,controller.signal);
 assert.deepEqual(calls[0],['/test-cases/automation/jobs/build%2Fwith%20space/source-proposal',{method:'POST',body:JSON.stringify(input),signal:controller.signal},180000]);
});

function fixture({role='admin',denied=[],generate,callRows,review}={}){
 const states=[],refs=[],queries=[],generated=[],copied=[],reviews=[];let index=0,refIndex=0;
 const dependencies={
  react:{...React,useId:()=> 'proposal-title',useEffect:()=>{},useRef:initial=>{const at=refIndex++;return refs[at]||=( {current:initial});},useState:initial=>{const at=index++;if(!(at in states))states[at]=initial;return[states[at],value=>states[at]=typeof value==='function'?value(states[at]):value];}},
  '@tanstack/react-query':{useQuery:options=>{queries.push(options);return{data:callRows||{items:[{id:'source-call',status:'completed',started_at:'2026-11-06T12:00:00Z'}],legacy:false},isFetching:false};}},
  '@hellotest/platform/frontend/src/auth/AuthContext':{useAuth:()=>({session:{user:{role}}})},
  '@hellotest/platform/frontend/src/platform/hooks/useCapabilityAccess':{useCapabilityAccess:()=>({can:permission=>!denied.includes(permission)})},
  '@hellotest/testing/frontend/api.client':{testingApi:{testCases:{proposeAutomationSectionSource:async(...args)=>{generated.push(args);return generate?generate(...args):proposal({...args[1],target_transaction_id:args[0]});},update:()=>assert.fail('Proposal review must never save a case')}}},
  '@hellotest/trace/frontend/api.client':{traceApi:{llmTraces:{list:async()=>({items:[],next_cursor:null}),detail:()=>assert.fail('Metadata choice must not read prompt/response contents')}}},
  './AutomationOverlay':{AutomationOverlay:({children})=>React.createElement('section',{role:'dialog'},children)},
  './AutomationInstructionPreview':{AutomationInstructionPreview:props=>React.createElement('pre',{'data-view':props.view},props.view==='source'?props.code:props.instructionMapping?'LLM mapped readable instructions':'Parsed instructions')},
  '../lib/automationSourceProposal':helper
 };
 const exports={};new Function('require','exports','navigator',compile(read('../../frontend/components/AutomationSourceProposalReview.tsx')))(name=>Object.hasOwn(dependencies,name)?dependencies[name]:require(name),exports,{clipboard:{writeText:async value=>copied.push(value)}});
 const props={projectId:'project',testCaseId:'case',transactionId:target,steps:[{id:'section13',test_case_id:'case',step_order:13,step_type:'web'},{id:'section14',test_case_id:'case',step_order:14,step_type:'web'}],history:[{id:older,status:'completed'}],working:false,integrationId:'configured-model',initialStepId:'section13',onReview:value=>{reviews.push(value);review?.(value);}};
 const render=()=>{
  index=0;refIndex=0;const tree=exports.AutomationSourceProposalReview(props),nodes=[];
  const visit=node=>{if(!React.isValidElement(node))return;nodes.push(node);React.Children.forEach(node.props.children,visit);};visit(tree);
  return{html:renderToStaticMarkup(tree),button:label=>nodes.find(node=>node.type==='button'&&React.Children.toArray(node.props.children).join('')===label),field:label=>nodes.find(node=>node.props['aria-label']===label),overlay:nodes.find(node=>node.type===dependencies['./AutomationOverlay'].AutomationOverlay)};
 };
 const open=()=>{let view=render();view.button('Regenerate saved instructions from retained evidence').props.onClick();return render();};
 return{render,open,props,states,queries,dependencies,generated,copied,reviews};
}

test('proposal is admin-only and requires every source/build/data/trace permission',()=>{
 for(const config of [{role:'member'},...helper.SOURCE_PROPOSAL_PERMISSIONS.map(permission=>({denied:[permission]}))]){
  const state=fixture(config);assert.equal(state.render().html,'');assert.equal(state.queries[0].enabled,false);assert.equal(state.generated.length,0);
 }
});

test('review shows LLM Instructions and exact Source, copies without saving, and opens the existing editor only on request',async()=>{
 const state=fixture(),before=structuredClone(state.props.steps);let view=state.open();
 assert.match(view.html,/Unverified proposal · Not saved · No browser actions/);assert.equal(view.field('Source proposal section').props.value,'section13');
 await view.button('Generate source proposal').props.onClick();await new Promise(resolve=>setImmediate(resolve));view=state.render();
 assert.match(view.html,/LLM mapped readable instructions/);assert.equal(state.generated.length,1);assert.deepEqual(state.reviews,[]);
 view.button('Source').props.onClick();view=state.render();assert.match(view.html,/frameLocator/);assert.match(view.html,/toHaveText/);
 await view.button('Copy proposed source').props.onClick();assert.deepEqual(state.copied,[code]);assert.deepEqual(state.props.steps,before);
 view.button('Review in Source editor').props.onClick();assert.equal(state.reviews.length,1);assert.equal(state.reviews[0].automation_instructions.schema,'hellotest.playwrightInstructions.v1');assert.deepEqual(state.props.steps,before);
});

test('the same bounded form can request section14 from an earlier retained Build without writing current source',async()=>{
 const state=fixture();let view=state.open();
 view.field('Source proposal section').props.onChange({target:{value:'section14'}});view=state.render();
 view.field('Retained evidence Build').props.onChange({target:{value:older}});view=state.render();
 await view.button('Generate source proposal').props.onClick();await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(state.generated[0].slice(0,2),[target,{test_case_id:'case',step_id:'section14',source_call_id:'source-call',evidence_transaction_id:older,integration_id:'configured-model'}]);
 assert.equal(state.generated[0][2].aborted,false);assert.deepEqual(state.reviews,[]);
});

test('closing during generation aborts the request and discards a late proposal',async()=>{
 let resolve;const state=fixture({generate:()=>new Promise(done=>resolve=done)});let view=state.open();
 view.button('Generate source proposal').props.onClick();view=state.render();assert.equal(view.button('Generating proposal…').props.disabled,true);
 view.overlay.props.onClose();resolve(proposal());await new Promise(done=>setImmediate(done));
 assert.equal(state.generated[0][2].aborted,true);assert.doesNotMatch(state.render().html,/Copy proposed source/);assert.deepEqual(state.reviews,[]);
});

test('retained call selection reads at most three metadata pages and never requests private payloads',async()=>{
 const state=fixture();state.open();const pages=[];
 state.dependencies['@hellotest/trace/frontend/api.client'].traceApi.llmTraces.list=async(query)=>{pages.push(query);return{items:[{id:'other',status:'completed',capture:{generation_section_ids:['another']}}],next_cursor:'next'};};
 const rows=await state.queries.at(-1).queryFn({signal:new AbortController().signal});assert.deepEqual(rows,{items:[],legacy:false});assert.equal(pages.length,3);
 for(const page of pages){assert.equal(page.project_id,'project');assert.equal(page.test_case_id,'case');assert.equal(page.session_id,target);}
});

test('call metadata prefers exact upstream source scope and labels only genuinely legacy fallback',async()=>{
 const state=fixture();state.open();let rows=[];
 state.dependencies['@hellotest/trace/frontend/api.client'].traceApi.llmTraces.list=async()=>({items:rows,next_cursor:null});
 const query=()=>state.queries.at(-1).queryFn({signal:new AbortController().signal});
 const legacy={id:'legacy',status:'succeeded',capture:{}},source={id:'source13',status:'succeeded',capture:{generation_scope:'upstream_source',generation_section_ids:['section13']}};
 rows=[legacy,{id:'actor',status:'succeeded',capture:{generation_scope:'upstream_browser_actor',generation_section_ids:['section13']}},{id:'mapping',status:'succeeded',capture:{generation_scope:'upstream_instruction_mapping',generation_section_ids:['section13']}},{id:'foreign',status:'succeeded',capture:{generation_scope:'upstream_source',generation_section_ids:['section14']}},source];
 assert.deepEqual(await query(),{items:[source],legacy:false});
 rows=rows.filter(row=>row!==source);assert.deepEqual(await query(),{items:[legacy],legacy:true});
 rows=[{...legacy,status:'running'},{...legacy,id:'truncated',capture:{request_truncated:true}}];assert.deepEqual(await query(),{items:[],legacy:false});
});

test('upstream trace purpose labels distinguish source proposals, native actions, display mapping, and API source',()=>{
 const source=ts.createSourceFile('details.tsx',read('../../../trace/frontend/components/ModelCallDetails.tsx'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const declarations=source.statements.filter(node=>ts.isFunctionDeclaration(node)&&['modelScopeLabel','modelScopeDescription'].includes(node.name?.text)).map(node=>node.getText(source)).join('\n');
 const functions=new Function(compile(declarations)+';return {modelScopeLabel,modelScopeDescription};')();
 for(const [scope,label,phrase] of [['upstream_browser_actor','Native browser actions','native browser actions'],['upstream_source','Native section source','retained native actions and evidence'],['upstream_instruction_mapping','Readable instructions','without changing executable code'],['upstream_api_source','API section source','selected API section']]){
  assert.equal(functions.modelScopeLabel(scope),label);assert.match(functions.modelScopeDescription(scope),new RegExp(phrase));
 }
});
