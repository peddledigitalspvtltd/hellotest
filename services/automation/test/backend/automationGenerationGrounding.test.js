const test=require('node:test'),assert=require('node:assert/strict');
const {navigationOrigins,validateNavigationGrounding,scopeRepositoryToTarget,buildNavigationOrigins}=require('../../backend/lib/automationGenerationGrounding');
test('generated navigation must use supplied or observed origins rather than invented external mailboxes',()=>{
 const origins=navigationOrigins('https://app.hellotest.ai/',{user_guidance:'Use https://inbox.test/account for email evidence.'},[{result:{content:[{type:'text',text:'{"url":"https://observed.test/"}'}]}}]);
 for(const code of ['await web.openTab("https://mail.example.com");','const inbox="https://mail.example.com";await page.goto(inbox);','await playwrightPage.goto(`https://mail.example.com`);'])assert.throws(()=>validateNavigationGrounding(code,origins),error=>error.code==='AUTOMATION_UNGROUNDED_NAVIGATION');
 for(const code of ['await page.goto("https://app.hellotest.ai/signup");','await web.openTab("https://inbox.test/account");','await page.goto("https://observed.test/after-sign-in");','await page.goto("/signup");','await web.openTab(params["t.mailbox_url"]);','await page.goto("@e.base_url/signup");'])assert.doesNotThrow(()=>validateNavigationGrounding(code,origins));
 assert.ok(!navigationOrigins({screenshot_url:'https://irrelevant.test/image',image:{type:'image',data:'https://image-payload.test'},secret:'https://user:password@private.test'}).size);
 assert.ok(navigationOrigins({data:{mailbox_url:'https://configured-data.test/inbox'}}).has('https://configured-data.test'));
 assert.doesNotThrow(()=>validateNavigationGrounding('await page.goto("http://[::1]:4313/fixture");',navigationOrigins('http://[::1]:4313/')));
});
test('a selected browser target excludes unrelated app-wide signup screens and locator records',()=>{
 const rows=[{id:'target',page_url:'https://app.test/signup',metadata:{page_identity:'https://app.test/signup'}},{id:'other-case',page_url:'https://signup.other-provider.test/',metadata:{record_kind:'screen'}},{id:'frame',page_url:'https://captcha.test/',metadata:{record_kind:'screen'}},{id:'unknown',page_key:'Signup'},{id:'conflict',page_url:'https://app.test/signup',metadata:{url_pattern_value:'https://signup.other-provider.test/'}}];
 assert.deepEqual(scopeRepositoryToTarget(rows,'https://app.test/').map(row=>row.id),['target']);
 assert.equal(scopeRepositoryToTarget(rows,null),rows,'API/native context without browser target retains its ordinary scope');
});
test('cache, document links and parameter URLs cannot authorize a different signup target',()=>{
 const origins=buildNavigationOrigins({startUrl:'https://app.test/',parameters:{'t.portal':'https://signup.other-provider.test'},cache:[{page_url:'https://signup.other-provider.test'}],observations:[{result:{content:[{type:'text',text:JSON.stringify({url:'https://app.test/signup',elements:[{href:'https://captcha.test'}]})}]}}]});
 assert.deepEqual([...origins],['https://app.test']);
 assert.throws(()=>validateNavigationGrounding('await page.goto(params["t.portal"]);',origins,{parameters:{'t.portal':'https://signup.other-provider.test'}}),error=>error.code==='AUTOMATION_UNGROUNDED_NAVIGATION');
 assert.throws(()=>validateNavigationGrounding('await page.goto("@t.portal");',origins,{resolveText:value=>value.replace('@t.portal','https://signup.other-provider.test')}));
 assert.doesNotThrow(()=>validateNavigationGrounding('await page.goto(`${params["t.portal"]}/signup`);',origins,{parameters:{'t.portal':'https://app.test'}}));
 const explicit=buildNavigationOrigins({startUrl:'https://app.test',additionalContext:'Use the authorized test inbox at https://inbox.test.'});
 assert.ok(explicit.has('https://inbox.test'),'a deliberate user source retains its explicit navigation intent');
});
