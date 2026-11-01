// Audited adapters for application operations. Registration alone never grants
// delegation: each callable route has a project-scope rule and a real receipt.
const db = require('@hellotest/platform/backend/src/db');
const nativeScopes = require('@hellotest/platform/backend/services/entityScope.service');
const { fail, permit } = require('./auth');

const scopeQueries = Object.freeze({
  iteration:'SELECT id,project_id FROM requirement_iterations WHERE id=?',
  release:'SELECT id,project_id FROM requirement_releases WHERE id=?',
  test_step:'SELECT s.id,a.project_id FROM test_steps s JOIN test_cases c ON c.id=s.test_case_id JOIN app_types a ON a.id=c.app_type_id WHERE s.id=?',
  module:'SELECT m.id,a.project_id FROM test_case_modules m JOIN app_types a ON a.id=m.app_type_id WHERE m.id=?',
  data_set:'SELECT id,project_id FROM test_data_sets WHERE id=?',
  schedule:'SELECT id,project_id FROM execution_schedules WHERE id=?',
  workflow:'SELECT id,project_id FROM agentic_workflows WHERE id=?',
  workflow_run:'SELECT id,project_id FROM agentic_workflow_runs WHERE id=?',
  agent:'SELECT id,project_id FROM ai_agent_definitions WHERE id=?',
  repository_run:'SELECT id,project_id FROM repository_agent_runs WHERE id=?',
  collection:'SELECT id,project_id FROM ai_knowledge_collections WHERE id=?',
  ingestion:'SELECT id,project_id FROM ai_knowledge_ingestion_jobs WHERE id=?',
  knowledge_session:'SELECT id,project_id FROM ai_knowledge_assistant_sessions WHERE id=?',
  knowledge_item:'SELECT id,project_id,app_type_id FROM ai_knowledge_repo WHERE id=?',
  transaction:'SELECT id,project_id FROM workspace_transactions WHERE id=?',
  dashboard:'SELECT id,project_id FROM quality_dashboards WHERE id=?',
  learning_object:'SELECT id,project_id,app_type_id FROM automation_learning_cache WHERE id=?',
  attachment:'SELECT id,project_id FROM attachments WHERE id=?',
  comment:'SELECT id,project_id FROM entity_comments WHERE id=?',
  generation_job:'SELECT id,project_id FROM ai_requirement_generation_jobs WHERE id=?',
  automation_repair:'SELECT id,project_id FROM ai_automation_repairs WHERE id=?',
  browser_mission:"SELECT related_id AS id,project_id FROM workspace_transactions WHERE related_kind='quality_agent_run' AND related_id=? ORDER BY created_at DESC LIMIT 1",
  browser_baseline:"SELECT related_id AS id,project_id FROM workspace_transactions WHERE related_kind='quality_agent_baseline' AND related_id=? ORDER BY created_at DESC LIMIT 1",
  project_member:'SELECT id,project_id FROM project_members WHERE id=?'
});
const scopeDatabases=Object.freeze({learning_object:'observability',transaction:'observability',browser_mission:'observability',browser_baseline:'observability'});
const policy = new Map();
const text={type:'string',maxLength:12000}, id={type:'string',minLength:1,maxLength:255};
const emptyBody={type:'object',properties:{},additionalProperties:false};
const body=(properties,required=[])=>({type:'object',properties,required,additionalProperties:true});
const persistedFields={
 app_type:['name','type','is_unified'],requirement:['title','description','priority','status','acceptance_criteria','additional_fields','gherkin_scenarios','labels','external_references','iteration_id','sprint','release','fix_version','ai_review','specification_format','specification_content','scrum_team','dev_completion_target_date','qa_completion_target_date'],
 iteration:['name','description','goal','labels','external_references','state','start_date','end_date','assignee_id','effort_points','original_dev_id','original_qa_id'],
 release:['name','description','fix_version','target_date_label','plan_date','target_date','external_link','state'],
 test_case:['app_type_id','title','description','priority','status','test_case_type','authoring_mode','gherkin_document','parameter_values','labels','automation_start_url','external_references','test_data_options','execution_hooks','automated','automation_status','automation_case_type','manual_test_case_id','reviewer_id','review_status','ai_quality_score','author_id'],
 test_step:['test_case_id','step_order','step_type','action','expected_result','automation_code','api_request','group_id','group_name','group_kind','reusable_group_id'],
 shared_step_group:['app_type_id','name','description','steps','parameter_values','authoring_mode','gherkin_document','test_data_set_id','test_data_row_index'],test_suite:['name','description','parent_id','labels','parameter_values','test_data_set_id','test_data_options','parallel_enabled','parallel_count'],
 module:['name','description'],environment:['app_type_id','name','description','base_url','variables','browser','notes'],configuration:['app_type_id','name','description','browser','targets','variables','mobile_os','platform_version'],
 data_set:['app_type_id','name','description','mode','columns','rows'],schedule:['app_type_id','name','cadence','next_run_at','is_active','suite_ids','test_case_ids','test_environment_id','test_configuration_id','test_data_set_id','release','sprint','build','assigned_to','assigned_to_ids','test_data_options'],
 execution:['name','description','status','assigned_to','assigned_to_ids','build','release','sprint'],execution_result:['status','comment','actual_result','defect_url','defect_id'],
 workflow:['app_type_id','name','description','status','trigger_kind','nodes','edges','settings','n8n_payload'],collection:['name','description','color','status','app_type_id','retrieval_config'],
 dashboard:['name','description','layout','gadgets','is_default'],issue:['title','message','steps_to_reproduce','expected_result','actual_result','severity','priority','status','bug_type','regression','environment','build','labels','sprint','release','fix_version','assignee_id','root_cause','qa_root_cause','jira_bug_key','linked_test_run_id','linked_test_case_ids','linked_test_suite_ids','linked_module_ids','linked_requirement_ids']
};
function add(method,path,value) {
  policy.set(`${method} ${path}`,{family:value.family,label:value.label || `${method==='GET'?'Read':method==='POST'?'Create':method==='DELETE'?'Delete':'Update'} ${value.family.replaceAll('_',' ')}`,
    summary:value.summary || 'Uses the existing application domain API with the verified project, permissions and native validation.',
    effect:method==='GET'?'read':method==='POST'?'create':method==='DELETE'?'delete':'update',...value,...(path==='/issues'||path.startsWith('/issues/')?{alias_of:`${method} ${path.replace(/^\/issues/,'/feedback')}`}:{})});
}
function resource(root,family,entity,{crud=true,collection=true,schema,metadataOnly=false}={}) {
  if(collection)add('GET',root,{family,scope:{entity,collection:true},metadata_only:metadataOnly});
  add('GET',root+'/:id',{family,scope:{entity,path_parameter:'id'},metadata_only:metadataOnly});
  if(!crud)return;
  for(const method of ['POST','PUT','DELETE'])add(method,root+(method==='POST'?'':'/:id'),{family,scope:{entity,...(method==='POST'?{}:{path_parameter:'id'})},
    verification:{method:'GET',path:root+'/:id',targetParameter:'id',idFromResponse:'id',matchFields:persistedFields[entity]||[],...(method==='DELETE'?{deleteAbsence:true}:{})},
    ...(schema?{body_schema:schema}:method==='DELETE'?{body_schema:emptyBody}:{})});
  const memberships={test_suite:[['test_case_ids','suite_cases']],module:[['test_case_ids','module_cases'],['requirement_ids','module_requirements']],iteration:[['requirement_ids','iteration_requirements']],release:[['requirement_ids','release_requirements'],['sprint_ids','release_sprints']]}[entity];
  if(memberships)for(const method of ['POST','PUT'])policy.get(`${method} ${root}${method==='POST'?'':'/:id'}`).verification.memberships=memberships.map(([bodyField,storage])=>({bodyField,storage,mode:'equals'}));
}
resource('/projects','projects','project',{crud:false,collection:false});
resource('/app-types','applications','app_type');
policy.get('PUT /app-types/:id').verification.matchFields=['name','is_unified'];
resource('/requirements','stories','requirement');
for(const method of ['POST','PUT'])policy.get(`${method} /requirements${method==='POST'?'':'/:id'}`).verification.memberships=[{bodyField:'release_id',storage:'selected_story_release',scalar:true,mode:'equals'},...(method==='POST'?[{bodyField:'related_requirement_ids',storage:'related_stories',mode:'equals'}]:[])];
resource('/requirement-iterations','sprints','iteration');
resource('/requirement-releases','releases','release');
for(const method of ['POST','PUT']){
 const selected=policy.get(`${method} /requirement-releases${method==='POST'?'':'/:id'}`).verification;
 selected.matchFields=persistedFields.release.filter(field=>field!=='state');selected.fieldMappings=[{bodyField:'state',observedPath:'persisted_state'}];
}
resource('/test-cases','test_cases','test_case');
for(const method of ['POST','PUT']){
 const selected=policy.get(`${method} /test-cases${method==='POST'?'':'/:id'}`).verification;
 selected.matchFields=selected.matchFields.filter(field=>field!=='gherkin_document');
 selected.fieldMappings=[{bodyField:'gherkin_document',observedPath:'persisted_gherkin_document'}];
 selected.relatedReads=[{bodyField:'steps',path:'/test-steps',queryParameter:'test_case_id'}];
 selected.memberships=['suite_ids','requirement_ids','test_data_set_ids','manual_test_case_ids'].map(bodyField=>({bodyField,listPath:bodyField,mode:'equals'}));
}
resource('/test-steps','test_steps','test_step');
resource('/shared-step-groups','shared_steps','shared_step_group');
resource('/test-suites','test_suites','test_suite');
policy.get('POST /test-suites').verification.matchFields=[...persistedFields.test_suite,'app_type_id'];
resource('/test-case-modules','test_modules','module');
policy.get('POST /test-case-modules').verification.matchFields=[...persistedFields.module,'app_type_id'];
resource('/test-environments','environments','environment',{metadataOnly:true});
resource('/test-configurations','configurations','configuration',{metadataOnly:true});
resource('/test-data-sets','test_data','data_set');
resource('/execution-schedules','schedules','schedule');
policy.get('PUT /execution-schedules/:id').verification.matchFields=persistedFields.schedule.filter(field=>field!=='is_active');
resource('/executions','runs','execution');
for(const method of ['POST','PUT']){
 const selected=policy.get(`${method} /executions${method==='POST'?'':'/:id'}`).verification;
 selected.matchFields=['name','release','sprint','release_id','iteration_id','build','start_date','end_date','test_environment_id','test_configuration_id','test_data_set_id','test_data_options','parallel_enabled','parallel_count','assigned_to','assigned_to_ids',...(method==='POST'?['app_type_id','execution_hooks']:[])];
 selected.fieldMappings=[{bodyField:'execution_mode',observedPath:'run_mode'}];
 selected.memberships=[{bodyField:'test_case_ids',listPath:'direct_test_case_ids',mode:'equals'},{bodyField:'suite_ids',listPath:'suite_ids',mode:'contains'}];
 selected.allowedControls=['expected_case_revisions','scope_source','smart_plan'];
}
resource('/execution-results','run_results','execution_result');
for(const method of ['POST','PUT']){
 const selected=policy.get(`${method} /execution-results${method==='POST'?'':'/:id'}`).verification;
 selected.matchFields=['status','error','logs','external_references',...(method==='POST'?['execution_id','test_case_id','app_type_id','duration_ms','test_data_set_id','test_data_set_name','data_set_iteration_index','data_set_iteration_key','data_set_row_snapshot','executed_by']:[])];
 selected.memberships=[{bodyField:'defects',listPath:'case_defects',mode:'equals'}];
}
resource('/agentic-workflows','workflows','workflow');
resource('/agentic-workflow-runs','workflow_runs','workflow_run',{crud:false});
resource('/repository-agents/runs','repository_agents','repository_run',{crud:false});
resource('/knowledge/sources','knowledge_sources','knowledge_source',{crud:false});
resource('/knowledge/collections','knowledge_collections','collection');
policy.get('POST /knowledge/collections').verification.matchFields=persistedFields.collection.filter(field=>field!=='status');
policy.get('POST /knowledge/collections').body_schema=body({project_id:id,app_type_id:id,name:{type:'string',minLength:1,maxLength:240},description:{type:'string',maxLength:4000},color:{type:'string',maxLength:40},retrieval_config:{type:'object'}},['project_id','name']);
policy.get('PUT /knowledge/collections/:id').body_schema=body({app_type_id:{type:['string','null'],maxLength:255},name:{...id,maxLength:240},description:{type:['string','null'],maxLength:4000},color:{type:['string','null'],maxLength:40},status:{enum:['active','archived']},retrieval_config:{type:'object'}});
resource('/knowledge/ingestions','knowledge_ingestion','ingestion',{crud:false,collection:false});
resource('/knowledge/assistant/sessions','knowledge_assistant','knowledge_session',{crud:false});
resource('/quality-dashboards','dashboards','dashboard',{schema:body({project_id:id,name:{...id,minLength:2},description:text,layout:{type:'string',maxLength:60},gadgets:{type:'array',maxItems:30,items:{type:'object'}}},['project_id','name'])});
resource('/agentic-assistant/sessions','agents','transaction',{crud:false});
resource('/workspace-transactions','activity','transaction',{crud:false,collection:false});
const activityFields=['id','project_id','app_type_id','category','action','status','title','description','related_kind','related_id','created_by','created_at','updated_at','started_at','completed_at','event_count','latest_event_at'];
policy.get('GET /workspace-transactions/:id').response_fields=activityFields;
add('DELETE','/workspace-transactions/:id',{family:'activity',scope:{entity:'transaction',path_parameter:'id'},body_schema:emptyBody,verification:{method:'GET',path:'/workspace-transactions/:id',targetParameter:'id',deleteAbsence:true}});
const defectBody=body({project_id:id,title:{...id,minLength:2},message:{...text,minLength:2},steps_to_reproduce:text,expected_result:text,actual_result:text,
  priority:{type:'string',maxLength:100},severity:{type:'string',maxLength:100},status:{type:'string',maxLength:100},category:{type:'string',maxLength:100},
  linked_test_run_id:id,linked_test_case_ids:{type:'array',maxItems:50,items:id},linked_test_suite_ids:{type:'array',maxItems:50,items:id},linked_module_ids:{type:'array',maxItems:50,items:id},linked_requirement_ids:{type:'array',maxItems:50,items:id},labels:{type:'array',maxItems:30,items:id}},['project_id','title','message']);
resource('/feedback','defects','issue',{schema:defectBody});
resource('/issues','defects','issue',{schema:defectBody});
for(const root of ['/feedback','/issues']){
  policy.get(`PUT ${root}/:id`).body_schema={...defectBody,required:[]};
  policy.get(`DELETE ${root}/:id`).body_schema=emptyBody;
  for(const method of ['POST','PUT']){
    const selected=policy.get(`${method} ${root}${method==='POST'?'':'/:id'}`).verification;
    selected.matchFields=persistedFields.issue.filter(field=>!['linked_module_ids','linked_requirement_ids'].includes(field));
    selected.memberships=['linked_module_ids','linked_requirement_ids'].map(bodyField=>({bodyField,listPath:bodyField,mode:'contains'}));
  }
}
// Collection/metadata APIs below are JSON and honor a fixed project selector.
const projectReads={
  '/metadata/domain':'workspace_metadata','/metadata/workspace-scopes':'workspace_metadata',
  '/analytics/overview':'analytics','/ai/quality-insights':'quality_insights',
  '/requirements/metrics':'stories','/requirements/create-metadata':'stories',
  '/requirement-iterations/health':'sprints','/requirement-releases/readiness':'releases',
  '/requirement-test-cases':'traceability','/test-cases/metrics':'test_cases','/test-cases/review-summary':'test_cases',
  '/test-cases/ai-generation-jobs':'test_case_generation','/shared-step-groups/metrics':'shared_steps',
  '/suite-test-cases':'test_suites','/test-cases/automation/learning-cache':'object_repository',
  '/test-cases/automation/repository-context':'object_repository','/test-cases/automation/agent-activity':'automation',
  '/test-cases/automation/agent-activities':'automation','/agentic-workflows/agents':'agents',
  '/agentic-workflows/connections':'workflow_connections','/repository-agents':'repository_agents',
  '/agentic-quality/catalog':'browser_agents','/agentic-quality/runs':'browser_agents',
  '/agentic-quality/baselines':'browser_baselines','/executions/history':'runs',
  '/execution-results/release-readiness':'release_readiness','/attachments/meta':'attachments','/attachments':'attachments',
  '/comments':'comments','/knowledge/assistant/integrations':'knowledge_assistant','/ai-prompt-templates':'prompt_templates',
  '/workspace-transactions':'activity','/feedback/metrics':'defects','/issues/metrics':'defects',
  '/feedback/create-metadata':'defects','/issues/create-metadata':'defects','/requirement-defects':'traceability',
  '/test-case-defects':'traceability','/repository-inspection/capabilities':'object_repository',
  '/ai/release-policy':'release_readiness','/ai/coverage-mappings':'coverage','/project-members':'project_members'
};
for(const [path,family]of Object.entries(projectReads))add('GET',path,{family,scope:{project:true}});
for(const path of ['/suite-test-cases','/requirement-test-cases','/requirement-defects','/test-case-defects'])policy.get('GET '+path).response_reference_fields=['suite_id','test_suite_id','test_case_id','requirement_id','issue_id','defect_id'];
policy.get('GET /workspace-transactions').response_fields=activityFields;
const entityReads=[
 ['/requirements/:id/edit-metadata','stories','requirement','id'],
 ['/requirements/ai-create-jobs/:jobId','story_generation','generation_job','jobId'],
 ['/requirement-iterations/:id/requirements','sprints','iteration','id'],['/requirement-releases/:id/readiness','releases','release','id'],
 ['/test-cases/:id/versions','test_cases','test_case','id'],['/test-cases/:id/versions/:revision','test_cases','test_case','id'],
 ['/test-case-modules/:id/test-cases','test_modules','module','id'],['/execution-results/:id/attachments','run_results','execution_result','id'],
 ['/test-cases/automation/learning-cache/:id/usage','object_repository','learning_object','id'],
 ['/test-cases/automation/jobs/:transactionId','automation','transaction','transactionId'],
 ['/agentic-workflows/:id/readiness','workflows','workflow','id'],
 ['/repository-agents/runs/:id/publication-status','repository_agents','repository_run','id'],
 ['/workspace-transactions/:id/events','activity','transaction','id'],['/workspace-transactions/:id/artifacts','activity','transaction','id'],
 ['/knowledge/sources/:id/revisions','knowledge_sources','knowledge_source','id'],
 ['/feedback/:id/edit-metadata','defects','issue','id'],['/issues/:id/edit-metadata','defects','issue','id'],
 ['/feedback/imports/:id','defects','transaction','id'],['/issues/imports/:id','defects','transaction','id'],
 ['/test-case-defects/:testCaseId/issues','traceability','test_case','testCaseId'],
 ['/agentic-workflow-runs/:id/nodes/:nodeId/model-calls','workflow_runs','workflow_run','id'],
 ['/agentic-workflow-runs/:id/nodes/:nodeId/model-calls/:callId','workflow_runs','workflow_run','id']
];
for(const [path,family,entity,path_parameter]of entityReads)add('GET',path,{family,scope:{entity,path_parameter}});
policy.get('GET /workspace-transactions/:id/events').omit_fields=['details'];
for(const suffix of ['', '/overview','/refresh','/search','/context-package','/relations/source/:source_id','/relations/target/:target_id'])add('GET','/projects/:project_id/knowledge'+suffix,{family:'knowledge',scope:{project:true}});
for(const suffix of ['','/search'])policy.get('GET /projects/:project_id/knowledge'+suffix).scope={entity:'knowledge_item',collection:true};
policy.get('GET /projects/:project_id/knowledge/context-package').response_legacy_knowledge=true;
add('GET','/requirements/ai-create-jobs',{family:'story_generation',scope:{project:true}});
add('GET','/agentic-quality/runs/:id',{family:'browser_agents',scope:{entity:'browser_mission',path_parameter:'id'}});
add('GET','/agentic-workflows/agents/:agentId',{family:'agents',scope:{entity:'agent',path_parameter:'agentId'}});
const agentBody=body({project_id:id,definition:{type:'object'},activate:{type:'boolean'},expected_version:{type:'integer',minimum:0}},['project_id','definition']);
add('POST','/agentic-workflows/agents',{family:'agents',scope:{project:true},body_schema:agentBody,
  verification:{method:'GET',path:'/agentic-workflows/agents/:agentId',targetParameter:'agentId',idFromResponse:'id',fieldMappings:[{bodyField:'definition',observedPath:'definition'}],activation:{bodyField:'activate',versionPath:'current_version',activeVersionPath:'active_version'}}});
add('PUT','/agentic-workflows/agents/:agentId',{family:'agents',scope:{entity:'agent',path_parameter:'agentId'},body_schema:agentBody,
  verification:{method:'GET',path:'/agentic-workflows/agents/:agentId',targetParameter:'agentId',idFromResponse:'id',fieldMappings:[{bodyField:'definition',observedPath:'definition'}],activation:{bodyField:'activate',versionPath:'current_version',activeVersionPath:'active_version'}}});
// Inline collection changes verify through the owning record, not an invented
// creation identifier. Every referenced child is checked below before dispatch.
for(const [path,family,entity,methods]of [
 ['/requirement-iterations/:id/requirements','sprints','iteration',['POST','PUT','DELETE']],
 ['/requirement-releases/:id/scope','releases','release',['POST']],
 ['/test-case-modules/:id/test-cases','test_modules','module',['POST','PUT','DELETE']],
 ['/test-suites/:id/assign-test-cases','test_suites','test_suite',['POST','PUT']]
])for(const method of methods)add(method,path,{family,effect:'update',scope:{entity,path_parameter:'id'},verification:{method:'GET',path:path.replace(/\/(?:requirements|scope|test-cases|assign-test-cases)$/,''),targetParameter:'id'}});
for(const [key,value]of policy){
 if(!value.verification||value.effect!=='update')continue;
 const fields=key.includes('/requirement-iterations/:id/requirements')?['requirement_ids']
  :key.includes('/requirement-releases/:id/scope')?['requirement_ids','sprint_ids']
    :/\/(?:assign-test-cases|test-cases)$/.test(key)&&['test_modules','test_suites'].includes(value.family)?['test_case_ids']:[];
 if(fields.length)value.verification.memberships=fields.map(bodyField=>({bodyField,listPath:bodyField,mode:key.startsWith('DELETE ')?'absent':value.family==='releases'?'contains':'append'}));
 if(fields.length)for(const rule of value.verification.memberships)rule.storage={sprints:{requirement_ids:'iteration_requirements'},releases:{requirement_ids:'release_requirements',sprint_ids:'release_sprints'},test_modules:{test_case_ids:'module_cases'},test_suites:{test_case_ids:'suite_cases'}}[value.family][rule.bodyField];
}
for(const root of ['/requirements','/test-cases'])for(const suffix of ['readiness','related-requirements']){
  if(root==='/test-cases')continue;
  add('PUT',root+'/:id/'+suffix,{family:'stories',effect:'update',scope:{entity:'requirement',path_parameter:'id'},verification:{method:'GET',path:root+'/:id',targetParameter:'id',...(suffix==='readiness'?{fieldMappings:[{bodyField:'checks',observedPath:'additional_fields._story_readiness.checks',subset:true}]}:{memberships:[{bodyField:'requirement_ids',storage:'related_stories',mode:'equals'}]})}});
}
add('GET','/project-members/:id',{family:'project_members',scope:{entity:'project_member',path_parameter:'id'}});
// Canonical features have one primary route. Native aliases remain inspectable
// for compatibility, but default discovery suppresses duplicate capabilities.
for(const [route,value]of policy)if(/ \/issues(?:\/|$)/.test(route))value.alias_of=route.replace(' /issues',' /feedback');
// An external ALM request requires a reviewed remote scope. Raw transport,
// OAuth, secrets, binary media and instance administration remain separate.
const proposalBody=body({project_id:id,app_type_id:id,integration_id:id,additional_context:{type:'string',maxLength:20000},prompt_guidance:{type:'string',maxLength:12000},proposed_change:{type:'object'},assurance_baseline:{type:'object'},review_purpose:{enum:['assurance','change-impact']}});
const proposals=[
 ['/requirements/ai-create-preview','story_generation'],['/requirements/ai-description-rephrase','story_generation'],['/requirements/ai-gherkin-preview','story_generation'],
 ['/test-cases/design-test-cases-preview','test_case_generation'],['/test-cases/ai-authoring-preview','test_case_generation'],['/test-cases/ai-step-rephrase','test_case_generation'],
 ['/test-data-sets/ai-generate-preview','test_data'],['/executions/smart-plan-preview','smart_runs'],['/executions/manual-run-suggestion','smart_runs'],
 ['/analytics/dashboard-design-preview','dashboards'],['/ai/quality-insights','quality_insights'],['/ai/rich-text-rephrase','content']
];
for(const [path,family]of proposals)add('POST',path,{family,effect:'generate',scope:{project:true},verification:{response:'proposal'},body_schema:proposalBody});
add('POST','/requirement-releases/:id/release-notes',{family:'releases',effect:'generate',scope:{entity:'release',path_parameter:'id'},body_schema:emptyBody,label:'Draft release notes',summary:'Compose unsaved notes from current Release readiness evidence. The native feature uses published AI guidance when the caller has AI permission; it does not publish or approve the Release.',verification:{response:'proposal'}});
for(const [root,entity,family,suffixes]of [
 ['/requirements','requirement','stories',['ai-groom-preview','ai-optimize-preview','ai-impact-preview','design-test-cases-preview']],
 ['/test-cases','test_case','test_cases',['ai-impact-preview']],
 ['/executions','execution','runs',['ai-failure-clusters']]
])for(const suffix of suffixes)add('POST',`${root}/:id/${suffix}`,{family,effect:'generate',scope:{entity,path_parameter:'id'},verification:{response:'proposal'},body_schema:proposalBody});
for(const root of ['/issues','/feedback'])for(const suffix of ['ai-draft-preview','ai-improve-preview','ai-triage-preview'])add('POST',root+'/'+suffix,{family:'defects',effect:'generate',scope:{project:true},verification:{response:'proposal'},body_schema:proposalBody});
// Existing native async endpoints have durable identifiers and scoped status.
for(const [path,family,status]of [
 ['/requirements/ai-create-jobs','story_generation','/requirements/ai-create-jobs/:jobId'],
 ['/agentic-workflows/:id/executions','workflow_runs','/agentic-workflow-runs/:id'],
 ['/agentic-quality/runs','browser_agents','/agentic-quality/runs/:id']
])add('POST',path,{family,effect:'command',scope:path.startsWith('/agentic-workflows/:id')?{entity:'workflow',path_parameter:'id'}:{project:true},verification:{method:'GET',path:status,targetParameter:status.includes(':jobId')?'jobId':'id',idFromResponse:'id',async:true}});
for(const path of ['/test-cases/:id/automation/generator-jobs','/test-cases/automation/build-batch'])add('POST',path,{family:'automation',effect:'command',scope:path.includes('/:id/')?{entity:'test_case',path_parameter:'id'}:{project:true},verification:{method:'GET',path:'/test-cases/automation/jobs/:transactionId',targetParameter:'transactionId',idFromResponse:'transaction_id',async:true}});
add('POST','/test-cases/automation/learning-cache/:id/ai-improve',{family:'object_repository',effect:'generate',scope:{entity:'learning_object',path_parameter:'id'},verification:{response:'proposal'}});
add('GET','/ai/automation-repairs/:id',{family:'automation_repair',scope:{entity:'automation_repair',path_parameter:'id'}});
add('GET','/test-cases/automation/learning-cache/:id',{family:'object_repository',scope:{entity:'learning_object',path_parameter:'id'}});
const repositoryMetadataFields=['screen_name','object_name','object_role','target_criteria','dom_structure','dom_path','screenshot_url','screenshot_path','fallback_strategy','platform','url_pattern_type','url_pattern_value','screen_fingerprint','screen_dom_compressed','screen_screenshot_url','accessibility_tree','fallback_locators','description','business_meaning','usage_keywords','stability_score','last_validated_at','validation_history','ancestor_dom','ancestor_screenshot_url','element_screenshot_url'];
for(const method of ['POST','PUT','DELETE'])add(method,'/test-cases/automation/learning-cache'+(method==='POST'?'':'/:id'),{
 family:'object_repository',scope:method==='POST'?{project:true}:{entity:'learning_object',path_parameter:'id'},
 verification:{method:'GET',path:'/test-cases/automation/learning-cache/:id',targetParameter:'id',idFromResponse:'id',
  matchFields:['page_url','page_key','locator_intent','locator','locator_kind','confidence','source','metadata'],fieldMappings:repositoryMetadataFields.map(bodyField=>({bodyField,observedPath:'metadata.'+bodyField})),...(method==='DELETE'?{deleteAbsence:true}:{})},
 ...(method==='DELETE'?{body_schema:emptyBody}:{})
});
for(const [path,family]of [['/repository-agents/runs/:id/cancel','repository_agents'],['/agentic-quality/runs/:id/cancel','browser_agents'],['/agentic-workflow-runs/:id/cancel','workflow_runs']])add('POST',path,{family,effect:'command',scope:{entity:family==='repository_agents'?'repository_run':family==='workflow_runs'?'workflow_run':'browser_mission',path_parameter:'id'},body_schema:emptyBody,
 label:'Stop an active '+family.replaceAll('_',' ')+' run',summary:'Request cancellation and verify its persisted state. Read the final status to distinguish a stopped run from one that already completed.',
 verification:{method:'GET',path:path.replace(/\/cancel$/,''),targetParameter:'id',expectedValues:[{path:'status',value:'cancelled'}]}});
add('GET','/agentic-workflow-runs/:id/cancellation',{family:'workflow_runs',scope:{entity:'workflow_run',path_parameter:'id'}});
Object.assign(policy.get('POST /agentic-workflow-runs/:id/cancel').verification,{path:'/agentic-workflow-runs/:id/cancellation',async:true,expectedValues:[{path:'requested',value:true}]});
add('POST','/agentic-workflow-runs/:id/drafts/accept',{family:'workflow_runs',effect:'create',scope:{entity:'workflow_run',path_parameter:'id'},label:'Save a recorded workflow draft for review',summary:'Save the selected fingerprinted workflow draft as a Test Case awaiting human review. This does not approve the case or verify its automation.',verification:{method:'GET',path:'/test-cases/:id',targetParameter:'id',idFromResponse:'id',allowedControls:['node_id','story_index','case_index','kind'],expectedValues:[{path:'review_status',value:'pending'},{path:'ai_generation_review_status',value:'pending'},{path:'status',value:'draft'}],responseFields:[{resultPath:'title',observedPath:'title'},{resultPath:'story_id',observedPath:'requirement_id'}]}});
add('POST','/repository-agents/runs/:id/retry',{family:'repository_agents',effect:'command',scope:{entity:'repository_run',path_parameter:'id'},body_schema:emptyBody,verification:{method:'GET',path:'/repository-agents/runs/:id',targetParameter:'id',idFromResponse:'id',async:true}});
const sourceBody={type:'object',additionalProperties:false,required:['type','repository_url'],properties:{type:{const:'github'},repository_url:{type:'string',maxLength:512,pattern:'^https://github\\.com/[A-Za-z0-9-]+/[A-Za-z0-9._-]+/?$'},ref:{type:['string','null'],maxLength:255},integration_id:{type:'string',maxLength:128}}};
add('POST','/repository-agents/runs',{family:'repository_agents',effect:'command',scope:{project:true},body_schema:body({project_id:id,app_type_id:id,agent_type:{enum:['object_repository','api_tests','repository_knowledge','component_tests']},source:sourceBody,llm_integration_id:id,goal:{type:'string',maxLength:2000},context_scopes:{type:'array',maxItems:6,items:{enum:['stories','test-cases','automation','runs','bugs','knowledge']}},evidence_scope:{type:'object'},smart_context:{type:'object'}},['project_id','agent_type','source']),verification:{method:'GET',path:'/repository-agents/runs/:id',targetParameter:'id',idFromResponse:'id',async:true}});
add('POST','/agentic-assistant/sessions',{family:'agents',effect:'command',scope:{project:true},verification:{method:'GET',path:'/agentic-assistant/sessions/:id',targetParameter:'id',idFromResponse:'transaction.id',observedIdPath:'transaction.id',async:true}});
for(const method of ['POST','PATCH'])add(method,'/knowledge/assistant/sessions'+(method==='POST'?'':'/:id'),{family:'knowledge_assistant',scope:method==='POST'?{project:true}:{entity:'knowledge_session',path_parameter:'id'},effect:method==='POST'?'create':'update',verification:{method:'GET',path:'/knowledge/assistant/sessions/:id',targetParameter:'id',idFromResponse:'id',matchFields:method==='POST'?['title','app_type_id','filters']:['title','status'],...(method==='POST'?{fieldMappings:[{bodyField:'integration_id',observedPath:'filters.llm_integration_id'}]}:{})}});
policy.get('POST /knowledge/assistant/sessions').body_schema=body({project_id:id,app_type_id:id,title:{type:'string',maxLength:240},filters:{type:'object'},integration_id:id},['project_id']);
for(const path of ['/knowledge/ingestions','/knowledge/ingestions/:id/retry'])add('POST',path,{family:'knowledge_ingestion',effect:'command',scope:path.includes('/:id/')?{entity:'ingestion',path_parameter:'id'}:{project:true},...(path.endsWith('/retry')?{body_schema:emptyBody}:{}),verification:{method:'GET',path:'/knowledge/ingestions/:id',targetParameter:'id',idFromResponse:'job.id',async:true}});
const browserLaunchBody=require('./contracts.json').schemas['POST /agentic-quality/runs']?.body;
if(browserLaunchBody)add('POST','/agentic-quality/plan',{family:'browser_agents',effect:'generate',scope:{project:true},body_schema:{...browserLaunchBody,properties:{...browserLaunchBody.properties,steps:browserLaunchBody.properties.reviewed_plan.properties.steps}},verification:{response:'proposal'}});
const knowledgeTextProperties={app_type_id:{type:['string','null'],maxLength:255},title:{type:'string',minLength:1,maxLength:240},description:{type:['string','null'],maxLength:12000},content_type:{enum:['text','markdown']},content:{type:'string',maxLength:100000},metadata:{type:'object'},linked_test_cases:{type:'array',maxItems:100,uniqueItems:true,items:id},source_uri:{type:['string','null'],maxLength:2000},is_active:{type:'boolean'},...Object.fromEntries(['asset_type','module_name','feature_name','priority','item_version','item_status','source'].map(field=>[field,{type:['string','null'],maxLength:255}]))};
add('GET','/projects/:project_id/knowledge/:id',{family:'knowledge_text',scope:{entity:'knowledge_item',path_parameter:'id'}});
for(const method of ['POST','PUT','DELETE'])add(method,'/projects/:project_id/knowledge'+(method==='POST'?'':'/:id'),{family:'knowledge_text',scope:method==='POST'?{project:true}:{entity:'knowledge_item',path_parameter:'id'},label:method==='PUT'?'Replace a Knowledge text item':undefined,summary:'Create, replace or remove a project Knowledge text or Markdown item. Replacement supplies the complete item; omitted optional values reset to native defaults. Indexing is asynchronous.',body_schema:method==='DELETE'?emptyBody:body(knowledgeTextProperties,['title','content']),verification:{method:'GET',path:'/projects/:project_id/knowledge/:id',targetParameter:'id',idFromResponse:'id',matchFields:Object.keys(knowledgeTextProperties),...(method==='DELETE'?{deleteAbsence:true}:{})}});
add('DELETE','/knowledge/sources/:id',{family:'knowledge_sources',scope:{entity:'knowledge_source',path_parameter:'id'},body_schema:emptyBody,summary:'Archive a Knowledge source and deactivate current retrieval while retaining its version history and audit records.',verification:{method:'GET',path:'/knowledge/sources/:id',targetParameter:'id',idFromResponse:'id',observedIdPath:'source.id',expectedValues:[{path:'source.extraction_status',value:'archived'}]}});
for(const method of ['POST','DELETE'])add(method,'/knowledge/collections/:id/sources',{family:'knowledge_collections',effect:'update',scope:{entity:'collection',path_parameter:'id'},body_schema:body({source_ids:{type:'array',minItems:1,maxItems:100,uniqueItems:true,items:id}},['source_ids']),verification:{method:'GET',path:'/knowledge/collections/:id',targetParameter:'id',memberships:[{bodyField:'source_ids',storage:'collection_sources',mode:method==='POST'?'contains':'absent'}]}});
add('DELETE','/agentic-workflows/agents/:agentId',{family:'agents',scope:{entity:'agent',path_parameter:'agentId'},body_schema:emptyBody,summary:'Archive an agent definition at its reviewed current version; preserve existing version history.',verification:{method:'GET',path:'/agentic-workflows/agents/:agentId',targetParameter:'agentId',versionQuery:'version',expectedValues:[{path:'archived',value:true}]}});
for(const method of ['POST','PUT'])add(method,'/projects/:project_id/knowledge/refresh',{family:'knowledge_ingestion',effect:method==='POST'?'command':'update',scope:{entity:'project',path_parameter:'project_id'},body_schema:method==='POST'?emptyBody:body({enabled:{type:'boolean'},interval_ms:{type:'integer',minimum:5000,maximum:86400000}},['enabled','interval_ms']),verification:{method:'GET',path:'/projects/:project_id/knowledge/refresh',targetParameter:'project_id',idFromResponse:'project_id',observedIdPath:'project_id',...(method==='POST'?{async:true}:{matchFields:['enabled','interval_ms']})}});
for(const suffix of ['start','complete','rerun'])add('POST',`/executions/:id/${suffix}`,{family:'runs',effect:suffix==='rerun'?'create':suffix==='start'?'command':'update',scope:{entity:'execution',path_parameter:'id'},verification:{method:'GET',path:'/executions/:id',targetParameter:'id',idFromResponse:'id',matchFields:suffix==='rerun'?['name']:[],allowedControls:suffix==='complete'?['status']:suffix==='rerun'?['failed_only']:['execution_mode'],...(suffix==='start'?{async:true}:{}),...(suffix==='rerun'?{expectedValues:[{path:'status',value:'queued'}]}:{responseFields:[{resultPath:'revision',observedPath:'revision'},...(suffix==='complete'?[{resultPath:'status',observedPath:'status'}]:[])]})}});
add('POST','/test-cases/:id/review',{family:'test_cases',effect:'update',scope:{entity:'test_case',path_parameter:'id'},verification:{method:'GET',path:'/test-cases/:id',targetParameter:'id',matchFields:['review_status'],fieldMappings:[{bodyField:'comment',observedPath:'review_history.-1.comment'}],allowedControls:['expected_updated_at']}});
add('POST','/test-cases/:id/accept-generated',{family:'test_cases',effect:'update',scope:{entity:'test_case',path_parameter:'id'},verification:{method:'GET',path:'/test-cases/:id',targetParameter:'id',expectedValues:[{path:'review_status',value:'accepted'},{path:'ai_generation_review_status',value:'accepted'},{path:'status',value:'ready'}],allowedControls:['expected_updated_at']}});
add('DELETE','/test-cases/:id/reject-generated',{family:'test_cases',effect:'delete',scope:{entity:'test_case',path_parameter:'id'},verification:{method:'GET',path:'/test-cases/:id',targetParameter:'id',deleteAbsence:true,allowedControls:['expected_updated_at']}});
policy.get('POST /executions/:id/rerun').verification.noEffectErrors=['RERUN_EMPTY_SCOPE','RERUN_NO_FAILED_CASES'];
for(const [method,suffix]of [['POST','review'],['POST','accept-generated'],['DELETE','reject-generated']])policy.get(`${method} /test-cases/:id/${suffix}`).verification.noEffectErrors=['TESTCASE_REVIEW_OWNER_DENIED','TESTCASE_REVIEW_NOT_PENDING'];
for(const method of ['POST','PUT']){
 const rule=policy.get(`${method} /test-cases/automation/learning-cache${method==='POST'?'':'/:id'}`).verification;
 if(method==='POST'){
   rule.matchFields.push('app_type_id','test_case_id');
   const actualFields=new Set(['screen_name','object_name','object_role','target_criteria','dom_structure','screenshot_url','fallback_strategy','screen_dom_compressed','screen_screenshot_url']);
   rule.fieldMappings=rule.fieldMappings.filter(mapping=>actualFields.has(mapping.bodyField));
 }else rule.matchFields=rule.matchFields.filter(field=>field!=='page_key');
}
policy.get('POST /test-cases').verification.matchFields=policy.get('POST /test-cases').verification.matchFields.filter(field=>field!=='review_status');
// Native collection aggregate counts currently apply source-kind permission,
// while individual sources also have principal ACLs. Keep those aggregates out
// of delegated data until they use the same authorization predicate.
for(const value of policy.values())if(value.family==='knowledge_collections')value.omit_fields=['source_count','document_count','chunk_count'];
// Run and result access grants evidence outcomes, not the separately protected
// environment/configuration and test-data values saved inside frozen scopes.
// Preserve scope identities, case snapshots, observed steps and metric values.
const executionValueBags=['data_set_row_snapshot','variables','template_variables','headers','cookies','rows','template_rows','shared_rows','shared_template_rows','parameter_values','parameter_template_values','suite_parameter_values','suite_parameter_template_values'];
for(const value of policy.values())if(['runs','run_results'].includes(value.family))value.omit_fields=[...new Set([...(value.omit_fields||[]),...executionValueBags])];

const references=Object.freeze({app_type_id:'app_type',test_case_id:'test_case',test_case_ids:'test_case',linked_test_case_ids:'test_case',manual_test_case_id:'test_case',
  requirement_id:'requirement',requirement_ids:'requirement',linked_requirement_ids:'requirement',related_requirement_ids:'requirement',story_id:'requirement',
  suite_id:'test_suite',test_suite_id:'test_suite',suite_ids:'test_suite',test_suite_ids:'test_suite',linked_test_suite_ids:'test_suite',linked_module_ids:'module',
  execution_id:'execution',linked_test_run_id:'execution',run_id:'execution',issue_id:'issue',issue_ids:'issue',defect_id:'issue',defect_ids:'issue',
  test_environment_id:'environment',test_configuration_id:'configuration',test_data_set_id:'data_set',iteration_id:'iteration',sprint_id:'iteration',sprint_ids:'iteration',release_id:'release',collection_id:'collection',collection_ids:'collection',source_ids:'knowledge_source',
  step_id:'test_step',step_ids:'test_step',module_id:'module',shared_step_group_id:'shared_step_group',baseline_id:'browser_baseline',linked_test_cases:'test_case',test_data_set_ids:'data_set',manual_test_case_ids:'test_case',reusable_group_id:'shared_step_group'});
async function assertEntity(entity,value,actor) {
  if(typeof value!=='string'||!value.trim()||value.length>255)throw fail(`A valid ${entity} identifier is required.`,400,'MCP_INVALID_ARGUMENT');
  if(entity==='project'){if(value!==actor.projectId)throw fail('Project does not match this connection.',403,'MCP_PROJECT_SCOPE_DENIED');return;}
  if(scopeQueries[entity]){
    const selected=scopeDatabases[entity]==='observability'?require('@hellotest/platform/backend/src/obsDb'):db;
    const record=await selected.prepare(scopeQueries[entity]).get(value);
    if(!record)throw fail('The requested record was not found in this project.',404,'MCP_RECORD_NOT_FOUND');
    if(entity==='learning_object'&&!record.project_id&&record.app_type_id){const application=await nativeScopes.resolveEntityScope({entityType:'app_type',entityId:record.app_type_id,projectId:actor.projectId});record.project_id=application.projectId;}
    if(record.project_id!==actor.projectId)throw fail('The record is outside the MCP project.',403,'MCP_PROJECT_SCOPE_DENIED');
    if(entity==='knowledge_item')await require('@hellotest/knowledge/backend/services/aiKnowledge.service').assertLegacyKnowledgeRead(actor.projectId,record,actor.user);
    return {entityId:record.id,projectId:record.project_id};
  }
  const resolved=await nativeScopes.resolveEntityScope({entityType:entity,entityId:value,projectId:actor.projectId,allowDisplayId:true});
  if(entity==='knowledge_source'){
    const lifecycle=require('@hellotest/knowledge/backend/services/knowledgeSourceLifecycle.service');
    const source=await lifecycle.get(resolved.entityId || value);
    if(source.extraction_status==='archived')await require('@hellotest/knowledge/backend/services/knowledgeAuthorization.service').assertHistoricalAccess(actor.user,actor.projectId);
    await lifecycle.assertSourceRead(source,actor.user,{allowArchived:source.extraction_status==='archived'});
  }
  return resolved;
}
async function assertScope(op,actor,args={}) {
  const value=op.policy || policyFor(op.method,op.path);
  if(!value)throw fail('No audited project wrapper is registered for this operation.',422,'MCP_WRAPPER_REQUIRED');
  if(args.body&&Object.hasOwn(args.body,'engine_base_url'))throw fail('MCP runs use the configured Test Engine connection. Choose a configured execution mode.',400,'MCP_UNSUPPORTED_FIELD');
  if(op.path==='/test-suites'&&op.method==='POST'&&args.body?.parallel_count!=null&&!Object.hasOwn(args.body,'parallel_enabled'))throw fail('Specify parallel_enabled together with parallel_count so the native suite stores the reviewed settings.',400,'MCP_INVALID_ARGUMENT');
  if(op.path==='/execution-results'&&op.method==='POST'&&args.body?.status==='pending'&&['duration_ms','test_data_set_id','test_data_set_name','data_set_row_snapshot','executed_by'].some(key=>Object.hasOwn(args.body,key)))throw fail('Pending results use their frozen run snapshot and lifecycle timer. Record those fields after an explicit lifecycle transition.',400,'MCP_UNSUPPORTED_FIELD');
  if(op.path.startsWith('/requirements')&&args.body?.ai_review&&typeof args.body.ai_review==='object'&&Object.keys(args.body.ai_review).some(key=>!['capability','request_id','input_fingerprint','evidence_refs','human_edited_fields'].includes(key)))throw fail('AI review accepts capability, request and evidence provenance; acceptance identity and time are assigned by the application.',400,'MCP_UNSUPPORTED_FIELD');
  for(const input of [args.path,args.query,args.body])if(input?.project_id && input.project_id!==actor.projectId)throw fail('Project does not match this connection.',403,'MCP_PROJECT_SCOPE_DENIED');
  if(value.scope.path_parameter){
    const selected=await assertEntity(value.scope.entity,args.path?.[value.scope.path_parameter],actor);
    if(selected?.entityId && value.scope.entity==='test_case')args.path[value.scope.path_parameter]=selected.entityId;
  }
  const seen=new Map();
  async function visit(input,depth=0){
    if(!input||typeof input!=='object'||depth>10)return;
    if(Array.isArray(input)){if(input.length>100)throw fail('Narrow this request to at most 100 referenced records.',400,'MCP_INVALID_ARGUMENT');for(const child of input)await visit(child,depth+1);return;}
    for(const [key,record]of Object.entries(input)){
      if(references[key] && record!=null && record!==''){
        const identifiers=Array.isArray(record)?record:[record];
        if(identifiers.length>100)throw fail('Narrow this request to at most 100 referenced records.',400,'MCP_INVALID_ARGUMENT');
        const normalized=[];
        for(const identifier of identifiers){
          const cache=references[key]+':'+identifier;
          let resolved=seen.get(cache);
          if(!resolved){resolved=await assertEntity(references[key],identifier,actor);seen.set(cache,resolved);}
          normalized.push(resolved?.entityId || identifier);
        }
        input[key]=Array.isArray(record)?normalized:normalized[0];
      }
      else if(record&&typeof record==='object'&&!['definition','nodes','edges','proposed_change','additional_fields','parameter_values','variables','headers','rows','columns'].includes(key))await visit(record,depth+1);
    }
  }
  await visit(args.query);await visit(args.body);
  if(['/test-steps','/comments','/attachments'].includes(op.path)){
    const query=op.method==='GET'?args.query:args.body;
    if(op.path==='/test-steps'&&!query?.test_case_id)throw fail('Select a Test Case for step operations.',400,'MCP_INVALID_ARGUMENT');
    if(['/comments','/attachments'].includes(op.path)){
      if(!query?.entity_type||!query?.entity_id)throw fail('Select an exact supported entity for comments or attachments.',400,'MCP_INVALID_ARGUMENT');
      await assertEntity(query.entity_type,query.entity_id,actor);
    }
  }
  return args;
}
async function assertResponseScope(op,actor,result) {
  const selected=op.policy || policyFor(op.method,op.path);
  if(!selected)throw fail('An audited response scope is required.',422,'MCP_WRAPPER_REQUIRED');
  const checked=new Set();let visited=0;
  async function check(entity,id){const key=entity+':'+id;if(checked.has(key))return;checked.add(key);await assertEntity(entity,id,actor);}
  async function walk(value,depth=0){
    if(!value||typeof value!=='object')return;
    if(++visited>5000||depth>15)throw fail('The response is too large. Use a bounded database projection or narrow the feature request.',413,'MCP_RESULT_TOO_LARGE');
    if(value.project_id!=null && value.project_id!==actor.projectId)throw fail('A domain response is outside the MCP project.',403,'MCP_PROJECT_SCOPE_DENIED');
    if(typeof value.app_type_id==='string'&&value.app_type_id)await check('app_type',value.app_type_id);
    for(const key of selected.response_reference_fields || [])if(typeof value[key]==='string'&&value[key])await check(references[key],value[key]);
    for(const child of Array.isArray(value)?value:Object.values(value))await walk(child,depth+1);
  }
  await walk(result);
  if(selected.scope.collection && selected.scope.entity){
    const rows=Array.isArray(result)?result:Array.isArray(result?.items)?result.items:Array.isArray(result?.records)?result.records:[];
    for(const row of rows)if(typeof row?.id==='string')await check(selected.scope.entity,row.id);
  }
  if(selected.response_legacy_knowledge)for(const item of result?.knowledge || []){
    const explicit=item?.metadata?.legacy_source_id;
    if(typeof explicit==='string'&&explicit)await check('knowledge_item',explicit);
    else if(typeof item?.id==='string'){
      const native=await db.prepare(scopeQueries.knowledge_item).get(item.id);
      if(native)await check('knowledge_item',item.id);
    }
  }
  return result;
}
const memberships=Object.freeze({
 suite_cases:{entity:'test_suite',permissions:['suite.view','testcase.view'],sql:'SELECT m.test_case_id AS id FROM suite_test_cases m JOIN test_cases c ON c.id=m.test_case_id JOIN app_types a ON a.id=c.app_type_id WHERE m.suite_id=? AND a.project_id=? ORDER BY m.test_case_id',project:true},
 module_cases:{entity:'module',permissions:['testcase.view'],sql:'SELECT m.test_case_id AS id FROM test_case_module_cases m JOIN test_cases c ON c.id=m.test_case_id JOIN app_types a ON a.id=c.app_type_id WHERE m.module_id=? AND a.project_id=? ORDER BY m.test_case_id',project:true},
 module_requirements:{entity:'module',permissions:['testcase.view','requirement.view'],sql:'SELECT m.requirement_id AS id FROM test_case_module_requirements m JOIN requirements r ON r.id=m.requirement_id WHERE m.module_id=? AND r.project_id=? ORDER BY m.requirement_id',project:true},
 iteration_requirements:{entity:'iteration',permissions:['requirement_iteration.view','requirement.view'],sql:'SELECT id FROM requirements WHERE iteration_id=? AND project_id=? ORDER BY id',project:true},
 release_requirements:{entity:'release',permissions:['requirement_iteration.view','requirement.view'],sql:"SELECT m.requirement_id AS id FROM requirement_release_items m JOIN requirements r ON r.id=m.requirement_id WHERE m.release_id=? AND r.project_id=? AND m.source='manual' ORDER BY m.requirement_id",project:true},
 release_sprints:{entity:'release',permissions:['requirement_iteration.view'],sql:'SELECT sprint_ids FROM requirement_releases WHERE id=?',arrayField:'sprint_ids'},
 selected_story_release:{entity:'requirement',permissions:['requirement.view','requirement_iteration.view'],sql:"SELECT rel.id AS id FROM requirements r JOIN requirement_releases rel ON rel.project_id=r.project_id AND rel.name=r.release AND rel.fix_version IS NOT DISTINCT FROM r.fix_version JOIN requirement_release_items m ON m.release_id=rel.id AND m.requirement_id=r.id AND m.source='manual' WHERE r.id=? AND r.project_id=? ORDER BY rel.id",project:true},
 collection_sources:{entity:'collection',permissions:['knowledge.view'],sql:'SELECT s.id FROM ai_knowledge_collection_sources m JOIN ai_knowledge_sources s ON s.id=m.source_id WHERE m.collection_id=? AND s.project_id=? ORDER BY s.id',project:true,children:'knowledge_source'},
 related_stories:{entity:'requirement',permissions:['requirement.view'],sql:'SELECT CASE WHEN m.requirement_id=? THEN m.related_requirement_id ELSE m.requirement_id END AS id FROM requirement_relations m JOIN requirements left_story ON left_story.id=m.requirement_id JOIN requirements right_story ON right_story.id=m.related_requirement_id WHERE (m.requirement_id=? OR m.related_requirement_id=?) AND left_story.project_id=? AND right_story.project_id=? ORDER BY id',targetCount:3,projectCount:2}
});
async function readMembership(storage,targetId,actor) {
 const definition=memberships[storage];
 if(!definition)throw fail('Unknown audited membership projection.',422,'MCP_WRAPPER_REQUIRED');
 for(const permission of definition.permissions)await permit(actor,permission);
 await assertEntity(definition.entity,targetId,actor);
 const rows=await db.prepare(definition.sql).all(...Array(definition.targetCount || 1).fill(targetId),...Array(definition.projectCount || (definition.project?1:0)).fill(actor.projectId));
 const ids=definition.arrayField?(rows[0]?.[definition.arrayField] || []):rows.map(row=>row.id);
 if(!Array.isArray(ids)||ids.length>1000)throw fail('Membership is too large for one reviewed change. Narrow the resource scope.',413,'MCP_RESULT_TOO_LARGE');
 const selected=[...new Set(ids)].sort();
 if(definition.children)for(const child of selected)await assertEntity(definition.children,child,actor);
 return selected;
}
function unavailableReason(method,path){
 if(path.includes('/local-dispatch')||path.startsWith('/local-browser-bridges/')||path==='/automation/browser-bridges')return 'Paired local execution and browser control require a browser-origin handshake and a scoped machine grant; these credentials are not delegated to MCP clients.';
 if(method==='POST'&&path==='/agentic-workflows/:id/runs')return 'This legacy route synthesizes a completed workflow preview; use /agentic-workflows/:id/executions for actual execution.';
 if(path==='/agentic-quality/runs/:id/events')return 'This native endpoint streams server-sent events; use the bounded JSON run status tool and poll its durable identifier.';
 if(path.startsWith('/notifications'))return 'Notifications belong to the personal workspace across projects; this project-bound MCP credential has no user-wide notification grant.';
 if(path.startsWith('/integrations'))return 'Native integration APIs expose instance-wide connection configuration. Use the integrations metadata projection for active project/shared connection identifiers; configure credentials in the native UI.';
 if(path.includes('/recorder-session'))return 'Step recording requires an interactive browser host and recorder-session handshake; a server-side JSON tool cannot supply that browser connection.';
 if(path==='/executions/local-run')return 'This endpoint launches an interactive local host run. Use a configured remote engine with a durable Execution identifier through MCP.';
 if(path==='/test-steps/run-api-request')return 'Ad hoc outbound API requests require a reviewed destination, secret binding and bounded response evidence wrapper; author a scoped API Test Case and execute its frozen run instead.';
 return null;
}
function policyFor(method,path){return policy.get(`${method} ${path}`) || null;}
module.exports={policyFor,describe:policyFor,unavailableReason,assertScope,assertResponseScope,assertEntity,readMembership,scopeQueries,scopeDatabases,memberships,policies:()=>[...policy].map(([route,value])=>({route,...value}))};
