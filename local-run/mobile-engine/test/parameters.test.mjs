import assert from "node:assert/strict";
import test from "node:test";
import { executeAndroidStepsWithDriver } from "../src/server.js";
import { buildMobileParameterValues, interpolateMobileText } from "../src/parameters.js";

test("mobile parameter references preserve scopes, quoted columns and literal resolved contents", () => {
  const params = buildMobileParameterValues({
    "@t.[First Name]": "Jay", "s.tenant": "Acme", "r.version": "5",
    "t.choice]value": "yes", "t.folder\\name": "docs", "t.email": "@s.tenant"
  });
  assert.equal(interpolateMobileText("@t.[First Name] @s.tenant @r.version @t.[choice\\]value] @t.[folder\\\\name]", params), "Jay Acme 5 yes docs");
  assert.equal(interpolateMobileText("@t.email mail@t.email @t. @s. @r. @r.tenant", params), "@s.tenant mail@t.email @t. @s. @r. ");
});

test("complete Android scripts execute numeric params and interpolate keyword targets, values and repository locators", async () => {
  const calls = [];
  const driver = {
    $: (selector) => ({
      setValue: async (value) => calls.push(["type", selector, value]),
      click: async () => calls.push(["tap", selector])
    }),
    pause: async (duration) => calls.push(["pause", duration]),
    touchAction: async (actions) => calls.push(["swipe", actions])
  };
  const result = await executeAndroidStepsWithDriver(driver, {
    parameter_values: {
      "t.target": "Login.Email", "t.first name": "@s.tenant", "s.tenant": "Acme",
      "r.field id": "email", "t.wait milliseconds": "0", "t.x": "0"
    },
    object_repository: [{ screen_name: "Login", object_name: "Email", locator: "id=@r.[field id]" }],
    steps: [{ id: "step-1", automation_code: [
      'await android.tap("Login.Email");',
      'await android.pause(Number(params["t.wait milliseconds"]));',
      'await android.step("Type details", async () => {',
      '  await android.type("@t.target", "@t.[First Name]");',
      '});',
      'await android.swipe(Number(params["t.x"]), 1, 2, 0, 0);'
    ].join("\n") }]
  });
  assert.equal(result.status, "passed");
  assert.deepEqual(calls, [
    ["tap", "id=email"], ["pause", 0], ["type", "id=email", "@s.tenant"],
    ["swipe", [{ action: "press", x: 0, y: 1 }, { action: "wait", ms: 0 }, { action: "moveTo", x: 2, y: 0 }, "release"]]
  ]);
  assert.doesNotMatch(JSON.stringify(result), /Acme|First Name/);
});

test("Android captures retain destinations and feed subsequent steps without bypassing code or failures", async () => {
  const calls = [];
  const result = await executeAndroidStepsWithDriver({
    $: (selector) => ({ setValue: async (value) => calls.push([selector, value]) })
  }, {
    parameter_values: { "r.session token": "old" },
    steps: [
      { id: "capture", automation_code: 'capture("@r.[Session Token]", "new");' },
      { id: "use", automation_code: 'await android.type("id=token", "@r.[Session Token]");' },
      { id: "fail", automation_code: 'throw new Error("Stopped before next command");\nawait android.type("id=never", "never");' },
      { id: "after", automation_code: 'await android.type("id=after", "never");' }
    ]
  });
  assert.equal(result.status, "failed");
  assert.deepEqual(calls, [["id=token", "new"]]);
  assert.deepEqual(result.results[0].captures, { "r.session token": "new" });
  assert.deepEqual(result.results.map(({ step_id, status }) => [step_id, status]), [["capture", "passed"], ["use", "passed"], ["fail", "failed"]]);
});

test('each shared group uses its frozen defaults without leaking into the following group or local step', async () => {
  const values = [];
  const result = await executeAndroidStepsWithDriver({ $: () => ({ setValue: async value => values.push(value) }) }, {
    parameter_values: { login: 'case' },
    steps: ['first-group', 'second-group', null].map((login, index) => ({
      id: `step-${index}`, parameter_values: login ? { login } : undefined,
      automation_code: 'await android.type("id=login", "@login");'
    }))
  });
  assert.equal(result.status, 'passed');
  assert.deepEqual(values, ['first-group', 'second-group', 'case']);
});

test('screen merges preserve native historical bindings and ignore redirect rows', async () => {
  const calls=[];
  const repository=[
    {page_key:'Login',object_name:'Email',locator:'id=retired',metadata:{merged_into_entry_id:'canonical'}},
    {id:'canonical',page_key:'Account',object_name:'Email',locator:'id=email',metadata:{reference_aliases:['Login.Email']}},
    {page_key:'Login',screen_name:'Account',object_name:'Submit',locator_intent:'Login.Submit',locator:'id=secondary',reference_aliases:['Login.Submit','Old.Submit']},
    {page_key:'Login',object_name:'Submit',locator:'id=primary'},
    {page_key:'Other',object_name:'Submit',locator:'id=other',metadata:{reference_aliases:['Old.Submit']}}
  ];
  const driver={$:selector=>({setValue:async value=>calls.push(['type',selector,value]),click:async()=>calls.push(['tap',selector])})};
  const result=await executeAndroidStepsWithDriver(driver,{object_repository:repository,steps:[{id:'merge',automation_code:'await android.type("Login.Email", "reader");\nawait android.tap("Login.Submit");'}]});
  assert.equal(result.status,'passed');
  assert.deepEqual(calls,[['type','id=email','reader'],['tap','id=primary']]);
  const ambiguous=await executeAndroidStepsWithDriver(driver,{object_repository:repository,steps:[{id:'conflict',automation_code:'await android.tap("Old.Submit");'}]});
  assert.equal(ambiguous.status,'failed');
  assert.match(ambiguous.results[0].note,/historical repository reference matches multiple fields/);
  assert.equal(calls.length,2);
});
