const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createRequire}=require('node:module');
const file=require.resolve('../../backend/projections'),local=createRequire(file);
function fixture(){
 const calls=[],permissions=[],module={exports:{}};
 const select=async(database,sql,...values)=>{
  calls.push({database,sql,values});
  if(sql.startsWith('SELECT column_name'))return ['id','project_id','app_type_id','name','type','model','is_active','page_url','locator_intent','metadata','config','api_key'].map(column_name=>({column_name,data_type:'text',is_nullable:'YES'}));
  if(sql.startsWith('SELECT id FROM app_types'))return [{id:'app-in-this-project'}];
  return [];
 };
 new Function('require','module','exports',fs.readFileSync(file,'utf8'))(id=>{
  if(id==='./readDatabase')return {all:(...args)=>select('application',...args),allFrom:(source,...args)=>select(source,...args)};
  if(id==='./auth')return {permit:async(actor,permission)=>permissions.push({project:actor.projectId,permission}),fail:(message,statusCode=400,code='MCP_INVALID_ARGUMENT')=>Object.assign(new Error(message),{statusCode,code})};
  if(id==='./backplane')return {bounded:value=>value};
  return local(id);
 },module,module.exports);
 return {projections:module.exports,calls,permissions};
}
const actor={projectId:'project-a',user:{id:'member'}};

test('object metadata queries preserve legacy application scope across the authoritative stores',async()=>{
 const {projections,calls,permissions}=fixture();
 await projections.query(actor,{entity:'object_repository',fields:['id','app_type_id'],limit:5});
 const owner=calls.find(item=>item.sql.startsWith('SELECT id FROM app_types'));
 assert.equal(owner.database,'application');assert.deepEqual(owner.values,['project-a']);
 const result=calls.at(-1);
 assert.equal(result.database,'observability');assert.match(result.sql,/t\.project_id IS NULL.*jsonb_array_elements_text\(\?::jsonb\)/);
 assert.deepEqual(result.values,['project-a',['app-in-this-project'],6,0]);
 assert.ok(permissions.some(item=>item.permission==='automation.view'));
});

test('integration selectors expose active project/shared metadata and reject raw credentials or caller SQL fields',async()=>{
 const {projections,calls}=fixture();
 await projections.query(actor,{entity:'integrations',fields:['id','model'],filters:[{field:'name',op:'contains',value:'x%_'}],limit:2});
 const query=calls.at(-1);assert.match(query.sql,/t\.is_active IS TRUE/);assert.match(query.sql,/config->>'project_id'=\?/);
 assert.deepEqual(query.values,['project-a','%x\\%\\_%',3,0]);
 for(const field of ['config','api_key','id"; DROP TABLE integrations; --'])await assert.rejects(projections.query(actor,{entity:'integrations',fields:[field]}),/Unknown or restricted field/);
 await assert.rejects(projections.query(actor,{entity:'integrations',limit:10000}),{code:'MCP_INVALID_ARGUMENT'});
});
