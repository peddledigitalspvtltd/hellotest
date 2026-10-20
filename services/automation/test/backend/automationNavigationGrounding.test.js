const test = require('node:test');
const assert = require('node:assert/strict');
const { createAutomationNavigationGrounding } = require('../../backend/lib/automationNavigationGrounding');
const { createBrowserParameterResolver } = require('../../backend/lib/automationBrowserParameters');
const { recordBrowserOperation } = require('../../backend/lib/automationBrowserRecording');

const startUrl = 'https://app.test/entry';
const execution = extra => ({ required: true, step_id: 'current', action: 'Open the registration page',
  expected_result: 'The registration page is displayed.', ...extra });
const receipt = value => ({ content: [{ type: 'text', text: JSON.stringify({ source: 'playwright', ...value }) }] });
const snapshot = (url = 'https://app.test/auth', elements = [], extra = {}) => ({ tool: 'browser_snapshot', execution_step_id: 'current',
  result: receipt({ observation_id: 'current-page', captured_at: '2026-10-17T00:00:00Z', url, scope: 'body', elements, ...extra }) });
function navigation(url, { failed = false } = {}) {
  const observation = { tool: 'browser_navigate', execution_step_id: 'current', arguments: { url },
    result: { ...receipt({ url, action_outcome: failed ? 'not_attempted' : 'completed' }), ...(failed ? { isError: true } : {}) } };
  recordBrowserOperation(observation, { name: 'browser_navigate', arguments: { url } });
  return observation;
}
const manager = (extra = {}) => createAutomationNavigationGrounding({ startUrl, execution: execution(), ...extra });
const inspect = (guard, url, observations = []) => guard.inspect({ url, observations });

test('shortened observed URLs cannot authorize navigation or resolve relative links, while exact authored URLs remain valid', () => {
  const clipped = 'https://app.test/shortened?token=part';
  const absolute = 'https://app.test/exact-link';
  const elements = [
    { tag: 'a', locators_validated: true, locator_candidates: ['#relative'], attributes: { href: './next' } },
    { tag: 'a', locators_validated: true, locator_candidates: ['#absolute'], attributes: { href: absolute } }
  ];
  const observations = [
    { tool: 'browser_click', execution_step_id: 'current', result: receipt({ url: clipped, url_truncated: true, action_outcome: 'completed' }) },
    snapshot(clipped, elements, { url_truncated: true })
  ];
  denied(inspect(manager(), clipped, observations));
  denied(inspect(manager(), 'https://app.test/next', observations));
  allowed(inspect(manager(), absolute, observations), absolute);
  const authored = manager({ execution: execution({ action: `Navigate to ${clipped}` }) });
  allowed(inspect(authored, clipped, observations), clipped);
});
function denied(result) {
  assert.equal(result.allowed, false);
  assert.equal(result.feedback.code, 'AUTOMATION_NAVIGATION_URL_NOT_GROUNDED');
  assert.equal(result.feedback.action_outcome, 'not_attempted');
  assert.equal(result.feedback.retry_safe, true);
}
function allowed(result, url) {
  assert.equal(result.allowed, true);
  assert.equal(result.url, url);
}

test('a named destination cannot authorize an invented same-origin path', () => {
  const guard = manager();
  allowed(inspect(guard, startUrl), startUrl);
  denied(inspect(guard, 'https://app.test/signup', [snapshot()]));
  denied(inspect(guard, 'https://app.test/registration', [snapshot()]));
  assert.equal(guard.context([]).grounding_required, true);
  assert.ok(guard.context([]).grounded_urls.some(item => item.url === startUrl && item.source === 'configured_start'));
});

test('exact authored current and linked obligations authorize their route, query and fragment only', () => {
  const first = 'https://app.test/invoices/42?mode=read#details';
  const second = 'https://app.test/audit?entity=42#latest';
  const guard = manager({ execution: execution({ action: `Open "${first}"`, obligations: [
    { id: 'current', source: 'section', action: `Open "${first}"`, expected_result: 'Invoice details appear.' },
    { id: 'manual:case:step', source: 'manual_step', action: `Then open "${second}"`, expected_result: 'The audit appears.' }
  ] }) });
  allowed(inspect(guard, first), first);
  allowed(inspect(guard, second), second);
  for (const url of ['https://app.test/invoices/43?mode=read#details', 'https://app.test/invoices/42?mode=edit#details',
    'https://app.test/invoices/42?mode=read#edit', 'https://elsewhere.test/invoices/42?mode=read#details']) denied(inspect(guard, url));
});

test('future case prose and unrelated object fields cannot expand current-section navigation authority', () => {
  const guard = manager({ execution: execution({ case_description: 'Later open https://app.test/admin',
    future_steps: [{ action: 'Open https://app.test/checkout' }], expected_result: 'The registration page is displayed.' }) });
  denied(inspect(guard, 'https://app.test/admin'));
  denied(inspect(guard, 'https://app.test/checkout'));
});

test('paths inside an authored absolute URL query or fragment are not separate destination authority', () => {
  const exact = 'https://app.test/redirect?next=/admin#return=/checkout';
  const guard = manager({ execution: execution({ action: `Open "${exact}"` }) });
  allowed(inspect(guard, exact), exact);
  denied(inspect(guard, 'https://app.test/admin#return=/checkout'));
  denied(inspect(guard, 'https://app.test/checkout'));
});

test('quoted authored URL literals preserve meaningful terminal URL punctuation', () => {
  for (const exact of ['https://app.test/search?q=wow!', 'https://app.test/files/report.', 'https://app.test/search?q=one,two;']) {
    const guard = manager({ execution: execution({ action: `Open "${exact}".` }) });
    allowed(inspect(guard, exact), exact);
    denied(inspect(guard, exact.slice(0, -1)));
  }
});

test('authored relative paths resolve from configured entry and do not grant neighboring paths', () => {
  const guard = manager({ startUrl: 'https://app.test/work/items/', execution: execution({ action: 'Open /invoices/42 and then ./detail followed by ../audit' }) });
  for (const url of ['https://app.test/invoices/42', 'https://app.test/work/items/detail', 'https://app.test/work/audit']) allowed(inspect(guard, url), url);
  denied(inspect(guard, 'https://app.test/work/items/signup'));
});

test('rich-text markup never grants relative-route authority but its explicit destinations remain grounded', () => {
  const guard = manager({ execution: execution({
    action: '<p>Enter <strong>@r.name</strong> then open "/profile?mode=review".</p><div data-route="/admin">Review the profile.</div><!-- /internal -->',
    expected_result: '<p>The profile is displayed.</p>'
  }) });
  allowed(inspect(guard, 'https://app.test/profile?mode=review'), 'https://app.test/profile?mode=review');
  for (const path of ['/p', '/strong', '/div', '/admin', '/internal']) denied(inspect(guard, 'https://app.test' + path));
  assert.equal(guard.context([]).grounded_urls.length, 2);
  const absolute = 'https://app.test/explicit?return=/admin';
  allowed(inspect(manager({ execution: execution({ action: `<p>Open ${absolute}</p>` }) }), absolute), absolute);
});

test('current and confirmed historical navigation URLs remain usable without inventing routes', () => {
  const guard = manager();
  const historical = 'https://app.test/reports?state=saved';
  const current = 'https://app.test/workspace#registration';
  const observations = [navigation(historical), snapshot(current)];
  allowed(inspect(guard, historical, observations), historical);
  allowed(inspect(guard, current, observations), current);
  const context = guard.context(observations);
  assert.ok(context.grounded_urls.some(item => item.url === historical && item.source === 'observed_history'));
  assert.ok(context.grounded_urls.some(item => item.url === current && item.source === 'current_page'));
  denied(inspect(guard, 'https://app.test/never-reached', [navigation('https://app.test/never-reached', { failed: true })]));
});

test('a failed navigation invalidates stale current-page and observed-link evidence', () => {
  const target = 'https://app.test/linked';
  const link = { tag: 'a', attributes: { href: target }, locators_validated: true, locator_candidates: ['#linked'], displayed: true };
  const stale = snapshot('https://app.test/stale', [link]);
  const observations = [stale, navigation('https://app.test/error-document', { failed: true })];
  const guard = manager();
  denied(inspect(guard, 'https://app.test/stale', observations));
  denied(inspect(guard, target, observations));
});

test('only exact current, validated and untruncated observed link hrefs can authorize navigation', () => {
  const target = 'https://app.test/linked?mode=read#section';
  const link = { tag: 'a', attributes: { href: target }, locators_validated: true, locator_candidates: ['#linked'], displayed: true };
  const guard = manager();
  allowed(inspect(guard, target, [snapshot(undefined, [link])]), target);
  for (const element of [{ ...link, locators_validated: false }, { ...link, locator_candidates: [] },
    { ...link, truncated_attributes: ['href'] }, { ...link, tag: 'div' }, { ...link, attributes: { href: '[redacted]' } }])
    denied(inspect(guard, target, [snapshot(undefined, [element])]));
  denied(inspect(guard, target.replace('mode=read', 'mode=edit'), [snapshot(undefined, [link])]));
});

test('host-pinned public URL parameters resolve once and token-like literal values remain literal', () => {
  const destination = 'https://app.test/target?literal=@r.other';
  const resolver = createBrowserParameterResolver({ materialize: false,
    caseValues: { 't.destination': destination, 'r.other': 'UNEXPECTED_SECOND_SUBSTITUTION' } });
  const guard = manager({ projectText: resolver.projectText, projectPrivateText: resolver.projectPrivateText,
    execution: execution({ action: 'Open the configured destination', navigation_parameter_references: ['t.destination'] }) });
  allowed(inspect(guard, '@t.destination'), destination);
  allowed(inspect(guard, destination), destination);
  denied(inspect(guard, destination.replace('@r.other', 'UNEXPECTED_SECOND_SUBSTITUTION')));
  assert.ok(guard.context([]).grounded_urls.some(item => item.url === destination));
});

test('already projected prose containing a literal parameter token cannot grant another parameter URL', () => {
  const literal = 'literal @r.other remains literal';
  const resolver = createBrowserParameterResolver({ materialize: false,
    caseValues: { 't.literal': literal, 'r.other': 'https://app.test/private-route', 't.unused': 'https://app.test/unused' } });
  const guard = manager({ projectText: resolver.projectText, projectPrivateText: resolver.projectPrivateText,
    execution: execution({ action: resolver.projectText('Read @t.literal'), navigation_parameter_references: [] }) });
  denied(inspect(guard, 'https://app.test/private-route'));
  denied(inspect(guard, '@r.other'));
  denied(inspect(guard, '@t.unused'));
  assert.doesNotMatch(JSON.stringify(guard.context([])), /private-route|https:\/\/app\.test\/unused/);
});

test('private URL bindings and masked target URLs cannot become model-visible navigation authority', () => {
  const secret = 'https://app.test/private?token=owned-secret';
  const resolver = createBrowserParameterResolver({ materialize: false, caseValues: { 't.secret_url': secret } });
  const guard = manager({ projectText: resolver.projectText, projectPrivateText: resolver.projectPrivateText,
    execution: execution({ action: 'Open @t.secret_url', navigation_parameter_references: ['t.secret_url'] }) });
  denied(inspect(guard, '@t.secret_url'));
  denied(inspect(guard, secret));
  assert.doesNotMatch(JSON.stringify(guard.context([])), /owned-secret|private\?token/);
  for (const url of ['javascript:alert(1)', 'file:///tmp/private', 'https://user:password@app.test/entry', 'https://app.test/[redacted]']) denied(inspect(guard, url));
});

test('context clones cannot alter subsequent grounded URL authority', () => {
  const guard = manager();
  const first = guard.context([]);
  first.grounded_urls.push({ url: 'https://app.test/forged', source: 'configured_start' });
  first.grounded_urls[0].url = 'https://app.test/rewritten';
  denied(inspect(guard, 'https://app.test/forged'));
  denied(inspect(guard, 'https://app.test/rewritten'));
  allowed(inspect(guard, startUrl), startUrl);
});
