const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

test('automation platform and parameter edits persist independently through versioned real database writes', {
  skip: process.env.AUTOMATION_CASE_TYPE_POSTGRES !== '1', timeout: 120000
}, async () => {
  const target = new URL(process.env.DATABASE_URL);
  assert.match(target.pathname,/^\/agent_verify_automation_type_\d+$/);
  assert.ok(['localhost','127.0.0.1'].includes(target.hostname));
  assert.equal(process.env.DATABASE_URL,process.env.OBS_DATABASE_URL);
  const db = require('@hellotest/platform/backend/src/db');
  const obs = require('@hellotest/platform/backend/src/obsDb');
  try {
    assert.equal((await db.prepare("SELECT to_regclass('public.projects') AS present").get()).present,null);
    await db.query(fs.readFileSync(path.resolve(__dirname,'../../../platform/backend/instance-setup-data/schema-setup/schema.sql'),'utf8'));
    await require('../../../platform/backend/src/db/bootstrap').ensureRuntimeSchema();
    await require('../../../platform/backend/src/obsDb/bootstrap').ensureRuntimeSchema();
    const project=randomUUID(),app=randomUUID(),actor=randomUUID();
    await db.prepare("INSERT INTO users(id,email,password_hash,name,status) VALUES(?,?,'no-login','Type fixture','active')").run(actor,`${actor}@example.test`);
    await db.prepare("INSERT INTO projects(id,name) VALUES(?,'Type fixture')").run(project);
    await db.prepare("INSERT INTO app_types(id,project_id,name,type) VALUES(?,?,'Web application with API cases','web')").run(app,project);
    const role=await db.prepare('SELECT id FROM roles LIMIT 1').get();
    await db.prepare('INSERT INTO project_members(id,project_id,user_id,role_id) VALUES(?,?,?,?)').run(randomUUID(),project,actor,role.id);
    const cases=require('../../backend/services/testCase.service');
    const steps=require('../../backend/services/testStep.service');
    const versions=require('../../backend/services/testCaseVersion.service');
    for (const runtime of ['api','ios']) {
      const legacyId=randomUUID();
      await db.prepare("INSERT INTO test_cases(id,app_type_id,title,automated,created_by,author_id) VALUES(?,?,'Untyped legacy case','yes',?,?)").run(legacyId,app,actor,actor);
      await db.prepare('INSERT INTO test_steps(id,test_case_id,step_order,step_type,action) VALUES(?,?,1,?,?)').run(randomUUID(),legacyId,runtime,runtime==='api'?'GET /orders':'Tap Save');
      const legacy=await cases.getTestCase(legacyId);
      assert.equal(legacy.automation_case_type,null,'Legacy metadata must not advertise application inference as an explicit platform selection.');
      const legacySteps=await steps.getTestSteps({test_case_id:legacyId});
      assert.equal(require('../../../platform/backend/src/utils/automationCaseType').resolveAutomationCaseType(legacy,{steps:legacySteps}),runtime);
      const page=await require('../../backend/services/testCaseCatalog.service').listPage({app_type_id:app,ids:[legacyId],projection:'summary'});
      assert.equal(page.items.find(item=>item.id===legacyId).automation_case_type,null);
    }
    const created=await cases.createTestCase({app_type_id:app,title:'Create a synthetic order',created_by:actor,automated:'yes',automation_case_type:'api',parameter_values:{name:'first'},test_data_options:{override_shared_steps:false},steps:[{step_type:'api',action:'POST /orders with @t.name',expected_result:'HTTP 201 and name @t.name',api_request:{method:'POST',url:'@r.base_url/orders',body_mode:'json',body:'{"name":"@t.name"}',validations:[{kind:'status',expected:'201'},{kind:'json_path',target:'$.name',expected:'@t.name'}]}}]});
    let current=await cases.getTestCase(created.id);
    assert.equal(current.automation_case_type,'api');
    assert.equal(current.test_data_options.automation_case_type,'api');
    assert.equal(current.automation_start_url,null,'An API case within a Web application needs no browser URL.');
    const beforeCount=(await db.prepare('SELECT COUNT(*)::int AS count FROM test_cases WHERE app_type_id=?').get(app)).count;
    await assert.rejects(cases.createTestCase({app_type_id:app,title:'Do not normalize an unsupported method',created_by:actor,automated:'yes',automation_case_type:'api',steps:[{step_type:'api',action:'Read orders',api_request:{method:'FETCH',url:'https://fixture.test/orders'}}]}),/supported method/);
    assert.equal((await db.prepare('SELECT COUNT(*)::int AS count FROM test_cases WHERE app_type_id=?').get(app)).count,beforeCount);
    const originalStep=(await steps.getTestSteps({test_case_id:created.id}))[0];
    await assert.rejects(steps.updateTestStep(originalStep.id,{api_request:{...originalStep.api_request,method:'FETCH'}}),/supported method/);
    await assert.rejects(steps.createTestStep({test_case_id:created.id,step_order:2,step_type:'api',action:'Read orders',api_request:{method:'FETCH',url:'https://fixture.test/orders'}}),/supported method/);
    assert.equal((await steps.getTestSteps({test_case_id:created.id})).length,1);
    assert.equal((await steps.getTestSteps({test_case_id:created.id}))[0].api_request.method,'POST');
    await steps.updateTestStep(originalStep.id,{api_request:{...originalStep.api_request,validations:[{kind:'status',expected:'@t.expected_status'}]}});
    assert.equal((await steps.getTestSteps({test_case_id:created.id}))[0].api_request.validations[0].expected,'@t.expected_status');
    await steps.updateTestStep(originalStep.id,{api_request:originalStep.api_request});
    await cases.updateTestCase(created.id,{parameter_values:{name:'changed'},updated_by:actor,expected_revision:current.revision});
    current=await cases.getTestCase(created.id);
    assert.equal(current.automation_case_type,'api');
    assert.deepEqual(current.parameter_values,{name:'changed'});
    await cases.updateTestCase(created.id,{test_data_options:{override_shared_steps:true},updated_by:actor,expected_revision:current.revision});
    current=await cases.getTestCase(created.id);
    assert.equal(current.automation_case_type,'api','Editing only data policy retains the selected platform.');
    assert.deepEqual(current.parameter_values,{name:'changed'});
    const saved=await steps.getTestSteps({test_case_id:created.id});
    assert.equal(saved[0].api_request.body,'{"name":"@t.name"}');
    assert.equal(saved[0].api_request.validations[1].expected,'@t.name','Saved instructions stay symbolic when values change.');
    await assert.rejects(steps.createTestStep({test_case_id:created.id,step_order:2,step_type:'web',action:'Click Submit',expected_result:'Saved'}),{code:'AUTOMATION_CASE_TYPE_MISMATCH'});
    assert.equal((await steps.getTestSteps({test_case_id:created.id})).length,1);
    await cases.updateTestCase(created.id,{automation_case_type:'web',updated_by:actor,expected_revision:current.revision});
    current=await cases.getTestCase(created.id);
    assert.equal(current.automation_case_type,'web');
    assert.deepEqual(current.parameter_values,{name:'changed'});
    const previous=await versions.get(created.id,current.revision-1);
    assert.equal(previous.content.test_data_options.automation_case_type,'api');
    assert.deepEqual(previous.content.parameter_values,{name:'changed'});
    await require('../../backend/services/testCaseVersionRestore.service').restore({testCaseId:created.id,revision:current.revision-1,expectedRevision:current.revision,userId:actor});
    current=await cases.getTestCase(created.id);
    assert.equal(current.automation_case_type,'api','Version restore returns the reviewed platform together with its symbolic instructions.');
    assert.deepEqual(current.parameter_values,{name:'changed'});
    assert.equal((await steps.getTestSteps({test_case_id:created.id}))[0].api_request.body,'{"name":"@t.name"}');
  } finally {
    await db.close();
    await obs.close();
    await require('../../../platform/backend/src/utils/cache').close();
  }
});
