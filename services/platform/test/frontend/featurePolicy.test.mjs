import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import * as permissions from '../../frontend/src/platform/lib/permissions.ts';

const require=createRequire(import.meta.url);
const backend=require('../../backend/services/featureFlag.service');
const fallback=JSON.parse(readFileSync(new URL('../../frontend/src/platform/lib/featurePolicy.generated.json',import.meta.url),'utf8'));
const policy={};
new Function('require','exports',ts.transpileModule(readFileSync(new URL('../../frontend/src/platform/lib/featureFlags.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>name.endsWith('.json')?{default:fallback}:permissions,policy);

test('flags-only snapshot compatibility is generated from the authoritative backend policy',()=>{
  assert.deepEqual(fallback,{feature_keys:backend.FEATURE_DEFINITIONS.map(feature=>feature.key),dependencies:backend.FEATURE_DEPENDENCIES,permission_features:backend.PERMISSION_FEATURES});
});

test('frontend and backend compute the same transitive, missing and cyclic hard dependencies',()=>{
  const local={core:false,parent:true,child:true,independent:true,cycleA:true,cycleB:true,missing:true,malformed:true};
  const dependencies={parent:['core'],child:['parent'],cycleA:['cycleB'],cycleB:['cycleA'],missing:['absent'],malformed:'core'};
  assert.deepEqual(policy.effectiveFeatureFlags(local,dependencies),backend.evaluateFeatureFlags(local,dependencies));
  assert.equal(policy.effectiveFeatureFlags(local,dependencies).child,false);
  assert.equal(policy.effectiveFeatureFlags({...local,core:true},dependencies).child,true);
  assert.equal(local.child,true);
});

test('optional off-features leave enabled host permissions usable in both new and flags-only snapshots',()=>{
  const flags=Object.fromEntries(fallback.feature_keys.map(key=>[key,true]));
  for(const key of ['hellotest.manual.requirements','hellotest.manual.suites','hellotest.manual.test_data','hellotest.manual.environments','hellotest.ai.bug_triage'])flags[key]=false;
  for(const snapshot of [{flags},{flags,permission_features:fallback.permission_features,dependencies:fallback.dependencies}]){
    for(const permission of ['testcase.create','run.create','feedback.create','feedback.manage','attachment.view'])assert.equal(policy.arePermissionFeaturesEnabled(snapshot,permission),true,permission);
    for(const permission of ['requirement.view','suite.create','data.view','environment.view'])assert.equal(policy.arePermissionFeaturesEnabled(snapshot,permission),false,permission);
  }
});

test('permission feature checks are fail-closed and never infer permission prerequisites from optional UI hints',()=>{
  const all={flags:new Proxy({},{get:()=>true})};
  assert.equal(policy.arePermissionFeaturesEnabled(all,'project_member.view'),true);
  assert.equal(policy.arePermissionFeaturesEnabled(all,'unknown.permission'),false);
  assert.equal(policy.arePermissionFeaturesEnabled(all,'__proto__'),false);
  for(const snapshot of [null,{}, {flags:[]},{flags:{},permission_features:null},{flags:{},permission_features:{'attachment.view':'wrong'}}])assert.equal(policy.arePermissionFeaturesEnabled(snapshot,'attachment.view'),false);
  assert.equal(policy.arePermissionFeaturesEnabled({flags:{'hellotest.manual.bugs':true},groups:[{features:[{key:'hellotest.ai.bug_triage',permissions:['feedback.manage']}]}]},'feedback.manage'),true);
  assert.equal(policy.arePermissionFeaturesEnabled({...all,permission_features:{}},'project_member.view'),false,'An explicit server mapping is authoritative');
});

test('known hard requirements apply even to stale or flags-only snapshots and configured-off choices stay off',()=>{
  const flags={'hellotest.manual.runs':false,'hellotest.manual.run_gherkin':true,'hellotest.automation.workspace':false,'hellotest.automation.object_repository':true,'hellotest.automation.step_code':true};
  assert.equal(policy.arePermissionFeaturesEnabled({flags},'run.gherkin.view'),false);
  assert.equal(policy.arePermissionFeaturesEnabled({flags},'automation.repository.manage'),false);
  assert.equal(policy.arePermissionFeaturesEnabled({flags},'automation.code.view'),true);
  assert.equal(policy.areFeatureFlagsEnabled({flags:{'hellotest.manual.bugs':true},local_flags:{'hellotest.manual.bugs':false}},['hellotest.manual.bugs']),false);
  assert.equal(policy.areFeatureFlagsEnabled({flags:{unknown:true}},['unknown']),false);
});
