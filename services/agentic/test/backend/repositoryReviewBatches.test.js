const test=require('node:test'),assert=require('node:assert/strict');
const {reviewBatches}=require('../../backend/agents/reviewBatches');
const base={id:'finding-a',title:'Source finding',evidence:[{path:'source.tsx',line:2}],review_required:true};
test('source review batches preserve API schemas and statuses, exact locators, component assertions and knowledge contents',()=>{
 const domains=[
  {...base,parameters:[{name:'id',in:'path',schema:{minimum:1}}],body_schema:null,declared_statuses:[200,404],declared_responses:[{status:200,content:[{content_type:'application/json',schema:{required:['id','name','price']}}]},{status:404,content:[],body_schema_declared:false}]},
  {...base,locator:'getByTestId("product-price")',object_role:'generic',page_url:'/product'},
  {...base,assertions:[{kind:'visibility',locator:'getByTestId("product-price")',expected:'visible'}]},
  {...base,content:'# ProductCard\nField notebook costs $42. No checkout implementation.',source_uri:'repository://source/ProductCard.tsx',metadata:{repository_file:'ProductCard.tsx'}}
 ];
 for(const domain of domains){const [[item]]=reviewBatches([domain]);assert.deepEqual(item,domain);assert.notEqual(item,domain);}
});
test('oversized source prose is visibly excerpted and never mutates the native artifact',()=>{
 const source={...base,content:'x'.repeat(20000)};
 const [[item]]=reviewBatches([source]);assert.equal(item.content.length,4000);assert.equal(item.content_excerpt,true);assert.equal(item.review_excerpt,true);
 assert.equal(source.content.length,20000);assert.equal(source.review_excerpt,undefined);
});
test('structured contracts that cannot fit fail instead of silently discarding schemas',()=>{
 const source={...base,declared_responses:Array.from({length:1000},(_,index)=>({status:200,schema:{description:'Response property '+index+'x'.repeat(20)}}))};
 assert.throws(()=>reviewBatches([source]),/cannot fit/);
});
test('retained source contents and nested response schemas redact credential literals before model review',()=>{
 const token='sk-'+ 'A'.repeat(28),password='fixture-password-value',authorization='Basic '+Buffer.from('private:password').toString('base64');
 const source={...base,content:`const key = "${token}";\nconst headers={"Authorization":"${authorization}"};\nconst password="${password}";\nconst url="https://user:private@host.test/path?token=private-query";`,
  declared_responses:[{status:200,content:[{content_type:'application/json',schema:{properties:{session:{enum:[token]},password:{type:'string',enum:[password]}}}}]}],
  metadata:{repository_file:'source.tsx',private_credentials:{password}},arbitrary_payload:{password}};
 const [[item]]=reviewBatches([source]);const encoded=JSON.stringify(item);
 for(const secret of [token,password,authorization,'private-query','user:private'])assert.equal(encoded.includes(secret),false,secret);
 assert.equal(item.review_redacted,true);assert.equal(item.arbitrary_payload,undefined);assert.equal(item.metadata.private_credentials,undefined);
 assert.equal(item.declared_responses[0].content[0].schema.properties.password.type,'string');
 assert.equal(source.content.includes(password),true,'Projection must not mutate the retained native source record.');
});
