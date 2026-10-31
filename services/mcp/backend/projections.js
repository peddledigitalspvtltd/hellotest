const db=require('./readDatabase');
const {permit,fail}=require('./auth');
const {bounded}=require('./backplane');
const entities={
 applications:{table:'app_types',permission:'app_type.view',scope:'t.project_id = ?',fields:['id','project_id','name','type','description','created_at','updated_at']},
 projects:{table:'projects',permission:'project.view',scope:'t.id = ?',fields:['id','name','description','status','updated_at']},
 requirements:{table:'requirements',permission:'requirement.view',scope:'t.project_id = ?',fields:['id','title','description','status','priority','updated_at']},
 test_cases:{table:'test_cases',permission:'testcase.view',scope:'EXISTS (SELECT 1 FROM app_types a WHERE a.id=t.app_type_id AND a.project_id=?)',fields:['id','app_type_id','title','status','priority','automation_status','revision','updated_at']},
 test_suites:{table:'test_suites',permission:'suite.view',scope:'EXISTS (SELECT 1 FROM app_types a WHERE a.id=t.app_type_id AND a.project_id=?)',fields:['id','app_type_id','name','description','updated_at']},
 executions:{table:'executions',permission:'run.view',scope:'t.project_id = ?',fields:['id','name','status','execution_mode','created_at','started_at','ended_at','revision']},
 defects:{table:'feedback',permission:'feedback.view',scope:'t.project_id = ?',fields:['id','title','description','status','priority','created_at','updated_at']},
 environments:{table:'test_environments',permission:'environment.view',scope:'t.project_id = ?',fields:['id','name','app_type_id','created_at','updated_at']},
 configurations:{table:'test_configurations',permission:'configuration.view',scope:'t.project_id = ?',fields:['id','name','app_type_id','created_at','updated_at']},
 integrations:{table:'integrations',permission:'integration.view',scope:"t.is_active IS TRUE AND (NULLIF(TRIM(t.config->>'project_id'),'') IS NULL OR t.config->>'project_id'=?)",fields:['id','name','type','model','is_active','created_at','updated_at']},
 sprints:{table:'requirement_iterations',permission:'requirement_iteration.view',scope:'t.project_id = ?',fields:['id','project_id','display_id','name','description','goal','state','start_date','end_date','created_at','updated_at']},
 releases:{table:'requirement_releases',permission:'requirement_iteration.view',scope:'t.project_id = ?',fields:['id','project_id','display_id','name','description','fix_version','state','target_date','created_at','updated_at']},
 test_steps:{table:'test_steps',permission:'testcase.view',scope:'EXISTS (SELECT 1 FROM test_cases c JOIN app_types a ON a.id=c.app_type_id WHERE c.id=t.test_case_id AND a.project_id=?)',fields:['id','test_case_id','step_order','step_type','action','expected_result','created_at','updated_at']},
 test_modules:{table:'test_case_modules',permission:'testcase.view',scope:'EXISTS (SELECT 1 FROM app_types a WHERE a.id=t.app_type_id AND a.project_id=?)',fields:['id','app_type_id','display_id','name','description','created_at','updated_at']},
 data_sets:{table:'test_data_sets',permission:'data.view',scope:'t.project_id = ?',fields:['id','project_id','app_type_id','name','description','mode','created_at','updated_at']},
 schedules:{table:'execution_schedules',permission:'schedule.view',scope:'t.project_id = ?',fields:['id','project_id','app_type_id','name','cadence','next_run_at','last_run_at','is_active','failure_count','created_at','updated_at']},
 workflows:{table:'agentic_workflows',permission:'agentic_workflow.view',scope:'t.project_id = ?',fields:['id','project_id','app_type_id','name','description','status','runtime_provider','created_at','updated_at']},
 workflow_runs:{table:'agentic_workflow_runs',permission:'agentic_workflow.view',scope:'t.project_id = ?',fields:['id','project_id','workflow_id','app_type_id','status','created_at','started_at','completed_at','updated_at']},
 agents:{table:'ai_agent_definitions',permission:'agentic_workflow.view',scope:'t.project_id = ?',fields:['id','project_id','name','objective','archived','current_version','active_version','created_at','updated_at'],expressions:{
  name:"(SELECT v.definition->>'name' FROM ai_agent_versions v WHERE v.agent_id=t.id AND v.version=t.current_version)",
  objective:"(SELECT v.definition->>'objective' FROM ai_agent_versions v WHERE v.agent_id=t.id AND v.version=t.current_version)"}},
 repository_runs:{table:'repository_agent_runs',permission:'agentic_workflow.view',scope:'t.project_id = ?',fields:['id','project_id','app_type_id','agent_type','status','progress','created_at','started_at','completed_at','updated_at']},
 knowledge_collections:{table:'ai_knowledge_collections',permission:'knowledge.view',scope:'t.project_id = ?',fields:['id','project_id','app_type_id','name','description','status','created_at','updated_at']},
 dashboards:{table:'quality_dashboards',permission:'dashboard.view',scope:'t.project_id = ?',fields:['id','project_id','name','description','layout','is_default','created_at','updated_at']},
 object_repository:{table:'automation_learning_cache',database:'observability',permission:'automation.view',scope:'(t.project_id = ? OR (t.project_id IS NULL AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(?::jsonb) authorized_app(id) WHERE authorized_app.id=t.app_type_id)))',application_scope_fallback:true,fields:['id','project_id','app_type_id','test_case_id','page_url','page_key','locator_intent','locator_kind','source','hit_count','created_at','updated_at']},
 activity:{table:'workspace_transactions',database:'observability',permission:'transaction.view',scope:'t.project_id = ?',fields:['id','project_id','app_type_id','action','status','title','description','created_at','started_at','completed_at','updated_at']}
};
const read=(definition,sql,...values)=>definition.database?db.allFrom(definition.database,sql,...values):db.all(sql,...values);
async function columns(definition){return [...(await read(definition,"SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name=? ORDER BY ordinal_position",definition.table)).filter(row=>definition.fields.includes(row.column_name)),...Object.keys(definition.expressions||{}).map(column_name=>({column_name,data_type:'text',is_nullable:'YES',derived:true}))];}
const fieldExpression=(definition,field)=>definition.expressions?.[field] || `t."${field}"`;
async function schema(actor){
 await permit(actor,'project.view');const visible=[];
 for(const [name,def] of Object.entries(entities)){
  try{await permit(actor,def.permission);}catch(error){if(error.statusCode===403)continue;throw error;}
  visible.push({entity:name,table:def.table,permission:def.permission,database_source:def.database||'application',fields:await columns(def),isolation:'Verified principal and fixed project projection; no caller-supplied SQL or joins.'});
 }
 let knowledge=false;
 try{await permit(actor,'knowledge.view');knowledge=true;}catch(error){if(error.statusCode!==403)throw error;}
 return {database:'PostgreSQL',entities:visible,relationships:[{from:'test_cases.app_type_id',to:'app_types.id',scope:'app_types.project_id'},{from:'test_suites.app_type_id',to:'app_types.id',scope:'app_types.project_id'}].filter(rel=>visible.some(item=>rel.from.startsWith(item.entity+'.'))),knowledge:knowledge?{sources:'ai_knowledge_sources',versions:'ai_knowledge_documents',chunks:'ai_knowledge_chunks',access:'Use knowledge retrieval tools so source ACLs and versions are checked.'}:null,query_language:{filters:['eq','contains'],pagination:'offset and bounded limit',raw_sql:false}};
}
async function query(actor,{entity,fields,filters=[],limit=25,offset=0}){
 const def=entities[entity];if(!def)throw fail('Choose a supported database projection.',400);
 await permit(actor,def.permission);
 if(!Number.isInteger(limit)||limit<1||limit>50||!Number.isInteger(offset)||offset<0||offset>10000||!Array.isArray(filters)||filters.length>8)throw fail('Choose bounded projection pagination and at most eight filters.',400,'MCP_INVALID_ARGUMENT');
 const available=(await columns(def)).map(row=>row.column_name);
 const selected=fields?.length?fields:available;
 if(!selected.length||selected.some(field=>!available.includes(field)))throw fail('Unknown or restricted field.',400);
 const params=[actor.projectId],where=[def.scope];
 if(def.application_scope_fallback){
  const applications=await db.all('SELECT id FROM app_types WHERE project_id=? ORDER BY id LIMIT 1001',actor.projectId);
  if(applications.length>1000)throw fail('Narrow this project to its native Object Repository API; more than 1,000 application scopes exceed the metadata projection budget.',413,'MCP_RESULT_TOO_LARGE');
  params.push(applications.map(application=>application.id));
 }
 for(const filter of filters){if(!available.includes(filter.field)||!['eq','contains'].includes(filter.op)||typeof filter.value!=='string'||filter.value.length>500)throw fail('Invalid database predicate.',400);where.push(filter.op==='eq'?`${fieldExpression(def,filter.field)}::text = ?`:`${fieldExpression(def,filter.field)}::text ILIKE ?`);params.push(filter.op==='eq'?filter.value:`%${filter.value.replace(/[\\%_]/g,'\\$&')}%`);}
 const rows=await read(def,`SELECT ${selected.map(field=>`${fieldExpression(def,field)} AS "${field}"`).join(',')} FROM "${def.table}" t WHERE ${where.join(' AND ')} ORDER BY t.id LIMIT ? OFFSET ?`,...params,limit+1,offset);
 const delivery={truncated:false,redacted:false,omitted_items:0,truncated_strings:0};
 const delivered=bounded(rows.slice(0,limit),delivery);
 return {entity,rows:delivered,delivery,next_offset:rows.length>limit?offset+limit:null,observed_at:new Date().toISOString(),source:'authorized_postgresql_projection'};
}
module.exports={schema,query,entities};
