const test=require('node:test'),assert=require('node:assert/strict');
const {canonicalizeRepositoryRows:project,canonicalPageUrl,repositoryInputMetadata}=require('../../backend/lib/repositoryScreenIdentity');
const row=(id,screen,locator='__screen__',extra={})=>({id,project_id:'p',app_type_id:'app',page_url:'https://app.test/account',page_key:screen,locator_intent:locator==='__screen__'?'__screen__':'Email',locator,source:'manual',test_case_id:'case-'+id,created_at:id,metadata:{screen_name:screen,object_name:locator==='__screen__'?'__screen__':'Email'},...extra});

test('same scoped Page URL is one screen; duplicate fields retain historical refs and source owners without deletes',()=>{
 const input=[row('1','Account'),row('2','Login'),row('3','Account','#email'),row('4','Login','#email'),row('5','Login','#submit',{metadata:{screen_name:'Login',object_name:'Submit'}})];
 const original=structuredClone(input),result=project(input);
 assert.equal(result.all.length,5);assert.equal(result.rows.length,3);assert.equal(result.byId.get('2').metadata.merged_into_entry_id,'1');assert.equal(result.byId.get('4').metadata.merged_into_entry_id,'3');
 assert.deepEqual(result.byId.get('3').metadata.reference_aliases,['Account.Email','Login.Email']);assert.equal(result.byId.get('3').metadata.source_owners.length,2);assert.equal(result.byId.get('5').metadata.screen_name,'Account');assert.equal(result.byId.get('5').metadata.screen_entry_id,'1');assert.deepEqual(input,original);
 assert.deepEqual(project(result.all).all,result.all,'projection is stable across rereads');
});

test('equivalent native selector spellings reuse the curated object while distinct controls and matching modes stay separate',()=>{
 const input=[row('1','Account'),row('2','Account','#email'),row('3','New capture','locator("#email")'),
  row('4','Account','getByLabel("Email")'),row('5','New capture','label="Email"'),row('6','Account','getByLabel("Email",{exact:false})'),
  row('7','Account','locator("#email")',{metadata:{screen_name:'Account',object_name:'MobileEmail',platform:'android'}})];
 const result=project(input);
 assert.equal(result.byId.get('3').metadata.merged_into_entry_id,'2');
 assert.equal(result.byId.get('5').metadata.merged_into_entry_id,'4');
 assert.equal(result.byId.get('2').locator,'#email','curated selector is retained');
 assert.equal(result.byId.get('6').metadata.merged_into_entry_id,undefined,'fuzzy matching is a distinct contract');
 assert.equal(result.byId.get('7').metadata.merged_into_entry_id,undefined,'platforms remain separate');
 assert.deepEqual(project(result.all).all,result.all);
});

test('scope, blank URLs and meaningful query/fragment routes remain separate',()=>{
 const input=[row('1','First'),row('2','Other app','__screen__',{app_type_id:'other'}),row('3','Other project','__screen__',{project_id:'other'}),row('4','Blank A','__screen__',{page_url:null}),row('5','Blank B','__screen__',{page_url:'about:blank'}),row('6','Query','__screen__',{page_url:'https://app.test/account?mode=edit'}),row('7','Hash','__screen__',{page_url:'https://app.test/account#/edit'})];
 assert.equal(project(input).rows.length,input.length);assert.equal(canonicalPageUrl('https://APP.test:443/account'),'https://app.test/account');assert.equal(canonicalPageUrl('https://user:password@app.test'),null);assert.equal(canonicalPageUrl('about:blank'),null);
});

test('name collisions preserve distinct fields and cross-URL screens with deterministic names and aliases',()=>{
 const result=project([row('1','Account'),row('2','Login'),row('3','Account','#first'),row('4','Login','#second'),row('5','Account','__screen__',{page_url:'https://app.test/other'})]);
 assert.equal(result.byId.get('4').metadata.object_name,'Email 2');assert.ok(result.byId.get('4').metadata.reference_aliases.includes('Login.Email'));assert.equal(result.byId.get('5').metadata.screen_name,'Account 2');
 assert.deepEqual(project(result.all).all,result.all);
});

test('invalid foreign redirects and cycles never expose a foreign target or hang projection',()=>{
 const result=project([row('1','Account','#first',{metadata:{screen_name:'Account',merged_into_entry_id:'foreign'}}),row('foreign','Foreign','#foreign',{project_id:'other'}),row('cycle-a','Cycle','#a',{metadata:{screen_name:'Cycle',merged_into_entry_id:'cycle-b'}}),row('cycle-b','Cycle','#b',{metadata:{screen_name:'Cycle',merged_into_entry_id:'cycle-a'}})]);
 assert.equal(result.byId.get('1').metadata.merged_into_entry_id,undefined);assert.ok(result.rows.some(value=>value.id==='1'));assert.ok(result.rows.some(value=>value.id.startsWith('cycle')));
 const clean=repositoryInputMetadata({description:'Curated',reference_aliases:['Other.Secret'],merged_into_entry_id:'foreign',screen_aliases:['Other'],source_owners:[{entry_id:'foreign'}],repository_identity_version:99});assert.deepEqual(clean,{description:'Curated'});
});

test('new cross-URL screen and field names never steal existing canonical references',()=>{
 const existing=[row('z-screen','Account','__screen__',{created_at:new Date('2026-10-15T12:00:00Z')}),row('z-field','Account','#email',{created_at:new Date('2026-10-15T12:00:01Z')})];
 const pending=row('a-new','Account','#other',{page_url:'https://app.test/other',created_at:undefined,_pending:true});
 const result=project([...existing,pending]);
 assert.equal(result.byId.get('z-field').metadata.screen_name,'Account');
 assert.equal(result.byId.get('a-new').metadata.screen_name,'Account 2');
 const fieldCollision=project([...existing,row('a-new','Account','#other',{created_at:undefined,_pending:true})]);
 assert.equal(fieldCollision.byId.get('z-field').metadata.object_name,'Email');
 assert.equal(fieldCollision.byId.get('a-new').metadata.object_name,'Email 2');
 const dates=project([row('later','Account','__screen__',{created_at:new Date('2026-10-16T12:00:00Z')}),row('earlier','Account','__screen__',{created_at:new Date('2026-10-15T12:00:00Z')})]);
 assert.equal(dates.byId.get('later').metadata.merged_into_entry_id,'earlier');
 const legacyField=row('z-field','Account','#email',{created_at:new Date('2026-10-15T12:00:00Z')});
 const addedScreen=project([legacyField,row('a-screen','New capture name','__screen__',{created_at:undefined,_pending:true})]);
 assert.equal(addedScreen.byId.get('a-screen').metadata.screen_name,'Account','adding an explicit screen retains the established virtual screen name');
 assert.equal(addedScreen.byId.get('z-field').metadata.screen_entry_id,'a-screen');
});

test('sanitized query/hash routes remain separate from each other and curated generic screens without raw route data',()=>{
 const routeA='a'.repeat(64),routeB='b'.repeat(64);
 const screen=(id,digest)=>row(id,'app '+digest.slice(0,12),'__screen__',{metadata:{screen_name:'app '+digest.slice(0,12),record_kind:'screen',observed_route_sha256:digest}});
 const field=(id,parent,digest)=>row(id,'app '+digest.slice(0,12),'#email',{metadata:{screen_name:'app '+digest.slice(0,12),object_name:'Email',screen_entry_id:parent,...(digest?{observed_route_sha256:digest}:{})}});
 const input=[row('generic-screen','Curated generic'),row('generic-field','Curated generic','#email'),screen('route-a',routeA),field('field-a','route-a',routeA),screen('route-b',routeB),field('field-b','route-b',routeB)];
 const result=project(input);
 assert.equal(result.rows.length,6);assert.equal(result.byId.get('generic-field').metadata.screen_name,'Curated generic');
 assert.equal(result.byId.get('field-a').metadata.screen_entry_id,'route-a');assert.equal(result.byId.get('field-b').metadata.screen_entry_id,'route-b');
 assert.deepEqual(project(result.all).all,result.all);
 const inherited=project([...input,row('child','app '+routeA.slice(0,12),'#child',{metadata:{screen_name:'app '+routeA.slice(0,12),object_name:'Child',screen_entry_id:'route-a'}})]);
 assert.equal(inherited.byId.get('child').metadata.screen_entry_id,'route-a');
 const poisoned=project(input.map(value=>value.id==='field-a'?{...value,metadata:{...value.metadata,merged_into_entry_id:'field-b'}}:value));
 assert.equal(poisoned.byId.get('field-a').metadata.merged_into_entry_id,undefined,'route A cannot redirect to route B');
});
