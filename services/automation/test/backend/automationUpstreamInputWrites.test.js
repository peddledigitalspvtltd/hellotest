const test = require('node:test');
const assert = require('node:assert/strict');
const {auditAuthoredInputWrites} = require('../../backend/lib/automationUpstreamInputWrites');
const {buildWithUpstreamPlaywright} = require('../../backend/lib/automationUpstreamEngineer');
const {inspectExecutablePlan} = require('../../backend/services/automationReadiness.service');
const step = {id: 'joined', step_order: 1, step_type: 'web', action: 'Fill Joined Date input with @r.employee_joined_date',
  expected_result: 'Joined Date retains @r.employee_joined_date', parameter_references: ['r.employee_joined_date']};
const startUrl = 'https://app.test/employee', goto = `await page.goto(${JSON.stringify(startUrl)});`;
const fill = 'await page.getByRole("textbox",{name:"Joined Date",exact:true}).fill("2026-11-06");';
const assertion = 'await expect(page.getByRole("textbox",{name:"Joined Date",exact:true})).toHaveValue("2026-11-06");';
const native = code => ({content: [{type: 'text', text: `### Ran Playwright code\n\x60\x60\x60js\n${code}\n\x60\x60\x60\n### Snapshot\n\x60\x60\x60yaml\n- textbox "Joined Date" [ref=e16]: 2026-11-06\n\x60\x60\x60`}]});

test('explicit parameterized input commands need a real text-write data argument; assertions, labels, comments and conditional writes cannot satisfy them', () => {
  for (const source of [
    'await expect(page.getByRole("textbox",{name:"Joined Date"})).toHaveValue("@r.employee_joined_date");',
    '// fill @r.employee_joined_date\nawait page.getByText("@r.employee_joined_date").click();',
    'await page.getByLabel("@r.employee_joined_date").fill("@r.other_date");',
    'if (false) await page.getByLabel("Joined Date").fill("@r.employee_joined_date");',
    'const fillLater=()=>page.getByLabel("Joined Date").fill("@r.employee_joined_date");'
  ]) assert.deepEqual(auditAuthoredInputWrites({step, source}).missing_parameter_references, ['@r.employee_joined_date']);
  for (const source of [
    'await page.getByLabel("Joined Date").fill("@r.employee_joined_date");',
    'await page.fill("#joined", params["r.employee_joined_date"]);',
    'const date=page.frameLocator("iframe").getByLabel("Joined Date"); await date.fill(params["r.employee_joined_date"]);'
  ]) assert.deepEqual(auditAuthoredInputWrites({step, source}).missing_parameter_references, []);
  for (const action of ['Verify Joined Date equals @r.employee_joined_date', 'Do not fill @r.employee_joined_date', 'Inspect the Enter @r.employee_joined_date help text']) {
    assert.deepEqual(auditAuthoredInputWrites({step: {...step, action}, source: ';'}).required_parameter_references, []);
  }
});

test('authored write values remain distinct from parameterized field labels and later click targets',()=>{
 const source='const message=params["r.message"]; const field=page.frameLocator("#editor").getByLabel(params["r.label"]); await field.fill(message);';
 for(const action of [
  'Type @r.message into the field labelled @r.label',
  'Enter @r.message in @r.label',
  'Fill the input labelled @r.label with @r.message',
  'Given I fill @r.label with @r.message and click @r.search_button'
 ]){
  const audit=auditAuthoredInputWrites({step:{action},source});
  assert.deepEqual(audit.required_parameter_references,['@r.message'],action);
  assert.deepEqual(audit.missing_parameter_references,[],action);assert.equal(audit.text_write_count,1);
 }
 const composite={action:'Enter @r.first_name and @r.last_name into the field labelled @r.label'};
 assert.deepEqual(auditAuthoredInputWrites({step:composite,source:'const value=params["r.first_name"]+" "+params["r.last_name"]; await page.getByLabel("Name").fill(value);'}).missing_parameter_references,[]);
 const repeated={action:'Fill @r.label with @r.message then type @r.second_message into @r.second_label'};
 assert.deepEqual(auditAuthoredInputWrites({step:repeated,source:'await page.getByLabel("First").fill(params["r.message"]); await page.getByLabel("Second").fill(params["r.second_message"]);'}).required_parameter_references,['@r.message','@r.second_message']);
});

test('a target reference, mutable value, wrong scope or conditional alias cannot substitute for the authored value write',()=>{
 const authored={action:'Type @r.message into the field labelled @r.label'};
 for(const source of [
  'const label=params["r.label"]; await page.getByLabel(label).fill(label);',
  'const message=params["s.message"]; await page.getByLabel("Message").fill(message);',
  'let message=params["r.message"]; message="Changed"; await page.getByLabel("Message").fill(message);',
  'const message=params["r.message"]; if(false) await page.getByLabel("Message").fill(message);',
  'const message=params["r.message"]; page.getByLabel("Message").fill(message);'
 ])assert.deepEqual(auditAuthoredInputWrites({step:authored,source}).missing_parameter_references,['@r.message'],source);
});

test('one input verb retains every repeated value-target pair while excluding labels and following click targets',()=>{
 const username='await page.getByLabel(params["r.username_label"]).fill(params["r.username"]);';
 const password='await page.getByLabel("Password").fill(params["r.password"]);';
 for(const action of [
  'Enter @r.username in Username and @r.password in Password, then click Login.',
  'Enter @r.username in @r.username_label and @r.password in Password, then click @r.login_button.',
  'Type @r.username into the field labelled @r.username_label and @r.password into the field labelled @r.password_label and click @r.login_button.'
 ]){
  const authored={action};
  assert.deepEqual(auditAuthoredInputWrites({step:authored,source:username}).required_parameter_references,['@r.username','@r.password'],action);
  assert.deepEqual(auditAuthoredInputWrites({step:authored,source:username}).missing_parameter_references,['@r.password'],action);
  assert.deepEqual(auditAuthoredInputWrites({step:authored,source:password}).missing_parameter_references,['@r.username'],action);
  assert.deepEqual(auditAuthoredInputWrites({step:authored,source:username+'\n'+password}).missing_parameter_references,[],action);
 }
 const composite={action:'Enter @r.username in @r.username_label and @r.first_name and @r.last_name into Full Name.'};
 assert.deepEqual(auditAuthoredInputWrites({step:composite,source:';'}).required_parameter_references,['@r.username','@r.first_name','@r.last_name']);
 const unknown={action:'Enter @r.username in Username and @r.password using the configured interaction.'};
 assert.deepEqual(auditAuthoredInputWrites({step:unknown,source:username}).missing_parameter_references,['@r.password'],'An unpaired second reference remains required when its role is unknown.');
});

function fixture({actor, emitFill = fill, generated = [goto, fill, assertion].join('\n'), interactive = true} = {}) {
  const calls = [], requests = [], saved = []; let turns = 0, closed = 0;
  const tools = [
    {name: 'browser_navigate', inputSchema: {type: 'object', required: ['url'], properties: {url: {type: 'string'}}, additionalProperties: false}},
    {name: 'browser_type', inputSchema: {type: 'object', required: ['ref','text'], properties: {ref: {type: 'string'}, text: {type: 'string'}}, additionalProperties: false}},
    {name: 'browser_snapshot', inputSchema: {type: 'object', properties: {}, additionalProperties: false}}
  ];
  const run = () => buildWithUpstreamPlaywright({steps: [step], startUrl, interactive, validate: inspectExecutablePlan,
    parameterBindings: {parameterValues: {'r.employee_joined_date': '2026-11-06'}},
    browser: {tools, call: async (name, args) => {calls.push({name, args}); return native(name === 'browser_navigate' ? goto : emitFill);}, close: async () => {closed++;}},
    complete: async request => {
      requests.push(request);
      if (request.phase === 'upstream_browser_actor') return actor ? actor(request, ++turns) : {done: true};
      if (request.phase === 'upstream_source') return {automation_code: generated};
      const packet = JSON.parse(request.prompt.slice(request.prompt.indexOf('{"task":')));
      return {schema: 'hellotest.playwrightInstructionMapping.v1', steps: packet.steps.map(row => ({step_id: row.step_id, source_sha256: row.source_sha256,
        instructions: row.operations.map(op => ({operation_id: op.operation_id, kind: op.kind, depth: op.depth, label: 'Native instruction', args: []}))}))};
    }, onSection: async update => saved.push(update)});
  return {run, calls, requests, saved, get closed() {return closed;}};
}

test('an already matching Joined Date still receives one native fill and saves the reusable supplied parameter', async () => {
  const f = fixture({actor: (request, turn) => {
    const packet = JSON.parse(request.prompt);
    assert.match(packet.input_action_contract, /even if the field already displays the configured value/);
    if (turn === 1) return {done: true};
    if (turn === 2) {
      assert.equal(packet.host_feedback.code, 'AUTOMATION_UPSTREAM_AUTHORED_INPUT_REQUIRED');
      assert.deepEqual(packet.host_feedback.required_parameter_references, ['@r.employee_joined_date']);
      return {tool: {name: 'browser_type', arguments: {ref: 'e16', text: '@r.employee_joined_date'}}};
    }
    return {done: true};
  }});
  const result = await f.run();
  assert.deepEqual(f.calls, [{name: 'browser_navigate', args: {url: startUrl}}, {name: 'browser_type', args: {ref: 'e16', text: '2026-11-06'}}]);
  assert.match(result.updates[0].automation_code, /\.fill\(params\["r\.employee_joined_date"\]\)/);
  assert.match(result.updates[0].automation_code, /\.toHaveValue\(params\["r\.employee_joined_date"\]\)/);
  assert.equal(f.saved.length, 1); assert.equal(f.closed, 1);
  assert.deepEqual(auditAuthoredInputWrites({step, source: result.updates[0].automation_code}).missing_parameter_references, []);
});

test('repeated assertion-only completion stops before source generation and never invents or dispatches a fill', async () => {
  const f = fixture();
  await assert.rejects(f.run(), {code: 'AUTOMATION_UPSTREAM_AUTHORED_INPUT_UNCONFIRMED'});
  assert.deepEqual(f.calls.map(row => row.name), ['browser_navigate']); assert.equal(f.saved.length, 0);
  assert.equal(f.requests.filter(row => row.phase === 'upstream_browser_actor').length, 3);
  assert.equal(f.requests.some(row => row.phase === 'upstream_source'), false);
});

test('a completed write without exact required binding stops without another write or source repair', async () => {
  const f = fixture({emitFill: fill.replace('2026-11-06', '2025-01-01'), actor: (_request, turn) => turn === 1
    ? {tool: {name: 'browser_type', arguments: {ref: 'e16', text: '@r.employee_joined_date'}}} : {done: true}});
  await assert.rejects(f.run(), {code: 'AUTOMATION_UPSTREAM_AUTHORED_INPUT_UNCONFIRMED'});
  assert.deepEqual(f.calls.map(row => row.name), ['browser_navigate','browser_type']); assert.equal(f.saved.length, 0);
  assert.equal(f.requests.some(row => row.phase === 'upstream_source'), false);
});

test('read-only preview source cannot replace a planned fill with the matching default assertion', async () => {
  const f = fixture({interactive: false, generated: [goto, assertion].join('\n')});
  await assert.rejects(f.run(), {code: 'AUTOMATION_UPSTREAM_AUTHORED_INPUT_REQUIRED'});
  assert.deepEqual(f.calls.map(row => row.name), ['browser_navigate']); assert.equal(f.saved.length, 0);
  assert.equal(f.requests.filter(row => row.phase === 'upstream_source').length, 3);
});
