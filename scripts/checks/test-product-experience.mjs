#!/usr/bin/env node
/** Run the product UX regressions against an owned local Vite process.
 * Browser fixtures must run sequentially: creating/removing entry files can
 * otherwise trigger Vite HMR in another test's in-progress dialog. */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer as createPortProbe } from 'node:net';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const frontend = join(root, 'services/platform/frontend');
const suite = [
  'services/platform/frontend/test/browser/appStartup.test.mjs',
  'services/platform/frontend/test/browser/productInteraction.test.mjs',
  'services/platform/frontend/test/browser/workspaceDiscoveryFlow.test.mjs',
  'services/platform/frontend/test/browser/projectControls.test.mjs',
  'services/agentic/test/browser/workflowStudioUsability.test.mjs',
  'services/agentic/test/browser/qualityAgentLab.test.mjs',
  'services/agentic/test/browser/mcpServers.test.mjs',
  'services/trace/test/browser/opsMonitoringViews.test.mjs',
  'services/integration/test/browser/integrationConnection.test.mjs',
  'services/automation/test/browser/automationStudioWorkspace.test.mjs',
  'services/automation/test/browser/automationCommandWorkspace.test.mjs',
  'services/automation/test/browser/automationRuntimeWorkspace.test.mjs',
  'services/knowledge/test/browser/knowledgeRepositoryExperience.test.mjs',
  'services/knowledge/test/browser/knowledgeRefreshWorkspace.test.mjs',
  'services/testing/test/browser/defectAttachmentRetry.test.mjs',
  'services/manual/test/browser/storyPlanningAssignments.test.mjs',
  'services/manual/test/browser/releaseHealth.test.mjs',
  'services/manual/test/browser/sprintHealthDialog.test.mjs',
  'services/testing/test/browser/testCaseCatalogPage.test.mjs',
  'services/testing/test/browser/runCatalogDetails.test.mjs',
  'services/platform/frontend/test/browser/contextAuthoringControls.test.mjs',
  'services/testing/test/browser/testCaseAuthoringContext.test.mjs',
  'services/testing/test/browser/testCaseDisplayId.test.mjs',
  'services/ai/test/browser/aiStudioExperience.test.mjs',
  'services/platform/frontend/test/browser/storyAiWorkbench.test.mjs',
  'services/platform/frontend/test/browser/defectAiStudio.test.mjs',
  'services/agentic/test/browser/agentWorkspace.test.mjs',
  'services/platform/frontend/test/browser/aiCaseAuthoringFormats.test.mjs',
  'services/platform/frontend/test/browser/knowledgeAssistant.test.mjs',
  'services/platform/test/browser/authFeatureCarousel.test.mjs'
];
const help = `Usage: npm run test:product-ux -- [--list | --filter <filename-text>]
Runs the redesigned product's browser regressions sequentially with a temporary
local Vite server. Starts and stops its own server; no application backend is used.

First install workspace, frontend and testengine dependencies using npm run setup.
Install Chromium with: npm --prefix testengine/backend exec -- playwright install chromium

Optional environment variables:
  PLAYWRIGHT_MODULE  Alternate Playwright module name or absolute module path.
  CHROME_EXECUTABLE  Browser executable; defaults to installed Playwright Chromium.

--list              List matching test files without starting the server.
--filter <text>     Run matching test filenames (for example knowledge or appStartup).
--help             Show this help.
`;

function selectedTests(args) {
  let filter = '';
  let list = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--list') list = true;
    else if (args[index] === '--filter' && args[index + 1] && !args[index + 1].startsWith('--')) filter = args[++index].toLowerCase();
    else throw new Error(`Unknown or incomplete option: ${args[index]}. Use --help.`);
  }
  const tests = suite.filter((path) => path.split('/').at(-1).toLowerCase().includes(filter));
  if (!tests.length) throw new Error(`No product UX tests match “${filter}”. Use --list to see the suite.`);
  return { tests, list };
}

function start(command, args, options) {
  const child = spawn(command, args, { ...options, detached: process.platform !== 'win32' });
  const state = { child, failure: null, complete: false, result: null };
  child.once('error', (error) => { state.failure = error; });
  state.closed = new Promise((done) => child.once('close', (code, signal) => {
    state.complete = true;
    state.result = { code, signal };
    done(state.result);
  }));
  return state;
}

function signalChild(state, signal = 'SIGTERM') {
  if (!state || state.complete || !state.child.pid) return;
  try {
    // Own each process group so interruption also closes browser/test children.
    if (process.platform !== 'win32') process.kill(-state.child.pid, signal);
    else state.child.kill(signal);
  } catch (error) {
    if (error.code !== 'ESRCH') console.error(`[product-ux] Could not stop a child process: ${error.message}`);
  }
}

async function stop(state) {
  if (!state || state.complete) return;
  signalChild(state);
  let timer;
  try {
    const finished = await Promise.race([state.closed.then(() => true), new Promise((done) => { timer = setTimeout(() => done(false), 5000); })]);
    if (!finished) { signalChild(state, 'SIGKILL'); await state.closed; }
  } finally { clearTimeout(timer); }
}

async function availablePort() {
  const probe = createPortProbe();
  await new Promise((done, fail) => { probe.once('error', fail); probe.listen(0, '127.0.0.1', done); });
  const port = probe.address().port;
  await new Promise((done, fail) => probe.close((error) => error ? fail(error) : done()));
  return port;
}

async function run(tests) {
  for (const path of tests) if (!existsSync(join(root, path))) throw new Error(`Product UX test is missing: ${path}`);
  const frontendRequire = createRequire(join(frontend, 'package.json'));
  const browserRequire = createRequire(join(root, 'testengine/backend/package.json'));
  let viteEntry;
  let playwrightPath;
  let executablePath;
  try { viteEntry = join(dirname(frontendRequire.resolve('vite/package.json')), 'bin/vite.js'); }
  catch { throw new Error('Vite is unavailable. Run npm run setup:frontend and npm run setup:capabilities first.'); }
  try {
    playwrightPath = browserRequire.resolve(process.env.PLAYWRIGHT_MODULE || 'playwright');
    executablePath = process.env.CHROME_EXECUTABLE || browserRequire(playwrightPath).chromium.executablePath();
  } catch { throw new Error('Playwright is unavailable. Run npm run setup:testengine, or provide PLAYWRIGHT_MODULE.'); }
  if (!existsSync(executablePath)) throw new Error('Chromium is unavailable. Run npm --prefix testengine/backend exec -- playwright install chromium, or provide CHROME_EXECUTABLE.');

  const temporary = await mkdtemp(join(tmpdir(), 'qaira-product-ux-'));
  const configPath = join(temporary, 'vite.product.config.mjs');
  await writeFile(configPath, `import base from ${JSON.stringify(join(frontend, 'vite.config.ts').replaceAll('\\', '/'))};\nexport default { ...base, server: { ...base.server, hmr: false }, clearScreen: false };\n`);
  let server;
  let runner;
  let interrupted = null;
  let url = '';
  let output = '';
  const abort = new AbortController();
  const interrupt = (signal) => {
    if (interrupted) return;
    interrupted = signal;
    console.error(`[product-ux] ${signal}: stopping tests and the local server.`);
    abort.abort();
    signalChild(runner);
    signalChild(server);
  };
  const onInterrupt = () => interrupt('SIGINT');
  const onTerminate = () => interrupt('SIGTERM');
  process.on('SIGINT', onInterrupt);
  process.on('SIGTERM', onTerminate);
  const startedAt = Date.now();
  const progress = setInterval(() => console.log(`[product-ux] ${Math.round((Date.now() - startedAt) / 1000)}s elapsed; ${runner ? 'browser checks are running' : 'waiting for local Vite'}.`), 25_000);
  try {
    console.log(`[product-ux] Starting local Vite for ${tests.length} browser test files.`);
    // Ask the OS for an available port. strictPort fails if another process
    // claims it before Vite binds, instead of attaching to unrelated tooling.
    // A private config turns off HMR: fixture cleanup cannot remount an open UI.
    const port = await availablePort();
    server = start(process.execPath, [viteEntry, '--config', configPath, '--host', '127.0.0.1', '--port', String(port), '--strictPort', '--clearScreen', 'false'], { cwd: frontend, env: { ...process.env, NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const capture = (chunk) => {
      output = (output + chunk.toString()).slice(-8192);
      const plain = output.replace(/\u001b\[[0-9;]*m/g, '');
      url = plain.match(/http:\/\/127\.0\.0\.1:\d+\//)?.[0] || url;
    };
    server.child.stdout.on('data', capture);
    server.child.stderr.on('data', capture);
    const deadline = Date.now() + 45_000;
    let ready = false;
    while (Date.now() < deadline && !interrupted) {
      if (server.failure || server.complete) throw new Error(`Vite could not start.\n${output.trim() || server.failure?.message || 'The server exited before readiness.'}`);
      if (url) {
        try { const response = await fetch(url, { signal: AbortSignal.timeout(1500) }); if (response.ok) { ready = true; break; } }
        catch { /* The listener can become available slightly after its banner. */ }
      }
      await delay(150, undefined, { signal: abort.signal });
    }
    if (interrupted) return interrupted === 'SIGINT' ? 130 : 143;
    if (!ready) throw new Error(`Vite did not become ready within 45 seconds.\n${output.trim()}`);
    console.log(`[product-ux] Ready at ${url}; running sequentially.`);
    runner = start(process.execPath, ['--test', '--test-concurrency=1', ...tests], { cwd: root, stdio: 'inherit', env: { ...process.env, PLAYWRIGHT_MODULE: playwrightPath, CHROME_EXECUTABLE: executablePath, VITE_TEST_URL: url.replace(/\/$/, '') } });
    const result = await runner.closed;
    if (interrupted) return interrupted === 'SIGINT' ? 130 : 143;
    if (runner.failure) throw runner.failure;
    if (result.signal) throw new Error(`Browser checks stopped with ${result.signal}.`);
    return result.code ?? 1;
  } catch (error) {
    if (interrupted) return interrupted === 'SIGINT' ? 130 : 143;
    throw error;
  } finally {
    clearInterval(progress);
    await Promise.all([stop(runner), stop(server)]);
    await rm(temporary, { recursive: true, force: true });
    process.off('SIGINT', onInterrupt);
    process.off('SIGTERM', onTerminate);
  }
}

try {
  const args = process.argv.slice(2);
  if (args.includes('--help')) console.log(help);
  else {
    const { tests, list } = selectedTests(args);
    if (list) console.log(tests.join('\n'));
    else process.exitCode = await run(tests);
  }
} catch (error) {
  console.error(`[product-ux] ${error.message}`);
  process.exitCode = 1;
}
