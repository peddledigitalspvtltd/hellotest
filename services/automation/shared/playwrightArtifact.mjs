export { buildAutomationRepositoryFields, preparePlaywrightRepository } from "./automationRepository.mjs";
import { prepareAutomationExportSource, automationExportRuntimeUsage } from "./automationExportSource.mjs";
import { parseApiRequestSource } from "./apiRequestSource.mjs";
import { buildApiValidationAssertionCode } from "./apiValidation.mjs";
import { hasConfiguredCaseExecutionHooks } from "./automationCaseExecutionHooks.mjs";
// The export is deliberately independent of the application's injected runtime.
const runtime = String.raw `
// RuntimeValue is the compatibility boundary for saved JavaScript instructions and API JSON.
// Playwright fixtures, test data, locators and assertions retain their native types.
type RuntimeValue = any;
type DataValues = Record<string, string>;
function runtimeFor(page: Page, request: APIRequestContext, context: BrowserContext, params: DataValues, repository: Record<string,string>, baseURL: string, captured: DataValues, onPageChange: (next: Page) => void) {
  const keyOf = (key: unknown): string => String(key).replace(/^@/, '').replace(/^([tsr])\.\[((?:\\.|[^\]\\])+)\]$/i, (_,scope,name) => scope + '.' + name.replace(/\\([\\\]])/g,'$1')).toLowerCase();
  const capture = (key: unknown, value: RuntimeValue) => { params[keyOf(key)] = captured[keyOf(key)] = String(value ?? ''); return value; };
  const text = (value: unknown): string => String(value ?? '').replace(/(?<![A-Za-z0-9_])@(?:(t|s|r)\.)?(\[(?:\\.|[^\]\\\r\n])+\]|[A-Za-z][A-Za-z0-9_-]*)/gi, (token, scope, rawName, offset, source) => {
    if(!scope&&/^[tsr]$/i.test(rawName)&&source[offset+token.length]==='.')return token;
    let name = keyOf((scope || 'r') + '.' + rawName);
    if(!scope&&!(name in params)&&('t.'+name.slice(2)) in params)name='t.'+name.slice(2);
    if (!(name in params)) throw new Error('Missing parameter @' + name + '. Supply it with QAIRA_DATA_JSON.');
    return String(params[name]);
  });
  const resolve = (value: RuntimeValue): RuntimeValue => typeof value === 'string' ? text(value) : Array.isArray(value) ? value.map(resolve) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k,v]) => [k,resolve(v)])) : value;
  const repositoryIndex = new Map(Object.entries(repository).map(([reference,expression]) => [reference.toLowerCase(),expression]));
  const repositoryScreens = new Set([...repositoryIndex.keys(),...Object.keys(repositoryIssues)].map(reference => reference.slice(0,reference.indexOf('.'))).filter(Boolean));
  const repositoryTarget = (target: unknown): string => {
    const value=text(target),key=value.toLowerCase();
    if(repositoryIssues[key])throw new Error(repositoryIssues[key]);
    if(repositoryIndex.has(key))return text(repositoryIndex.get(key));
    if(/^[\w -]+\.[\w .-]+$/.test(value) && repositoryScreens.has(key.slice(0,key.indexOf('.'))))throw new Error('Missing repository reference '+value+'. Export its saved locator before running this test.');
    return value;
  };
  const repositoryLocator = (scope: RuntimeValue, expression: string): Locator => {
    const suffix=expression.match(/\.(nth\(\s*(\d+)\s*\)|first\(\s*\)|last\(\s*\))$/);
    const value=suffix ? expression.slice(0,suffix.index) : expression;
    const argument = (name='') => {
      const pattern=name ? new RegExp('\\b'+name+'["\x27]?\\s*:\\s*(["\x27\x60])((?:\\\\.|(?!\\1)[\\s\\S])*?)\\1','i') : /\(\s*(["'\x60])((?:\\.|(?!\1)[\s\S])*?)\1/;
      const first=value.match(/\(\s*(["'\x60])((?:\\.|(?!\1)[\s\S])*?)\1/);
      const input=name && first ? value.slice(first.index!+first[0].length) : value;
      const match=input.match(pattern);if (!match) throw new Error('Repository locator requires a literal '+(name || 'first argument')+'. Export the original locator as Playwright source when using expressions or regular expressions.');
      if(match[1] === String.fromCharCode(96) && match[2].includes('$'+'{'))throw new Error('Dynamic repository locator expressions must be authored in the section source.');
      if (match[1] === '"') {try {return JSON.parse('"'+match[2]+'"');} catch {}}
      return match[2].replace(/\\(["'\x60\\])/g,'$1');
    };
    const method=value.match(/^(?:page\.)?(getByRole|getByLabel|getByPlaceholder|getByText|getByTestId|getByTitle|getByAltText|locator)\s*\(/i)?.[1];
    let exact=true,hasName=false;
    if(!method && /^(?:page\.)?getBy\w+\s*\(/i.test(value))throw new Error('Unsupported repository locator method: '+value);
    if (method) {
      let depth=0,quote='',escaped=false,closed=false;
      for(let index=value.indexOf('(');index<value.length;index++) {
        const char=value[index];
        if(quote){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char===quote)quote='';}
        else if(['"',"'",String.fromCharCode(96)].includes(char))quote=char;
        else if(char==='(')depth++;
        else if(char===')'&&--depth===0){if(value.slice(index+1).trim())throw new Error('Unsupported repository locator chain');closed=true;break;}
      }
      if(!closed)throw new Error('Invalid repository locator');
      argument();
      // Never ignore selector options: doing so can select a different element.
      // Strip literal contents before checking the small supported option grammar.
      const structure=value.replace(/(["'\x60])(?:\\.|(?!\1)[\s\S])*?\1/g,(literal,quote,offset) => /^\s*:/.test(value.slice(offset+literal.length)) ? literal.slice(1,-1) : '""');
      hasName=/\bname\s*:/.test(structure);
      if(hasName)argument('name');
      exact=!/\bexact\s*:\s*false\b/.test(structure);
      const argumentsText=structure.slice(structure.indexOf('(')+1,-1).trim();
      const allowedOptions=method.toLowerCase() === 'getbyrole' ? /^(?:name\s*:\s*""|exact\s*:\s*(?:true|false))(?:\s*,\s*(?:name\s*:\s*""|exact\s*:\s*(?:true|false)))*\s*,?\s*$/ : /^exact\s*:\s*(?:true|false)\s*,?\s*$/;
      const options=argumentsText.match(/^""\s*,\s*\{([\s\S]*)\}\s*$/);
      const keys=[...structure.matchAll(/\b(name|exact)\s*:/g)].map(match=>match[1]);
      if(argumentsText !== '""' && (!options || ['locator','getbytestid'].includes(method.toLowerCase()) || (options[1].trim() && !allowedOptions.test(options[1].trim())) || new Set(keys).size !== keys.length))throw new Error('Unsupported repository locator options. Preserve them in authored Playwright section source instead of dropping selector constraints.');
    }
    const role=value.match(/^role=([^\[]+)(?:\[name=["']?(.+?)["']?\])?$/i);
    const shorthand=value.match(/^(text|label|placeholder|title|alt|alttext|testid|data-testid)=(.+)$/i);
    let found;
    if (method?.toLowerCase()==='getbyrole') {const name=hasName ? argument('name') : undefined;found=scope.getByRole(argument(),name !== undefined ? {name,exact} : undefined);}
    else if (method?.toLowerCase()==='locator') found=scope.locator(argument());
    else if (method) found=scope[({getbylabel:'getByLabel',getbyplaceholder:'getByPlaceholder',getbytext:'getByText',getbytestid:'getByTestId',getbytitle:'getByTitle',getbyalttext:'getByAltText'} as Record<string,string>)[method.toLowerCase()]](argument(),{exact});
    else if (role) found=scope.getByRole(role[1].trim(),role[2] ? {name:role[2],exact} : undefined);
    else if (shorthand) found=scope[({text:'getByText',label:'getByLabel',placeholder:'getByPlaceholder',title:'getByTitle',alt:'getByAltText',alttext:'getByAltText',testid:'getByTestId','data-testid':'getByTestId'} as Record<string,string>)[shorthand[1].toLowerCase()]](shorthand[2].replace(/^["']|["']$/g,''),{exact});
    else found=scope.locator(value);
    return suffix ? suffix[1].startsWith('nth') ? found.nth(Number(suffix[2])) : suffix[1].startsWith('last') ? found.last() : found.first() : found;
  };
  const locator = (target: unknown): Locator => repositoryLocator(page,repositoryTarget(target));
  const url = (value: unknown): string => baseURL ? new URL(text(value), baseURL).href : text(value);
  // Match the runner's native Playwright bindings: source authored with page.*
  // resolves data and repository references just like web.* instructions.
  const originals = new WeakMap<object,RuntimeValue>();
  const proxies = new WeakMap<object,RuntimeValue>();
  const interpolateMethods = new Set(['getByRole','getByText','getByLabel','getByPlaceholder','getByTestId','getByTitle','getByAltText','fill','type','press','pressSequentially','selectOption','filter']);
  const selectorMethods = new Set(['click','dblclick','fill','type','press','check','uncheck','selectOption','setInputFiles','hover','focus','textContent','innerText','inputValue','getAttribute','waitForSelector']);
  const transform = (value: RuntimeValue, interpolate = false): RuntimeValue => {
    if (typeof value === 'string') return interpolate ? text(value) : value;
    if (!value || typeof value !== 'object') return value;
    if (originals.has(value)) return originals.get(value);
    if (Array.isArray(value)) return value.map(entry => transform(entry,interpolate));
    if (Object.getPrototypeOf(value) === Object.prototype) return Object.fromEntries(Object.entries(value).map(([key,entry]) => [key,transform(entry,interpolate)]));
    return value;
  };
  const wrapPage = (target: RuntimeValue): RuntimeValue => {
    if (!target || typeof target !== 'object') return target;
    const isPage = typeof target.goto === 'function' && typeof target.locator === 'function';
    const isLocator = typeof target.count === 'function' && typeof target.click === 'function';
    const isFrameLocator = typeof target.frameLocator === 'function' && typeof target.getByRole === 'function';
    if (!isPage && !isLocator && !isFrameLocator) return target;
    if (proxies.has(target)) return proxies.get(target);
    const proxy = new Proxy(target,{get(native,key) {
      const method=Reflect.get(native,key,native);
      if (typeof method !== 'function' || key === 'constructor') return method;
      return (...input: RuntimeValue[]) => {
        const name=String(key),args=input.map(value => transform(value,interpolateMethods.has(name)));
        if (name === 'locator' && typeof args[0] === 'string') {
          const resolved=repositoryTarget(args[0]);
          if (/^(?:page\.)?(?:getBy\w+|locator)\s*\(|^(?:role|text|label|placeholder|title|alt|alttext|testid|data-testid)=/.test(resolved)) {
            const found=repositoryLocator(native,resolved);return wrapPage(args[1] ? found.filter(args[1]) : found);
          }
          args[0]=resolved;
        }
        if (isPage && selectorMethods.has(name) && typeof args[0] === 'string') {
          args[0]=repositoryTarget(args[0]);
          if (/^(?:page\.)?(?:getBy\w+|locator)\s*\(|^(?:role|text|label|placeholder|title|alt|alttext|testid|data-testid)=/.test(args[0])) {
            const found=repositoryLocator(native,args[0]);
            if(name === 'waitForSelector')return (async () => {
              await found.waitFor(args[1]);
              return ['hidden','detached'].includes(args[1]?.state) ? null : found.elementHandle({timeout:args[1]?.timeout});
            })();
            return (found as RuntimeValue)[name](...args.slice(1));
          }
        }
        if (isPage && name === 'goto' && typeof args[0] === 'string') args[0]=url(args[0]);
        const result=method.apply(native,args);
        return result && typeof result.then === 'function' ? result.then(wrapPage) : wrapPage(result);
      };
    }});
    originals.set(proxy,target);proxies.set(target,proxy);return proxy;
  };
  // Resolve expected data at the matcher boundary, after unwrapping the actual
  // locator/page. Native, negated, soft and polling checks retain their normal
  // Playwright behavior while using the same scoped values as recorded inputs.
  const wrapMatchers = (matchers: RuntimeValue): RuntimeValue => new Proxy(matchers,{get(target,key) {
    const value=Reflect.get(target,key,target);
    if (['not','resolves','rejects'].includes(String(key)) && value && typeof value === 'object') return wrapMatchers(value);
    return typeof value === 'function' && /^to[A-Z]/.test(String(key))
      ? (...args: RuntimeValue[]) => value.apply(target,args.map(argument => transform(argument,true))) : value;
  }});
  const wrapExpect = (native: RuntimeValue): RuntimeValue => new Proxy(native,{
    apply(target,receiver,args) {return wrapMatchers(Reflect.apply(target,receiver,args.map(value => transform(value))));},
    get(target,key) {
      const value=Reflect.get(target,key,target);
      if (['poll','soft'].includes(String(key)) && typeof value === 'function') return (...args: RuntimeValue[]) => wrapMatchers(value.apply(target,args.map(argument => transform(argument))));
      if (key === 'configure' && typeof value === 'function') return (...args: RuntimeValue[]) => wrapExpect(value.apply(target,args));
      return value;
    }
  });
  const expect = wrapExpect(playwrightExpect.configure({timeout:executionOptions.assertionTimeout}));
  const activate = (next: Page) => { page=next; onPageChange(wrapPage(next)); };
  const findTab = async (target: RuntimeValue): Promise<Page> => {
    const pages=context.pages(); if (target === 'current' || target?.current) return page;
    if (target === undefined || target === null || target === 'latest' || target?.latest) { const latest=pages.at(-1); if (!latest) throw new Error('No browser tab is open'); return latest; }
    let found;if (typeof target === 'number' || /^\d+$/.test(String(target))) found=pages[Number(target)];
    else if (typeof target === 'object' && target.index !== undefined) found=pages[target.index];
    else if (target === 'first') found=pages[0];
    else { for (const candidate of pages) { if (typeof target === 'object' ? target.title ? (await candidate.title()).includes(text(target.title)) : target.url && candidate.url().includes(text(target.url)) : candidate.url().includes(text(target))) { found=candidate;break; } } }
    if (!found) throw new Error('Requested browser tab was not found'); return found;
  };
  const web = {
    step: (name: unknown, fn: () => Promise<unknown>) => test.step(text(name), fn),
    goto: (value: unknown, options?: Parameters<Page['goto']>[1]) => page.goto(url(value), options), reload: (options?: Parameters<Page['reload']>[0]) => page.reload(options), goBack: (options?: Parameters<Page['goBack']>[0]) => page.goBack(options), goForward: (options?: Parameters<Page['goForward']>[0]) => page.goForward(options),
    openTab: async (value?: unknown) => { activate(await context.newPage()); if (value) await page.goto(url(value)); },
    switchTab: async (target: RuntimeValue) => { activate(await findTab(target)); await page.bringToFront(); },
    closeTab: async (target?: RuntimeValue) => { const closing = target === undefined || target === null ? page : await findTab(target); await closing.close(); if (closing === page) activate(context.pages().at(-1) || await context.newPage()); },
    tabs: async () => Promise.all(context.pages().map(async (candidate,index) => ({index,title:await candidate.title(),url:candidate.url(),active:candidate===page}))),
    click: (target: unknown, options?: RuntimeValue) => locator(target).click(options), hover: (target: unknown, options?: RuntimeValue) => locator(target).hover(options), dblclick: (target: unknown, options?: RuntimeValue) => locator(target).dblclick(options), rightClick: (target: unknown, options?: RuntimeValue) => locator(target).click({...options,button:'right'}),
    fill: (target: unknown, value: unknown, options?: RuntimeValue) => locator(target).fill(text(value), options), clear: (target: unknown) => locator(target).clear(), select: (target: unknown, value: unknown) => locator(target).selectOption(text(value)), check: (target: unknown) => locator(target).check(), uncheck: (target: unknown) => locator(target).uncheck(),
    uploadFile: (target: unknown, value: string | string[]) => locator(target).setInputFiles(Array.isArray(value) ? value.map(text) : text(value)), uploadLocalFile: (target: unknown, value: string | string[]) => locator(target).setInputFiles(Array.isArray(value) ? value.map(text) : text(value)),
    uploadRemoteFile: async (target: unknown, value: unknown) => { const response = await request.get(url(value)); expect(response.ok()).toBeTruthy(); await locator(target).setInputFiles({name:'download',mimeType:response.headers()['content-type'] || 'application/octet-stream',buffer:await response.body()}); },
    press: (target: unknown, value: unknown) => target ? locator(target).press(text(value)) : page.keyboard.press(text(value)), drag: (from: unknown, to: unknown) => locator(from).dragTo(locator(to)),
    scroll: (deltaX?: RuntimeValue, deltaY?: RuntimeValue, options: Record<string,RuntimeValue> = {}) => { const amount=Number(options.amount || 500); const direction=options.direction; return page.mouse.wheel(Number(options.deltaX ?? deltaX ?? (direction === 'left' ? -amount : direction === 'right' ? amount : 0)),Number(options.deltaY ?? deltaY ?? (direction === 'up' ? -amount : direction === 'left' || direction === 'right' ? 0 : amount))); },
    wait: (value: unknown) => page.waitForTimeout(Number(text(value))), waitForTimeout: (value: unknown) => page.waitForTimeout(Number(text(value))), resolve:text, capture,
    waitForLoadState: (state: 'load' | 'domcontentloaded' | 'networkidle' | 'commit', options?: Parameters<Page['waitForLoadState']>[1]) => page.waitForLoadState(state === 'commit' ? 'domcontentloaded' : state, options),
    expectVisible: (target: unknown) => expect(locator(target)).toBeVisible(), expectHidden: (target: unknown) => expect(locator(target)).toBeHidden(), expectText: (target: unknown, value?: unknown, options: {match?: string} = {}) => value === undefined || value === null ? expect(page.locator("body")).toContainText(text(target)) : options.match === "equals" ? expect(locator(target)).toHaveText(text(value)) : expect(locator(target)).toContainText(text(value)), expectValue: (target: unknown, value: unknown, options: {match?: string} = {}) => options.match === "equals" ? expect(locator(target)).toHaveValue(text(value)) : expect.poll(() => locator(target).inputValue()).toContain(text(value)), expectEnabled: (target: unknown) => expect(locator(target)).toBeEnabled(), expectUrl: (value: unknown) => expect.poll(() => page.url()).toContain(text(value)),
    text: (target: unknown) => locator(target).innerText(), value: (target: unknown) => locator(target).inputValue(), captureText: async (target: unknown, key: unknown) => capture(key, await locator(target).innerText()), screenshot: (name?: unknown) => page.screenshot({path:text(name || 'automation') + '.png'}),
    aiStep: async () => { throw new Error('Build this instruction before exporting it.'); }
  };
  const readJsonPath = (body: RuntimeValue, path: unknown): RuntimeValue => {
    const query=String(path || '$').trim();if(!query.startsWith('$'))throw new Error('JPath must start with $');
    if(query==='$')return body;
    if(queryJsonPath)return queryJsonPath(body,query);
    return query.replace(/^\$\.?/, '').replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean).reduce((value,key) => value?.[key],body);
  };
  let lastResponse: {status:number;headers:Record<string,string>;body:RuntimeValue;durationMs:number} | undefined;
  const api = {
    request: async (input: RuntimeValue) => {
      const spec = typeof input === 'string' ? {method:'GET',url:input} : resolve(Object.fromEntries(Object.entries(input).filter(([key]) => !['captures','validations'].includes(key))));
      const headers = Array.isArray(spec.headers) ? Object.fromEntries(spec.headers.map((h: RuntimeValue) => [h.key,h.value])) : {...spec.headers};
      const query = spec.query || Object.fromEntries((spec.query_params || []).map((p: RuntimeValue) => [p.key,p.value]));
      const auth = spec.auth || {}; const credential = auth.credentialReference || auth.credential_reference;
      if (auth.type && auth.type !== 'none') { const secret = process.env[String(credential || '')]; if (!secret) throw new Error('Set credential environment variable: ' + credential); if (auth.type === 'api_key') {if(auth.location === 'query')query[auth.key_name || 'api_key']=secret;else headers[auth.key_name || 'Authorization'] = secret;} else headers.Authorization = (auth.type === 'basic' ? 'Basic ' : 'Bearer ') + secret; }
      const cookies = Array.isArray(spec.cookies) ? Object.fromEntries(spec.cookies.map((c: RuntimeValue) => [c.key,c.value])) : spec.cookies;
      if (cookies && Object.keys(cookies).length) headers.Cookie = Object.entries(cookies).map(([key,value]) => key + '=' + value).join('; ');
      const bodyMode = spec.bodyMode || spec.body_mode; const start = Date.now();
      const response = await request.fetch(url(spec.url), {method:spec.method || 'GET',headers,params:query,timeout:spec.timeoutMs || spec.timeout_ms || 30000,maxRedirects:(spec.followRedirects ?? spec.follow_redirects) === false ? 0 : 20,...(bodyMode === 'form' ? {form:Object.fromEntries(new URLSearchParams(spec.body || ''))} : spec.body && bodyMode !== 'none' ? {data:bodyMode === 'json' && typeof spec.body === 'string' ? JSON.parse(spec.body) : spec.body} : {})});
      const raw = await response.text(); let body; try { body = JSON.parse(raw); } catch { body = raw; }
      lastResponse = {status:response.status(),headers:response.headers(),body,durationMs:Date.now()-start}; return lastResponse;
    },
    expectStatus: (expected: unknown) => expect(lastResponse?.status).toBe(Number(text(expected))), expectJson: (path: unknown, value: unknown) => expect(readJsonPath(lastResponse?.body,text(path))).toEqual(value), capture: (path: unknown,key: unknown) => capture(key,readJsonPath(lastResponse?.body,text(path)))
  };
  return {web,api,capture,readJsonPath,text,locator,expect,wrapPage};
}
`;
function runtimeForUsage(usage) {
    let source = runtime;
    if (!usage.web) {
        const start = source.indexOf("  const activate = ");
        const end = source.indexOf("  const readJsonPath = ", start);
        source = source.slice(0, start) + "  const web = undefined;\n" + source.slice(end);
    }
    if (!usage.api) {
        const start = source.indexOf("  let lastResponse:");
        const end = source.indexOf("  return {web,api,", start);
        source = source.slice(0, start) + "  const api = undefined;\n" + source.slice(end);
    }
    if (!usage.readJsonPath) {
        const start = source.indexOf("  const readJsonPath = ");
        const end = source.indexOf("  const api = undefined;", start);
        source = source.slice(0, start) + "  const readJsonPath = undefined;\n" + source.slice(end);
    }
    return source;
}
function exportValidation(validation) {
    if (validation.kind !== "json_path" && validation.kind !== "header")
        return buildApiValidationAssertionCode(validation, "response");
    const expression = validation.kind === "header" ? `response.headers[${JSON.stringify((validation.target || "").toLowerCase())}]` : `readJsonPath(response.body,${JSON.stringify(validation.target || "$")})`;
    const raw = validation.expected || "";
    let expected = JSON.stringify(raw);
    if (validation.kind === "json_path") {
        try {
            expected = JSON.stringify(JSON.parse(raw));
        }
        catch { }
    }
    const operator = validation.operator || "eq";
    if (operator === "exists")
        return `expect(${expression}).toBeDefined();`;
    if (operator === "matches")
        return `expect(String(${expression})).toMatch(new RegExp(${JSON.stringify(raw)}));`;
    const methods = { eq: "toEqual", ne: "not.toEqual", contains: "toContain", lt: "toBeLessThan", lte: "toBeLessThanOrEqual", gt: "toBeGreaterThan", gte: "toBeGreaterThanOrEqual" };
    return `expect(${expression}).${methods[operator] || "toEqual"}(${expected});`;
}
export function createPlaywrightExecutionOptions(runtimeSettings = {}) {
    const timeout = (key, fallback, min, max) => {
        const value = Number.parseInt(String(runtimeSettings[key] ?? ""), 10);
        return Math.min(max, Math.max(min, Number.isFinite(value) ? value : fallback));
    };
    const mode = (key, allowed) => allowed.includes(String(runtimeSettings[key])) ? String(runtimeSettings[key]) : "off";
    const executionOptions = { actionTimeout: timeout("action_timeout_ms", 5000, 250, 120000), navigationTimeout: timeout("navigation_timeout_ms", 30000, 1000, 600000), assertionTimeout: timeout("assertion_timeout_ms", 10000, 250, 120000), timeout: timeout("run_timeout_seconds", 1800, 60, 21600) * 1000,
        video: mode("video_mode", ["off", "on", "retain-on-failure", "on-first-retry"]), trace: mode("trace_mode", ["off", "on", "retain-on-failure", "on-first-retry"]), screenshotOnSuccess: runtimeSettings.screenshot_on_success !== false, screenshotOnFailure: runtimeSettings.screenshot_on_failure !== false };
    return executionOptions;
}
/** One deterministic emitter for UI downloads and backend-issued artifacts. It never executes saved source. */
export function buildPlaywrightArtifact({ testCase, steps, rows: data = [{}], sectionRows, objects = {}, repositoryIssues = {}, baseURL = "", executionOptions = createPlaywrightExecutionOptions(), plainText = value => String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(), formatSource = code => code }) {
    sectionRows ||= data.map(row => steps.map(() => ({ ...row })));
    const sectionOptions = step => String(step.automation_code || step.action || "").match(/^\s*\/\/\s*@hellotest-options\s+([^\n]+)/i)?.[1].split(/\s+/) || [];
    const runtimeUsage = automationExportRuntimeUsage(steps.filter(step => !sectionOptions(step).includes("skip")).map(step => step.step_type === "api" ? "api.request();" : step.automation_code));
    const artifactRuntime = runtimeForUsage(runtimeUsage);
    const hookIssue = hasConfiguredCaseExecutionHooks(testCase.execution_hooks)
        ? "This case has linked Before/After cases. Execute it with the case runner, or include their saved setup and cleanup in this standalone suite before running it."
        : "";
    const extraImports = [], dependencies = [], issues = [];
    if (hookIssue) issues.push(hookIssue);
    if (!steps.length)
        issues.push('This automation case has no executable sections. Build or author its sections before running the exported test.');
    let usesSchema = false, usesJsonPath = false;
    const lines = steps.map((step, sectionIndex) => {
        const options = sectionOptions(step);
        const skipped = options.includes("skip");
        let apiSpec = null, requestIssue = "";
        if (step.step_type === "api" && !skipped) {
            try {
                apiSpec = parseApiRequestSource(JSON.stringify(step.api_request));
            }
            catch (error) {
                requestIssue = error instanceof Error ? error.message : "Save an executable API request before exporting this section.";
            }
        }
        if (apiSpec) {
            usesSchema ||= Boolean(apiSpec.validations?.some(validation => validation.kind === "json_schema"));
            usesJsonPath ||= Boolean(apiSpec.captures?.length || apiSpec.validations?.some(validation => validation.kind === "json_path"));
        }
        const source = apiSpec ? [`const response = await api.request(${JSON.stringify(apiSpec)});`, ...(apiSpec.validations || []).map(validation => exportValidation(validation).replace(/"(?:\\.|[^"\\])*"/g, literal => /@[tsr]\./i.test(JSON.parse(literal)) ? `text(${literal})` : literal)), ...(apiSpec.captures || []).map(item => `capture(${JSON.stringify(item.parameter)}, readJsonPath(response.body, ${JSON.stringify(item.path)}));`)].join("\n") : step.automation_code?.trim();
        const native = step.step_type === "android" || step.step_type === "ios";
        const prepared = native || skipped || requestIssue ? { code: "", imports: [], dependencies: [], issue: undefined } : prepareAutomationExportSource(source || "", sectionIndex, { typescript: true });
        extraImports.push(...prepared.imports);
        dependencies.push(...prepared.dependencies);
        if (prepared.issue)
            issues.push(`Section ${step.step_order} (${step.id}): ${prepared.issue}`);
        if (requestIssue)
            issues.push(`Section ${step.step_order} (${step.id}): ${requestIssue}`);
        if (native && !skipped)
            issues.push(`Section ${step.step_order} (${step.id}) requires the Appium runner; Playwright cannot execute native mobile instructions.`);
        let code = requestIssue ? `throw new Error(${JSON.stringify(`Standalone export blocked: ${requestIssue}`)});` : native ? `throw new Error(${JSON.stringify("Native mobile section requires the Appium runner: " + plainText(step.action))});` : prepared.code || `throw new Error(${JSON.stringify("Build this section before execution: " + plainText(step.action))});`;
        if (skipped)
            code = "return; // Skipped section";
        else if (options.includes("optional"))
            code = "try {\n" + code + "\n} catch (error) { console.warn('Optional section failed', error instanceof Error ? error.message : String(error)); }";
        const name = plainText(step.action) || "Section " + step.step_order;
        const region = `${step.step_order}. ${name}${step.group_name ? " · " + step.group_name : ""}`.replace(/[\r\n\u2028\u2029]/g, " ");
        const screenshot = step.step_type === "web" && !skipped;
        // Never indent physical source lines: whitespace inside multiline literals is data.
        const section = `await test.step(${JSON.stringify(name)}, async () => {\n${formatSource(code)}\n});`;
        const executed = screenshot ? `try {\n${section}\n  if (executionOptions.screenshotOnSuccess) await attachScreenshot(${JSON.stringify(`section-${step.step_order}-completed`)});\n} catch (error) {\n  if (executionOptions.screenshotOnFailure${options.includes("screenshotOnFailure") ? " || true" : ""}) await attachScreenshot(${JSON.stringify(`section-${step.step_order}-failed`)});\n  throw error;\n}` : section;
        return `  // #region ${region}\n  // Section ${String(step.step_order).replace(/[\r\n]/g, " ")} [${String(step.id).replace(/[\r\n]/g, " ")}]\n  for (const key of Object.keys(params)) delete params[key];\n  Object.assign(params,sectionRows[iteration][${sectionIndex}],overrides,captured);\n${executed}\n  // #endregion`;
    });
    const schemaSupport = usesSchema ? "import Ajv from 'ajv';\nconst ajv = new Ajv();\nconst validateJsonSchema = (body: unknown, schema: object) => ({valid: Boolean(ajv.validate(schema,body))});\n" : "";
    const exportNotes = [...new Set(dependencies)].filter(module => !module.startsWith("node:")).map(module => /^\.{0,2}\//.test(module) ? `// External helper file required: ${module.replace(/[\r\n]/g, " ")} — copy it to the matching path beside this spec; its source was not included in the saved section.` : `// External dependency: ${module.replace(/[\r\n]/g, " ")} — install this package before running the spec.`).concat([...issues, ...Object.values(repositoryIssues)].map(issue => `// Export limitation: ${issue.replace(/[\r\n]/g, " ")}`)).join("\n");
    return `// Save as automation.spec.ts. Install: npm i -D @playwright/test typescript @types/node${usesSchema ? " ajv" : ""}${usesJsonPath ? " jsonpath-plus" : ""}\n// Browser setup: npx playwright install chromium\n// Type check: npx tsc --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution Bundler automation.spec.ts\n// Run: npx playwright test automation.spec.ts\n// Override missing/private values with QAIRA_DATA_JSON='{"t.secret":"..."}'.\n${exportNotes}\nimport { test, expect as playwrightExpect, type Page, type Locator, type APIRequestContext, type BrowserContext } from '@playwright/test';\n${[...new Set(extraImports)].join('\n')}\n${usesJsonPath ? "import { JSONPath } from 'jsonpath-plus';\n" : ""}${schemaSupport}const queryJsonPath: ((body: RuntimeValue,path: string) => RuntimeValue) | undefined = ${usesJsonPath ? "(body,path) => JSONPath({path,json:body,eval:false,wrap:true})[0]" : "undefined"};\nconst executionOptions = ${JSON.stringify(executionOptions, null, 2)} as const;\ntest.use({actionTimeout:executionOptions.actionTimeout,navigationTimeout:executionOptions.navigationTimeout,video:executionOptions.video,trace:executionOptions.trace,screenshot:'off'});\ntest.setTimeout(executionOptions.timeout);\n\n// #region Test data\nconst rows: DataValues[] = ${JSON.stringify(data, null, 2)};\nconst sectionRows: DataValues[][] = ${JSON.stringify(sectionRows, null, 2)};\n// #endregion\n\n// #region Repository and Playwright bindings\nconst repository: Record<string,string> = ${JSON.stringify(objects, null, 2)};\nconst repositoryIssues: Record<string,string> = ${JSON.stringify(repositoryIssues, null, 2)};\n${artifactRuntime}\n// #endregion\n\nfor (const [iteration, defaults] of rows.entries()) {\n test(${JSON.stringify(testCase.title)} + ' [row ' + (iteration + 1) + ']', async ({page,request,context,browser,browserName},testInfo) => {\n  const overrides = JSON.parse(process.env.QAIRA_DATA_JSON || '{}');\n  const captured: DataValues = {};\n  const params: DataValues = {...defaults,...overrides};\n${hookIssue ? `  throw new Error(${JSON.stringify(hookIssue)});\n` : ''}  const baseURL = process.env.QAIRA_BASE_URL || ${JSON.stringify(baseURL)};\n  if (baseURL) await page.goto(baseURL);\n  let playwrightPage = page;\n  const driver = undefined;\n  const {web,api,capture,readJsonPath,locator,text,expect,wrapPage} = runtimeFor(page,request,context,params,repository,baseURL,captured,next => { page=next; playwrightPage=next; });\n  page=wrapPage(page);\n  playwrightPage=page;\n  const bindings = {get page(){return page;},web,api,expect,params,capture,get playwrightPage(){return playwrightPage;},driver,test,request,context,browser,browserName,testInfo};\n  const attachScreenshot = async (name: string) => {\n    try {\n      if (!page.isClosed()) await testInfo.attach(name,{body:await page.screenshot({type:'jpeg',quality:55,fullPage:false,scale:'css'}),contentType:'image/jpeg'});\n    } catch (error) { console.warn('Screenshot capture unavailable',error instanceof Error ? error.message : String(error)); }\n  };\n${lines.length ? lines.join("\n") : '  throw new Error("This automation case has no executable sections. Build or author its sections before running the exported test.");'}\n });\n}\n`;
}
