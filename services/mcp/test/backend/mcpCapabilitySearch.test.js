const test = require('node:test');
const assert = require('node:assert/strict');
const { matchesCapability } = require('../../backend/capabilitySearch');
const cases = {id:'test-case-list',method:'GET',path:'/test-cases',permission:'testcase.view',family:'test_cases',label:'Read test cases'};

test('catalog search resolves product vocabulary and short natural-language discovery requests', () => {
  for (const query of ['', 'test-cases', 'test_cases', 'list test cases', 'Please show me the available testcases', 'GET /test-cases', 'test-case-list']) assert.equal(matchesCapability(cases, query), true, query);
  assert.equal(matchesCapability({...cases,path:'/requirements',permission:'requirement.view',family:'stories',label:'Read Stories'}, 'find requirements'), true);
  assert.equal(matchesCapability({...cases,path:'/feedback',permission:'feedback.view',family:'defects',label:'Read Defects'}, 'show bugs'), true);
  assert.equal(matchesCapability({...cases,path:'/requirement-iterations',permission:'requirement_iteration.view',family:'sprints',label:'Read sprints'}, 'list sprints'), true);
  assert.equal(matchesCapability({...cases,id:'run-list',path:'/executions',permission:'run.view',family:'runs',label:'Read runs'}, 'show runs'), true);
});

test('search requires each requested concept and retains explicit action and resource distinctions', () => {
  for (const query of ['delete test cases', 'create test cases', 'show defects', 'list test cases passwords', 'please']) assert.equal(matchesCapability(cases, query), false, query);
  assert.equal(matchesCapability({...cases,method:'DELETE',label:'Delete test cases'}, 'remove test cases'), true);
  assert.equal(matchesCapability({...cases,method:'POST',label:'Create test cases'}, 'add testcase'), true);
  assert.equal(matchesCapability({...cases,method:'PUT',label:'Update test cases'}, 'edit test case'), true);
  assert.equal(matchesCapability({...cases,method:'POST',label:'Create test cases',summary:'Read back the resulting test case to verify its effect.'}, 'list test cases'), false, 'Read-back verification in a description does not make a mutation a read operation.');
});
