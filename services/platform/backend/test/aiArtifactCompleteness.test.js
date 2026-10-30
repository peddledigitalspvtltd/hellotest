const test = require('node:test');
const assert = require('node:assert/strict');
const Ajv = require('ajv');
const { validateNativeArtifactOutput: validate, validateCaseParameterBindings, caseOutputSchema } = require('../src/utils/aiGenerationContracts');
const story = { title: 'Register a contact', description: 'A user registers a contact and sees the saved record.', priority: 2, acceptance_criteria: ['The saved contact appears after successful submission.'] };
const draft = { title: 'Register a synthetic contact', description: 'Create a contact using isolated synthetic data.', priority: 2, test_case_type: 'functional', parameter_values: {email:'contact.42@example.test'}, steps: [{action:'Enter @t.email and submit the contact',expected_result:'The saved contact displays @t.email'}] };
const invalid = (feature, value, field) => assert.throws(() => validate(feature, value), error => error.code === 'AI_NATIVE_CONTRACT_INVALID' && (!field || error.validation_errors.some(issue => issue.field === field)));

test('Story creation and completion require complete prose and at least one nonempty acceptance criterion', () => {
  for (const feature of ['ai.requirement.creation','ai.requirement.optimization']) {
    const pack = value => feature.endsWith('creation') ? {requirements:[value]} : value;
    validate(feature,pack(story));
    for (const field of ['title','description','acceptance_criteria']) {
      const missing={...story};delete missing[field];invalid(feature,pack(missing),field);
      invalid(feature,pack({...story,[field]:field==='acceptance_criteria'?[]:'  '}),field);
    }
    invalid(feature,pack({...story,acceptance_criteria:[],open_questions:['What constitutes acceptance?']}),'acceptance_criteria');
    invalid(feature,pack({...story,acceptance_criteria:['  ']}),'acceptance_criteria');
    invalid(feature,pack({...story,title:'a'.repeat(256)}),'title');
  }
});

test('generated and improved Test Cases require title, description, native parameters and every action/result pair', () => {
  for (const feature of ['ai.case_authoring.full_case','ai.test_case.design']) {
    const pack=value=>feature.endsWith('design')?{testCases:[value]}:value;
    validate(feature,pack(draft));
    for (const field of ['title','description','parameter_values','steps']) {
      const missing={...draft};delete missing[field];invalid(feature,pack(missing),field);
    }
    for (const row of [{action:'Do this'},{expected_result:'Observe this'},{action:'',expected_result:'Observe this'},{action:'Do this',expected_result:'  '}]) invalid(feature,pack({...draft,steps:[row]}),'steps');
    invalid(feature,pack({...draft,parameter_values:{}}),'parameter_values.email');
    validate(feature,pack({...draft,parameter_values:{},steps:[{action:'Read the public status',expected_result:'The documented status is visible'}]}));
  }
});

test('case parameter declarations preserve synthetic values, intentional empty data and external private bindings', () => {
  for (const values of [{email:'person.17@example.test'},{email:''},{email:'@r.reviewed_email'},{email:'@s.shared_email'},{email:'@t.alias',alias:'person.17@example.test'},{email:'@t.randomString'},{email:'{{randomString:8}}@example.test'}]) validateCaseParameterBindings({...draft,parameter_values:values});
  validateCaseParameterBindings({parameter_values:{},steps:[{action:'Enter @t.randomString',expected_result:'Display the generated value'}]});
  validateCaseParameterBindings({parameter_values:{'login email':'person@example.test'},steps:[{action:'Enter @t.[login email]',expected_result:'Display @t.[login email]'}]});
  validateCaseParameterBindings({parameter_values:{},steps:[{action:'Sign in using @r.secret and @s.username',expected_result:'The authorized user is signed in'}]});
  for (const values of [{email:42},{email:'a',Email:'b'},{email:'@t.other'},{email:'@t.email'},{email:'@t.alias',alias:'@t.email'},{'@t.email':'person@example.test'},{constructor:'invalid'}]) assert.throws(()=>validateCaseParameterBindings({...draft,parameter_values:values}),{code:'AI_NATIVE_CONTRACT_INVALID'});
  assert.throws(()=>validateCaseParameterBindings({parameter_values:Object.fromEntries(Array.from({length:101},(_,index)=>['p'+index,'data']))}),{code:'AI_NATIVE_CONTRACT_INVALID'});
});

test('Gherkin requires an action and observable result while Scenario Outline example columns remain native data', () => {
  const gherkin={...draft,authoring_mode:'gherkin',steps:[],gherkin_document:'Feature: Contacts\nScenario: Register a contact\nWhen I submit @t.email\nThen the contact displays @t.email'};
  validate('ai.case_authoring.full_case',gherkin);
  invalid('ai.case_authoring.full_case',{...gherkin,gherkin_document:'Feature: Contacts\nScenario: Vague\nThen everything works'},'gherkin_document');
  invalid('ai.case_authoring.full_case',{...gherkin,parameter_values:{}},'parameter_values.email');
  invalid('ai.case_authoring.full_case',{...gherkin,gherkin_document:gherkin.gherkin_document+'\nScenario: Incomplete follow-up\nWhen I save the contact'},'gherkin_document');
  invalid('ai.case_authoring.full_case',{...gherkin,gherkin_document:'Feature: Contacts\nScenario: Missing expected outcome\nWhen I view source\n  """\n  Then this is example content\n  """'},'gherkin_document');
  validate('ai.case_authoring.full_case',{...gherkin,parameter_values:{},gherkin_document:'@t.billing\nFeature: Contacts\nScenario Outline: Register\nWhen I register <email>\nThen the contact displays <email>\nExamples:\n| email |\n| synthetic@example.test |'});
  invalid('ai.case_authoring.full_case',{...gherkin,authoring_mode:'structured'},'steps');
});

test('native output schemas expose explicit parameter data and complete required draft fields', () => {
  const structured=caseOutputSchema('structured'),gherkin=caseOutputSchema('gherkin');
  for(const schema of [structured,gherkin]) for(const field of ['title','description','parameter_values']) assert.ok(schema.required.includes(field));
  const schema=caseOutputSchema('structured',{count:2,refs:['R1'],testCaseTypes:['functional']});
  const check=new Ajv({strict:false}).compile(schema);
  const valid={testCases:[{...draft,requirement_refs:['R1']}]};
  assert.equal(check(valid),true,JSON.stringify(check.errors));
  for(const field of ['title','description','parameter_values','steps']) {const candidate=structuredClone(valid);delete candidate.testCases[0][field];assert.equal(check(candidate),false);}
});

test('artifact context excludes protected defaults and literal copies without changing the saved case', () => {
  const {testCaseAiSnapshot}=require('../src/utils/aiArtifactContext');
  const secret='Private-synthetic-fixture-value-94!';
  const source={title:'Authorized sign in',description:'Use '+secret,parameter_values:{password:secret,email:'reviewer@example.test',reference:'@r.private_token'},test_data_options:{private_parameter_names:['password'],effective_private_parameter_names:['reference']},steps:[{action:'Sign in using '+secret,expected_result:'The authorized account is shown'}],history:[{body:'Ignored historical context'}]};
  const snapshot=testCaseAiSnapshot(source);
  assert.doesNotMatch(JSON.stringify(snapshot),new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.equal(snapshot.steps[0].action,'Sign in using @t.password');
  assert.match(snapshot.parameter_values.password,/^\[Missing: protected/);
  assert.equal(snapshot.parameter_values.reference,'@r.private_token');
  assert.equal(snapshot.parameter_values.email,'reviewer@example.test');
  assert.equal(snapshot.private_parameter_values_omitted,true);
  assert.equal(source.parameter_values.password,secret);
  assert.equal(source.steps[0].action,'Sign in using '+secret);
  assert.equal(testCaseAiSnapshot(snapshot).parameter_values.password,snapshot.parameter_values.password,'Projection is idempotent, never a self-referential binding');
  assert.equal(snapshot.history,undefined);
});
