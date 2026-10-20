import test from 'node:test';
import assert from 'node:assert/strict';
import { initialEngineerParameterValues, projectEngineerStepData } from '../../frontend/lib/automationEngineerData.ts';

const options = { manual: false, caseId: 'automation', dataAllowed: true };
const frozen = (overrides = {}) => ({ schema_version: 1, kind: 'automation_build_data', test_case_id: 'automation',
  parameter_values: {}, steps: [], manual_steps: [], ...overrides });

test('idle labels resolve exact namespaces, brackets and literal params expressions without rescanning inserted data', () => {
  const input = { step_id: 'one', action: 'Use @name, @T.[Display name] and params["s.locale"]', expected_result: "Echo params['t.literal'] with alice@example.test" };
  const result = projectEngineerStepData(input, { ...options, initialParameterValues: {
    'r.name': 'Run name', 't.name': 'Different case name', 't.display name': 'Case display', 's.locale': 'en-GB', 't.literal': '@r.name'
  } });
  assert.equal(result.step.action, 'Use Run name, Case display and en-GB');
  assert.equal(result.step.expected_result, 'Echo @r.name with alice@example.test');
  assert.deepEqual(result.resolution.missing, []);
  assert.match(input.action, /@name/);
});

test('active and historical labels use only frozen data, including dynamically planned rows', () => {
  const result = projectEngineerStepData({ step_id: 'new', action: "Enter params['t.email']", expected_result: '@t.email saved' }, {
    ...options, activityId: 'retained-build', initialParameterValues: { 't.email': 'changed-after-build@example.test' },
    buildData: frozen({ parameter_values: { 't.email': 'frozen-build@example.test' } })
  });
  assert.equal(result.step.action, 'Enter frozen-build@example.test');
  assert.equal(result.step.expected_result, 'frozen-build@example.test saved');
  assert.doesNotMatch(JSON.stringify(result), /changed-after-build/);
});

test('legacy labels inherit case data while frozen labels preserve their recorded namespace decision', () => {
  const step={action:'Use @name and @r.name'};
  const initialParameterValues={'t.name':'Inherited Person'};
  const idle=projectEngineerStepData(step,{...options,initialParameterValues});
  assert.equal(idle.step.action,'Use Inherited Person and @r.name');
  assert.deepEqual(idle.resolution.missing,['r.name']);
  const active=projectEngineerStepData(step,{...options,activityId:'build',buildData:frozen({parameter_values:{...initialParameterValues,'r.name':''},unscoped_parameter_bindings:{'r.name':'t.name'}})});
  assert.equal(active.step.action,'Use Inherited Person and ');
  assert.deepEqual(active.resolution.missing,[]);
});

test('exact snapshot labels retain literal @text and manual snapshot matching requires both source IDs', () => {
  const buildData = frozen({ parameter_values: { 't.name': 'Do not substitute twice' }, manual_steps: [
    { manual_test_case_id: 'other', manual_step_id: 'shared-id', action: 'Wrong source' },
    { manual_test_case_id: 'manual', manual_step_id: 'shared-id', action: 'Literal input @t.name', expected_result: 'Frozen result' }
  ] });
  const result = projectEngineerStepData({ manual_test_case_id: 'manual', manual_step_id: 'shared-id', action: 'Enter @t.name' }, {
    ...options, manual: true, activityId: 'retained-build', buildData
  });
  assert.equal(result.step.action, 'Literal input @t.name');
  assert.equal(result.step.expected_result, 'Frozen result');
});

test('missing references are explicit while configured empty values and separate namespaces remain accurate', () => {
  const result = projectEngineerStepData({ action: 'Use @name and @r.empty with params["t.email"]' }, {
    ...options, activityId: 'build', buildData: frozen({ parameter_values: { 't.name': 'Other namespace', 'r.empty': '' },
      parameter_references: ['r.name', 'r.empty', 't.email'], missing_parameter_references: ['r.name', 't.email'] })
  });
  assert.equal(result.step.action, 'Use @name and  with params["t.email"]');
  assert.deepEqual(result.resolution.missing, ['r.name', 't.email']);
});

test('data denial, unavailable snapshots and foreign case snapshots never use current saved defaults', () => {
  const step = { action: 'Enter @t.email' }, initialParameterValues = { 't.email': 'current@example.test' };
  for (const setting of [
    { dataAllowed: false, buildData: frozen({ parameter_values: initialParameterValues }) },
    { pending: true },
    { buildData: frozen({ test_case_id: 'different', parameter_values: initialParameterValues }) }
  ]) {
    const result = projectEngineerStepData(step, { ...options, activityId: 'build', initialParameterValues, ...setting });
    assert.equal(result.step.action, step.action);
    assert.equal(result.resolution.unavailable, true);
    assert.deepEqual(result.resolution.missing, []);
  }
});

test('configured and implicit generators stay deferred; protected values and aliases stay out of projected labels', t => {
  t.mock.method(Math, 'random', () => { throw new Error('UI must not generate build data'); });
  const idle = projectEngineerStepData({ action: 'Enter @t.email with @random and @t.password or @t.alias' }, {
    ...options, initialParameterValues: { 't.email': '{{yopmail}}', 't.password': 'secret-value', 't.alias': 'secret-value' }
  });
  assert.deepEqual(idle.resolution.deferred, ['t.email', 'r.random']);
  assert.deepEqual(idle.resolution.private, ['t.password', 't.alias']);
  assert.doesNotMatch(JSON.stringify(idle), /secret-value|yopmail/);
  const active = projectEngineerStepData({ action: 'Enter @t.password with @t.alias' }, {
    ...options, activityId: 'build', buildData: frozen({ private_parameter_references: ['t.password', 't.alias'] })
  });
  assert.deepEqual(active.resolution.private, ['t.password', 't.alias']);
  assert.deepEqual(active.resolution.missing, []);
});

test('idle dataset defaults follow build precedence and preserve generators without exposing secret rows or aliases', t => {
  t.mock.method(Math, 'random', () => { throw new Error('No random generation during preview'); });
  const result = initialEngineerParameterValues({ 'r.email': 'case@example.test', 't.name': 'Manual name', 't.empty': '', 't.alias': 'hidden-value' }, {
    mode: 'key_value', columns: [], rows: [
      { key: 'r.email', value: '{{yopmail:dataset}}' },
      { key: 'r.password', value: 'hidden-value', is_secret: true }
    ]
  });
  assert.deepEqual(result, { 'r.email': '{{yopmail:dataset}}', 't.name': 'Manual name', 't.empty': '' });
  const projected = projectEngineerStepData({ action: 'Enter @r.email with @t.name' }, { ...options, initialParameterValues: result });
  assert.equal(projected.step.action, 'Enter @r.email with Manual name');
  assert.deepEqual(projected.resolution.deferred, ['r.email']);
});

test('idle labels preserve only marked normalized own overrides above dataset defaults, including empty strings', () => {
  const own = { 't.name': 'Reviewed name', 'r.blank': '', 't.ordinary': 'Case default', 't.password': 'private-own', 't.alias': 'private-own' };
  const policy = { parameter_overrides: ['@T.Name', 'r.blank', 't.password', 't.absent'] };
  const before = structuredClone({own, policy});
  const result = initialEngineerParameterValues(own, {mode:'table', columns:['t.name','r.blank','t.ordinary','t.absent'],
    rows:[{'t.name':'Dataset name','r.blank':'Dataset nonempty','t.ordinary':'Dataset ordinary','t.absent':'Dataset only'}]}, policy);
  assert.deepEqual(result, {'t.name':'Reviewed name','r.blank':'','t.ordinary':'Dataset ordinary','t.absent':'Dataset only'});
  assert.deepEqual({own,policy},before);
  const projected = projectEngineerStepData({action:'Enter @t.name and @r.blank'}, {...options,initialParameterValues:result});
  assert.equal(projected.step.action,'Enter Reviewed name and ');
  assert.deepEqual(projected.resolution.missing,[]);
});

test('opaque reviewed private inputs and their aliases remain hidden after their originating source disappears', () => {
  const values = {'r.opaque_input':'opaque-bound-value','t.alias':'opaque-bound-value','t.public':'Public name','r.empty':'','t.otherempty':''};
  const own = {parameter_overrides:['r.opaque_input'],private_parameter_names:['@R.opaque_input','r.empty']};
  const source = structuredClone({values,own});
  const result = initialEngineerParameterValues(values, undefined, own);
  assert.deepEqual(result, {'t.public':'Public name','t.otherempty':''});
  const inherited = initialEngineerParameterValues(values, undefined, {effective_private_parameter_names:['r.opaque_input','r.empty']});
  assert.deepEqual(inherited, result);
  const projected = projectEngineerStepData({action:'Use @r.opaque_input and @t.alias with @t.public'}, {...options,initialParameterValues:result});
  assert.equal(projected.step.action,'Use @r.opaque_input and @t.alias with Public name');
  assert.doesNotMatch(JSON.stringify(projected), /opaque-bound-value/);
  assert.deepEqual({values,own},source);
});
