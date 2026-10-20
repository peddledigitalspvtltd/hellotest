const test = require("node:test");
const assert = require("node:assert/strict");
const db = require("@hellotest/platform/backend/src/db");
const batches = require("../../backend/services/batchProcess.service");
const mockDatabase = context => {
  context.mock.method(db.pool, 'connect', async () => ({
    query: async input => {
      const sql = typeof input === 'string' ? input : input.text;
      return { rows: sql.includes('FROM app_types') ? [{ id: 'app', project_id: 'project', type: 'web' }]
        : sql.includes('SELECT source.id, source.automated, source.automation_start_url') ? [{ id: 'case', automated: 'yes', automation_start_url: 'https://app.example.test/' }]
        : sql.includes('FROM test_steps') ? [{ test_case_id: 'case', step_type: 'web' }] : [] };
    },
    release() {}, on() {}, removeListener() {}
  }));
  context.mock.method(db.pool, 'query', async () => { throw new Error('The build queue must retain its transaction connection.'); });
};

test('agent configuration and uncertain browser outcomes never enter the transient worker retry policy',()=>{
 const fs=require('node:fs'),source=fs.readFileSync(require.resolve('../../backend/services/batchProcess.service'),'utf8');
 const body=source.slice(source.indexOf('const isRetryableBatchError ='),source.indexOf('const isAiCapacityError ='));
 const retryable=new Function(`${body};return isRetryableBatchError;`)();
 for(const code of ['AI_INSTRUCTION_MISSING','AI_FEATURE_UNMAPPED','AI_CONFIGURATION_INVALID'])assert.equal(retryable({code,statusCode:503}),false);
 assert.equal(retryable({code:'AUTOMATION_BROWSER_OUTCOME_UNKNOWN',nonRetryable:true,statusCode:504}),false);
 assert.equal(retryable({code:'HTTP_503',statusCode:503}),true);
});

test("batch jobs preserve explicit browser action authorization and default it off", async context => {
  mockDatabase(context);
  context.mock.method(batches, "queueBatchJob", async input => input);
  for (const authorization of [undefined, false, true, "true"]) {
    const job = await batches.queueAutomationBuild({ app_type_id: "app", test_case_ids: ["case"], created_by: "user", allow_browser_actions: authorization });
    assert.equal(job.payload.allow_browser_actions, authorization === true);
    assert.equal(job.title, "Build with automation agent");
  }
});

test("batch jobs retain the governed Engineer profile and reject unrelated profiles", async context => {
 mockDatabase(context);
 let queued=0;context.mock.method(batches,"queueBatchJob",async input=>{queued++;return input;});
 const job=await batches.queueAutomationBuild({app_type_id:"app",test_case_ids:["case"],ai_feature:"ai.agentic.automation-engineer"});
 assert.equal(job.payload.ai_feature,"ai.agentic.automation-engineer");
 await assert.rejects(batches.queueAutomationBuild({app_type_id:"app",ai_feature:"ai.admin.prompt_optimization"}),{code:"AI_FEATURE_INVALID"});assert.equal(queued,1);
});
