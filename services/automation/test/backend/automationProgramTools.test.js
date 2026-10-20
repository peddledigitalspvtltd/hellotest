const test = require('node:test');
const assert = require('node:assert/strict');
const { deriveProgramTools, explainProgramToolsUnsupported, hasLinearProgramAssertion } = require('../../backend/lib/automationProgramTools');

const execution = { required: true, step_id: 'current' };
const payload = source => ({ steps: [{ step_id: 'current', step_type: 'web', automation_code: source }] });
const derive = (source, override = {}) => deriveProgramTools({ payload: payload(source), execution, ...override });
const call = (name, args) => ({ name, arguments: args });

test('native visibility waits lower to real guarded checks without approximating other wait states',()=>{
 for(const source of ['await page.locator("#signup").waitFor();','await page.waitForSelector("#signup",{state:"visible"});','const form=page.locator("#signup");await form.waitFor({state:"visible"});'])assert.deepEqual(derive(source),[call('browser_assert',{assertion:'visible',locator:'#signup'})]);
 assert.deepEqual(derive('await page.locator("#signup").waitFor({state:"hidden"});'),[call('browser_assert',{assertion:'hidden',locator:'#signup'})]);
 for(const source of ['page.locator("#signup").waitFor();','await page.locator("#signup").waitFor({state:"attached"});','await page.locator("#signup").waitFor({state:"detached"});','await page.locator("#signup").waitFor({timeout:1});','await page.locator("#signup").waitFor({timeout:45000});','await page.waitForSelector("#signup",{state:"visible",timeout:10000});','await page.locator("#signup").waitFor({timeout:0});','await page.locator("#signup").waitFor({timeout:100001});','await page.locator("#signup").waitFor({timeout:delay});','await page.locator("#signup").waitFor({...options});','await page.locator("#signup").waitFor({unknown:true});','await page.waitForSelector("#signup",{strict:true});','await page.waitForSelector(\'getByRole("heading")\');'])assert.equal(derive(source),null,source);
 assert.equal(explainProgramToolsUnsupported({payload:payload('await page.locator("#signup").waitFor({timeout:1});'),execution}).code,'unsupported_wait_timeout');
 const aliasedTimeout='const field=page.getByLabel("Email");await field.waitFor({state:"visible",timeout:45000});';
 assert.equal(derive(aliasedTimeout),null);
 assert.equal(hasLinearProgramAssertion({payload:payload(aliasedTimeout),execution}),true);
});

test('only a unique current interactive web section is eligible', () => {
  const code = 'await page.locator("#continue").click();';
  for (const value of [undefined, {}, { required: false, step_id: 'current' }, { required: true },
    { required: true, step_id: 'elsewhere' }, Object.create(execution)]) assert.equal(derive(code, { execution: value }), null);
  for (const value of [null, {}, { steps: [] }, { steps: payload(code).steps.concat(payload(code).steps) },
    { steps: [{ id: 'current', step_type: 'android', automation_code: code }] }]) assert.equal(derive(code, { payload: value }), null);
  assert.deepEqual(derive(code), [call('browser_click', { locator: '#continue' })]);
  assert.deepEqual(derive(code, { payload: { steps: [{ id: 'queued', automation_code: 'never execute this' },
    { id: 'current', automation_code: code }] } }), [call('browser_click', { locator: '#continue' })]);
});

test('all linear actions preserve their order, exact input values and scoped parameter references', () => {
  const code = `
    const email = page.locator('#email');
    const alias = email;
    await alias.fill('@t.email');
    await email.press('Tab');
    await page.locator('#country').selectOption(' us ');
    await page.locator('#terms').check();
    await page.locator('#terms').uncheck();
    await page.locator('#help').hover();
    await playwrightPage.locator('#continue').click();
    await page.fill('#secret', params['t.password']);
    await page.press('#code', params['s.[Access code]']);
  `;
  assert.deepEqual(derive(code), [
    call('browser_fill', { locator: '#email', value: '@t.email' }),
    call('browser_press_key', { locator: '#email', key: 'Tab' }),
    call('browser_select_option', { locator: '#country', value: ' us ' }),
    call('browser_check', { locator: '#terms' }), call('browser_uncheck', { locator: '#terms' }),
    call('browser_hover', { locator: '#help' }), call('browser_click', { locator: '#continue' }),
    call('browser_fill', { locator: '#secret', value: '@t.password' }),
    call('browser_press_key', { locator: '#code', key: '@s.[access code]' })
  ]);
});

test('semantic locator lowering explicitly preserves native fuzzy and exact matching', () => {
  for (const name of ['getByLabel', 'getByText', 'getByPlaceholder', 'getByTitle', 'getByAltText']) {
    assert.deepEqual(derive(`await page.${name}('Continue').click();`), [call('browser_click', {
      locator: `${name}("Continue", {"exact":false})`
    })]);
    assert.deepEqual(derive(`await page.${name}('Continue',{exact:true}).click();`), [call('browser_click', {
      locator: `${name}("Continue", {"exact":true})`
    })]);
  }
  assert.deepEqual(derive(`await page.getByRole('button',{name:'Continue'}).click();`), [call('browser_click', {
    locator: 'getByRole("button", {"name":"Continue","exact":false})'
  })]);
  assert.deepEqual(derive(`await page.getByRole('button',{exact:true,name:'Continue'}).click();`), [call('browser_click', {
    locator: 'getByRole("button", {"name":"Continue","exact":true})'
  })]);
  assert.deepEqual(derive(`await page.getByTestId('continue').click();`), [call('browser_click', { locator: 'getByTestId("continue")' })]);
  assert.deepEqual(derive(`const buttons=page.getByRole('button');await buttons.nth(1).click();`), [call('browser_click', {
    locator: 'getByRole("button", {"exact":false}).nth(1)'
  })]);
  assert.deepEqual(derive(`await page.locator('button').last().click();`), [call('browser_click', { locator: 'button.last()' })]);
});

test('every supported assertion is retained, including negated state checks and exact parameter references', () => {
  const conditions = [
    ['toBeVisible()', 'visible'], ['toBeHidden()', 'hidden'], ['toBeEnabled()', 'enabled'],
    ['toBeDisabled()', 'disabled'], ['toBeChecked()', 'checked'],
    ['not.toBeVisible()', 'hidden'], ['not.toBeHidden()', 'visible'], ['not.toBeEnabled()', 'disabled'],
    ['not.toBeDisabled()', 'enabled'], ['not.toBeChecked()', 'unchecked']
  ];
  for (const [matcher, condition] of conditions) assert.deepEqual(derive(`await expect(page.locator('#field')).${matcher};`), [
    call('browser_assert', { assertion: condition, locator: '#field' })
  ]);
  assert.deepEqual(derive(`
    const email=page.locator('#email');
    await email.fill('@t.email');
    await expect(email).toHaveValue('@t.email');
    await expect(page.locator('#review-email')).toHaveText(params['t.email']);
    await expect(page.locator('#result')).toContainText('Created successfully');
    await expect(page.locator('button')).toHaveCount(2);
  `), [
    call('browser_fill', { locator: '#email', value: '@t.email' }),
    call('browser_assert', { assertion: 'value', locator: '#email', value: '@t.email' }),
    call('browser_assert', { assertion: 'text_content', locator: '#review-email', value: '@t.email' }),
    call('browser_assert', { assertion: 'text_content_contains', locator: '#result', value: 'Created successfully' }),
    call('browser_assert', { assertion: 'count', locator: 'button', value: '2' })
  ]);
});

test('the actual navigation-only model pattern lowers into guarded navigation and real URL verification', () => {
  assert.deepEqual(derive(`await page.goto('https://selected.example'); await page.waitForLoadState('domcontentloaded'); await expect(page).toHaveURL('https://selected.example');`), [
    call('browser_navigate', { url: 'https://selected.example' }),
    call('browser_assert', { assertion: 'url', value: 'https://selected.example/' })
  ]);
  assert.deepEqual(derive(`await playwrightPage.goto('https://selected.example/auth');await page.waitForLoadState();await expect(playwrightPage).toHaveTitle('Sign In');`), [
    call('browser_navigate', { url: 'https://selected.example/auth' }),
    call('browser_assert', { assertion: 'title_normalized', value: 'Sign In' })
  ]);
  // No local URL authorization is inferred. The unchanged MCP session origin,
  // SSRF/access/read-only controls still decide whether a request may execute.
  assert.equal(derive(`await page.goto('https://different.example/');`)[0].name, 'browser_navigate');
});

test('unsupported control flow, mutation options or mixed assertions reject the entire program without execution', () => {
  const unsupported = [
    'if (ready) await page.locator("#x").click();',
    'for(let i=0;i<2;i++) await page.locator("#x").click();',
    'while(true) await page.locator("#x").click();',
    'await Promise.all([page.locator("#x").click()]);',
    'await page.locator("#x").click({force:true});',
    'await page.locator("#x").click({trial:true});',
    'await page.locator("#x").fill("value",{timeout:100});',
    'await page.locator("#x").dblclick();',
    'await page.locator(selector).click();',
    'await page.locator(`#${selector}`).click();',
    'await page.locator("#x").filter({hasText:"value"}).click();',
    'await page.locator("#x").locator("button").click();',
    'await page.getByRole("heading",{level:1}).click();',
    'await page.getByRole("button",{name:/Continue/}).click();',
    'await page.getByLabel("Name",{exact:true,exact:false}).click();',
    'await page.getByLabel("Name",{__proto__:{polluted:true}}).click();',
    'await page.getByTestId("x",{exact:true}).click();',
    'await page.locator("#x").nth(-1).click();',
    'await page.locator("#x").first().last().click();',
    'await page.locator("button.first()").click();',
    'await page.locator("button.last()").click();',
    'await page.locator("button.nth( 1 )").click();',
    'await page.click("button.first()");',
    'await page.locator(\'getByLabel("Email")\').click();',
    'await page.locator(\'locator("#email")\').click();',
    'await page.click(\'getByLabel("Email")\');',
    'await page.locator("#x").selectOption({label:"USA"});',
    'await page.locator("#x").selectOption(["us","uk"]);',
    'await page.locator("#x").fill(generateSecret());',
    'await page.locator("#x").fill(params[dynamicKey]);',
    'await page.evaluate(()=>globalThis.executed=true);',
    'await helper();',
    'await expect(page.locator("#x").click()).toBeTruthy();',
    'await expect(customHelper()).toHaveText("value");',
    'await expect(page.locator("#x")).toHaveText(/value/);',
    'await expect(page.locator("#x")).toHaveText(["one","two"]);',
    'await expect(page.locator("#x")).toHaveText("value",{timeout:10});',
    'await expect(page.locator("#x")).not.toHaveText("value");',
    'await expect(page.locator("#x")).toBeChecked({checked:false});',
    'await expect.soft(page.locator("#x")).toBeVisible();',
    'await expect.poll(()=>page.title()).toBe("Title");',
    'await expect(page).toHaveURL(/^auth$/);',
    'await expect(page).toHaveURL("/auth");',
    'expect(page.locator("#x")).toBeVisible();',
    'page.locator("#x").click();',
    'let target=page.locator("#x");await target.click();',
    'const target=page.locator("#x");target=page.locator("#y");',
    'const page=playwrightPage.locator("#x");await page.click();',
    'const expect=page.locator("#x");await expect.click();',
    'await page["click"]("#x");',
    'await page.constructor("return process")();',
    'await page.locator("#x").__proto__();',
    'throw new Error("done");',
    'import value from "outside";'
  ];
  for (const source of unsupported) {
    assert.equal(derive(source), null, source);
    assert.equal(derive(`await page.locator('#valid').click();${source}`), null, `mixed: ${source}`);
  }
  assert.equal(globalThis.executed, undefined);
  assert.equal({}.polluted, undefined);
});

test('only load checks guaranteed by the preceding derived navigation may be omitted', () => {
  for (const source of [
    'await page.waitForLoadState("load");',
    'await page.goto("https://selected.example/");await page.waitForLoadState("networkidle");',
    'await page.goto("https://selected.example/");await page.waitForLoadState("load",{timeout:100});',
    'await page.goto("https://selected.example/");await page.locator("#next").click();await page.waitForLoadState();',
    'await page.goto("https://selected.example/",{waitUntil:"commit"});',
    'await page.goto("file:///etc/passwd");',
    'await page.goto("https://user:password@selected.example/");',
    'await page.goto("/relative");', 'await page.goto(params["t.url"]);',
    'await page.waitForTimeout(1000);'
  ]) assert.equal(derive(source), null, source);
  assert.ok(derive('await page.goto("https://selected.example/");await page.waitForLoadState("load");'));
});

test('source, AST, locator and tool limits reject oversized programs instead of partially lowering them', () => {
  const click = 'await page.locator("#x").click();';
  assert.equal(derive(' '.repeat(64_001) + click), null);
  assert.equal(derive(click.repeat(13)), null);
  assert.equal(derive(click.repeat(12)).length, 12);
  assert.equal(derive(';'.repeat(10_001) + click), null);
  assert.equal(derive(`await page.locator('${'x'.repeat(2_001)}').click();`), null);
  assert.equal(derive(`await page.locator('#x').fill('${'x'.repeat(2_001)}');`), null);
  assert.equal(derive(`await page.getByLabel('${'"'.repeat(1_050)}').click();`), null);
});

test('only literal flagless URL regexes lower to equivalent substring checks, preserving all assertions atomically', () => {
  for (const [pattern, value] of [['review-details', 'review-details'], ['auth\\/signup', 'auth/signup'], ['example\\.test\\?next=review', 'example.test?next=review'], ['\\[literal\\]\\+\\$', '[literal]+$'], ['\\\\path', '\\path']]) {
    assert.deepEqual(derive(`await page.locator('#continue').click();await expect(page).toHaveURL(/${pattern}/);`), [
      call('browser_click', { locator: '#continue' }), call('browser_assert', { assertion: 'url_contains', value })
    ]);
    // This test constructs regexes from test-owned strings only. Production
    // lowering and the MCP server never compile or run model regexes.
    const regex = new RegExp(pattern);
    for (const sample of [`https://app.test/${value}`, 'https://app.test/elsewhere']) assert.equal(regex.test(sample), sample.includes(value));
  }
  for (const regex of ['/review/i', '/review/g', '/review/u', '/^review/', '/review$/', '/review.details/', '/review.*details/', '/(review)/', '/review|details/', '/[a-z]/', '/review?/', '/review+/', '/review{2}/', '/\\d/', '/\\u0072eview/', '/\\x72eview/', '/\\n/', '/(?:)/']) {
    const source = `await page.locator('#continue').click();await expect(page).toHaveURL(${regex});`;
    assert.equal(derive(source), null, regex);
    assert.equal(explainProgramToolsUnsupported({ payload: payload(source), execution }).code, 'unsupported_url_regex', regex);
  }
});

test('source correction feedback is bounded and specific without leaking source or expected values', () => {
  const explain = source => explainProgramToolsUnsupported({ payload: payload(source), execution });
  assert.equal(explain('await expect(page).toHaveURL(/review-details/);'), null);
  assert.equal(explain('if(secret) await page.locator("#private").click();').code, 'unsupported_control_flow');
  assert.equal(explain('await page.getByRole("heading",{level:1}).click();').code, 'unsupported_locator_options');
  assert.equal(explain('await page.click("#private",{force:true});').code, 'unsupported_locator_options');
  assert.equal(explain('await page.locator("#private").fill("secret",{timeout:10});').code, 'unsupported_locator_options');
  assert.equal(explain('await helper("secret");').code, 'unsupported_program');
  assert.equal(explain('await broken(').code, 'source_syntax');
  assert.equal(explain(' '.repeat(64_001)+'await helper();').code, 'source_limit');
  for (const source of ['await page.locator("#private").click({force:true});', 'await expect(page).toHaveURL(/secret.+/);']) {
    assert.doesNotMatch(JSON.stringify(explain(source)), /#private|secret|force/);
  }
});

test('awaited input-value reads with synchronous string equality keep exact typed value checks',()=>{
 for(const matcher of ['toBe','toEqual','toStrictEqual'])assert.deepEqual(derive(`expect(await page.locator('#email').inputValue()).${matcher}('@t.email');`),[
  {name:'browser_assert',arguments:{assertion:'value',locator:'#email',value:'@t.email'}}
 ]);
 assert.equal(derive("expect(await page.locator('#email').inputValue()).toBe(5);"),null);
 assert.equal(derive("expect(await page.locator('#email').inputValue()).toBe(true);"),null);
 assert.equal(derive("expect(await page.locator('#email').inputValue()).toBe(null);"),null);
 assert.equal(derive("expect(await page.locator('#email').inputValue()).not.toBe('secret');"),null);
 assert.equal(derive("expect(page.locator('#email').inputValue()).toBe('secret');"),null);
 assert.equal(derive("expect(await page.locator('#email').textContent()).toBe('secret');"),null,'text matcher normalization cannot be approximated by value mode');
});
