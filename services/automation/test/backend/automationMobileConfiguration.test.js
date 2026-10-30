const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {buildMobileEngineConfiguration:build}=require('../../backend/lib/automationMobileConfiguration');
const {configurationTargetsForRead}=require('../../../platform/backend/src/utils/configurationTargets');
const {resolveAutomationCaseType}=require('../../../platform/backend/src/utils/automationCaseType');
const {containsMobileIntegrationConfig}=require('../../../platform/backend/src/utils/mobileFeature');

const configuration={mobile_os:'Android',device_name:'Selected Pixel',udid:'selected-android',platform_version:'14',browser:'Chrome',targets:[
  {id:'ios',mobile_os:'iOS',version:'18',browser:'Safari'},
  {id:'android',mobile_os:'Android',version:'15'},
  {id:'web',browser:'Chrome',version:'126',os:'Linux'}
]};
const integration={android_app:'android.apk',ios_app:'ios.ipa',device_name:'Legacy shared device',platform_version:'Legacy shared version',ios_device_name:'iPhone 16',ios_udid:'selected-ios',ios_bundle_id:'com.fixture.ios',app_package:'com.fixture.android',app_activity:'.Main',provider_options:{common:true},ios_provider_options:{iosOnly:true}};

test('Unified native targets use matching versions and separate apps/devices rather than browser or other-platform defaults',()=>{
  const input={automationCaseType:'unified',steps:[{step_type:'web'},{step_type:'ios'},{step_type:'android'}],configurationSnapshot:configuration,integrationConfig:integration};
  const original=structuredClone(input),result=build(input);
  assert.equal(result.platform_name,null);assert.equal(result.app,null);
  assert.equal(result.platforms.ios.platform_name,'ios');assert.equal(result.platforms.ios.app,'ios.ipa');assert.equal(result.platforms.ios.platform_version,'18');assert.equal(result.platforms.ios.device_name,'iPhone 16');assert.equal(result.platforms.ios.udid,'selected-ios');assert.equal(result.platforms.ios.bundle_id,'com.fixture.ios');assert.equal(result.platforms.ios.app_package,null);
  assert.equal(result.platforms.android.app,'android.apk');assert.equal(result.platforms.android.platform_version,'15');assert.equal(result.platforms.android.device_name,'Selected Pixel');assert.equal(result.platforms.android.udid,'selected-android');assert.equal(result.platforms.android.app_package,'com.fixture.android');assert.equal(result.platforms.android.bundle_id,null);
  assert.deepEqual(result.platforms.ios.provider_options,{common:true,iosOnly:true});assert.deepEqual(result.platforms.android.provider_options,{common:true});
  assert.deepEqual(input,original,'configuration snapshots remain immutable');
});

test('Unified with only iOS keeps legacy top-level compatibility and browser-only configuration never becomes the iOS version',()=>{
  const result=build({automationCaseType:'unified',steps:[{step_type:'ios'},{step_type:'api'}],configurationSnapshot:{browser:'Firefox',platform_version:'Browser version',targets:[{browser:'Firefox',version:'126'}]},integrationConfig:{...integration,ios_platform_version:'18.2'}});
  assert.equal(result.platform_name,'ios');assert.equal(result.app,'ios.ipa');assert.equal(result.platform_version,'18.2');assert.equal(result.device_name,'iPhone 16');assert.equal(result.platforms.android,undefined);
  const legacy=build({automationCaseType:'android',configurationSnapshot:{device_name:'Legacy device',platform_version:'14'},integrationConfig:{android_app:'old.apk'}});
  assert.equal(legacy.device_name,'Legacy device');assert.equal(legacy.platform_version,'14');assert.equal(legacy.app,'old.apk');
});

test('native setup and teardown receive their own frozen target even when the main plan is Web/API',()=>{
  const result=build({automationCaseType:'web',steps:[{step_type:'api'},{step_type:'web'}],hooks:[{steps:[{step_type:'ios'}]}],configurationSnapshot:configuration,integrationConfig:integration});
  assert.equal(result.platforms.ios.app,'ios.ipa');assert.equal(result.platforms.ios.platform_version,'18');assert.equal(result.platforms.android,undefined);
});

test('actual dispatch envelope retains the desktop browser while freezing both native platform snapshots',async()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../../backend/services/testEngineDispatch.service.js'),'utf8');
  const body=source.slice(source.indexOf('const buildEngineEnvelope ='),source.indexOf('const summarizeWarnings ='));
  const normalizeText=value=>typeof value==='string'&&value.trim()?value.trim():null;
  const dependencies={configurationTargetsForRead,resolveAutomationCaseType,normalizeText,normalizeEngineBrowser:value=>value==='Chrome'?'chromium':value,
    normalizeInteger:(value,fallback)=>Number.isFinite(Number(value))&&value!==undefined?Number(value):fallback,normalizeSessionMode:(_value,fallback)=>fallback,
    resolveExecutionPolicy:async()=>({}),resolveCaseDataSetContext:()=>null,resolveExecutionHooks:()=>[],preserveFrozenEngineEnvelope:value=>value,
    normalizeStoredReferenceList:()=>[],normalizeTestEngineWebEngine:()=> 'playwright',buildManualSpec:()=>({}),configuredRepairBrief:async()=>({}),
    normalizeStringRecord:value=>value||{},toEngineKeyValueEntries:value=>value||[],require:id=>{assert.equal(id,'../lib/automationMobileConfiguration');return {buildMobileEngineConfiguration:build};}};
  const envelopeBuilder=new Function(...Object.keys(dependencies),body+'\nreturn buildEngineEnvelope;')(...Object.values(dependencies));
  const envelope=await envelopeBuilder({engineRunId:'run',execution:{id:'execution',test_configuration:{name:'Matrix',snapshot:configuration}},project:{id:'project',name:'Project'},appType:{id:'app',type:'web'},caseSnapshot:{test_case_id:'case',test_case_title:'Unified checkout',test_data_options:{automation_case_type:'unified'}},steps:[{step_type:'ios'},{step_type:'web'},{step_type:'android'}],integration:{config:integration}});
  assert.equal(envelope.automation_case_type,'unified');assert.equal(envelope.browser,'chromium');assert.equal(envelope.configuration.os,'Linux');
  assert.equal(envelope.mobile_engine.platforms.ios.app,'ios.ipa');assert.equal(envelope.mobile_engine.platforms.ios.platform_version,'18');assert.equal(envelope.mobile_engine.platforms.android.app,'android.apk');assert.equal(envelope.mobile_engine.platforms.android.platform_version,'15');
});

test('integration normalization round-trips supported iOS and per-platform defaults instead of dropping them on edits',()=>{
  const normalize=require('../../../integration/backend/services/integration.service')._internals.normalizeConfig;
  const raw={...integration,active_mobile_engine:'browserstack',mobile_recorder_mode:'remote',android_device_name:'Pixel 9',android_udid:'android-only',ios_platform_version:'18.3',android_provider_options:{deviceType:'android'}};
  const saved=normalize('testengine',raw),reloaded=normalize('testengine',saved);
  for(const key of ['ios_app','android_app','ios_bundle_id','ios_device_name','android_device_name','ios_platform_version','android_udid','active_mobile_engine','mobile_recorder_mode'])assert.equal(reloaded[key],raw[key],key);
  assert.deepEqual(reloaded.ios_provider_options,raw.ios_provider_options);assert.deepEqual(reloaded.android_provider_options,raw.android_provider_options);assert.deepEqual(reloaded.provider_options,raw.provider_options);
  assert.equal(containsMobileIntegrationConfig({type:'testengine',config:{ios_app:'ios.ipa'}}),true);assert.equal(containsMobileIntegrationConfig({type:'testengine',config:{ios_udid:'device'}}),true);
});
