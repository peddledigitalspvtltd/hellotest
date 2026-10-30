import test from 'node:test';
import assert from 'node:assert/strict';
import {createMobileRunSession,executeMobileSteps} from '../dist/lib/mobileEngine.js';

test('Unified iOS and Android blocks select separate frozen devices/apps and keep distinct resumable sessions',{concurrency:false},async t=>{
  const previous={fetch:globalThis.fetch,MOBILE_ENGINE_URL:process.env.MOBILE_ENGINE_URL,MOBILE_ENGINE_SHARED_SECRET:process.env.MOBILE_ENGINE_SHARED_SECRET,NODE_ENV:process.env.NODE_ENV};
  Object.assign(process.env,{MOBILE_ENGINE_URL:'http://native.fixture',MOBILE_ENGINE_SHARED_SECRET:'hellotest-mobile-engine-dev-secret',NODE_ENV:'development'});
  t.after(()=>{globalThis.fetch=previous.fetch;for(const key of ['MOBILE_ENGINE_URL','MOBILE_ENGINE_SHARED_SECRET','NODE_ENV'])if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];});
  const bodies=[],closed=[];
  globalThis.fetch=async(url,init)=>{
    if(init.method==='DELETE'){closed.push(String(url).split('/').at(-1));return new Response(null,{status:204});}
    const body=JSON.parse(init.body);bodies.push(body);return new Response(JSON.stringify({status:'passed',results:body.steps.map(step=>({step_id:step.id,status:'passed'}))}),{status:200,headers:{'content-type':'application/json'}});
  };
  const envelope={automation_case_type:'unified',run_timeout_seconds:10,parameters_frozen:true,case_parameters:{'t.value':'Case'},mobile_engine:{active:'local-appium',platform_name:null,device_name:'Legacy common',app:'Wrong common app',provider_options:{common:true},platforms:{
    ios:{platform_name:'ios',device_name:'iPhone 16',platform_version:'18',app:'ios.ipa',udid:'ios-device',bundle_id:'com.fixture.ios',app_package:null,provider_options:{common:true,iosOnly:true}},
    android:{platform_name:'android',device_name:'Pixel 9',platform_version:'15',app:'android.apk',udid:'android-device',bundle_id:null,app_package:'com.fixture.android',provider_options:{common:true,androidOnly:true}}
  }}};
  const session=createMobileRunSession(envelope);
  await session.run([{id:'ios-before',step_type:'ios'}]);await session.run([{id:'android',step_type:'android'}]);await session.run([{id:'ios-after',step_type:'ios'}],{'r.api_token':'current'});await session.close();
  assert.deepEqual(bodies.map(body=>[body.platform_name,body.device_name,body.platform_version,body.app]),[['ios','iPhone 16','18','ios.ipa'],['android','Pixel 9','15','android.apk'],['ios','iPhone 16','18','ios.ipa']]);
  assert.equal(bodies[0].execution_session_key,bodies[2].execution_session_key);assert.notEqual(bodies[0].execution_session_key,bodies[1].execution_session_key);assert.deepEqual(new Set(closed),new Set([bodies[0].execution_session_key,bodies[1].execution_session_key]));
  assert.equal(bodies[0].config.udid,'ios-device');assert.equal(bodies[0].config.bundle_id,'com.fixture.ios');assert.equal(bodies[0].config.app_package,null);assert.equal(bodies[0].config.platforms,undefined,'a device receives only its own selected snapshot');
  assert.equal(bodies[1].config.udid,'android-device');assert.equal(bodies[1].config.bundle_id,null);assert.equal(bodies[1].config.app_package,'com.fixture.android');assert.equal(bodies[2].parameter_values['r.api_token'],'current');
  await assert.rejects(executeMobileSteps({...envelope,mobile_engine:{active:'local-appium',platforms:{android:envelope.mobile_engine.platforms.android}}},[{id:'missing',step_type:'ios'}]),/no matching frozen mobile target/);
  await assert.rejects(executeMobileSteps({...envelope,mobile_engine:{active:'local-appium',platform_name:'android',app:'android.apk'}},[{id:'wrong',step_type:'ios'}]),/does not match its frozen mobile target/);
  assert.equal(bodies.length,3,'missing or incompatible target fails before any native request');
});
