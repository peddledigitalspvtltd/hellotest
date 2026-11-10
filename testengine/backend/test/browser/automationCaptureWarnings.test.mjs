import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebRunSession } from '../../dist/lib/webEngine.js';

test('a closed browser records requested screenshot failures without changing the actual step outcomes', { timeout: 30000 }, async t => {
  const session=createWebRunSession({engine_run_id:'capture-warning-fixture',browser:'chromium',headless:true,web_engine:{active:'playwright'},run_timeout_seconds:20,max_repair_attempts:0,
    artifact_policy:{screenshot_mode:'all',trace_mode:'off',video_mode:'off',capture_console:false,capture_network:false},steps:[]});
  t.after(()=>session.stop('failed'));
  await session.start();
  const passed=await session.runStep({id:'close',order:1,step_type:'web',action:'Close the page',automation_code:'await page.close();'});
  assert.equal(passed.status,'passed');assert.equal(passed.evidence,undefined);assert.match(passed.web_detail.capture_warnings[0],/step 1 \(passed\).*could not be captured/);
  const failed=await session.runStep({id:'fail',order:2,step_type:'web',action:'Fail the recorded check',automation_code:'throw new Error("Expected fixture failure");'});
  assert.equal(failed.status,'failed');assert.match(failed.note,/Expected fixture failure/);assert.equal(failed.evidence,undefined);assert.match(failed.web_detail.capture_warnings[0],/step 2 \(failed\).*could not be captured/);
  const artifacts=await session.stop('failed');assert.equal(artifacts.capture_warnings.length,2);
});
