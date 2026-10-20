const test=require('node:test'),assert=require('node:assert/strict');
const {compileRecordedProgram}=require('../../backend/lib/automationRecordedProgram');
const {deriveProgramTools}=require('../../backend/lib/automationProgramTools');
const {prepareVerificationSections}=require('../../backend/lib/automationVerificationPipeline');
const {parameterReference,referenceKey,createBrowserParameterResolver}=require('../../backend/lib/automationBrowserParameters');

const lower=source=>deriveProgramTools({payload:{steps:[{step_id:'step',automation_code:source}]},execution:{required:true,step_id:'step'}});
const operation=(assertion,value)=>({name:'browser_assert',arguments:{assertion,...(!['url','url_contains','title','title_normalized'].includes(assertion)?{locator:'getByRole("alert", {name:"Notice",exact:true})'}:{}),...(value===undefined?{}:{value})}});
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).filter(([key])=>!['start','end','raw'].includes(key)).map(([key,item])=>[key,stable(item)])):value;
const ast=source=>stable(require('acorn').parse(source,{ecmaVersion:'latest',sourceType:'module',allowAwaitOutsideFunction:true}));

test('the host compiler round trips every saved assertion mode through verification without dropping checks',()=>{
 const fixtures=[
  ...['visible','hidden','enabled','disabled','checked','unchecked','valid','invalid','field_valid'].map(mode=>operation(mode)),
  ...['text','text_contains','text_content','text_content_contains','value','title','title_normalized'].flatMap(mode=>['Expected message','@r.message','params["r.message"]'].map(value=>operation(mode,value))),
  ...['url','url_contains'].flatMap(mode=>['https://app.test/login','@r.target','params["r.target"]'].map(value=>operation(mode,value))),
  ...['0','2','@r.count','params["r.count"]'].map(value=>operation('count',value))
 ];
 const values={'r.message':'Expected message','r.target':'https://app.test/login','r.count':'2'};
 for(const fixture of fixtures){
  const compiled=compileRecordedProgram([fixture]);assert.ok(compiled,JSON.stringify(fixture));
  const lowered=lower(compiled.source);assert.ok(lowered,fixture.arguments.assertion+' '+fixture.arguments.value);
  assert.equal(lowered.length,1);assert.equal(lowered[0].arguments.assertion,fixture.arguments.assertion);
  const prepared=prepareVerificationSections([{id:'step',step_type:'web',automation_code:compiled.source}],{resolve:(_name,args)=>({...args,value:values[args.value.replace(/^@/,'').replace(/^params\["|"\]$/g,'')]??args.value})});
  assert.equal(prepared.sections[0].operations.length,1);assert.deepEqual(ast(compileRecordedProgram(prepared.sections[0].operations).source),ast(compiled.source));
 }
});

test('canonical visible-text lowering keeps the visibility gate, normalization, subject, matcher and expected binding',()=>{
 const compiled=compileRecordedProgram([operation('text_contains','@r.message')]).source;
 const rejected=[
  compiled.replace('&&','||'),compiled.replace('.includes(','.startsWith('),compiled.replace('.toBe(true)','.toBe(false)'),
  compiled.replace('.isVisible()', '.isEnabled()'),compiled.replace('replace(/\\s+/g, " ")','replace(/x/g, " ")'),
  compiled.replace('String(params["r.message"])','String(params["r.message"]).toLowerCase()'),
  compiled.replace('async () =>','async () => { await page.getByRole("button").click(); return').replace(')).toBe(true);','); }).toBe(true);')
 ];
 for(const source of rejected)assert.equal(lower(source),null,source);
 const pagePoll=compileRecordedProgram([operation('url','https://app.test/login')]).source;
 for(const source of [pagePoll.replace('() => page.url()','() => { page.reload(); return page.url(); }'),pagePoll.replace('.toBe(','.not.toBe('),pagePoll.replace('page.url()','page.title()'),pagePoll.replace('expect.poll(', 'expect.poll(()=>undefined,')]){
  // A canonical title read is a different, faithfully represented operation;
  // it may lower, but never as the original URL oracle.
  const result=lower(source);assert.ok(result===null||result[0].arguments.assertion!=='url');
 }
});

test('scoped bracketed, dotted and escaped names round trip with their exact frozen namespace and value',()=>{
 const scopes=['t','s','r'];
 const names=['customer name','account.code','closing]bracket','path\\segment','quoted"name',"apostrophe'name"];
 const modes=['text','text_contains','text_content','text_content_contains','value','title','title_normalized','url','url_contains','count'];
 for(const name of names)for(const mode of modes){
  const frozen=Object.fromEntries(scopes.map((scope,index)=>[`${scope}.${name}`,mode==='count'?String(index+1):['url','url_contains'].includes(mode)?`https://fixture.test/${scope}`:`Frozen ${scope} value containing @r.unrelated`]));
  const resolver=createBrowserParameterResolver({caseValues:frozen,materialize:false});
  for(const scope of scopes){
   const key=`${scope}.${name}`;
   for(const value of [parameterReference(key),`params[${JSON.stringify(key)}]`]){
    const compiled=compileRecordedProgram([operation(mode,value)]);assert.ok(compiled,`${mode} ${value}`);
    const lowered=lower(compiled.source);assert.ok(lowered,`${mode} ${value}`);
    assert.equal(lowered.length,1);assert.equal(lowered[0].arguments.assertion,mode);assert.equal(referenceKey(lowered[0].arguments.value),key);
    const prepared=prepareVerificationSections([{id:'step',step_type:'web',automation_code:compiled.source}],resolver);
    assert.deepEqual({...prepared.parameters},{[key]:frozen[key]},'one exact scope is frozen without substituting another namespace or rescanning inserted @tokens');
    assert.equal(prepared.sections[0].automation_code,compiled.source);
    assert.deepEqual(ast(compileRecordedProgram(prepared.sections[0].operations).source),ast(compiled.source));
   }
  }
 }
});

test('unscoped, empty and dynamic parameter member expressions cannot enter the closed program',()=>{
 const rejected=[
  'params["message"]','params["x.message"]','params["r."]','params["r.   "]','params["r.\\nmessage"]',
  'params["r.message" + ""]','params[key]','params[getKey()]','params.r.message','params?.["r.message"]','other["r.message"]'
 ];
 for(const value of rejected){
  assert.equal(lower(`await page.locator("#message").fill(${value});`),null,value);
  for(const mode of ['text','url','title','count']){
   const source=compileRecordedProgram([operation(mode,'params["r.message"]')]).source.replaceAll('params["r.message"]',value);
   assert.equal(lower(source),null,mode+' '+value);
  }
 }
});
