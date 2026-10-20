const test=require('node:test'),assert=require('node:assert/strict');
const {reduceActivityProgress:reduce}=require('../../backend/lib/automationActivityProgress');
test('strict progression completes only from a durable section receipt and propagates to linked manual work',()=>{
 let state=reduce({}, {phase:'automation.agent.plan',details:{test_case_id:'case',progression_policy:'performed_generated_saved',steps:[{step_id:'one'},{step_id:'two'}],manual_steps:[{manual_step_id:'manual-one'}],manual_coverage:[{manual_step_id:'manual-one',section_step_id:'one'}]}});
 assert.equal(state.progression_policy,'performed_generated_saved');
 state={...state,...reduce(state,{phase:'automation.agent.section.ready',details:{test_case_id:'case',step_id:'one',development_status:'completed'}})};
 assert.notEqual(state.step_progress[0].development_status,'completed','A preview alone cannot unlock the next step.');
 state={...state,...reduce(state,{phase:'automation.agent.section.saved',details:{test_case_id:'case',step_id:'one',development_status:'completed'}})};
 assert.equal(state.step_progress[0].instruction_status,'saved');assert.equal(state.step_progress[0].development_status,'completed');
 assert.equal(state.manual_step_progress[0].development_status,'completed');assert.equal(state.step_progress[1].development_status,'queued');
 assert.equal(state.step_progress[0].verification_status,'unverified');
});
test('per-step generation progress persists real queue/attempt/validation/save transitions without execution claims',()=>{
 let state={step_progress:[{test_case_id:'other',step_id:'keep',status:'completed',instruction_status:'saved'}]};
 const apply=(phase,details={})=>state={...state,...reduce(state,{phase,details:{test_case_id:'case',...details}})};
 apply('automation.agent.plan',{steps:[{step_id:'one',step_order:1,action:'Open',expected_result:'Visible'},{step_id:'two',step_order:2,action:'Submit',expected_result:'Saved'}],manual_steps:[{manual_step_id:'m',manual_test_case_id:'manual',expected_result:'Saved'}],manual_coverage:[{manual_step_id:'m',section_step_id:'two'}]});
 assert.equal(state.step_progress.find(row=>row.step_id==='one').status,'queued');
 apply('automation.agent.attempt',{pending_step_ids:['one','two'],attempt:1});assert.equal(state.manual_step_progress[0].status,'queued');assert.equal(state.step_progress.find(row=>row.step_id==='one').instruction_status,'requested');
 apply('automation.agent.section.ready',{step_id:'one',attempt:1});assert.equal(state.step_progress.find(row=>row.step_id==='one').instruction_status,'validated');
 apply('automation.agent.incomplete',{pending_step_ids:['two']});assert.equal(state.manual_step_progress[0].status,'needs_attention');
 apply('automation.agent.attempt',{pending_step_ids:['two'],attempt:2});apply('automation.agent.section.ready',{step_id:'two',attempt:2});
 assert.equal(state.manual_step_progress[0].instruction_status,'validated');
 apply('automation.case.updated',{step_ids:['one','two']});assert.equal(state.manual_step_progress[0].instruction_status,'saved');assert.equal(state.step_progress.find(row=>row.step_id==='keep').instruction_status,'saved');
 assert.ok(state.step_progress.filter(row=>row.test_case_id==='case').every(row=>row.verification_status==='unverified'));
});
test('failed generation retains validated-but-unsaved progress and marks unfinished work as needing attention',()=>{
 const state={step_progress:[{test_case_id:'case',step_id:'one',status:'completed',instruction_status:'validated'},{test_case_id:'case',step_id:'two',status:'in_progress',instruction_status:'generating'}]};
 const result=reduce(state,{phase:'automation.llm.failed',details:{test_case_id:'case'}});
 assert.equal(result.step_progress[0].instruction_status,'validated_not_saved');assert.equal(result.step_progress[1].status,'needs_attention');assert.equal(state.step_progress[1].status,'in_progress','does not mutate earlier snapshots');
});

test('a declared missing mailbox stays needs-attention while other sections remain validated but unsaved',()=>{
 const initial={step_progress:[{test_case_id:'case',step_id:'good',instruction_status:'validated',status:'completed'},{test_case_id:'case',step_id:'inbox',instruction_status:'validated',status:'completed',preview_artifact_id:'older-draft',preview_created_at:'2026-10-15T22:00:00Z',validated_at:'2026-10-15T22:00:00Z'}]};
 const blocked=reduce(initial,{phase:'automation.agent.dependencies',details:{test_case_id:'case',blocked_steps:[{step_id:'inbox',reason:'No real mailbox source',required_context:['Mailbox connection']}]}});
 const result=reduce(blocked,{phase:'automation.agent.blocked',details:{test_case_id:'case'}});
 assert.equal(result.step_progress[0].instruction_status,'validated_not_saved');assert.equal(result.step_progress[1].instruction_status,'dependency_missing');assert.equal(result.step_progress[1].dependency.reason,'No real mailbox source');assert.equal(result.step_progress[1].status,'needs_attention');
 assert.equal(result.step_progress[1].preview_artifact_id,null,'a later dependency cannot leave an earlier draft labeled as validated');assert.equal(result.step_progress[1].validated_at,null);
});

test('authoritative sequential progress enables one current source row and leaves all future work queued',()=>{
 let state={};
 const apply=(phase,details={})=>state={...state,...reduce(state,{phase,details:{test_case_id:'case',...details}})};
 apply('automation.agent.plan',{generation_mode:'sequential',steps:[{step_id:'one',action:'Use @t.value'},{step_id:'two',action:'Submit'}],manual_steps:[{manual_step_id:'m-one'},{manual_step_id:'m-two'}],manual_coverage:[{manual_step_id:'m-one',section_step_id:'one'},{manual_step_id:'m-two',section_step_id:'two'}]});
 apply('automation.agent.attempt',{generation_mode:'sequential',active_step_id:'one',active_manual_step_ids:['m-one'],pending_step_ids:['one','two'],attempt:1});
 assert.equal(state.step_progress[1].instruction_status,'pending');
 apply('automation.agent.section.started',{generation_mode:'sequential',step_id:'one',active_step_id:'one',active_manual_step_ids:['m-one'],attempt:1,section_attempt:1});
 assert.deepEqual(state.manual_step_progress.map(row=>row.status),['in_progress','queued']);
 assert.deepEqual(state.step_progress.map(row=>row.status),['in_progress','queued']);
 apply('automation.agent.observation',{active_step_id:'one',active_manual_step_ids:['m-one'],screenshot_artifact_id:'actual-image-one',attempt:1});
 assert.equal(state.workspace_application.active_step_id,'one');assert.deepEqual(state.workspace_application.active_manual_step_ids,['m-one']);
 apply('automation.agent.section.ready',{step_id:'one',attempt:1});
 apply('automation.agent.section.started',{generation_mode:'sequential',step_id:'two',active_step_id:'two',active_manual_step_ids:['m-two'],attempt:2,section_attempt:1});
 assert.deepEqual(state.manual_step_progress.map(row=>row.status),['completed','in_progress']);
 assert.equal(state.workspace_application.active_step_id,'one','the previous real image keeps its source step until new evidence is captured');
 apply('automation.agent.incomplete',{generation_mode:'sequential',active_step_id:'two',active_manual_step_ids:['m-two'],pending_step_ids:['two'],missing_manual_step_ids:[]});
 assert.equal(state.step_progress[0].instruction_status,'validated');assert.equal(state.step_progress[1].status,'needs_attention');
});

test('resolved build-data progress stores only protected artifact references and preserves other cases',()=>{
 const state={build_data_artifacts:{other:'artifact-other'}};
 const result=reduce(state,{phase:'automation.agent.data',details:{test_case_id:'case',build_data_artifact_id:'artifact-case',parameter_values:{'t.private':'never-copy-this'}}});
 assert.deepEqual(result.build_data_artifacts,{other:'artifact-other',case:'artifact-case'});
 assert.doesNotMatch(JSON.stringify(result),/never-copy-this/);assert.deepEqual(state.build_data_artifacts,{other:'artifact-other'});
});

test('a shared generated section highlights only its earliest source action while its other covered sources wait',()=>{
 let state={};
 const apply=(phase,details={})=>state={...state,...reduce(state,{phase,details:{test_case_id:'case',...details}})};
 apply('automation.agent.plan',{steps:[{step_id:'shared'}],manual_steps:[{manual_step_id:'first'},{manual_step_id:'second'}],manual_coverage:[{manual_step_id:'first',section_step_id:'shared'},{manual_step_id:'second',section_step_id:'shared'}]});
 apply('automation.agent.section.started',{step_id:'shared',active_manual_step_ids:['first'],attempt:1});
 assert.deepEqual(state.manual_step_progress.map(row=>row.status),['in_progress','queued']);
 apply('automation.agent.observation',{active_step_id:'shared',active_manual_step_ids:['first'],snapshot_artifact_id:'current-evidence'});
 assert.deepEqual(state.manual_step_progress.map(row=>row.status),['in_progress','queued']);
 apply('automation.agent.section.ready',{step_id:'shared'});
 assert.deepEqual(state.manual_step_progress.map(row=>row.instruction_status),['validated','validated']);
});

test('durably saved section receipts survive later drafts and case dependency failures',()=>{
 let state={};
 const apply=(phase,details={})=>state={...state,...reduce(state,{phase,details:{test_case_id:'case',...details}})};
 apply('automation.agent.plan',{steps:[{step_id:'saved'},{step_id:'blocked'}],manual_steps:[{manual_step_id:'m'}],manual_coverage:[{manual_step_id:'m',section_step_id:'saved'}]});
 apply('automation.agent.section.ready',{step_id:'saved',preview_artifact_id:'validated-preview'});
 assert.equal(state.step_progress[0].instruction_status,'validated');
 apply('automation.agent.section.saved',{step_id:'saved',saved_at:'2026-10-17T12:00:00Z'});
 for(const phase of ['automation.agent.section.ready','automation.agent.dependencies','automation.agent.incomplete','automation.llm.failed','automation.agent.save.failed','automation.agent.blocked'])apply(phase,{step_id:'saved',pending_step_ids:['saved','blocked'],blocked_steps:[{step_id:'saved',reason:'Late failure cannot erase a durable save'},{step_id:'blocked',reason:'Mailbox unavailable'}]});
 assert.equal(state.step_progress[0].instruction_status,'saved');assert.equal(state.step_progress[0].saved_at,'2026-10-17T12:00:00Z');
 assert.equal(state.manual_step_progress[0].instruction_status,'saved');assert.equal(state.step_progress[0].verification_status,'unverified');
 assert.notEqual(state.step_progress[1].instruction_status,'saved');
});

test('real browser action receipts are idempotent, scoped and contain no tool arguments',()=>{
 let state={step_progress:[{test_case_id:'case',step_id:'one'},{test_case_id:'other',step_id:'one'}],manual_step_progress:[{test_case_id:'case',manual_step_id:'m-one',section_step_id:'one'},{test_case_id:'case',manual_step_id:'m-two',section_step_id:'one'}]};
 const apply=(phase,extra={})=>state={...state,...reduce(state,{phase,details:{test_case_id:'case',active_step_id:'one',active_manual_step_ids:['m-one'],action_id:'unique-action',tool:'browser_fill',arguments:{value:'private-value'},...extra}})};
 apply('automation.agent.action.started');
 const before=structuredClone(state);
 apply('automation.agent.action.completed',{action_outcome:'completed'});
 assert.equal(state.step_progress[0].browser_actions[0].status,'completed');assert.equal(before.step_progress[0].browser_actions[0].status,'running');
 apply('automation.agent.action.started');apply('automation.agent.action.completed',{action_outcome:'completed'});
 assert.equal(state.step_progress[0].browser_actions.length,1);assert.equal(state.step_progress[0].browser_actions[0].status,'completed');
 assert.equal(state.step_progress[1].browser_actions,undefined);assert.equal(state.manual_step_progress[0].browser_actions.length,1);assert.equal(state.manual_step_progress[1].browser_actions.length,0);
 assert.doesNotMatch(JSON.stringify(state),/private-value|arguments/);
 apply('automation.agent.action.completed',{action_id:'assertion',tool:'browser_assert',assertion_outcome:'satisfied'});
 assert.equal(state.step_progress[0].browser_actions[1].assertion_outcome,'satisfied');assert.equal(state.step_progress[0].browser_actions[1].status,'completed');
 apply('automation.agent.action.failed',{action_id:'unknown',tool:'browser_click',action_outcome:'unknown'});
 assert.equal(state.step_progress[0].browser_actions[2].status,'unknown');
 assert.equal(state.step_progress[0].instruction_status,undefined,'browser interaction is separate from generated or saved code');
});

test('native assertion satisfaction is distinct from completed mutations and contradictory or missing outcomes stay failed',()=>{
 const cases=[
  ['browser_assert','automation.agent.action.completed',{assertion_outcome:'satisfied'},'completed'],
  ['browser_assert','automation.agent.action.completed',{action_outcome:'completed'},'failed'],
  ['browser_assert','automation.agent.action.completed',{assertion_outcome:'not_satisfied'},'failed'],
  ['browser_assert','automation.agent.action.failed',{assertion_outcome:'satisfied'},'failed'],
  ['browser_assert','automation.agent.action.unknown',{assertion_outcome:'satisfied'},'unknown'],
  ['browser_click','automation.agent.action.completed',{action_outcome:'completed'},'completed'],
  ['browser_click','automation.agent.action.completed',{assertion_outcome:'satisfied'},'failed']
 ];
 for(const [tool,phase,outcomes,status]of cases){
  const state={step_progress:[{test_case_id:'case',step_id:'one'}]};
  const result=reduce(state,{phase,details:{test_case_id:'case',active_step_id:'one',action_id:'receipt',tool,...outcomes}});
  assert.equal(result.step_progress[0].browser_actions[0].status,status,`${tool}/${phase}/${JSON.stringify(outcomes)}`);
 }
});

test('a saved section keeps its satisfied assertion after a later section fails and delayed events do not reverse it',()=>{
 let state={};let clock=0;
 const apply=(phase,details={})=>state={...state,...reduce(state,{phase,details:{test_case_id:'case',updated_at:`2026-10-17T11:03:${String(clock++).padStart(2,'0')}Z`,...details}})};
 apply('automation.agent.plan',{steps:[{step_id:'one'},{step_id:'two'}],manual_steps:[{manual_step_id:'m-one'},{manual_step_id:'m-two'}],
  manual_coverage:[{manual_step_id:'m-one',section_step_id:'one'},{manual_step_id:'m-two',section_step_id:'two'}]});
 apply('automation.agent.section.started',{step_id:'one',active_step_id:'one',active_manual_step_ids:['m-one']});
 apply('automation.agent.action.started',{active_step_id:'one',active_manual_step_ids:['m-one'],action_id:'satisfied-check',tool:'browser_assert'});
 apply('automation.agent.action.completed',{active_step_id:'one',active_manual_step_ids:['m-one'],action_id:'satisfied-check',tool:'browser_assert',assertion_outcome:'satisfied'});
 apply('automation.agent.section.saved',{step_id:'one',development_status:'completed'});
 const saved=structuredClone(state.step_progress[0]);
 apply('automation.agent.section.started',{step_id:'two',active_step_id:'two',active_manual_step_ids:['m-two']});
 apply('automation.agent.action.failed',{active_step_id:'two',active_manual_step_ids:['m-two'],action_id:'failed-check',tool:'browser_assert',error_code:'BROWSER_ASSERTION_NOT_SATISFIED'});
 apply('automation.agent.browser.failed',{active_step_id:'two',active_manual_step_ids:['m-two'],error_code:'AUTOMATION_BROWSER_CHECK_STALLED'});
 assert.deepEqual(state.step_progress[0],saved);
 assert.equal(state.step_progress[0].browser_actions[0].status,'completed');
 assert.equal(state.manual_step_progress[0].browser_actions[0].status,'completed');
 assert.equal(state.step_progress[1].status,'needs_attention');assert.equal(state.step_progress[1].browser_actions[0].status,'failed');
 apply('automation.agent.action.started',{active_step_id:'one',active_manual_step_ids:['m-one'],action_id:'satisfied-check',tool:'browser_assert'});
 apply('automation.agent.action.failed',{active_step_id:'one',active_manual_step_ids:['m-one'],action_id:'satisfied-check',tool:'browser_assert'});
 assert.equal(state.step_progress[0].browser_actions[0].status,'completed');assert.equal(state.step_progress[0].instruction_status,'saved');
});

test('isolated verification is case scoped and does not turn authoring evidence into a passing run',()=>{
 const summary={status:'passed',phase:'complete',source_fingerprint:'a'.repeat(64),verification_id:'receipt',attempts:1,repair_count:0};
 const result=reduce({workspace_application:{test_case_id:'case',verification_status:'unverified'},verification_by_case:{other:{status:'blocked'}}},{phase:'automation.agent.verification',details:{test_case_id:'case',verification:summary}});
 assert.deepEqual(result.verification_by_case.case,summary);assert.equal(result.verification_by_case.other.status,'blocked');assert.equal(result.workspace_application,undefined);
});
