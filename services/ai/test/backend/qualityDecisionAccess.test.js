const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const Fastify=require('fastify');
const {ROUTE_PERMISSIONS}=require('../../../platform/backend/src/security/permissions.catalog');
test('policy authority and repair mutations enforce every source and action grant before calling services',async()=>{
  const app=Fastify(),calls=[],module={exports:{}};
  const read=['automation.view','testcase.view','run.view','result.view','data.view'];
  new Function('require','module',fs.readFileSync(require.resolve('../../backend/routes/qualityAssistance.routes'),'utf8'))(id=>{
    if(id.endsWith('/projectAccess'))return {getProject:async project=>{if(project!=='project')throw Object.assign(new Error('Project denied'),{statusCode:403});}};
    if(id.endsWith('automationRepair.service'))return {permissions:read.filter(code=>code!=='data.view'),...Object.fromEntries(['load','plan','start','apply'].map(method=>[method,async()=>{calls.push(method);return {ok:true};}]))};
    if(id.endsWith('qualityReleasePolicy.service'))return Object.fromEntries(['current','approve','waive'].map(method=>[method,async()=>{calls.push(method);return {ok:true};}]));
    return {};
  },module);
  app.decorate('authenticate',async req=>{if(!req.headers['x-user'])throw Object.assign(new Error('Sign in'),{statusCode:401});req.user={id:req.headers['x-user']};});
  app.decorate('validate',(schema,input)=>{if(!input.project_id)throw Object.assign(new Error('Project required'),{statusCode:400});});
  app.decorate('requirePermission',code=>async req=>{if(!(req.headers['x-grants']||'').split(',').includes(code))throw Object.assign(new Error(`Missing ${code}`),{statusCode:403});});
  app.addHook('preHandler',async req=>{await app.authenticate(req);const code=ROUTE_PERMISSIONS.get(`${req.method} ${req.routeOptions.url}`);assert.ok(code);await app.requirePermission(code)(req);});
  await app.register(module.exports);
  const request=(path,grants,project='project')=>app.inject({method:'POST',url:path,headers:{'x-user':'reviewer','x-grants':grants.join(',')},payload:{project_id:project}});
  try{
    for(const [path,required,method] of [
      ['/ai/automation-repairs/id/validation',[...read,'run.create'],'plan'],
      ['/ai/automation-repairs/id/start',[...read,'run.execute'],'start'],
      ['/ai/automation-repairs/id/apply',[...read,'step.manage','testcase.update'],'apply'],
      ['/ai/release-policy',['quality_gate.view','quality_gate.update'],'approve'],
      ['/ai/release-waivers',['quality_gate.view','quality_gate.update','requirement.view','testcase.view','run.view','result.view','feedback.view'],'waive']
    ]){
      for(const missing of required){const before=calls.length;assert.equal((await request(path,required.filter(code=>code!==missing))).statusCode,403,missing);assert.equal(calls.length,before);}
      assert.equal((await request(path,required,'foreign')).statusCode,403);
      assert.equal((await request(path,required)).statusCode,200);assert.equal(calls.at(-1),method);
    }
  }finally{await app.close();}
});
