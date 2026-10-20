import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { writeFile, rm } from 'node:fs/promises';

const require = createRequire(new URL('../../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require('playwright');
const { readFieldValidationState } = require('../../services/automation/backend/lib/automationFieldValidity.js');
const root = new URL('../../', import.meta.url);
const fixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import {AuthProvider} from '/src/auth/AuthContext';
import {AuthPage} from '/pages/AuthPage';
import {api,sessionStorage as appSession} from '/src/lib/api';
import {platformApi} from '/api.client';
import '/src/styles.css';
localStorage.clear();sessionStorage.clear();appSession.clear();
window.fixtureCalls=[];
platformApi.auth.setup=async()=>({google:{enabled:false,clientId:null},emailVerification:{enabled:true,senderEmail:'fixture@example.test',senderName:'Fixture'}});
for(const method of ['requestSignupCode','requestPasswordResetCode'])api.auth[method]=async()=>{window.fixtureCalls.push(method);return {success:true}};
createRoot(document.getElementById('root')).render(<MemoryRouter><AuthProvider><AuthPage/></AuthProvider></MemoryRouter>);
`;

async function checkAssociations(page, id, valid) {
  const control = page.locator('#' + id);
  const associations = await control.evaluate(node => ({
    label: Array.from(node.labels || []).some(label => label.control === node),
    labelText: Array.from(node.labels || []).map(label => label.textContent?.replace(/\s+/g, ' ').replace(/\s*\*\s*$/, '').trim()).join(' '),
    controlCount: document.querySelectorAll('[id="' + CSS.escape(node.id) + '"]').length,
    references: (node.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean).map(id => ({ id, count: document.querySelectorAll('[id="' + CSS.escape(id) + '"]').length })),
    wrapperHasAria: Boolean(node.parentElement?.id.endsWith('-shell') && (node.parentElement.hasAttribute('aria-describedby') || node.parentElement.hasAttribute('aria-invalid')))
  }));
  assert.equal(associations.label, true, id + ' label focuses its real input');
  assert.equal(associations.labelText, id === 'new-password-input' ? 'New password' : id === 'verification-code-input' ? 'Verification code' : 'Password');
  assert.equal(associations.controlCount, 1, id + ' identifies one native input');
  assert.ok(associations.references.length > 0);
  assert.ok(associations.references.every(reference => reference.count === 1), id + ' has no dangling/ambiguous hint or error');
  assert.equal(associations.wrapperHasAria, false, 'input validation metadata does not move to its decorative wrapper');
  assert.equal(await control.evaluate(readFieldValidationState), valid, id + ' preserves selected-field validation semantics');
  await page.locator('label[for="' + id + '"]').click();
  assert.equal(await control.evaluate(node => document.activeElement === node), true);
}

test('actual login, signup, reset and code inputs retain valid labels and field-validation associations', { timeout: 90_000 }, async () => {
  const name = 'auth-field-associations-' + randomUUID(); let browser;
  try {
    await writeFile(new URL(name + '.tsx', root), fixture);
    await writeFile(new URL(name + '.html', root), '<!doctype html><html><body><div id="root"></div><script type="module" src="/' + name + '.tsx"></script></body></html>');
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
    const page = await browser.newPage();page.setDefaultTimeout(12_000);
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => { requests.push(new URL(route.request().url()).pathname);return route.abort(); });
    await page.goto((process.env.VITE_TEST_URL || 'http://127.0.0.1:5197') + '/' + name + '.html');
    await page.getByRole('heading', { name: 'Welcome back', exact: true }).waitFor();
    await page.locator('#password-input').fill('Fixture password');
    await checkAssociations(page, 'password-input', true);
    await page.getByRole('button', { name: 'Show password', exact: true }).click();
    assert.equal(await page.locator('#password-input').getAttribute('type'), 'text');
    await checkAssociations(page, 'password-input', true);

    await page.getByRole('button', { name: 'Sign up', exact: true }).click();
    await page.locator('#password-input').fill('x');await page.locator('#email-input').click();
    await checkAssociations(page, 'password-input', false);
    await page.locator('#password-input').fill('Fixture password');await page.locator('#email-input').click();
    await checkAssociations(page, 'password-input', true);
    await page.locator('#email-input').fill('fixture@example.test');
    await page.getByRole('button', { name: 'Sign Up', exact: true }).click();
    await page.getByRole('heading', { name: 'Enter your signup code', exact: true }).waitFor();
    await page.locator('#verification-code-input').fill('123456');
    await checkAssociations(page, 'verification-code-input', true);
    await page.locator('#verification-code-input').fill('1');await page.getByRole('heading', { name: 'Enter your signup code', exact: true }).click();
    await checkAssociations(page, 'verification-code-input', false);

    await page.getByRole('button', { name: 'Change details', exact: true }).click();
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('button', { name: 'Forgot password?', exact: true }).click();
    await page.locator('#new-password-input').fill('x');await page.locator('#email-input').click();
    await checkAssociations(page, 'new-password-input', false);
    await page.locator('#new-password-input').fill('Fixture reset password');await page.locator('#email-input').click();
    await checkAssociations(page, 'new-password-input', true);
    await page.locator('#email-input').fill('fixture@example.test');
    await page.getByRole('button', { name: 'Send reset code', exact: true }).click();
    await page.getByRole('heading', { name: 'Enter your reset code', exact: true }).waitFor();
    await page.locator('#verification-code-input').fill('123456');
    await checkAssociations(page, 'verification-code-input', true);
    assert.deepEqual(await page.evaluate(() => window.fixtureCalls), ['requestSignupCode', 'requestPasswordResetCode']);
    assert.deepEqual(errors, []);assert.deepEqual(requests, [], 'email/auth APIs are entirely isolated fixture calls');
  } finally {
    await browser?.close();await Promise.all(['tsx', 'html'].map(extension => rm(new URL(name + '.' + extension, root), { force: true })));
  }
});
