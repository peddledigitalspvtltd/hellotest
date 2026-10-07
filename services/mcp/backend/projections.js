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
 configurations:{table:'test_configurations',permission:'configuration.view',scope:'t.project_id = ?',fields:['id','name','app_type_id','created_at','updated_at']}
};
async function columns(definition){return (await db.all("SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name=? ORDER BY ordinal_position",definition.table)).filter(row=>definition.fields.includes(row.column_name));}
async function schema(actor){
 await permit(actor,'project.view');const visible=[];
 for(const [name,def] of Object.entries(entities)){
  try{await permit(actor,def.permission);}catch(error){if(error.statusCode===403)continue;throw error;}
  visible.push({entity:name,table:def.table,permission:def.permission,fields:await columns(def),isolation:'Verified principal and fixed project projection; no caller-supplied SQL or joins.'});
 }
 let knowledge=false;
 try{await permit(actor,'knowledge.view');knowledge=true;}catch(error){if(error.statusCode!==403)throw error;}
 return {database:'PostgreSQL',entities:visible,relationships:[{from:'test_cases.app_type_id',to:'app_types.id',scope:'app_types.project_id'},{from:'test_suites.app_type_id',to:'app_types.id',scope:'app_types.project_id'}].filter(rel=>visible.some(item=>rel.from.startsWith(item.entity+'.'))),knowledge:knowledge?{sources:'ai_knowledge_sources',versions:'ai_knowledge_documents',chunks:'ai_knowledge_chunks',access:'Use knowledge retrieval tools so source ACLs and versions are checked.'}:null,query_language:{filters:['eq','contains'],pagination:'offset and bounded limit',raw_sql:false}};
}
async function query(actor,{entity,fields,filters=[],limit=25,offset=0}){
 const def=entities[entity];if(!def)throw fail('Choose a supported database projection.',400);
 await permit(actor,def.permission);const available=(await columns(def)).map(row=>row.column_name);
 const selected=fields?.length?fields:available;
 if(!selected.length||selected.some(field=>!available.includes(field)))throw fail('Unknown or restricted field.',400);
 const params=[actor.projectId],where=[def.scope];
 for(const filter of filters){if(!available.includes(filter.field)||!['eq','contains'].includes(filter.op)||typeof filter.value!=='string'||filter.value.length>500)throw fail('Invalid database predicate.',400);where.push(filter.op==='eq'?`t."${filter.field}"::text = ?`:`t."${filter.field}"::text ILIKE ?`);params.push(filter.op==='eq'?filter.value:`%${filter.value.replace(/[\\%_]/g,'\\$&')}%`);}
 const rows=await db.all(`SELECT ${selected.map(field=>'t."'+field+'"').join(',')} FROM "${def.table}" t WHERE ${where.join(' AND ')} ORDER BY t.id LIMIT ? OFFSET ?`,...params,limit+1,offset);
 return {entity,rows:bounded(rows.slice(0,limit)),next_offset:rows.length>limit?offset+limit:null,observed_at:new Date().toISOString(),source:'authorized_postgresql_projection'};
}
module.exports={schema,query,entities};
