import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require('playwright'), { expect } = require('playwright/test');
const root = new URL('../../../platform/frontend/', import.meta.url);
test('queued automated cases disable manual Start and outcome controls while manual cases remain executable', {timeout:60000}, async () => {
  const source = await readFile(new URL('./runCatalogDetails.test.mjs',import.meta.url),'utf8');
  let fixture = runInNewContext(source.match(/const fixtureSource\s*=\s*(`[\s\S]*?`);/)[1]);
  fixture = fixture.replace('test_case_description: item.description, priority:', "test_case_description: item.description, automated: i === 5 ? 'yes' : 'no', priority:");
  const name = 'automation-case-ownership-'+randomUUID(); let browser;
  try {
    await writeFile(new URL(name+'.tsx',root),fixture);
    await writeFile(new URL(name+'.html',root),`<!doctype html><html><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    browser = await chromium.launch({headless:true,...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{})});
    const page = await browser.newPage({viewport:{width:1440,height:1000}}); const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    const route = testCase => `${process.env.VITE_TEST_URL||'http://127.0.0.1:5197'}/${name}.html?route=${encodeURIComponent('/executions?view=test-case-runs&execution=running&testCase='+testCase)}`;
    await page.goto(route('case-6'));
    const controls = page.getByLabel('Case execution controls');
    await expect(controls.getByRole('button',{name:'Start case',exact:true})).toBeDisabled();
    await expect(controls.getByLabel('Set case outcome')).toBeDisabled();
    await expect(page.getByText('TestEngine starts this automated case and records its outcome.',{exact:false})).toBeVisible();
    await page.goto(route('case-1'));
    await expect(page.getByLabel('Case execution controls').getByRole('button',{name:'Start new attempt',exact:true})).toBeEnabled();
    await expect(page.getByLabel('Set case outcome')).toBeEnabled();
    assert.deepEqual(errors,[]);
  } finally {
    await browser?.close();
    await Promise.all([rm(new URL(name+'.tsx',root),{force:true}),rm(new URL(name+'.html',root),{force:true})]);
  }
});
