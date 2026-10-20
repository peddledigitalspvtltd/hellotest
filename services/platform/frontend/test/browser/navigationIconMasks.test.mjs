import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const root=resolve(import.meta.dirname,'../..');
const require=createRequire(root+'/package.json');
const {chromium}=createRequire(resolve(root,'../../../testengine/backend/package.json'))('playwright');
const ts=require('typescript');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const filename=resolve(root,'src/platform/components/AppIcons.tsx');
const source=ts.transpileModule(readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const module={exports:{}};
new Function('require','module','exports',source)(id=>id.endsWith('.svg')?{default:'data:image/svg+xml,'+encodeURIComponent(readFileSync(resolve(root,'src/platform/components',id),'utf8'))}:id.endsWith('.png')?{default:'data:image/png;base64,'+readFileSync(resolve(root,'src/platform/components',id)).toString('base64')}:require(id),module,module.exports);
test('reference navigation icons share transparent SVG masks in both themes',{timeout:30000},async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
 try{
  const page=await browser.newPage({viewport:{width:520,height:240},deviceScaleFactor:2});
  const names=['ProjectOverviewIcon','AiAgentStudioIcon','TestPlanIcon'];
  const icons=names.map(name=>`<div data-icon="${name}" style="display:flex;align-items:center;gap:16px;margin:16px">${renderToStaticMarkup(React.createElement(module.exports[name]))}<span>${name}</span></div>`).join('');
  for(const theme of ['light','dark']){
   await page.setContent(`<body style="margin:0;font:16px system-ui;background:${theme==='dark'?'#172630':'#fff'};color:${theme==='dark'?'#e5edf0':'#42526e'}">${icons}</body>`);
   for(const name of names){const icon=page.locator(`[data-icon="${name}"] > span`).first();
    assert.notEqual(await icon.evaluate(el=>getComputedStyle(el).maskImage),'none',`${name}: SVG mask must parse rather than becoming a square`);
    assert.equal(await icon.evaluate(el=>getComputedStyle(el).backgroundImage),'none','Navigation icons use the inherited colour with no image background');
    assert.equal((await icon.boundingBox()).width,24);assert.equal((await icon.boundingBox()).height,24);
   }
   await page.screenshot({path:`/tmp/navigation-icon-masks-${theme}.png`});
  }
 }finally{await browser.close();}
});
