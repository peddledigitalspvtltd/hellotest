const {configurationTargetsForRead}=require('@hellotest/platform/backend/src/utils/configurationTargets');

const text=value=>typeof value==='string'&&value.trim()?value.trim():null;
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};

/** Freeze each native platform's own device/app settings. The browser target
 * and another native platform's version are never a mobile fallback. */
function buildMobileEngineConfiguration({automationCaseType,steps=[],hooks=[],configurationSnapshot={},integrationConfig={}}={}){
  const targets=configurationTargetsForRead(configurationSnapshot.targets,configurationSnapshot);
  const platforms=new Set([...steps,...hooks.flatMap(hook=>hook.steps||[])].map(step=>step.step_type).filter(type=>type==='android'||type==='ios'));
  if(automationCaseType==='android'||automationCaseType==='ios')platforms.add(automationCaseType);
  const common={
    active:text(integrationConfig.active_mobile_engine)||'local-appium',
    recorder_mode:text(integrationConfig.mobile_recorder_mode)||'local',
    appium_server_url:text(integrationConfig.appium_server_url),
    cloud_provider:text(integrationConfig.mobile_cloud_provider),
    provider_options:object(integrationConfig.provider_options)
  };
  const perPlatform=Object.fromEntries([...platforms].sort().map(platform=>{
    const target=targets.find(row=>text(row.mobile_os)?.toLowerCase()===platform);
    const legacyPlatform=text(configurationSnapshot.mobile_os)?.toLowerCase();
    const legacyValue=key=>legacyPlatform===platform||!legacyPlatform&&!(key==='platform_version'&&targets.some(row=>row.browser&&!row.mobile_os))?text(configurationSnapshot[key]):null;
    const scoped=key=>text(configurationSnapshot[`${platform}_${key}`])
      ||(legacyPlatform===platform?legacyValue(key):null)
      ||text(integrationConfig[`${platform}_${key}`])||legacyValue(key)||text(integrationConfig[key]);
    const options={
      platform_name:platform,
      device_name:scoped('device_name'),
      udid:scoped('udid'),
      platform_version:text(target?.version)||scoped('platform_version'),
      app:text(platform==='ios'?integrationConfig.ios_app:integrationConfig.android_app)||text(integrationConfig.app),
      bundle_id:platform==='ios'?(scoped('bundle_id')||text(integrationConfig.ios_bundle_id)):null,
      app_package:platform==='android'?scoped('app_package'):null,
      app_activity:platform==='android'?scoped('app_activity'):null,
      provider_options:{...common.provider_options,...object(integrationConfig[`${platform}_provider_options`])}
    };
    return [platform,options];
  }));
  const single=platforms.size===1?perPlatform[[...platforms][0]]:null;
  return {...common,platform_name:null,device_name:null,udid:null,platform_version:null,app:null,bundle_id:null,app_package:null,app_activity:null,
    ...(single||{}),platforms:perPlatform};
}

module.exports={buildMobileEngineConfiguration};
