import assert from 'node:assert/strict';
import test from 'node:test';
import { migrateCaseParameterScope } from '../../frontend/lib/caseParameterScope.ts';

test('scope migration moves the exact default and all binding surfaces without changing literal data or adjacent names', () => {
  const input = {name:'t.email',scope:'r',values:{email:'literal @t.email', 't.email_alt':'keep'},
    title:'Sign in @t.email',description:'<p>Use @T.EMAIL and @t.email_alt; customer@t.email is a literal address.</p>',gherkin_document:'',steps:[{
      action:'Enter @t.email and @t.email_alt',expected_result:'@t.email appears',
      automation_code:"// params['t.email'] @t.email\nconst note = '@t.email';\nawait page.fill('input', params['t.email']); await page.fill('other', '@t.email'); await page.fill('template', `@t.email ${params['t.email']}`);",
      api_request:{url:'/users?email=@t.email',body:'{"email":"@t.email"}',headers:[{key:'user',value:'@t.email'}],validations:[{target:'body.email',expected:'@t.email'}],captures:[{path:'$["@t.email"]',parameter:'T.Email'},{path:'$.backup',parameter:'t.email_backup'}]}
    }]};
  const before=structuredClone(input),next=migrateCaseParameterScope(input);
  assert.deepEqual(next.parameter_values,{'r.email':'literal @t.email','t.email_alt':'keep'});
  assert.equal(next.title,'Sign in @r.email');
  assert.equal(next.description,'<p>Use @r.email and @t.email_alt; customer@t.email is a literal address.</p>');
  assert.equal(next.steps[0].action,'Enter @r.email and @t.email_alt');
  assert.equal(next.steps[0].expected_result,'@r.email appears');
  assert.match(next.steps[0].automation_code,/params\["r.email"\]/);
  assert.match(next.steps[0].automation_code,/page.fill\('other', "@r.email"\)/);
  assert.match(next.steps[0].automation_code,/const note = '@t.email'/);
  assert.match(next.steps[0].automation_code,/`@r.email \$\{params\["r.email"\]\}`/);
  assert.match(next.steps[0].automation_code,/\/\/ params\['t.email'\] @t.email/);
  assert.equal(next.steps[0].api_request.url,'/users?email=@r.email');
  assert.equal(next.steps[0].api_request.validations[0].expected,'@r.email');
  assert.deepEqual(next.steps[0].api_request.captures,[{path:'$["@t.email"]',parameter:'r.email'},{path:'$.backup',parameter:'t.email_backup'}]);
  assert.deepEqual(input,before);
});

test('Gherkin scoped placeholders and Examples headers migrate without changing data rows',()=>{
  const next=migrateCaseParameterScope({name:'t.email',scope:'s',values:{'t.email':''},title:'Sign in',description:'<email> is HTML',steps:[],
    gherkin_document:'Feature: Sign in\nScenario Outline: Customer\n Given <t.email> and @t.email\n Then accepted\nExamples:\n | t.email | result |\n | @t.email | <t.email> |\n # @t.email comment\n @t.email-tag\n Scenario: Another customer\n Given @t.email is used'});
  assert.equal(next.description,'<email> is HTML');
  assert.equal(next.parameter_values['s.email'],'');
  assert.match(next.gherkin_document,/Given <s.email> and @s.email/);
  assert.match(next.gherkin_document,/\| s.email \| result \|\n \| @t.email \| <t.email> \|/);
  assert.match(next.gherkin_document,/# @t.email comment\n @t.email-tag/);
  assert.match(next.gherkin_document,/Given @s.email is used/);
});

test('quoted names are lossless and collisions reject the entire migration',()=>{
  const input={name:'t.first name',scope:'r',values:{'t.first name':'Jay'},title:'Enter @t.[first name]',description:'',gherkin_document:'',steps:[]};
  assert.equal(migrateCaseParameterScope(input).title,'Enter @r.[first name]');
  assert.throws(()=>migrateCaseParameterScope({...input,values:{...input.values,'r.first name':'Existing'}}),/already exists/);
  assert.throws(()=>migrateCaseParameterScope({...input,steps:[{action:'@t.[first name]',automation_code:'await broken(',expected_result:''}]}),/Correct the automation source/);
});
