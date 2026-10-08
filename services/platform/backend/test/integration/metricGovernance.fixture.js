const assert=require('node:assert/strict');
exports.verify=async({app,db,createToken})=>{
 const root='/admin-portal/metric-governance',headers={authorization:'Bearer '+createToken({id:'mcp-a'})},member={authorization:'Bearer '+createToken({id:'mcp-b'})};
 assert.equal((await app.inject({url:root,headers:member})).statusCode,403);
 await db.prepare('UPDATE users SET is_workspace_admin = TRUE WHERE id = ?').run('mcp-a');
 try{
  const id='metric.project.portfolio_health',previous={story_weight:30,automation_weight:20,pass_weight:50};
  await db.prepare('INSERT INTO app_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value').run('workspace_governed_preference:ai_metric_formula_values',{[id]:previous});
  const result=await app.inject({url:root,headers});assert.equal(result.statusCode,200,result.body);assert.equal(result.json().metrics.length,42);
  const metric=result.json().metrics.find(item=>item.id===id);assert.deepEqual(metric.config.parameters,previous);assert.equal(metric.source,'legacy');
  const config={criteria:'Review the scoped portfolio evidence and keep uncertainty explicit.',parameters:{story_weight:40,automation_weight:30,pass_weight:30}};
  const mutate=(mode,body,auth=headers)=>app.inject({method:'POST',url:`${root}/${id}/${mode}`,headers:auth,payload:body});
  assert.equal((await mutate('publish',{expected_revision:0,config},member)).statusCode,403);
  const draft=await mutate('draft',{expected_revision:0,config});assert.equal(draft.statusCode,200,draft.body);assert.equal(draft.json().published_version,0);
  const preferences=require('../../services/settings.service');assert.deepEqual((await preferences.getWorkspacePreferences('mcp-b')).ai_metric_formula_values[id],previous,'Saving a draft must not affect calculations');
  const invalid=await mutate('publish',{expected_revision:1,config:{...config,parameters:{...config.parameters,story_weight:39}}});assert.equal(invalid.statusCode,400,invalid.body);
  const formula=await mutate('publish',{expected_revision:1,config:{...config,formula:'Replace the denominator'}});assert.equal(formula.statusCode,400,formula.body);
  const competing=await Promise.all([mutate('publish',{expected_revision:1,config}),mutate('publish',{expected_revision:1,config})]);assert.deepEqual(competing.map(item=>item.statusCode).sort(),[200,409]);
  assert.deepEqual((await preferences.getWorkspacePreferences('mcp-b')).ai_metric_formula_values[id],config.parameters);
  assert.equal((await preferences.getWorkspacePreferences('mcp-b')).ai_metric_criteria_overrides[id],config.criteria);
  const calculated=await require('@hellotest/dashboard/backend/services/portfolioAnalytics.service').buildPortfolioAnalytics('mcp-b');assert.deepEqual(calculated.configuration[id],config.parameters,'Native portfolio calculations must read published metric values');
  const second=await mutate('publish',{expected_revision:2,config:{...config,parameters:{story_weight:35,automation_weight:25,pass_weight:40}}});assert.equal(second.statusCode,200,second.body);
  const rollback=await mutate('rollback',{expected_revision:3,version:1});assert.equal(rollback.statusCode,200,rollback.body);assert.equal(rollback.json().published_version,3);assert.deepEqual(rollback.json().config.parameters,config.parameters);
  for(const key of ['ai_metric_criteria_overrides','ai_metric_formula_values']){const retired=await app.inject({method:'PUT',url:'/settings/workspace-preferences',headers,payload:{preferences:{[key]:{}}}});assert.equal(retired.statusCode,409,retired.body);assert.equal(retired.json().code,'METRIC_GOVERNANCE_MOVED');}
  const audit=await db.prepare("SELECT COUNT(*)::integer AS count FROM admin_audit_log WHERE action LIKE ?").get('metric_governance.%');assert.equal(audit.count,4);
 }finally{await db.prepare('UPDATE users SET is_workspace_admin = FALSE WHERE id = ?').run('mcp-a');}
};
