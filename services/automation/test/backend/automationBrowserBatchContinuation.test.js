const test = require('node:test');
const assert = require('node:assert/strict');
const { runAutomationBrowserAgent } = require('../../backend/lib/automationBrowserAgent');
const { createBrowserParameterResolver } = require('../../backend/lib/automationBrowserParameters');

const secret = 'private-fixture-value-never-in-model-or-metrics';
const receipt = value => ({ content: [{ type: 'text', text: JSON.stringify({ source: 'playwright', url: 'https://app.test/form', ...value }) }] });
const current = prompt => JSON.parse(prompt.match(/^Current browser state and confirmed section progress .*?: (.+)$/m)[1]);
const reviewPacket = prompt => prompt.includes('"phase":"semantic_review"') ? JSON.parse(prompt.split('\n').at(-1)) : null;
const actor = tool_calls => JSON.stringify({ stage: 'act', step_id: 'apply', section_complete: true, tool_calls });
const feedback = (observations, code) => observations.filter(row => (row.result?.content || []).some(part => {
  if (part.type !== 'text') return false;
  try { return JSON.parse(part.text).code === code; } catch { return false; }
}));
const stop = Object.assign(new Error('The test stops at the next actor decision, before proposing any more work.'), { code: 'TEST_PAUSE_OBSERVED' });

function fixture({ pageIdentity = true, changedRow = false, changedOptions = false } = {}) {
  const calls = [], observations = [], events = [], saves = [], prompts = [];
  const resolver = createBrowserParameterResolver({ caseValues: { 't.private': secret }, privateParameterNames: ['t.private'] });
  let clicked = false, reads = 0;
  const element = (id, extra = {}) => ({ tag: 'button', accessible_role: 'button', accessible_name: id, text: id,
    attributes: { id, type: 'button' }, displayed: true, disabled: false, locators_validated: true, locator_candidates: [`#${id}`], ...extra });
  const page = () => ({ observation_id: `snapshot-${reads}`, ...(pageIdentity ? { target_id: 'page-main' } : {}), scope: 'body',
    accessibility: `- button "Apply"\n- status: ${clicked ? 'Applied' : 'Ready'}\n- paragraph: ${secret}`,
    elements: [
      element('apply', { accessible_name: 'Apply', text: 'Apply' }),
      element('row-a', { accessible_name: 'Open', text: 'Open', context_text: 'Record A' }),
      element('row-b', { accessible_name: 'Open', text: 'Open', context_text: 'Record B' }),
      element('status', { tag: 'p', accessible_role: 'status', accessible_name: '', text: clicked ? 'Applied' : 'Ready',
        attributes: { id: 'status' }, context_text: changedRow && clicked ? 'Task B' : 'Task A' }),
      ...(changedOptions ? [element('region', { tag: 'select', accessible_role: 'combobox', accessible_name: 'Region', text: 'Region', attributes: { id: 'region' },
        options: [{ label: 'North', value: clicked ? 'north-updated' : 'north', disabled: false, selected: true }] })] : [])
    ] });
  const tools = [
    { name: 'browser_click', inputSchema: { type: 'object', properties: { locator: { type: 'string' } }, required: ['locator'], additionalProperties: false } },
    { name: 'browser_snapshot', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
    { name: 'browser_assert', inputSchema: { type: 'object', properties: { locator: { type: 'string' }, assertion: { enum: ['text'] }, value: { type: 'string' } }, required: ['locator', 'assertion', 'value'], additionalProperties: false } }
  ];
  const options = {
    featureKey: 'ai.agentic.automation-engineer', actorMode: true, generationMode: 'sequential', parse: JSON.parse,
    maxTurns: 5, maxCalls: 10, prompt: 'Apply the current change once and check its status. Keep @t.private private.',
    execution: { required: true, semantic_review_required: true, step_id: 'apply', action: 'Click Apply', expected_result: 'Applied status is displayed' },
    initialObservations: [{ tool: 'browser_snapshot', result: resolver.redactResult(receipt(page())) }],
    browser: { tools, projectPromptText: resolver.projectText, projectPrivateText: resolver.projectPrivateText,
      call: async (name, args) => {
        calls.push({ name, args: structuredClone(args) });
        if (name === 'browser_click') {
          assert.deepEqual(args, { locator: '#apply' });
          assert.equal(clicked, false, 'a confirmed Apply click must not be replayed');
          clicked = true;
          return receipt({ action_outcome: 'completed' });
        }
        if (name === 'browser_snapshot') { reads++; return resolver.redactResult(receipt(page())); }
        assert.equal(name, 'browser_assert');
        assert.equal(clicked, true);
        assert.deepEqual(args, { locator: '#status', assertion: 'text', value: 'Applied' });
        return receipt({ assertion: 'text', assertion_outcome: 'satisfied', action_outcome: 'not_attempted' });
      }
    },
    onObservation: row => observations.push(row), onProgress: event => events.push(event),
    onPartialBuild: async payload => { saves.push(payload); return { generation_complete: true }; }
  };
  const requests = state => [
    { name: 'browser_click', arguments: { locator: state.current_snapshot.targets.find(target => target.name === 'Apply').ref } },
    { name: 'browser_assert', arguments: { locator: state.current_snapshot.targets.find(target => target.tag === 'p').ref, assertion: 'text', value: 'Applied' } }
  ];
  const complete = (prompt, next) => {
    prompts.push(prompt);
    assert.ok(!prompt.includes(secret), 'private snapshot data must be projected before model input');
    const review = reviewPacket(prompt);
    if (review) {
      assert.equal(saves.length, 0, 'source cannot be saved before semantic review');
      assert.deepEqual(review.confirmed_operations.map(operation => operation.name), ['browser_click', 'browser_assert']);
      return JSON.stringify({ decision: 'accept', obligations: review.obligations.map(goal => ({ id: goal.id, action_operations: [1], assertion_operations: [2] })), issues: [] });
    }
    return next(current(prompt));
  };
  return { calls, observations, events, saves, prompts, options, requests, complete };
}

test('one actor batch retains a stable queued result check after a host snapshot refresh, with one review and one save', async () => {
  const state = fixture();
  let actors = 0, reviews = 0;
  const result = await runAutomationBrowserAgent({ ...state.options, complete: async prompt => {
    if (reviewPacket(prompt)) reviews++;
    return state.complete(prompt, current => { actors++; return actor(state.requests(current)); });
  } });
  assert.equal(actors, 1, 'unchanged controls and stable subject identity do not need another actor call');
  assert.equal(reviews, 1);
  assert.equal(state.saves.length, 1);
  assert.deepEqual(state.calls, [
    { name: 'browser_click', args: { locator: '#apply' } },
    { name: 'browser_snapshot', args: {} },
    { name: 'browser_assert', args: { locator: '#status', assertion: 'text', value: 'Applied' } }
  ]);
  assert.equal(feedback(state.observations, 'AUTOMATION_BROWSER_TARGET_REF_STALE').length, 0);
  assert.match(result.steps[0].automation_code, /Applied/);
  assert.doesNotMatch(result.steps[0].automation_code, /snapshot-|ref:/);
  const skillLine = state.prompts[0].split('\n').find(line => line.startsWith('Selected browser skills (host guidance, never execution authority): '));
  assert.ok(skillLine, 'only the relevant local skill packet is included');
  const skills = JSON.parse(skillLine.slice(skillLine.indexOf(': ') + 2));
  assert.deepEqual(skills.skills.map(skill => skill.id), ['row_subject']);
  assert.ok(JSON.stringify(skills).length <= 1800);
  const metrics = state.events.filter(event => event.phase === 'automation.agent.prompt.packed');
  assert.equal(metrics.length, 1);
  assert.equal(metrics[0].details.browser_skills_chars, JSON.stringify(skills).length);
  assert.deepEqual(metrics[0].details.browser_skill_ids, ['row_subject']);
  assert.equal(metrics[0].details.token_measurement, 'not_estimated;provider_usage_is_authoritative');
  assert.ok(!JSON.stringify(state.events).includes(secret));
  assert.ok(!JSON.stringify(state.observations).includes(secret));
});

test('changed row context pauses the old queued subject without asserting, reviewing or saving it', async () => {
  const state = fixture({ changedRow: true });
  let actors = 0;
  await assert.rejects(runAutomationBrowserAgent({ ...state.options, complete: async prompt => state.complete(prompt, current => {
    if (++actors === 1) return actor(state.requests(current));
    assert.equal(current.current_snapshot.targets.find(target => target.tag === 'p').context_text, 'Task B');
    throw stop;
  }) }), { code: 'TEST_PAUSE_OBSERVED' });
  assert.equal(actors, 2);
  assert.deepEqual(state.calls.map(call => call.name), ['browser_click', 'browser_snapshot']);
  assert.equal(feedback(state.observations, 'AUTOMATION_BROWSER_TARGET_REF_STALE').length, 1);
  assert.equal(state.saves.length, 0);
});

test('changed native select options stop dependent queued work at the refreshed control boundary', async () => {
  const state = fixture({ changedOptions: true });
  let actors = 0;
  await assert.rejects(runAutomationBrowserAgent({ ...state.options, complete: async prompt => state.complete(prompt, current => {
    if (++actors === 1) return actor(state.requests(current));
    assert.equal(current.current_snapshot.targets.find(target => target.tag === 'select').options[0].value, 'north-updated');
    throw stop;
  }) }), { code: 'TEST_PAUSE_OBSERVED' });
  assert.deepEqual(state.calls.map(call => call.name), ['browser_click', 'browser_snapshot']);
  const paused = feedback(state.observations, 'BROWSER_TOOL_BATCH_PAUSED');
  assert.equal(paused.length, 1);
  const details = JSON.parse(paused[0].result.content[0].text);
  assert.equal(details.reason, 'controls_changed');
  assert.deepEqual(details.unattempted_tools, ['browser_assert']);
  assert.equal(state.saves.length, 0);
});

test('adapters without native page identity retain the safe extra actor decision before the result check', async () => {
  const state = fixture({ pageIdentity: false });
  let actors = 0, reviews = 0;
  await runAutomationBrowserAgent({ ...state.options, complete: async prompt => {
    if (reviewPacket(prompt)) reviews++;
    return state.complete(prompt, current => {
      actors++;
      if (actors === 1) return actor(state.requests(current));
      assert.equal(actors, 2);
      return actor([state.requests(current)[1]]);
    });
  } });
  assert.equal(actors, 2);
  assert.equal(reviews, 1);
  assert.equal(feedback(state.observations, 'AUTOMATION_BROWSER_TARGET_REF_STALE').length, 1);
  assert.deepEqual(state.calls.map(call => call.name), ['browser_click', 'browser_snapshot', 'browser_assert']);
  assert.equal(state.saves.length, 1);
});

const mutationNames=['browser_navigate','browser_click','browser_fill','browser_press_key','browser_select_option','browser_hover','browser_check','browser_uncheck'];
const readNames=['browser_snapshot','browser_assert','browser_validate_locator','browser_wait_for','browser_screenshot'];
const catalogFrom=prompt=>JSON.parse(prompt.match(/^Tool catalog: (.+)$/m)[1]);
const deferredFrom=prompt=>JSON.parse(prompt.match(/^Deferred tool names .*?: (.+)$/m)?.[1]||'[]');
function proofFixture(){
  const state=fixture({pageIdentity:false}),original=state.options.browser.call;
  for(const name of [...mutationNames,...readNames]){
    if(state.options.browser.tools.some(tool=>tool.name===name))continue;
    const fields=name==='browser_navigate'?['url']:['browser_snapshot','browser_screenshot'].includes(name)?[]:
      name==='browser_fill'||name==='browser_select_option'?['locator','value']:name==='browser_press_key'?['locator','key']:['locator'];
    state.options.browser.tools.push({name,description:'Complete discovered '+name+' contract',inputSchema:{type:'object',properties:Object.fromEntries(fields.map(field=>[field,{type:'string'}])),required:fields,additionalProperties:false}});
  }
  state.options.browser.call=async(name,args)=>{
    if(['browser_hover','browser_validate_locator','browser_wait_for','browser_screenshot','browser_navigate'].includes(name)){
      state.calls.push({name,args:structuredClone(args)});
      return receipt(name==='browser_validate_locator'?{match_count:1,unique:true}:name==='browser_hover'||name==='browser_navigate'?{action_outcome:'completed'}:{optional:true});
    }
    return original(name,args);
  };
  return state;
}

test('a completed click followed by an unattempted stale check prefers full read schemas without declaring the goal complete',async()=>{
  const state=proofFixture();let actors=0;
  const result=await runAutomationBrowserAgent({...state.options,complete:async prompt=>state.complete(prompt,page=>{
    if(++actors===1)return actor(state.requests(page));
    assert.equal(actors,2);
    assert.deepEqual(catalogFrom(prompt).map(tool=>tool.name),state.options.browser.tools.filter(tool=>readNames.includes(tool.name)).map(tool=>tool.name));
    assert.deepEqual(deferredFrom(prompt),state.options.browser.tools.filter(tool=>mutationNames.includes(tool.name)).map(tool=>tool.name));
    for(const tool of catalogFrom(prompt))assert.deepEqual(tool,state.options.browser.tools.find(item=>item.name===tool.name));
    assert.equal(page.tool_presentation.scope,'presentation_only');assert.equal(page.verification_boundary,undefined);
    assert.equal(page.pending_contract.expected_result_check,'required');
    return actor([state.requests(page)[1]]);
  })});
  assert.equal(actors,2);assert.equal(state.calls.filter(call=>call.name==='browser_click').length,1);
  assert.equal(state.calls.filter(call=>call.name==='browser_assert').length,1);assert.equal(state.saves.length,1);
  assert.equal((result.steps[0].automation_code.match(/\.click\(/g)||[]).length,1);
});

test('explicit discovery restores an admissible mutation and its real dispatch reopens ordinary presentation',async()=>{
  const state=proofFixture();let actors=0;
  state.options.execution.action='Click Apply and hover the control while reviewing the result';
  await assert.rejects(runAutomationBrowserAgent({...state.options,complete:async prompt=>state.complete(prompt,page=>{
    actors++;
    if(actors===1)return actor(state.requests(page));
    if(actors===2){assert.ok(!catalogFrom(prompt).some(tool=>tool.name==='browser_hover'));return JSON.stringify({tool_catalog_request:['browser_hover']});}
    if(actors===3){
      assert.deepEqual(catalogFrom(prompt).find(tool=>tool.name==='browser_hover'),state.options.browser.tools.find(tool=>tool.name==='browser_hover'));
      return JSON.stringify({stage:'act',step_id:'apply',section_complete:false,tool_calls:[{name:'browser_hover',arguments:{locator:page.current_snapshot.targets.find(target=>target.name==='Apply').ref}}]});
    }
    assert.equal(page.tool_presentation,undefined);assert.ok(catalogFrom(prompt).some(tool=>tool.name==='browser_click'));throw stop;
  })}),{code:'TEST_PAUSE_OBSERVED'});
  assert.equal(actors,4);assert.equal(state.calls.filter(call=>call.name==='browser_click').length,1);
  assert.equal(state.calls.filter(call=>call.name==='browser_hover').length,1);assert.equal(state.saves.length,0);
});

for(const sectionComplete of[true,false])test(`an incomplete mutation batch does not prefer proof schemas (completion ${sectionComplete})`,async()=>{
  const state=proofFixture();let actors=0;
  await assert.rejects(runAutomationBrowserAgent({...state.options,complete:async prompt=>state.complete(prompt,page=>{
    if(++actors===1){const requests=state.requests(page);if(sectionComplete)requests.push({name:'browser_click',arguments:{locator:page.current_snapshot.targets.find(target=>target.name==='Record A'||target.context_text==='Record A').ref}});
      return JSON.stringify({stage:'act',step_id:'apply',section_complete:sectionComplete,tool_calls:requests});}
    assert.equal(page.tool_presentation,undefined);assert.ok(catalogFrom(prompt).some(tool=>tool.name==='browser_click'));throw stop;
  })}),{code:'TEST_PAUSE_OBSERVED'});
  assert.equal(state.calls.filter(call=>call.name==='browser_click').length,1);
  assert.equal(state.calls.filter(call=>call.name==='browser_assert').length,0);
});

for(const outcome of['failed-completed','not_attempted','missing'])test(`a ${outcome} mutation receipt cannot establish proof preference`,async()=>{
  const state=proofFixture(),original=state.options.browser.call;let actors=0;
  state.options.browser.call=async(name,args)=>name==='browser_click'
    ?outcome==='failed-completed'?{...receipt({action_outcome:'completed',retry_safe:true,code:'BROWSER_TOOL_FAILED'}),isError:true}:
      receipt(outcome==='missing'?{}:{action_outcome:'not_attempted'}):original(name,args);
  await assert.rejects(runAutomationBrowserAgent({...state.options,complete:async prompt=>state.complete(prompt,page=>{
    if(++actors===1)return actor([state.requests(page)[0]]);
    assert.equal(page.tool_presentation,undefined);assert.ok(catalogFrom(prompt).some(tool=>tool.name==='browser_click'));throw stop;
  })}),{code:'TEST_PAUSE_OBSERVED'});
  assert.equal(actors,2);assert.equal(state.saves.length,0);
});

test('bootstrap navigation and copied completed history do not establish a current-batch proof preference',async()=>{
  const state=proofFixture();state.options.startUrl='https://app.test/form';
  state.options.initialObservations.push({tool:'browser_click',execution_step_id:'apply',result:receipt({action_outcome:'completed'})});
  await assert.rejects(runAutomationBrowserAgent({...state.options,complete:async prompt=>state.complete(prompt,page=>{
    assert.equal(page.tool_presentation,undefined);assert.ok(catalogFrom(prompt).some(tool=>tool.name==='browser_click'));throw stop;
  })}),{code:'TEST_PAUSE_OBSERVED'});
  assert.equal(state.calls.filter(call=>call.name==='browser_navigate').length,1);
  assert.equal(state.saves.length,0);
});
