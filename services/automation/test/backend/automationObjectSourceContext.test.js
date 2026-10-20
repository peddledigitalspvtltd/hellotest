const test=require('node:test'),assert=require('node:assert/strict');
const {automationObjectSourceContext:context,automationObjectSourceContexts:contexts}=require('../../backend/lib/automationObjectSourceContext');
const rows=[{id:'navigate',step_order:1,step_type:'web',automation_code:'await page.goto("https://app.test/app?view=PRIVATE_ROUTE");'},
 {id:'fill',step_order:2,step_type:'web',automation_code:'await page.locator("#email").fill("@r.email");'},
 {id:'submit',step_order:3,step_type:'web',automation_code:'await page.locator("#submit").click();'}];
const input={caseStartUrl:'https://app.test/start?session=PRIVATE_VALUE',steps:rows};

test('ordered saved source prefix and start URL produce independent stable opaque context digests',()=>{
 const before=context({...input,stepId:'fill'});assert.match(before,/^[a-f0-9]{64}$/);
 assert.equal(context({...input,steps:[...rows].reverse(),stepId:'fill'}),before,'database ordering is normalized by explicit order and ID');
 for(const changed of [
  {...input,caseStartUrl:'https://app.test/other-start'},
  {...input,steps:rows.map(row=>row.id==='navigate'?{...row,automation_code:row.automation_code+'\n// Changed prerequisite'}:row)},
  {...input,steps:rows.map(row=>row.id==='navigate'?{...row,id:'other-navigation'}:row)}
 ])assert.notEqual(context({...changed,stepId:'fill'}),before);
 assert.equal(context({...input,steps:rows.map(row=>row.id==='fill'||row.id==='submit'?{...row,automation_code:'future/current changed'}:row),stepId:'fill'}),before,'current and future source are separate identities');
 const all=contexts(input);assert.equal(all.get('fill'),before);assert.notEqual(all.get('submit'),before);
 assert.doesNotMatch(JSON.stringify([...all]),/PRIVATE_ROUTE|PRIVATE_VALUE|page\.goto|params/);
});

test('missing or unresolved source prefixes cannot authorize route context, including API/shared barriers',()=>{
 assert.equal(context({steps:rows,stepId:'fill'}),null,'an absent case start-URL snapshot is unknown, while explicit null is valid');
 assert.match(context({...input,caseStartUrl:null,stepId:'navigate'}),/^[a-f0-9]{64}$/);
 assert.equal(context({...input,stepId:'missing'}),null);
 for(const prior of [{...rows[0],automation_code:''},{...rows[0],reusable_group_id:'unresolved-shared'}, {...rows[0],step_type:'api',automation_code:'',api_request:'invalid json'}])
  assert.equal(context({...input,steps:[prior,...rows.slice(1)],stepId:'fill'}),null);
 const api={...rows[0],step_type:'api',automation_code:'',api_request:{method:'GET',url:'/setup',headers:{b:'2',a:'1'}}};
 assert.equal(context({...input,steps:[api,...rows.slice(1)],stepId:'fill'}),context({...input,steps:[{...api,api_request:{headers:{a:'1',b:'2'},url:'/setup',method:'GET'}},...rows.slice(1)],stepId:'fill'}),'API object key formatting is immaterial but its ordered barrier remains in context');
});
