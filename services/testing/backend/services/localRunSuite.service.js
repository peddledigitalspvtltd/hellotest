const db=require('@hellotest/platform/backend/src/db');
const suites=require('./testSuite.service');
const mappings=require('./suiteTestCase.service');
const DESCRIPTION='HelloTest default suite for local runs of otherwise unassigned test cases.';
exports.ensure=async({projectId,appTypeId,testCaseId,createdBy})=>db.transaction(async()=>{
 const app=await db.prepare('SELECT id, project_id FROM app_types WHERE id = ? FOR UPDATE').get(appTypeId);
 if(!app||app.project_id!==projectId)throw Object.assign(new Error('Local run suite must belong to the selected project.'),{statusCode:403});
 const testCase=await db.prepare('SELECT id, app_type_id FROM test_cases WHERE id = ?').get(testCaseId);
 if(!testCase||testCase.app_type_id!==appTypeId)throw Object.assign(new Error('Local case must belong to the selected application.'),{statusCode:403});
 // Another concurrent run may have assigned the case while this run waited.
 const existing=await db.prepare('SELECT s.id, s.name FROM suite_test_cases m JOIN test_suites s ON s.id = m.suite_id WHERE m.test_case_id = ? AND s.app_type_id = ? ORDER BY m.sort_order, s.id LIMIT 1').get(testCaseId,appTypeId);
 if(existing)return existing;
 let suite=await db.prepare('SELECT id, name FROM test_suites WHERE app_type_id = ? AND description = ? AND parent_id IS NULL ORDER BY created_at LIMIT 1').get(appTypeId,DESCRIPTION);
 if(!suite){const created=await suites.createTestSuite({app_type_id:appTypeId,name:'Default Local Runs',description:DESCRIPTION,created_by:createdBy});suite={id:created.id,name:'Default Local Runs'};}
 await mappings.replaceMappingsForSuite(suite.id,[testCaseId],{append:true});return suite;
})();
