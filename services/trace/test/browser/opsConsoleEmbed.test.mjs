import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const requireApi = createRequire(new URL('../../../platform/backend/package.json', import.meta.url));
const requireEngine = createRequire(new URL('../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = requireEngine('playwright');

for (const provider of ['traces', 'alerts']) test(`live ${provider} console loads inside a protected iframe`, { skip: process.env.OPS_CONSOLES_LIVE_TEST !== 'true', timeout: 90000 }, async () => {
  const service = requireApi('../../services/trace/backend/services/opsConsole.service');
  const gateway = service.createGateway({ environment: { OPS_MONITORING_ENABLED: 'true', OPS_JAEGER_URL: 'http://127.0.0.1:16687', OPS_ALERTMANAGER_URL: 'http://127.0.0.1:9093' } });
  const sandbox = { module: { exports: {} }, require: name => {
    if (name === 'node:stream') return requireApi(name);
    if (name.includes('opsConsole.service')) return { ...service, gateway };
    if (name.includes('opsGrafana.service')) return requireApi('../../services/trace/backend/services/opsGrafana.service');
    if (name.includes('project.service')) return { getProject: async id => assert.equal(id, 'fixture-project') };
    throw Error(name);
  }, setTimeout, clearTimeout, AbortController };
  vm.runInNewContext(readFileSync(requireApi.resolve('../../services/trace/backend/routes/opsConsole.routes'), 'utf8'), sandbox);
  const app = requireApi('fastify')();
  app.decorate('requireAdmin', async req => {
    if (req.headers.authorization !== 'Bearer fixture-console') throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });
    req.user = { id: 'fixture-admin' }; req.authMethod = 'session';
  });
  app.register(sandbox.module.exports, { prefix: '/api' });
  app.get('/', async (_req, reply) => reply.type('text/html').send(`<!doctype html><body style="margin:0"><iframe title="Console" sandbox="allow-scripts allow-same-origin allow-downloads" style="width:100%;height:100vh;border:0"></iframe><script>
fetch('/api/ops-telemetry/console-session/${provider}',{method:'POST',headers:{Authorization:'Bearer fixture-console','Content-Type':'application/json'},body:JSON.stringify({project_id:'fixture-project'})}).then(r=>r.json()).then(r=>{if(r.url)document.querySelector('iframe').src=r.url;else document.body.innerText=JSON.stringify(r);});</script></body>`));
  let browser, page;
  const failures = [];
  try {
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('response', r => { if (r.status() >= 400) failures.push(`${r.status()} ${new URL(r.url()).pathname}`); });
    const result = page.waitForResponse(r => r.url().includes(provider === 'traces' ? '/api/v3/trace-summaries' : '/api/v2/alerts/groups') && r.status() === 200, { timeout: 45000 }).catch(error => ({ error }));
    await page.goto(address);
    const response = await result;
    if (response.error) throw response.error;
    const payload = await response.json();
    assert.ok(provider === 'traces' ? payload && typeof payload === 'object' : Array.isArray(payload));
    const frame = page.frameLocator('iframe');
    await frame.locator('body').waitFor();
    const content = await frame.locator('body').innerText();
    assert.match(content, provider === 'traces' ? /Jaeger|Search|Find Traces/i : /Alertmanager|Alerts|Silences/i);
    await page.screenshot({ path: `/tmp/hellotest-console-${provider}.png` });
    if (provider === 'traces') {
      const traceLinks = frame.locator('a[href*="/trace/"]').filter({ hasText: 'hellotest-api' });
      if (await traceLinks.count()) {
        const detail = page.waitForResponse(r => /\/api\/(?:v3\/)?traces\//.test(r.url()) && r.status() === 200, { timeout: 15000 }).catch(error => ({ error }));
        await traceLinks.first().click();
        const fetched = await detail;
        if (fetched.error) throw fetched.error;
        await page.screenshot({ path: '/tmp/hellotest-console-trace-detail.png' });
      }
    } else {
      await frame.getByRole('link', { name: 'Silences', exact: true }).click();
      await frame.getByRole('link', { name: 'Status', exact: true }).click();
    }
    const cookie = (await page.context().cookies()).find(c => c.name === service.cookie(provider));
    assert.ok(cookie?.httpOnly); assert.equal(cookie.sameSite, 'Strict');
    assert.deepEqual(failures, [], 'console resources must load without missing API paths');
  } catch (error) {
    console.error('Failed console resources:', failures);
    await page?.screenshot({ path: `/tmp/hellotest-console-${provider}-failure.png` });
    throw error;
  } finally { await browser?.close(); await app.close(); }
});
