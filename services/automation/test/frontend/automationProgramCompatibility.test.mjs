import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeSavedLocatorWrappers, playwrightRepositoryLocatorExpression } from '../../shared/automationProgramCompatibility.mjs';

test('saved semantic wrappers keep strict identity, explicit indices, data bindings and assertion contracts', () => {
  const source = `await page.locator('getByRole("textbox", {name:"Email"}).nth(1)').fill(params["r.email"]);\nawait expect(playwrightPage.locator('page.getByLabel("Password", {exact:false})')).not.toHaveValue("@t.secret");`;
  const result = canonicalizeSavedLocatorWrappers(source);
  assert.equal(result.changed, 2);
  assert.equal(result.source, 'await page.getByRole("textbox", { name: "Email", exact: true }).nth(1).fill(params["r.email"]);\nawait expect(playwrightPage.getByLabel("Password", { exact: false })).not.toHaveValue("@t.secret");');
  assert.deepEqual(canonicalizeSavedLocatorWrappers(result.source), { source: result.source, changed: 0 });
  assert.equal(canonicalizeSavedLocatorWrappers('```javascript\n' + source + '\n```').source, '```javascript\n' + result.source + '\n```');
  const multiline = 'await page.locator(\n`getByText("Ready")`\n).click();';
  assert.equal(canonicalizeSavedLocatorWrappers(multiline).source.split('\n').length, multiline.split('\n').length);
});

test('compatibility never evaluates selector code, discards constraints, descends into data strings or guesses scope', () => {
  globalThis.__selectorCompatibilitySideEffect = 0;
  for (const source of [
    `await page.locator('getByRole("button", {name:sideEffect()})').click();`,
    `await page.locator('getByRole("button", {name:"Save",checked:true})').click();`,
    `await page.locator('getByRole("button", {name:"Save",name:"Delete"})').click();`,
    `await page.locator('getByText(/Saved/)').click();`,
    `await page.locator('getByLabel("Email").filter({hasText:"Customer"})').click();`,
    `await page.locator('getByLabel("Email").nth(dynamicIndex)').click();`,
    `await page.locator('getByLabel("Email");globalThis.__selectorCompatibilitySideEffect++').click();`,
    `await page.locator('getByLabel("Email")', {hasText:'Customer'}).click();`,
    `await page.locator('#form').locator('getByLabel("Email")').click();`,
    `const example = 'page.locator("getByText(\\"Ready\\")")'; await page.locator('#save').click();`,
    `await page.locator('#field').fill('getByLabel("Email")');`
  ]) assert.deepEqual(canonicalizeSavedLocatorWrappers(source), { source, changed: 0 }, source);
  assert.equal(globalThis.__selectorCompatibilitySideEffect, 0);
  delete globalThis.__selectorCompatibilitySideEffect;
});

test('recording locator emission preserves observed exactness and indexing without implicit first matching', () => {
  assert.equal(playwrightRepositoryLocatorExpression('getByRole("button", {name:"Save",exact:false}).nth(2)'), 'page.getByRole("button", { name: "Save", exact: false }).nth(2)');
  assert.equal(playwrightRepositoryLocatorExpression('getByLabel("Email")'), 'page.getByLabel("Email", { exact: true })');
  assert.equal(playwrightRepositoryLocatorExpression('#email'), 'page.locator("#email")');
  assert.equal(playwrightRepositoryLocatorExpression('Login.Email'), 'page.locator("Login.Email")');
  assert.equal(playwrightRepositoryLocatorExpression('button.nth(3)'), 'page.locator("button").nth(3)');
  assert.equal(playwrightRepositoryLocatorExpression('page.locator("#email").nth(3)'), 'page.locator("#email").nth(3)');
  assert.equal(playwrightRepositoryLocatorExpression('label=Email'), 'page.getByLabel("Email", { exact: true })');
  assert.throws(() => playwrightRepositoryLocatorExpression('getByRole("button", {name:"Save",checked:true})'), /Unsupported semantic locator/);
});
