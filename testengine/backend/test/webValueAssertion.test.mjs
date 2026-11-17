import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Builder } from 'selenium-webdriver';
import { createWebRunSession } from '../dist/lib/webEngine.js';

test('saved web value assertions wait for a settling field and preserve exact versus contains semantics', { timeout: 15000 }, async t => {
  const server=createServer((_req,res)=>{res.setHeader('content-type','text/html');res.end('<input id="value" value="Loading"><script>setTimeout(()=>document.querySelector("#value").value="Ready [literal]",350)</script>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const run=createWebRunSession({engine_run_id:randomUUID(),hellotest_run_id:'run',hellotest_test_case_id:'case',headless:true,browser:'chromium',run_timeout_seconds:15,max_repair_attempts:0,
    environment:{base_url:`http://127.0.0.1:${server.address().port}`},timeouts:{assertion_timeout_ms:1500},web_engine:{active:'playwright'},artifact_policy:{trace_mode:'off',video_mode:'off',screenshot_mode:'off',capture_console:false,capture_network:false}});
  t.after(()=>run.stop('passed'));
  await run.start();
  const result=await run.runStep({id:'value-settles',order:1,step_type:'web',automation_code:'await web.expectValue("#value", "Ready [literal]", {match:"equals",timeoutMs:1500}); await web.expectValue("#value", "[literal]", {timeoutMs:500});'});
  assert.equal(result.status,'passed',result.note);
  const mismatch=await run.runStep({id:'value-exact',order:2,step_type:'web',automation_code:'await web.expectValue("#value", "Ready", {match:"equals",timeoutMs:250});'});
  assert.equal(mismatch.status,'failed');
  assert.match(mismatch.note,/equal the expected value/);
  assert.doesNotMatch(mismatch.note,/Ready \[literal\]/,'Input contents do not need to be repeated in the public assertion error.');
});

test('Selenium state, text and value assertions poll settling elements and restore action timeouts', async t => {
  const reads = { value: 0, visible: 0, enabled: 0, hidden: 0, text: 0 };
  const implicit = [];
  let failLookups = false;
  const driver = {
    manage: () => ({ setTimeouts: async options => { implicit.push(options.implicit); } }),
    getCurrentUrl: async () => 'http://fixture.local/',
    quit: async () => {},
    findElements: async selector => {
      if (failLookups) throw new Error('invalid session id');
      const hidden = selector.value === '#hidden';
      return [{
        getAttribute: async () => ++reads.value < 3 ? 'Loading' : 'Ready [literal]',
        getText: async () => ++reads.text < 3 ? 'Loading' : 'Ready [literal]',
        isDisplayed: async () => hidden ? ++reads.hidden < 3 : ++reads.visible >= 3,
        isEnabled: async () => ++reads.enabled >= 3
      }];
    },
    wait: async (check, timeout, message) => {
      const deadline = Date.now() + timeout;
      do {
        if (await check()) return true;
        await new Promise(resolve => setTimeout(resolve, 10));
      } while (Date.now() < deadline);
      throw new Error(message);
    }
  };
  t.mock.method(Builder.prototype, 'build', () => driver);
  const run = createWebRunSession({ engine_run_id: randomUUID(), hellotest_run_id: 'run', hellotest_test_case_id: 'case', browser: 'chromium', run_timeout_seconds: 10, max_repair_attempts: 0,
    timeouts: { action_timeout_ms: 900, assertion_timeout_ms: 500 }, web_engine: { active: 'selenium' }, artifact_policy: { screenshot_mode: 'off', capture_console: false, capture_network: false } });
  t.after(() => run.stop('passed'));
  await run.start();
  const result = await run.runStep({ id: 'settles', order: 1, step_type: 'web', automation_code: 'await web.expectValue("#value", "Ready [literal]", {match:"equals"}); await web.expectVisible("#visible"); await web.expectHidden("#hidden"); await web.expectEnabled("#enabled"); await web.expectText("#text", "Ready [literal]", {match:"equals"});' });
  assert.equal(result.status, 'passed', result.note);
  for (const count of Object.values(reads)) assert.ok(count >= 3, 'Assertions must retry the device state instead of observing it once.');
  assert.equal(implicit.filter(value => value === 0).length, 5);
  assert.equal(implicit.at(-1), 900);

  const mismatch = await run.runStep({ id: 'exact', order: 2, step_type: 'web', automation_code: 'await web.expectText("#text", "Ready", {match:"equals",timeoutMs:250});' });
  assert.equal(mismatch.status, 'failed');
  assert.match(mismatch.note, /equal the expected text/);
  assert.doesNotMatch(mismatch.note, /Ready \[literal\]/);
  failLookups = true;
  const unavailable = await run.runStep({ id: 'driver-failed', order: 3, step_type: 'web', automation_code: 'await web.expectHidden("#hidden", {timeoutMs:250});' });
  assert.equal(unavailable.status, 'failed', 'A lost driver session must not be reported as a hidden-element assertion pass.');
});
