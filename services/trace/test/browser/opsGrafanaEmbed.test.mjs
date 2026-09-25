import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const requireApi = createRequire(new URL('../../../platform/backend/package.json', import.meta.url));
const requireEngine = createRequire(new URL('../../../../testengine/backend/package.json', import.meta.url));
const { chromium } = requireEngine('playwright');

test('live Grafana loads with a protected cookie, Viewer account and no login form', { skip: process.env.OPS_GRAFANA_LIVE_TEST !== 'true', timeout: 90000 }, async () => {
  const Fastify = requireApi('fastify');
  const grafana = requireApi('../../services/trace/backend/services/opsGrafana.service');
  const secret = readFileSync(new URL('../../../../.hellotest/ops.env', import.meta.url), 'utf8').match(/^GRAFANA_ADMIN_PASSWORD=(.+)$/m)[1];
  const gateway = grafana.createGateway({ environment: { OPS_MONITORING_ENABLED: 'true', OPS_GRAFANA_PASSWORD: secret, OPS_GRAFANA_URL: 'http://127.0.0.1:3001' } });
  const sandbox = { module: { exports: {} }, require: name => {
    if (name === 'node:stream') return requireApi(name);
    if (name.includes('opsGrafana.service')) return { ...grafana, gateway };
    if (name.includes('project.service')) return { getProject: async id => assert.equal(id, 'fixture-project') };
    return {};
  }, setTimeout, clearTimeout, AbortController };
  vm.runInNewContext(readFileSync(requireApi.resolve('../../services/trace/backend/routes/opsTelemetry.routes'), 'utf8'), sandbox);
  const app = Fastify();
  app.decorate('requireAdmin', async req => {
    if (req.headers.authorization !== 'Bearer test-browser-session') throw Object.assign(new Error('Unauthorized'), { statusCode: 401 });
    req.user = { id: 'fixture-admin' }; req.authMethod = 'session';
  });
  app.register(sandbox.module.exports, { prefix: '/api' });
  app.get('/', async (_req, reply) => reply.type('text/html').send(`<!doctype html><html><body style="margin:0"><iframe title="Grafana" style="width:100%;height:100vh;border:0"></iframe><script>
fetch('/api/ops-telemetry/grafana-session',{method:'POST',headers:{Authorization:'Bearer test-browser-session','Content-Type':'application/json'},body:JSON.stringify({project_id:'fixture-project'})}).then(r=>r.json()).then(r=>{if(r.url)document.querySelector('iframe').src=r.url;else document.body.innerText='Session failed';});
</script></body></html>`));
  let browser;
  try {
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const failures = [];
    page.on('response', response => { if (response.status() >= 400) failures.push(`${response.status()} ${new URL(response.url()).pathname}`); });
    const hasSamples = data => Object.values(data.results || {}).some(result => result.frames?.some(frame => frame.data?.values?.some((column, index) => frame.schema?.fields?.[index]?.type === 'number' && column.some(value => typeof value === 'number' && Number.isFinite(value)))));
    // Queries finish in different orders; a newly restarted API can have empty rate series.
    const queryResponse = page.waitForResponse(async response => {
      if (!response.url().includes('/api/ds/query') || response.status() !== 200) return false;
      return hasSamples(await response.json());
    }, { timeout: 60000 }).catch(error => ({ error }));
    await page.goto(address);
    const frame = page.frameLocator('iframe');
    try { await frame.getByText('API request rate', { exact: true }).waitFor({ timeout: 45000 }); } catch (error) {
      await page.screenshot({ path: '/tmp/hellotest-live-grafana-failure.png' });
      console.error('Dashboard failures:', failures, await page.locator('body').innerText(), await frame.locator('body').innerText());
      throw error;
    }
    await frame.getByText('API resident memory', { exact: true }).waitFor();
    const response = await queryResponse;
    if (response.error) throw response.error;
    const values = await response.json();
    assert.ok(hasSamples(values), 'Grafana must receive actual metric samples');
    await frame.locator('canvas').nth(2).waitFor({ timeout: 30000 });
    assert.equal(await frame.getByRole('button', { name: 'Sign in', exact: true }).count(), 0);
    await page.screenshot({ path: '/tmp/hellotest-live-grafana.png' });
    const cookies = await page.context().cookies();
    const cookie = cookies.find(item => item.name === grafana.COOKIE);
    assert.ok(cookie?.httpOnly); assert.equal(cookie.sameSite, 'Strict');
    assert.doesNotMatch(JSON.stringify(cookies), new RegExp(secret));
    assert.deepEqual(failures, [], 'all required dashboard resources must load');
  } finally { await browser?.close(); await app.close(); }
});
