import assert from 'node:assert/strict';
import test from 'node:test';
import { casePrivateParameterNames, collectPrivateParameterNames, caseParameterSaveOptions, caseParameterDefinitionValues, caseParameterDraftValues, restoreCaseParameterDraftValues } from '../src/shared/lib/parameterPrivacy.ts';
import { excludeSensitiveStepParameterValues } from '../src/shared/lib/stepParameters.ts';

test('durable own and effective inherited metadata hides opaque Test Params and aliases without an original resource', () => {
  const source={test_data_options:{private_parameter_names:['@R.Opaque','bare']},effective_private_parameter_names:['t.linked','@r.opaque']};
  const maps=[{'r.opaque':'private-one','r.alias':'private-one','t.linked':'private-two','s.alias':'private-two','t.bare':'','t.otherblank':'','t.public':'Visible'}, {'r.opaque':'Different later layer'}];
  const before=structuredClone({source,maps});
  const names=collectPrivateParameterNames(maps,casePrivateParameterNames(source));
  assert.deepEqual([...names].sort(),['r.alias','r.opaque','s.alias','t.bare','t.linked']);
  assert.deepEqual(excludeSensitiveStepParameterValues(maps[0],names),{'t.otherblank':'','t.public':'Visible'});
  assert.deepEqual({source,maps},before);
});

test('only changed own values become authored overrides; untouched bindings keep their supplying precedence', () => {
  const saved = {'t.untouched':'case seed','r.changed':'previous','r.blank':'was filled'};
  const own = {...saved,'r.changed':'replacement','r.blank':'','t.new':'entered'};
  const options = {override_shared_steps:false, parameter_overrides:['t.untouched','r.deleted'], private_parameter_names:['r.changed']};
  const before = structuredClone({saved,own,options});
  const result = caseParameterSaveOptions(options, own, saved, ['r.blank']);
  assert.deepEqual(result.parameter_overrides,['r.blank','r.changed','t.new','t.untouched']);
  assert.deepEqual(result.private_parameter_names,['r.blank','r.changed']);
  assert.equal(result.override_shared_steps,false);
  assert.deepEqual(caseParameterSaveOptions({},saved,saved).parameter_overrides,[]);
  assert.deepEqual({saved,own,options},before);
});

test('hidden inherited replacements and explicit blanks persist private classification without copying defaults', () => {
  const inherited = {'r.opaque':'original private default','r.unedited':'untouched private default'};
  const values = {'r.opaque':'replacement secret','t.public':'entered','r.empty':''};
  const result = caseParameterSaveOptions({}, values, {}, ['r.opaque','r.unedited','r.empty']);
  assert.deepEqual(result.parameter_overrides,['r.empty','r.opaque','t.public']);
  assert.deepEqual(result.private_parameter_names,['r.empty','r.opaque']);
  assert.doesNotMatch(JSON.stringify(result),/original private|replacement secret|untouched private/);
  assert.equal(Object.hasOwn(values,'r.unedited'),false);
  const afterUnlink = collectPrivateParameterNames([values],casePrivateParameterNames({test_data_options:result}));
  assert.deepEqual(excludeSensitiveStepParameterValues(values,afterUnlink),{'t.public':'entered'});
  assert.equal(inherited['r.opaque'],'original private default');
});

test('reset removes bound markers while untouched own secrets survive ordinary saves', () => {
  const options = {parameter_overrides:['r.opaque','r.empty'],private_parameter_names:['r.opaque','r.empty']};
  const saved = {'r.opaque':'old private','r.empty':'','t.password':'kept private'};
  const current = {'r.empty':'','t.password':'kept private'};
  const result = caseParameterSaveOptions(options,current,saved,['r.opaque']);
  assert.deepEqual(result.parameter_overrides,['r.empty']);
  assert.deepEqual(result.private_parameter_names,['r.empty','t.password']);
  assert.equal(current['t.password'],'kept private');
  assert.deepEqual(caseParameterSaveOptions(result,{},current).parameter_overrides,[]);
  assert.deepEqual(caseParameterSaveOptions(result,{},current).private_parameter_names,[]);
});

test('private inventories retain hidden unused inputs with name-only definitions', () => {
  const values = caseParameterDefinitionValues([{'r.opaque':'must never enter definitions','t.own':''},{'t.inherited':'hidden inherited value'}],['@R.Unused','r.opaque']);
  assert.deepEqual(values,{'r.opaque':'','t.own':'','t.inherited':'','r.unused':''});
  assert.doesNotMatch(JSON.stringify(values),/must never|hidden inherited/);
});

test('privacy includes aliases before replacement and keeps them hidden after source removal', () => {
  const saved = {'r.opaque':'old private','t.alias':'old private'};
  const own = {'r.opaque':'new private','t.alias':'old private'};
  const result = caseParameterSaveOptions({},own,saved,['r.opaque']);
  assert.deepEqual(result.private_parameter_names,['r.opaque','t.alias']);
  assert.deepEqual(result.parameter_overrides,['r.opaque']);
  assert.deepEqual(excludeSensitiveStepParameterValues(own,result.private_parameter_names),{});
});

test('local drafts omit private replacements and restore untouched saved secrets without accepting legacy plaintext', () => {
  const saved = {'r.opaque':'server secret','t.password':'saved password','t.public':'old public','t.deleted':'remove me'};
  const own = {...saved,'r.opaque':'typed replacement','t.password':'new password','t.public':'new public'};
  delete own['t.deleted'];
  const stored = caseParameterDraftValues(own,['r.opaque']);
  assert.deepEqual(stored,{'t.public':'new public'});
  const restored = restoreCaseParameterDraftValues({...stored,'r.opaque':'old insecure browser secret'},saved,['r.opaque']);
  assert.deepEqual(restored,{'r.opaque':'server secret','t.password':'saved password','t.public':'new public'});
  assert.equal(Object.hasOwn(restored,'t.deleted'),false,'public deletion remains an authored draft change');
  assert.deepEqual(caseParameterDraftValues({'r.opaque':'new draft secret'},['r.opaque']),{});
});
