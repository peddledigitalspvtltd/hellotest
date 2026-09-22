import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { writeFile, rm, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const require = createRequire(new URL('../../../testengine/backend/package.json', import.meta.url));
const { chromium } = require('playwright');
const root = new URL('../../', import.meta.url);
const screenshotDir = process.env.AUTH_SCREENSHOT_DIR || '/tmp/qaira-auth-manual';
const assertBrandLayout = async page => {
  const mark = await page.locator('.auth-card-brand .hellotest-brand-q').boundingBox();
  const name = await page.locator('.auth-card-brand .hellotest-brand-copy strong').boundingBox();
  const subtitle = await page.locator('.auth-card-brand .hellotest-brand-copy small').boundingBox();
  assert.ok(mark.x + mark.width <= name.x && Math.abs(mark.y + mark.height / 2 - name.y - name.height / 2) < 18, 'Target mark and HelloTest stay beside each other');
  assert.ok(subtitle.y >= name.y + name.height && Math.abs(subtitle.x - name.x) < 2, 'Tagline aligns beneath the wordmark');
};
const makeFixture = (component = '/src/pages/AuthPage') => `
import React from 'react';import{createRoot}from'react-dom/client';import{createMemoryRouter,RouterProvider}from'react-router-dom';
import{AuthPage}from'${component}';import{AuthProvider}from'/src/auth/AuthContext';import{api,sessionStorage}from'/src/lib/api';
import'@fontsource/inter/400.css';import'@fontsource/inter/500.css';import'@fontsource/inter/600.css';import'@fontsource/inter/700.css';
import'/src/styles.css';import'/src/dark-theme.css';import'/src/modal-system.css';
sessionStorage.clear();window.authCalls=[];window.rejectLogin=false;
api.auth.setup=async()=>({google:{enabled:false,clientId:null},emailVerification:{enabled:true,senderEmail:'hello@example.test',senderName:'HelloTest'}});
api.auth.login=async input=>{window.authCalls.push({kind:'login',input});if(window.rejectLogin)throw new Error('Email or password is incorrect.');return{token:'fixture-only',user:{id:'author',name:'Author',role:'user'}}};
api.auth.requestSignupCode=async input=>{window.authCalls.push({kind:'signup',input});return{success:true}};
api.auth.requestPasswordResetCode=async input=>{window.authCalls.push({kind:'reset',input});return{success:true}};
api.auth.verifySignupCode=api.auth.verifyPasswordResetCode=async()=>({success:true});
const router=createMemoryRouter([{path:'/auth',element:<AuthPage/>},{path:'/',element:<h1>Signed in workspace</h1>}],{initialEntries:['/auth']});
createRoot(document.getElementById('root')).render(<AuthProvider><RouterProvider router={router}/></AuthProvider>);`;

test('Login uses a manual navy-and-green coverflow while sign-in stays usable across themes and mobile', { timeout: 120000 }, async () => {
  const files = [];
  let browser;
  let activePage;
  const errors = [];
  const makePage = async (name, fixture, options) => {
    const tsx = new URL(name + '.tsx', root), html = new URL(name + '.html', root);
    files.push(tsx, html);
    await writeFile(tsx, fixture);
    await writeFile(html, `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1" /></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    const { installClock, ...pageOptions } = options;
    const page = await browser.newPage(pageOptions);
    page.setDefaultTimeout(10000);
    activePage = page;
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => { errors.push('Unexpected API ' + route.request().url()); return route.abort(); });
    if (installClock) await page.clock.install();
    await page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5189'}/${name}.html`);
    await page.getByRole('heading', { name: 'Welcome back', exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    return page;
  };
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
    await mkdir(screenshotDir, { recursive: true });
    if (process.env.AUTH_CAPTURE_BASELINE) {
      const baseName = 'AuthBaseline-' + randomUUID();
      const baseline = new URL(`src/pages/${baseName}.tsx`, root);
      files.push(baseline);
      await writeFile(baseline, execFileSync('git', ['show', 'HEAD:frontend/src/pages/AuthPage.tsx'], { cwd: root, encoding: 'utf8' }));
      const page = await makePage('auth-before-' + randomUUID(), makeFixture('/src/pages/' + baseName), { viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
      await page.screenshot({ path: screenshotDir + '/before-1440.png', fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: screenshotDir + '/before-390.png', fullPage: true });
      await page.close();
    }
    const page = await makePage('auth-features-' + randomUUID(), makeFixture(), { viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const carousel = page.getByRole('region', { name: 'HelloTest product features' });
    const activeCard = page.locator('.auth-feature-card[data-position="0"]');
    assert.equal(await carousel.locator('.auth-feature-card').count(), 5);
    assert.equal(await carousel.locator('.auth-feature-card[aria-hidden="false"]').count(), 1);
    assert.equal(await carousel.getByRole('button', { name: /play|pause/i }).count(), 0, 'Playback controls are removed');
    assert.equal(await activeCard.evaluate(el => getComputedStyle(el).transitionDuration), '0s');
    assert.equal(await carousel.locator('.auth-coverflow-status').innerText(), '01 / 05 · Story refinement');
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        await page.evaluate(() => window.scrollTo(0, 0));
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, `${theme} ${width}: no horizontal overflow`);
        const submit = await page.getByRole('button', { name: 'Sign in to HelloTest', exact: true }).boundingBox();
        assert.ok(submit && submit.y >= 0 && submit.y + submit.height <= (width === 390 ? 844 : 900), `${theme} ${width}: sign-in visible without scrolling`);
        const email = await page.getByRole('textbox', { name: 'Email', exact: false }).boundingBox();
        assert.ok(email.width > 250);
        const google = await page.getByRole('button', { name: 'Continue with Google', exact: true }).boundingBox();
        const divider = await page.locator('.auth-provider-divider').boundingBox();
        assert.ok(google.y + google.height <= divider.y && divider.y + divider.height <= email.y, 'Google and the email divider precede the email form');
        await assertBrandLayout(page);
        assert.equal(await activeCard.evaluate(el => el.scrollHeight <= el.clientHeight + 1), true, 'Feature card content fits');
        await page.screenshot({ path: `${screenshotDir}/${theme}-${width}.png`, fullPage: true, animations: 'disabled' });
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => document.documentElement.dataset.theme = 'light');
    await carousel.getByRole('button', { name: 'Next feature', exact: true }).click();
    assert.match(await activeCard.innerText(), /Turn intent into coverage/);
    await carousel.getByRole('button', { name: 'Previous feature', exact: true }).click();
    assert.match(await activeCard.innerText(), /Start with a clearer Story/);
    await carousel.getByRole('button', { name: 'Show Agent workflows', exact: true }).click();
    assert.match(await activeCard.innerText(), /Build your team's QA flow/);
    await page.keyboard.press('ArrowRight');
    assert.match(await activeCard.innerText(), /Start with a clearer Story/);
    await page.keyboard.press('End');
    assert.match(await activeCard.innerText(), /Build your team's QA flow/);
    await page.keyboard.press('Home');
    assert.match(await activeCard.innerText(), /Start with a clearer Story/);
    assert.equal(await page.evaluate(() => window.authCalls.length), 0, 'Carousel controls never submit credentials');
    await page.getByRole('button', { name: 'Sign up', exact: true }).click();
    await page.getByRole('heading', { name: 'Set up your HelloTest access', exact: true }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: 'Full name', exact: true }).isVisible(), true);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('button', { name: 'Forgot password?', exact: true }).click();
    await page.getByRole('heading', { name: 'Reset your password', exact: true }).waitFor();
    assert.equal(await page.locator('#new-password-input').isVisible(), true);
    assert.equal(await page.getByRole('button', { name: 'Continue with Google', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Back to login', exact: true }).click();
    await page.getByRole('button', { name: 'Sign in to HelloTest', exact: true }).click();
    await page.getByText('Email is required.', { exact: true }).waitFor();
    await page.getByRole('textbox', { name: 'Email', exact: false }).fill('author@example.test');
    await page.locator('#password-input').fill('fixture-password');
    await page.getByRole('button', { name: 'Show password', exact: true }).click();
    assert.equal(await page.locator('#password-input').getAttribute('type'), 'text');
    await page.getByRole('button', { name: 'Hide password', exact: true }).click();
    await page.evaluate(() => window.rejectLogin = true);
    await page.getByRole('button', { name: 'Sign in to HelloTest', exact: true }).click();
    await page.getByText('Email or password is incorrect.', { exact: true }).waitFor();
    await page.evaluate(() => window.rejectLogin = false);
    await page.getByRole('button', { name: 'Sign in to HelloTest', exact: true }).click();
    await page.getByRole('heading', { name: 'Signed in workspace' }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.authCalls.at(-1)), { kind: 'login', input: { email: 'author@example.test', password: 'fixture-password' } });
    await page.close();

    const manual = await makePage('auth-manual-' + randomUUID(), makeFixture(), { viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference', installClock: true });
    const status = manual.locator('.auth-coverflow-status');
    await manual.getByRole('textbox', { name: 'Email', exact: false }).fill('draft@example.test');
    await manual.locator('#password-input').fill('draft-password');
    const initial = await status.innerText();
    await manual.clock.fastForward(20000);
    assert.equal(await status.innerText(), initial, 'The carousel never rotates automatically');
    assert.equal(await manual.getByRole('textbox', { name: 'Email', exact: false }).inputValue(), 'draft@example.test');
    assert.equal(await manual.locator('#password-input').inputValue(), 'draft-password');
    assert.equal(await manual.evaluate(() => document.activeElement.id), 'password-input', 'The carousel does not steal form focus');
    await manual.getByRole('button', { name: 'Next feature', exact: true }).click();
    assert.match(await status.innerText(), /Test design/);
    await manual.clock.fastForward(20000);
    assert.match(await status.innerText(), /Test design/, 'A manual selection stays selected');
    await manual.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await manual.locator('.auth-feature-card[data-position="0"]').evaluate(el => getComputedStyle(el).transitionDuration), '0s');
    assert.deepEqual(errors, []);
  } catch (error) {
    const body = activePage && !activePage.isClosed() ? await activePage.locator('body').innerText().catch(() => '') : '';
    throw new Error(`${error.message}\nPage errors: ${JSON.stringify(errors)}\n${body.slice(0, 5000)}`, { cause: error });
  } finally {
    await browser?.close();
    await Promise.all(files.map(file => rm(file, { force: true })));
  }
});

test('Admin sign-in shares the manual carousel and workspace theme without changing administrator authentication', { timeout: 90000 }, async () => {
  const name = 'admin-auth-' + randomUUID();
  const html = new URL(name + '.html', root), tsx = new URL(name + '.tsx', root);
  let browser;
  let page;
  const errors = [];
  try {
    await mkdir(screenshotDir, { recursive: true });
    await writeFile(tsx, `import React from 'react';import{createRoot}from'react-dom/client';import{AdminApp}from'/src/admin/AdminApp';import{adminApi,sessionStore}from'/src/admin/api';
import'@fontsource/inter/400.css';import'@fontsource/inter/500.css';import'@fontsource/inter/600.css';import'@fontsource/hanken-grotesk/600.css';import'/src/admin/admin.css';
sessionStore.clear();window.adminLogins=[];window.adminLoginFails=false;
adminApi.status=async()=>({database_ready:true,bootstrap_login_enabled:false});
adminApi.login=async(username,password)=>{window.adminLogins.push({username,password});if(window.adminLoginFails)throw new Error('Administrator credentials are incorrect.');return{token:'admin-auth-fixture',user:{id:'fixture-admin',name:'QA Administrator',email:'operator@example.test',role:'admin'}}};
adminApi.overview=async()=>({status:'operational',schema:{status:'ready',required_tables:16,available_tables:16,missing_tables:[]},metrics:{users:2,administrators:2,projects:1,integrations:3,active_integrations:3,enabled_features:45,total_features:46},runtime:{}});
createRoot(document.getElementById('root')).render(<AdminApp/>);`);
    await writeFile(html, `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1" /></head><body><div id="root"></div><script type="module" src="/${name}.tsx"></script></body></html>`);
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
    page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => { errors.push('Unexpected API ' + route.request().url()); return route.abort(); });
    await page.goto(`${process.env.VITE_TEST_URL || 'http://127.0.0.1:5189'}/${name}.html`);
    await page.getByRole('heading', { name: 'Welcome back', exact: true }).waitFor();
    await page.getByText('Control plane ready', { exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    const carousel = page.getByRole('region', { name: 'HelloTest product features' });
    assert.equal(await carousel.locator('.auth-feature-card').count(), 5);
    assert.equal(await carousel.getByRole('button', { name: /play|pause/i }).count(), 0);
    assert.doesNotMatch(await page.locator('body').innerText(), /100%|Auditable/);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        await page.evaluate(() => window.scrollTo(0, 0));
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
        const submit = await page.getByRole('button', { name: 'Enter administration', exact: true }).boundingBox();
        assert.ok(submit && submit.y >= 0 && submit.y + submit.height <= (width === 390 ? 844 : 900), 'Admin sign-in is visible without scrolling');
        await assertBrandLayout(page);
        assert.equal(await carousel.locator('.auth-feature-card').evaluateAll(cards => cards.every(card => card.scrollHeight <= card.clientHeight + 1)), true, 'All admin capability cards fit');
        await page.screenshot({ path: `${screenshotDir}/admin-${theme}-${width}.png`, fullPage: true, animations: 'disabled' });
      }
    }
    await carousel.getByRole('button', { name: 'Next feature', exact: true }).click();
    assert.match(await page.locator('.auth-feature-card[data-position="0"]').innerText(), /Prepare the workspace/);
    await carousel.getByRole('button', { name: 'Show Audit activity', exact: true }).click();
    await page.keyboard.press('ArrowRight');
    assert.match(await page.locator('.auth-feature-card[data-position="0"]').innerText(), /Put the right people/);
    assert.equal(await page.evaluate(() => window.adminLogins.length), 0);
    await page.getByRole('textbox', { name: 'Username or email', exact: true }).fill('operator@example.test');
    await page.getByLabel('Password', { exact: true }).fill('admin-fixture-password');
    await page.evaluate(() => window.adminLoginFails = true);
    await page.getByRole('button', { name: 'Enter administration', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'Administrator credentials are incorrect.' }).waitFor();
    await page.evaluate(() => window.adminLoginFails = false);
    await page.getByRole('button', { name: 'Enter administration', exact: true }).click();
    await page.getByRole('heading', { name: 'Control center', exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.adminLogins.at(-1)), { username: 'operator@example.test', password: 'admin-fixture-password' });
    assert.deepEqual(errors, []);
  } catch (error) {
    const body = page && !page.isClosed() ? await page.locator('body').innerText().catch(() => '') : '';
    throw new Error(`${error.message}\nPage errors: ${JSON.stringify(errors)}\n${body.slice(0, 5000)}`, { cause: error });
  } finally {
    await browser?.close();
    await Promise.all([html, tsx].map(file => rm(file, { force: true })));
  }
});
