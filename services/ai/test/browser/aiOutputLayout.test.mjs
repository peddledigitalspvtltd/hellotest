import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {randomUUID} from 'node:crypto';
const require=createRequire(new URL('../../../../testengine/backend/package.json',import.meta.url));
const {chromium}=require('playwright');
const root=new URL('../../../platform/frontend/',import.meta.url);

test('long Story proposals keep every field reachable and review actions visible at all viewport sizes',{timeout:90000},async()=>{
 const source=await readFile(new URL('test/browser/storyAiWorkbench.test.mjs',root),'utf8');
 let fixture=runInNewContext(source.match(/const fixture = (`[\s\S]*?`);\n/)[1]);
 fixture=fixture.replace('function App(){',`drafts.forEach(d=>{d.description=Array.from({length:12},(_,i)=>'Paragraph '+(i+1)+': Review the recorded run, its available evidence and the expected execution outcomes. Preserve the selected project and explain unavailable information.').join('\\n\\n');d.acceptanceCriteria=Array.from({length:16},(_,i)=>'Criterion '+(i+1)+': The selected run displays authorized evidence, explicit outcomes, the latest execution details and a clear explanation of any unavailable records.');});function App(){`);
 const name='ai-output-layout-'+randomUUID();let browser;
 try{
  await writeFile(new URL(name+'.tsx',root),fixture);
  await writeFile(new URL(name+'.html',root),`<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
  await mkdir('/tmp/ai-output-layout',{recursive:true});
  browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
  for(const mode of ['create','improve']){
   const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});const errors=[];page.on('pageerror',error=>errors.push(error.message));
   await page.goto(`${process.env.VITE_TEST_URL||'http://127.0.0.1:5197'}/${name}.html?mode=${mode}`);await page.locator('.ai-proposal-review-toolbar').waitFor();
   for(const width of [1440,768,390]){
    await page.setViewportSize({width,height:900});
    await page.waitForFunction(()=>Array.from(document.querySelectorAll('textarea[data-ai-auto-size]')).every(e=>e.clientHeight+2>=e.scrollHeight));
    const footer=page.locator('.ai-test-generator-modal > .ai-test-generator-footer');await footer.waitFor();
    await page.screenshot({animations:'disabled',path:`/tmp/ai-output-layout/${mode}-${width}-top.png`});
    const before=await footer.boundingBox();assert.ok(before.y>=0&&before.y+before.height<=900,'Review footer stays in view');
    assert.ok(await page.locator('.ai-artifact-detail').evaluate(e=>parseFloat(getComputedStyle(e).paddingLeft)>=14),'Proposal has a readable inset');
    if(mode==='improve'){
     await page.getByRole('button',{name:'Compare changes',exact:true}).click();
     const compare=page.getByRole('region',{name:'Current and proposed content'});await compare.waitFor();
     assert.equal(await page.locator('.ai-proposal-review-toolbar').evaluate(e=>e.nextElementSibling.classList.contains('ai-proposal-compare')),true,'Comparison follows its review toolbar');
     if(width===390)assert.equal(await compare.locator('.ai-proposal-compare__field').first().evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length),1);
     await page.getByRole('button',{name:'Hide comparison',exact:true}).click();
    }
    await page.locator('.ai-test-generator-workspace').evaluate(e=>e.scrollTop=e.scrollHeight);
    const last=page.getByLabel('Acceptance criterion 16',{exact:true});await last.scrollIntoViewIfNeeded();
    assert.equal(await last.evaluate(e=>e.clientHeight+2>=e.scrollHeight),true,'The final criterion has no hidden lines');
    assert.equal(await last.evaluate(e=>{const control=e.closest('li').querySelector('button');return e.getBoundingClientRect().right<=control.getBoundingClientRect().left;}),true,'Remove controls do not cover criterion text');
    const after=await footer.boundingBox();assert.ok(Math.abs(before.y-after.y)<2,'Proposal scrolling does not move the review footer');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({animations:'disabled',path:`/tmp/ai-output-layout/${mode}-${width}-end.png`});
    await page.locator('.ai-test-generator-workspace').evaluate(e=>e.scrollTop=0);
   }
   assert.deepEqual(errors,[]);await page.close();
  }
 }finally{await browser?.close();await Promise.all([rm(new URL(name+'.tsx',root),{force:true}),rm(new URL(name+'.html',root),{force:true})]);}
});
