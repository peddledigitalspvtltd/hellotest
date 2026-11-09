const test = require('node:test');
const assert = require('node:assert/strict');
const { explicitFieldValidationRequirement, nativeValueCoverageRequirements, nativeValueCoverageIssues } = require('../../backend/lib/automationExpectedResultCoverage');
const { maskParameterReferences, referencedParameterNames } = require('../../backend/lib/automationBrowserParameters');

const goal = (expected_result, id = 'current') => ({ id, expected_result });
const operation = (assertion, tag = 'input', locator = '#field', inputType = 'text') => ({ name: 'browser_assert', arguments: { assertion, locator, ...(assertion === 'value' ? { value: '@r.input' } : {}) },
  observed_target: { tag, input_type: tag === 'input' ? inputType : undefined, evidence: 'snapshot_before_operation' } });
const requirements = nativeValueCoverageRequirements([goal('The field value is entered without errors.')]);

test('the conservative classifier recognizes explicit English validation outcomes without interpreting quoted data', () => {
  for (const expected of ['The full value is entered without errors.', 'No validation error is shown.', 'The field remains valid.', 'The entered value is accepted.',
    'The entered value passes validation.', 'The input is error-free.', 'The data is entered without any validation errors.']) assert.equal(explicitFieldValidationRequirement(expected), true, expected);
  for (const expected of ['The configured value is entered.', 'The field value is "without errors".', "The field contains 'no error is shown'.", 'The value is `error-free`.',
    'The field displays “without errors”.', 'The value is @r.expected.', 'El valor se introduce sin errores.']) assert.equal(explicitFieldValidationRequirement(expected), false, expected);
  assert.equal(explicitFieldValidationRequirement("The user's input is entered without errors."), true, 'an apostrophe is not a quoted data span');
});

test('authored parameter keys are data rather than validation clauses', () => {
  for (const expected of ['Value equals @r.[no errors shown].', 'Value equals @[field is accepted].',
    'Value equals @t.[without errors].', 'Value equals params["r.no errors shown"].',
    "Value equals params['r.field is accepted'].", 'Value equals @r.[no errors shown\\] in value].'])
    assert.equal(explicitFieldValidationRequirement(expected), false, expected);
  assert.equal(explicitFieldValidationRequirement('Value equals @r.[no errors shown] without errors.'), true,
    'masking the reference must preserve the separate authored requirement');
});

test('reference masking shares resolution grammar and preserves non-reference text without reading values', () => {
  const tokens = ['@r.name', '@name', '@[field is accepted]', '@r.[no errors shown\\] in key]', 'params["r.without errors"]'];
  for (const token of tokens) {
    assert.equal(referencedParameterNames([{ expected_result: token }]).length, 1, token);
    assert.equal(maskParameterReferences(`before ${token} after`), `before ${' '.repeat(token.length)} after`, token);
  }
  const ordinary = 'literal user@example.test, invalid @r. and params[untrusted]';
  assert.equal(maskParameterReferences(ordinary), ordinary, 'email addresses and invalid partial references are not references');
  assert.equal(maskParameterReferences(null), null);
});

test('native content with only value, visibility or enabled predicates cannot discharge explicit validation', () => {
  for (const operations of [[operation('value')], [operation('value'), operation('value', 'input', '#other')],
    [operation('value'), operation('visible')], [operation('value'), operation('enabled')],
    [operation('value'), operation('value', 'select', '#selection')], [operation('value', 'select')]]) {
    const issues = nativeValueCoverageIssues({ requirements, operations });
    assert.equal(issues.length, 1);assert.equal(issues[0].obligation_id, 'current');assert.equal(issues[0].code, 'expected_result_not_covered');
    assert.doesNotMatch(JSON.stringify(issues), /@r\.input|#field|#other/);
  }
  assert.deepEqual(nativeValueCoverageIssues({ requirements: [], operations: [operation('value')] }), []);
});

test('independent status and declared-field predicates retain ordinary semantic assessment of their relevance', () => {
  for (const predicate of [operation('text', 'p'), operation('text_content', 'p'), operation('hidden', 'p'), operation('field_valid')])
    assert.deepEqual(nativeValueCoverageIssues({ requirements, operations: [operation('value'), predicate] }), []);
  assert.deepEqual(nativeValueCoverageIssues({ requirements, operations: [operation('value'), operation('enabled', 'button')] }), [], 'a non-control predicate remains subject to ordinary semantic review');
});

test('explicit no-field-error outcomes distinguish declared errors from native constraints', () => {
  for (const expected of ['Email field contains @r.email and no field errors are displayed.', 'No field error messages are displayed.',
    'No field-level errors should be visible.', 'No input errors are shown.', 'No inline errors are present.',
    'Validation errors are not displayed.', 'The input is entered without validation errors.', 'The entered input is error-free.']) {
    const strict = nativeValueCoverageRequirements([goal(expected)]);
    assert.equal(strict[0].validation_scope, 'declared_field_errors', expected);
    for (const native of ['valid', 'invalid']) {
      assert.equal(nativeValueCoverageIssues({ requirements: strict, operations: [operation('value'), operation(native)] }).length, 1, expected);
      assert.equal(nativeValueCoverageIssues({ requirements: strict, operations: [operation(native)] }).length, 1, expected);
    }
    assert.deepEqual(nativeValueCoverageIssues({ requirements: strict, operations: [operation('value'), operation('field_valid')] }), []);
  }
});

test('native-only validity requirements still allow the native predicate without inventing app or business proof', () => {
  for (const expected of ['The input is valid according to native constraints.', 'The field remains valid.', 'The entered value passes validation.']) {
    const native = nativeValueCoverageRequirements([goal(expected)]);
    assert.equal(native.length, 1); assert.equal(native[0].validation_scope, undefined);
    assert.deepEqual(nativeValueCoverageIssues({ requirements: native, operations: [operation('value'), operation('valid')] }), []);
  }
});

test('quoted literal data and reference names never create declared-error absence clauses', () => {
  for (const expected of ['The value equals "no field errors are displayed".', 'The value equals `field errors are not displayed`.',
    'The field displays “no field error messages are shown”.', 'Value equals @r.[no field errors are displayed].',
    'Value equals params["r.no field errors are displayed"].']) assert.deepEqual(nativeValueCoverageRequirements([goal(expected)]), [], expected);
  const fixedBusiness = nativeValueCoverageRequirements([goal('The server accepted the request and no field errors are displayed.')]);
  assert.equal(fixedBusiness[0].validation_scope, 'declared_field_errors');
  assert.equal(nativeValueCoverageIssues({ requirements: fixedBusiness, operations: [operation('value'), operation('valid')] }).length, 1);
});

test('each linked obligation must map its own non-content proof instead of borrowing another row’s status', () => {
  const operations = [operation('value'), operation('text_content', 'p')];
  const strict = nativeValueCoverageRequirements([goal('The entered value is retained.'), goal('The input is entered without errors.', 'manual')]);
  const issues = nativeValueCoverageIssues({ requirements: strict, operations, mappings: [
    { id: 'current', assertion_operations: [1, 2] }, { id: 'manual', assertion_operations: [1] }
  ] });
  assert.deepEqual(issues.map(issue => issue.obligation_id), ['manual']);
  assert.deepEqual(nativeValueCoverageIssues({ requirements: strict, operations, mappings: [
    { id: 'current', assertion_operations: [1] }, { id: 'manual', assertion_operations: [1, 2] }
  ] }), []);
});

test('mapped value checks on a select cannot disguise a native content-only proof', () => {
  const operations = [operation('value'), operation('value', 'select'), operation('text_content', 'p')];
  const issues = nativeValueCoverageIssues({ requirements, operations, mappings: [{ id: 'current', assertion_operations: [1, 2] }] });
  assert.equal(issues.length, 1);
  assert.deepEqual(nativeValueCoverageIssues({ requirements, operations, mappings: [{ id: 'current', assertion_operations: [1, 2, 3] }] }), []);
});

test('all native input value properties remain content-only without reinterpreting checked or validity states', () => {
  for (const inputType of ['checkbox', 'radio', 'hidden', 'range', 'file', 'color', 'button']) {
    const operations = [operation('value'), operation('value', 'input', '#other', inputType), operation('text_content', 'p')];
    assert.equal(nativeValueCoverageIssues({ requirements, operations: operations.slice(0, 2) }).length, 1, inputType);
    assert.equal(nativeValueCoverageIssues({ requirements, operations, mappings: [{ id: 'current', assertion_operations: [1, 2] }] }).length, 1, inputType);
  }
  for (const assertion of ['checked', 'visible', 'enabled'])
    assert.deepEqual(nativeValueCoverageIssues({ requirements, operations: [operation('value'), operation(assertion, 'input', '#other', 'checkbox')] }), [], assertion);
});

test('named editability and exact native input types require their own same-subject executable predicates',()=>{
 const editable=nativeValueCoverageRequirements([{id:'current',action:'Verify Username field',expected_result:'Username input field is visible, focusable, and accepts text.'}]);
 assert.equal(editable[0].assertion,'editable');assert.equal(editable[0].subject,'username');
 const typed=(assertion,name='Username',value)=>({...operation(assertion),arguments:{assertion,locator:'#field',...(value===undefined?{}:{value})},observed_target:{tag:'input',name,input_type:'text'}});
 for(const assertion of ['visible','enabled','value'])assert.equal(nativeValueCoverageIssues({requirements:editable,operations:[typed(assertion)]}).length,1,assertion);
 assert.deepEqual(nativeValueCoverageIssues({requirements:editable,operations:[typed('visible'),typed('editable')]}),[]);
 assert.equal(nativeValueCoverageIssues({requirements:editable,operations:[typed('editable','Other field')]}).length,1,'a different named input cannot supply the proof');
 assert.equal(nativeValueCoverageIssues({requirements:editable,operations:[{...typed('editable'),observed_target:{tag:'input',name:'Username',excerpt_truncated:true}}]}).length,1);
 const inputType=nativeValueCoverageRequirements([{id:'current',action:'Verify Password field',expected_result:'Password input field is visible, of type password, and masks entered characters.'}]);
 assert.equal(inputType[0].assertion,'input_type');assert.equal(inputType[0].value,'password');assert.equal(inputType[0].subject,'password');
 for(const operations of [[typed('value','Password','')],[typed('input_type','Username','password')],[typed('input_type','Password','PASSWORD')]])
  assert.equal(nativeValueCoverageIssues({requirements:inputType,operations}).length,1);
 assert.deepEqual(nativeValueCoverageIssues({requirements:inputType,operations:[typed('input_type','Password','password')]}),[]);
 assert.equal(nativeValueCoverageIssues({requirements:editable,operations:[typed('editable')],mappings:[{id:'current',assertion_operations:[]}]}).length,1,'model mappings cannot omit the relevant native proof');
});

test('native property classification preserves exact literals without inventing positive proof for negated, quoted or unknown requirements',()=>{
 for(const expected_result of ['Username field is not editable.','Username field must never be editable.','Username field is read-only.',
  'Username field displays "editable".','Username field displays "type password".','Username field equals @r.[type password].',
  'El campo de usuario permite editar texto.','The input is editable.'])
  assert.deepEqual(nativeValueCoverageRequirements([{id:'current',expected_result}]),[],expected_result);
 const quoted=nativeValueCoverageRequirements([{id:'current',expected_result:'Password input field has type "password".'}]);
 assert.equal(quoted[0].value,'password');
 const uppercase=nativeValueCoverageRequirements([{id:'current',expected_result:'Password input field has type "PASSWORD".'}]);
 assert.equal(uppercase[0].value,'PASSWORD','authored comparison data is not normalized into a passing value');
 assert.deepEqual(nativeValueCoverageRequirements([{id:'current',expected_result:'Password input field must not be of type password.'}]),[]);
 const named=nativeValueCoverageRequirements([{id:'current',expected_result:'"Email address" field is editable.'}]);
 assert.equal(named[0].subject,'email address');
 const fallback=nativeValueCoverageRequirements([{id:'current',action:'Verify Username field',expected_result:'The field is editable.'}]);
 assert.equal(fallback[0].subject,'username');
});

test('editable and input_type remain presentation rather than field-validation proof',()=>{
 for(const assertion of ['editable','input_type'])assert.equal(nativeValueCoverageIssues({requirements,operations:[operation('value'),operation(assertion)]}).length,1);
});

test('an explicit named input retention clause requires the original parameter value oracle after its same-field fill',()=>{
 const requirements=nativeValueCoverageRequirements([{id:'current',action:'Enter @r.orangehrm_password in the Password input.',expected_result:'The Password input retains @r.orangehrm_password and has type password.'}]);
 assert.equal(requirements.filter(row=>row.requirement==='named_input_retained_parameter').length,1);
 const named=(name,args,scope='same-doc',aliases=['same-field'])=>({name,arguments:args,observed_target:{tag:'input',name:'Password',input_type:'password',coverage_scope:scope,coverage_aliases:aliases}});
 const fill=named('browser_fill',{locator:'#password',value:'@r.orangehrm_password'}),type=named('browser_assert',{assertion:'input_type',locator:'#password',value:'password'});
 const value=named('browser_assert',{assertion:'value',locator:'#password',value:'@r.orangehrm_password'});
 assert.equal(nativeValueCoverageIssues({requirements,operations:[fill,type]}).length,1,'a successful fill and password masking/type are not a retained-value oracle');
 assert.deepEqual(nativeValueCoverageIssues({requirements,operations:[fill,type,value]}),[]);
 for(const wrong of [{...value,arguments:{...value.arguments,value:'@r.equal_secret'}},{...value,arguments:{...value.arguments,value:'[private parameter value]'}},
  {...value,observed_target:{...value.observed_target,coverage_scope:'other-doc'}},{...value,observed_target:{...value.observed_target,coverage_aliases:['other-field']}},
  {...value,observed_target:{...value.observed_target,name:'Other'}}])assert.equal(nativeValueCoverageIssues({requirements,operations:[fill,type,wrong]}).length,1);
 assert.equal(nativeValueCoverageIssues({requirements,operations:[value,fill,type]}).length,1,'an old check before input cannot discharge the new value');
 assert.equal(nativeValueCoverageIssues({requirements,operations:[fill,type,value],mappings:[{id:'current',action_operations:[1],assertion_operations:[2]}]}).length,1);
 assert.deepEqual(nativeValueCoverageIssues({requirements,operations:[fill,type,value],mappings:[{id:'current',action_operations:[1],assertion_operations:[2,3]}]}),[]);
});

test('retention classification never invents a value oracle from ambiguous, negated, quoted or composite prose',()=>{
 for(const expected_result of ['The Password input does not retain @r.password.','The Password input displays "retains @r.password".',
  'The Password input retains a masked value.','The Password input retains @r.password suffix.','The Name input retains @r.first @r.last.',
  'Password retained.','El campo Password mantiene @r.password.'])assert.equal(nativeValueCoverageRequirements([{id:'current',action:'Enter @r.password and @r.first and @r.last.',expected_result}]).filter(row=>row.requirement==='named_input_retained_parameter').length,0,expected_result);
 assert.equal(nativeValueCoverageRequirements([{id:'current',action:'Verify Password input',expected_result:'The Password input retains @r.password.'}]).length,0,'a pure readonly check does not invent a new fill requirement');
});

test('the actual entered-username expectation requires a reusable symbolic native value oracle',()=>{
 const requirements=nativeValueCoverageRequirements([{id:'current',action:'Enter @r.orangehrm_username in the Username field.',
  expected_result:'The Username field contains the entered username.'}]);
 assert.equal(requirements.length,1);assert.equal(requirements[0].parameter_reference,'r.orangehrm_username');
 assert.equal(requirements[0].classifier,'explicit_english_entered_input_retention_v1');
 const target={tag:'input',name:'Username',input_type:'text',coverage_scope:'main-document',coverage_aliases:['username-control']};
 const fill={name:'browser_fill',arguments:{locator:'#username',value:'@r.orangehrm_username'},observed_target:target};
 const check=value=>({name:'browser_assert',arguments:{assertion:'value',locator:'#username',value},observed_target:target});
 assert.equal(nativeValueCoverageIssues({requirements,operations:[fill,check('fixed-build-username')]}).length,1,'a configured literal is not a reusable relational oracle');
 assert.deepEqual(nativeValueCoverageIssues({requirements,operations:[fill,check('@r.orangehrm_username')]}),[]);
 assert.equal(nativeValueCoverageIssues({requirements,operations:[fill,check('@r.equal_other_parameter')]}).length,1);
 for(const wrong of [{...check('@r.orangehrm_username'),observed_target:{...target,coverage_scope:'different-document'}},
  {...check('@r.orangehrm_username'),observed_target:{...target,coverage_aliases:['other-control']}},
  {...check('@r.orangehrm_username'),observed_target:{...target,name:'Other'}}])
  assert.equal(nativeValueCoverageIssues({requirements,operations:[fill,wrong]}).length,1);
 assert.equal(nativeValueCoverageIssues({requirements,operations:[check('@r.orangehrm_username'),fill]}).length,1,'do not reuse a check before the actual entry');
});

test('entered-value classification preserves fixed literals and rejects ambiguous or invented relations',()=>{
 const action='Enter @r.username in the Username field.';
 for(const expected_result of ['The Username field contains admin.','The Username field contains "the entered username".',
  'The Username field does not contain the entered username.','The Username field contains the entered username suffix.',
  'The Username field contains the entered password.','The field contains the entered username.','Username retained.',
  'The Username field contains the entered username and any server-generated suffix.'])
  assert.deepEqual(nativeValueCoverageRequirements([{id:'current',action,expected_result}]),[],expected_result);
 for(const unknownAction of ['Verify @r.username in the Username field.','Do not enter @r.username in the Username field.',
  'Enter @r.username and @r.equal_other_parameter in the Username field.'])
  assert.deepEqual(nativeValueCoverageRequirements([{id:'current',action:unknownAction,expected_result:'The Username field contains the entered username.'}]),[],unknownAction);
});

test('entered private value proof stays symbolic and respects frame document scope',()=>{
 const requirements=nativeValueCoverageRequirements([{id:'current',action:'Enter @r.private_password in the Password input.',
  expected_result:'The Password input retains the entered value.'}]);
 const target={tag:'input',name:'Password',input_type:'password',coverage_scope:'frame-document-1',coverage_aliases:['password-control']};
 const fill={name:'browser_fill',arguments:{frame:['#work'],locator:'#password',value:'@r.private_password'},observed_target:target};
 const check={name:'browser_assert',arguments:{frame:['#work'],assertion:'value',locator:'#password',value:'@r.private_password'},observed_target:target};
 assert.deepEqual(nativeValueCoverageIssues({requirements,operations:[fill,check]}),[]);
 assert.equal(nativeValueCoverageIssues({requirements,operations:[fill,{...check,arguments:{...check.arguments,value:'[private parameter value]'}}]}).length,1);
 assert.equal(nativeValueCoverageIssues({requirements,operations:[fill,{...check,observed_target:{...target,coverage_scope:'frame-document-2'}}]}).length,1);
 assert.equal(JSON.stringify(requirements).includes('[private parameter value]'),false);
});

test('complete repeated native labels match only one to three exact authored names with required markers',()=>{
 const requirements=nativeValueCoverageRequirements([{id:'date',action:'Fill the Joined Date input with @r.employee_joined_date.',expected_result:'The Joined Date input retains @r.employee_joined_date.'}]);
 const target={tag:'input',name:'Joined Date* Joined Date*',input_type:'text',coverage_scope:'current-document',coverage_aliases:['joined-date-control']};
 const fill={name:'browser_fill',arguments:{locator:'#joinedDate',value:'@r.employee_joined_date'},observed_target:target};
 const check={name:'browser_assert',arguments:{assertion:'value',locator:'#joinedDate',value:'@r.employee_joined_date'},observed_target:target};
 for(const name of ['Joined Date','Joined Date*','Joined Date Joined Date','Joined Date* Joined Date*','Joined Date* Joined Date Joined Date*']){
  const named={...target,name};assert.deepEqual(nativeValueCoverageIssues({requirements,operations:[{...fill,observed_target:named},{...check,observed_target:named}]}),[],name);
 }
 for(const name of ['Joined Date Joined Date Joined Date Joined Date','Joined Date* Joined Date* Joined Date* Joined Date*','Joined Date Password','Password Joined Date','Date','Joined Date confirmation','Joined DateJoined Date']){
  const named={...target,name};assert.equal(nativeValueCoverageIssues({requirements,operations:[{...fill,observed_target:named},{...check,observed_target:named}]}).length,1,name);
 }
 for(const changed of [{excerpt_truncated:true},{name:'Unrelated',placeholder:'Joined Date* Joined Date*'},{coverage_scope:'different-frame-document'},
  {coverage_aliases:['different-field']},{name:'Username Password'}])
  assert.equal(nativeValueCoverageIssues({requirements,operations:[fill,{...check,observed_target:{...target,...changed}}]}).length,1);
 assert.equal(nativeValueCoverageIssues({requirements,operations:[fill,{...check,arguments:{...check.arguments,value:'@r.equal_other'}}]}).length,1);
 assert.equal(nativeValueCoverageIssues({requirements,operations:[check,fill]}).length,1);
 assert.equal(nativeValueCoverageIssues({requirements,operations:[fill,check],mappings:[{id:'date',action_operations:[],assertion_operations:[2]}]}).length,1);
 assert.deepEqual(nativeValueCoverageIssues({requirements,operations:[fill,check],mappings:[{id:'date',action_operations:[1],assertion_operations:[2]}]}),[]);
 assert.equal(target.name,'Joined Date* Joined Date*','raw native name is preserved');assert.equal(check.arguments.locator,'#joinedDate');
});

test('native field properties share the bounded repeated name rule without changing field validation requirements',()=>{
 const property=nativeValueCoverageRequirements([{id:'current',action:'Inspect the Username field.',expected_result:'The Username field is editable.'}]);
 const target={tag:'input',name:'Username* Username*',input_type:'text'};
 assert.deepEqual(nativeValueCoverageIssues({requirements:property,operations:[{name:'browser_assert',arguments:{assertion:'editable',locator:'#username'},observed_target:target}]}),[]);
 for(const name of ['Username Password','Username Username Username Username'])
  assert.equal(nativeValueCoverageIssues({requirements:property,operations:[{name:'browser_assert',arguments:{assertion:'editable',locator:'#username'},observed_target:{...target,name}}]}).length,1);
 const validation=nativeValueCoverageRequirements([{id:'current',action:'Fill the Joined Date field with @r.date.',expected_result:'The Joined Date field retains @r.date without errors.'}]);
 const observed={...target,name:'Joined Date* Joined Date*',coverage_scope:'current-document',coverage_aliases:['date']};
 assert.equal(nativeValueCoverageIssues({requirements:validation,operations:[{name:'browser_fill',arguments:{locator:'#date',value:'@r.date'},observed_target:observed},
  {name:'browser_assert',arguments:{assertion:'value',locator:'#date',value:'@r.date'},observed_target:observed}]}).length,1,'value-only proof still cannot discharge the independent validation requirement');
});
