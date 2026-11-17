import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { registerRecorderRoutes } from '../../dist/lib/recorder.js';
import { createPlaywrightCodeBindings } from '../../dist/lib/playwrightBindings.js';

const builderFile = new URL('../../../../services/automation/backend/services/aiAutomationBuilder.service.js', import.meta.url);
const require = createRequire(builderFile), builderSource = await readFile(builderFile, 'utf8');
const database = { prepare: () => ({ get: async () => null, all: async () => [], run: async () => ({ changes: 1 }) }) };
const sandbox = { module: { exports: {} }, exports: {}, process, URL, Buffer, setTimeout, clearTimeout, console, require: id => {
 if (typeof id === 'string' && id.startsWith('./builder/')) return require('node:module').createRequire(require.resolve('@hellotest/automation/build'))(id);

  if (id.endsWith('/db') || id.endsWith('/obsDb')) return database;
  if (id === 'crypto' || id.endsWith('/testStepAutomation') || id.endsWith('/automationBrowserParameters') || id.endsWith('/automationRecorderActions') || id.endsWith('/automationRecorderReplayPlan')) return require(id);
  return {};
} };
vm.runInNewContext(`${builderSource}\nmodule.exports={normalizeCapturedActions,buildRecorderStepCandidates,buildRecorderStepCandidate,createRecorderAutomationCode};`, sandbox);
const host = sandbox.module.exports;
const { playwrightRepositoryLocatorExpression } = await import('../../../../services/automation/shared/automationProgramCompatibility.mjs');
const repositoryModel = { locatorExpression: playwrightRepositoryLocatorExpression };
const { createBrowserParameterResolver } = require('../lib/parameters/automationBrowserParameters');
const { bindRecorderParameterCandidates } = require('../lib/recording/automationRecorderParameters');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

for (const mode of ['remote', 'local']) test(`${mode} recorder stops with the final input and its parameterized source replays in a fresh browser`, { timeout: 30000 }, async t => {
  const app = Fastify();
  app.get('/form', async (_req, reply) => reply.type('text/html').send('<!doctype html><title>Recorder fixture</title><label>Name<input autofocus id="name"></label>'));
  await registerRecorderRoutes(app);
  const origin = await app.listen({ host: '127.0.0.1', port: 0 });t.after(() => app.close());
  const started = await app.inject({ method: 'POST', url: '/api/v1/recorder/sessions', payload: { start_url: `${origin}/form`, purpose: 'automation-recording', recorder_mode: mode } });
  assert.equal(started.statusCode, 202, started.body);
  const session = started.json(), token = new URL(session.live_view_path, origin).searchParams.get('token');
  const headers = { 'x-hellotest-recorder-token': token };
  // Navigation starts asynchronously. Wait for the actual fixture page and
  // use a screenshot round trip so the browser has processed its autofocus.
  let loaded = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    const tabs = (await app.inject({ method: 'GET', url: `/api/v1/recorder/sessions/${session.id}/tabs`, headers })).json();
    if (tabs.tabs?.some(tab => tab.title === 'Recorder fixture')) { loaded = true;break; }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.equal(loaded, true);
  const clicked = await app.inject({ method: 'POST', url: `/api/v1/recorder/sessions/${session.id}/input`, headers, payload: { type: 'click', x: 100, y: 15 } });
  assert.equal(clicked.statusCode, 200, clicked.body);
  const typed = await app.inject({ method: 'POST', url: `/api/v1/recorder/sessions/${session.id}/input`, headers, payload: { type: 'type', text: '  Final recorded input  ' } });
  assert.equal(typed.statusCode, 200, typed.body);
  const stopped = await app.inject({ method: 'POST', url: `/api/v1/recorder/sessions/${session.id}/stop`, headers });
  assert.equal(stopped.statusCode, 200, stopped.body);
  const capture = stopped.json(), fill = capture.actions.find(action => action.type === 'fill' || action.type === 'change');
  assert.equal(capture.status, 'stopped');assert.ok(fill, JSON.stringify(capture.actions));assert.equal(fill.value, '  Final recorded input  ');
  const actions = host.normalizeCapturedActions(capture.actions), resolver = createBrowserParameterResolver({ caseValues: { 't.name': '  Changed playback input  ' } });
  const bound = bindRecorderParameterCandidates({ actions, candidates: host.buildRecorderStepCandidates(actions, repositoryModel), resolver,
    parameterBindings: [{ source_action_index: fill.index, parameter_reference: '@t.name' }], rebuildCandidate: (action, order) => host.buildRecorderStepCandidate(action, order, repositoryModel) });
  const source = host.createRecorderAutomationCode(bound.candidates);
  assert.match(source, /@t.name/);assert.doesNotMatch(source, /Final recorded input|Changed playback input/);
  const browser = await chromium.launch({ headless: true });t.after(() => browser.close());
  const page = await browser.newPage();
  const bindings = createPlaywrightCodeBindings(page, { interpolate: value => value.replaceAll('@t.name', '  Changed playback input  '), resolveLocator: value => value, resolveUrl: value => value });
  await new AsyncFunction('page', source)(bindings.page);
  assert.equal(await page.locator('#name').inputValue(), '  Changed playback input  ');
  const reread = (await app.inject({ method: 'GET', url: `/api/v1/recorder/sessions/${session.id}`, headers })).json();
  assert.equal(reread.actions.find(action => action.index === fill.index).value, '  Final recorded input  ', 'stopped capture remains available for a failed save retry');
});

for (const activationKey of ['Enter', 'Space']) test(`recorded ${activationKey} submits once in a fresh browser without lifecycle Tab or duplicate navigation`, { timeout: 30000 }, async t => {
  const app = Fastify(); let submissions = 0;
  app.get('/form', async (_req, reply) => reply.type('text/html').send('<!doctype html><title>Submit fixture</title><form action="/saved"><label>Name<input autofocus id="name" name="name"></label><button>Save</button></form>'));
  app.get('/saved', async (_req, reply) => { submissions++; return reply.type('text/html').send('<!doctype html><title>Saved fixture</title><h1>Saved</h1>'); });
  await registerRecorderRoutes(app);
  const origin = await app.listen({ host: '127.0.0.1', port: 0 }); t.after(() => app.close());
  const started = await app.inject({ method: 'POST', url: '/api/v1/recorder/sessions', payload: { start_url: `${origin}/form`, purpose: 'automation-recording', recorder_mode: 'remote' } });
  assert.equal(started.statusCode, 202, started.body);
  const session = started.json(), headers = { 'x-hellotest-recorder-token': new URL(session.live_view_path, origin).searchParams.get('token') };
  for (let attempt = 0; attempt < 100; attempt++) {
    const tabs = (await app.inject({ method: 'GET', url: `/api/v1/recorder/sessions/${session.id}/tabs`, headers })).json();
    if (tabs.tabs?.some(tab => tab.title === 'Submit fixture')) break;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  for (const payload of [{ type: 'click', x: 100, y: 15 }, { type: 'type', text: 'Saved account' }, ...(activationKey === 'Space' ? [{ type: 'press', key: 'Tab' }] : []), { type: 'press', key: activationKey }]) {
    const result = await app.inject({ method: 'POST', url: `/api/v1/recorder/sessions/${session.id}/input`, headers, payload });
    assert.equal(result.statusCode, 200, result.body);
  }
  for (let attempt = 0; attempt < 100; attempt++) {
    const tabs = (await app.inject({ method: 'GET', url: `/api/v1/recorder/sessions/${session.id}/tabs`, headers })).json();
    if (tabs.tabs?.some(tab => tab.title === 'Saved fixture')) break;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  const stopped = await app.inject({ method: 'POST', url: `/api/v1/recorder/sessions/${session.id}/stop`, headers });
  assert.equal(stopped.statusCode, 200, stopped.body);
  const actions = host.normalizeCapturedActions(stopped.json().actions);
  const candidates = host.buildRecorderStepCandidates(actions, repositoryModel);
  const source = host.createRecorderAutomationCode(candidates);
  assert.equal((source.match(new RegExp(`keyboard\\.press\\("${activationKey}"\\)`, 'g')) || []).length, 1, source);
  assert.equal((source.match(/keyboard\.press\("Tab"\)/g) || []).length, activationKey === 'Space' ? 1 : 0, source);
  assert.equal(candidates.filter(candidate => candidate.keyword === 'page.waitForURL').length, 1, source);
  assert.equal(submissions, 1, JSON.stringify(actions));
  const browser = await chromium.launch({ headless: true }); t.after(() => browser.close());
  const page = await browser.newPage();
  const bindings = createPlaywrightCodeBindings(page, { interpolate: value => value, resolveLocator: value => value, resolveUrl: value => value });
  await new AsyncFunction('page', source)(bindings.page);
  assert.equal(await page.locator('h1').innerText(), 'Saved');
  assert.equal(submissions, 2, 'Playback must submit once, without another goto to the observed result route');
});
