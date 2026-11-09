import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { chromium } from 'playwright';
import { validateInspectionLocatorCandidates } from '../../dist/lib/inspectionLocatorCandidates.js';
import { resolveRepositoryLocator } from '../../dist/lib/repositoryLocator.js';
const require=createRequire(import.meta.url),ts=require('typescript');
const source=await readFile(new URL('../../src/lib/recorder.ts',import.meta.url),'utf8');
const declaration=source.slice(source.indexOf('const installInspectMode ='),source.indexOf('const captureValidatedRepositoryLocator ='));
const module={exports:{}};
vm.runInNewContext(ts.transpileModule(declaration+'\nexports.installInspectMode=installInspectMode;',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports:module.exports});

test('captured locators identify only the clicked field using actual Playwright semantics, including password and duplicate contracts',async t=>{
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const page=await browser.newPage();
  await page.setContent('<form><label for="password">Password</label><input id="password" type="password" data-test="duplicate"><input id="other" data-test="duplicate"><div id="card" role="group" aria-label="Account"><input aria-label="Nested input"></div></form>');
  const inspect=async selector=>{
    await module.exports.installInspectMode(page);
    // Install a deliberately unsuitable recorder heuristic. Inspection must
    // capture the selected node rather than redirecting it to a descendant.
    await page.evaluate(()=>{window.__hellotestRecorderLocatorFor=()=> 'getByTestId("duplicate")';});
    await page.locator(selector).click();
    const field=await page.evaluate(()=>window.__hellotestInspectSelections.at(-1));
    const candidates=await validateInspectionLocatorCandidates(page,field.locator_candidates,field.selection_token);
    assert.ok(candidates.length);
    for(const candidate of candidates)assert.equal(candidate.matchCount,await resolveRepositoryLocator(page,candidate.locator).count());
    const primary=resolveRepositoryLocator(page,candidates[0].locator);
    assert.equal(await primary.count(),1);assert.equal(await primary.getAttribute('id'),selector.slice(1));
    const withWrongTarget=await validateInspectionLocatorCandidates(page,[...field.locator_candidates,{locator:'#other',confidenceScore:1,matchCount:1,warning:null,recommended:true}],field.selection_token);
    assert.ok(!withWrongTarget.some(row=>row.locator==='#other'),'a unique locator for a different field cannot become a fallback');
    return candidates;
  };
  const password=await inspect('#password');
  assert.ok(!password.some(row=>row.locator.startsWith('getByTestId')),'data-test is not data-testid');
  assert.equal(password.find(row=>row.locator==='[data-test="duplicate"]').matchCount,2);
  const group=await inspect('#card');assert.ok(group[0].locator.includes('group')||group[0].locator==='#card');
});
