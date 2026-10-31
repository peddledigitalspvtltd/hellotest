const z = require('zod');
const {delivery}=require('./toolContracts');

const identifier = z.string().min(1).max(255).describe('Exact saved HelloTest identifier from a list/get result. Project identity is fixed by the credential.');
const text = z.string().max(16000);
const labels = z.array(z.string().min(1).max(120)).max(30);
const localValues = z.record(z.string().max(120), z.string().max(2000));
const listOutput = z.object({
  resource: z.string(), items: z.array(z.record(z.string(), z.unknown())).max(50),
  next_offset: z.number().int().nonnegative().nullable(), observed_at: z.string(),
  projection: z.literal('authorized_summary'),
  delivery: delivery.optional(),
}).strict();
const detailOutput = z.object({resource:z.string(),record:z.record(z.string(),z.unknown()),observed_at:z.string(),bounded:z.literal(true),delivery:delivery.optional()}).strict();

// Curated domain names make common tasks usable without opaque route hashes.
// The operation registry remains the source of executable capability; a
// descriptor never activates a route or weakens its domain authorization.
const resources = [
  {name:'applications',label:'applications',entity:'applications',path:'/app-types',key:'application_id',search:'name'},
  {name:'stories',label:'Stories',entity:'requirements',path:'/requirements',key:'story_id',search:'title',status:true},
  {name:'test_cases',label:'Test Cases',entity:'test_cases',path:'/test-cases',key:'test_case_id',search:'title',status:true,application:true},
  {name:'test_suites',label:'Test Suites',entity:'test_suites',path:'/test-suites',key:'test_suite_id',search:'name',application:true},
  {name:'test_runs',label:'test runs',entity:'executions',path:'/executions',key:'run_id',search:'name',status:true},
  {name:'defects',label:'Defects',entity:'defects',path:'/feedback',aliases:['/issues'],key:'defect_id',search:'title',status:true},
  {name:'environments',label:'environment metadata',entity:'environments',path:'/test-environments',key:'environment_id',search:'name',application:true},
  {name:'configurations',label:'test configuration metadata',entity:'configurations',path:'/test-configurations',key:'configuration_id',search:'name',application:true},
  {name:'releases',label:'releases',entity:'releases',path:'/requirement-releases',key:'release_id',search:'name'},
  {name:'sprints',label:'Sprints',entity:'sprints',path:'/requirement-iterations',key:'sprint_id',search:'name'},
  {name:'data_sets',label:'Test Data Sets',entity:'data_sets',path:'/test-data-sets',key:'data_set_id',search:'name'},
  {name:'workflows',label:'workflows',entity:'workflows',path:'/agentic-workflows',key:'workflow_id',search:'name'},
];

function createDomainTools({backplane, projections, registry, fail}) {
  const result = {};
  const operation = (method, paths) => registry.all().find(item=>item.method===method && paths.includes(item.path));
  const executable = (method, paths, mode) => {
    const value=operation(method,paths);
    if(!value?.[mode])throw fail('This domain capability is unavailable. Refresh hellotest_capabilities for callable operations.',422,'MCP_OPERATION_UNAVAILABLE');
    return value;
  };
  for(const resource of resources) {
    const paths=[resource.path,...resource.aliases || []];
    const listShape={search:z.string().max(200).optional().describe('Optional literal name/title substring; no query language or wildcard syntax.'),limit:z.number().int().min(1).max(50).default(25).describe('Maximum summaries in this page.'),offset:z.number().int().min(0).max(10000).default(0).describe('Use next_offset from the previous result; omit for the first page.'),
      ...(resource.status?{status:z.string().min(1).max(120).optional()}:{}),...(resource.application?{application_id:identifier.optional()}:{})};
    result[`hellotest_${resource.name}_list`]={
      title:`List ${resource.label}`,description:`List ${resource.label} summaries in this credential's project. Search is a literal substring; pagination uses a bounded authorized database projection. Use the matching get tool for full fields.`,
      schema:z.object(listShape).strict(),output:listOutput,
      available:()=>Boolean(projections.entities[resource.entity] && operation('GET',paths)?.read),
      run:async(actor,args,signal)=>{
        executable('GET',paths,'read');signal?.throwIfAborted();
        const filters=[];
        if(args.search)filters.push({field:resource.search,op:'contains',value:args.search});
        if(args.status)filters.push({field:'status',op:'eq',value:args.status});
        if(args.application_id)filters.push({field:'app_type_id',op:'eq',value:args.application_id});
        const value=await projections.query(actor,{entity:resource.entity,filters,limit:args.limit,offset:args.offset});
        signal?.throwIfAborted();
        return {resource:resource.name,items:value.rows,next_offset:value.next_offset,observed_at:value.observed_at,projection:'authorized_summary',...(value.delivery?{delivery:value.delivery}:{})};
      }
    };
    const detailPaths=paths.map(path=>`${path}/:id`);
    result[`hellotest_${resource.name}_get`]={
      title:`Get ${resource.label}`,description:`Read one saved ${resource.label} record by its exact identifier, using native domain checks and the credential's project. Sensitive environment and configuration values remain omitted.`,
      schema:z.object({[resource.key]:identifier}).strict(),output:detailOutput,
      available:()=>Boolean(operation('GET',detailPaths)?.read),
      run:async(actor,args,signal)=>{
        const op=executable('GET',detailPaths,'read');
        const value=await backplane.read(actor,{operation_id:op.id,arguments:{path:{id:args[resource.key]}}},signal);
        if(!value.data || typeof value.data!=='object' || Array.isArray(value.data))throw fail('The domain returned no single record. Inspect its operation contract.',502,'MCP_DOMAIN_SHAPE_INVALID');
        return {resource:resource.name,record:value.data,observed_at:value.observed_at,bounded:true,...(value.delivery?{delivery:value.delivery}:{})};
      }
    };
  }
  result.hellotest_project_get={
    title:'Get current project',description:'Read the project bound to this MCP credential. The project identity cannot be replaced by a tool argument.',schema:z.object({}).strict(),output:detailOutput,
    available:()=>Boolean(operation('GET',['/projects/:id'])?.read),
    run:async(actor,_args,signal)=>{const op=executable('GET',['/projects/:id'],'read');const value=await backplane.read(actor,{operation_id:op.id,arguments:{path:{id:actor.projectId}}},signal);return {resource:'project',record:value.data,observed_at:value.observed_at,bounded:true,...(value.delivery?{delivery:value.delivery}:{})};}
  };
  result.hellotest_knowledge_source_get={
    title:'Get Knowledge source',description:'Read an authorized Knowledge source by exact ID. For immutable cited content, use hellotest_knowledge_fetch with its fragment/version identifiers.',schema:z.object({source_id:identifier}).strict(),output:detailOutput,
    available:()=>Boolean(operation('GET',['/knowledge/sources/:id'])?.read),
    run:async(actor,args,signal)=>{const op=executable('GET',['/knowledge/sources/:id'],'read');const value=await backplane.read(actor,{operation_id:op.id,arguments:{path:{id:args.source_id}}},signal);return {resource:'knowledge_source',record:value.data,observed_at:value.observed_at,bounded:true,...(value.delivery?{delivery:value.delivery}:{})};}
  };

  const story={title:z.string().min(2).max(255),description:text.optional(),acceptance_criteria:z.array(z.string().min(1).max(2000)).max(100).optional(),priority:z.number().int().min(1).max(5).optional(),status:z.string().max(100).optional(),labels:labels.optional(),release_id:identifier.optional(),iteration_id:identifier.optional()};
  const step=z.object({step_order:z.number().int().min(1).optional(),step_type:z.enum(['web','api','android','ios']).optional(),action:z.string().min(1).max(4000),expected_result:z.string().min(1).max(4000)}).strict();
  const testCase={app_type_id:identifier,title:z.string().min(2).max(255),description:text.optional(),priority:z.number().int().min(1).max(5).optional(),test_case_type:z.string().min(1).max(120).optional(),authoring_mode:z.enum(['structured','gherkin']).optional(),gherkin_document:z.string().max(40000).optional(),steps:z.array(step).max(100).optional(),parameter_values:localValues.optional(),requirement_ids:z.array(identifier).max(50).optional(),suite_ids:z.array(identifier).max(30).optional(),labels:labels.optional()};
  const suite={app_type_id:identifier,name:z.string().min(2).max(255),description:text.optional(),parent_id:identifier.optional(),test_case_ids:z.array(identifier).max(50).optional(),labels:labels.optional()};
  const testRun={name:z.string().min(2).max(255).optional(),app_type_id:identifier,test_case_ids:z.array(identifier).min(1).max(50),execution_mode:z.enum(['manual','local','remote']).default('manual'),test_environment_id:identifier.optional(),test_configuration_id:identifier.optional(),assigned_to:identifier.optional(),release_id:identifier.optional(),iteration_id:identifier.optional()};
  const defect={title:z.string().min(2).max(255),message:z.string().min(2).max(16000),steps_to_reproduce:text.optional(),expected_result:text.optional(),actual_result:text.optional(),priority:z.string().max(80).optional(),severity:z.string().max(80).optional(),status:z.string().max(100).optional(),linked_test_case_ids:z.array(identifier).max(50).optional(),linked_requirement_ids:z.array(identifier).max(50).optional(),linked_test_suite_ids:z.array(identifier).max(50).optional(),linked_module_ids:z.array(identifier).max(50).optional(),linked_test_run_id:identifier.optional(),labels:labels.optional()};
  const prepares=[
    {name:'story',label:'Story',paths:['/requirements'],shape:story,key:'story_id'},
    {name:'test_case',label:'Test Case',paths:['/test-cases'],shape:testCase,key:'test_case_id'},
    {name:'test_suite',label:'Test Suite',paths:['/test-suites'],shape:suite,key:'test_suite_id'},
    {name:'test_run',label:'test run',paths:['/executions'],shape:testRun,key:'run_id',createOnly:true},
    {name:'defect',label:'Defect',paths:['/feedback','/issues'],shape:defect,key:'defect_id'},
  ];
  for(const descriptor of prepares)for(const action of descriptor.createOnly?['create']:['create','update']) {
    const method=action==='create'?'POST':'PUT',paths=action==='create'?descriptor.paths:descriptor.paths.map(path=>`${path}/:id`);
    const shape=action==='create'?descriptor.shape:Object.fromEntries(Object.entries(descriptor.shape).filter(([key])=>key!=='app_type_id').map(([key,schema])=>[key,schema.optional()]));
    result[`hellotest_${descriptor.name}_${action}_prepare`]={
      title:`Prepare ${descriptor.label} ${action}`,description:`Prepare ${action==='create'?'a new': 'changes to a saved'} ${descriptor.label} for explicit review. Returns an immutable plan; it does not save the artifact or execute a run. Authorize the exact plan in Agent Studio, then call hellotest_operation_execute once. Inspect the operation for advanced fields.`,
      schema:z.object({...(action==='update'?{[descriptor.key]:identifier}:{}),...shape}).strict(),write:true,destructive:false,external:false,
      available:()=>Boolean(operation(method,paths)?.prepare),
      run:async(actor,args)=>{
        const op=executable(method,paths,'prepare'),body={...args};
        const resourceId=body[descriptor.key];delete body[descriptor.key];
        if(action==='update'&&!Object.keys(body).length)throw fail('Supply at least one field to update.',400,'MCP_INVALID_ARGUMENT');
        return backplane.prepare(actor,{operation_id:op.id,arguments:{...(resourceId?{path:{id:resourceId}}:{}),body}});
      }
    };
  }
  return result;
}

module.exports={createDomainTools,resources,listOutput,detailOutput};
