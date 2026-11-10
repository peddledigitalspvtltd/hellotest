import { errors, type Page, type Frame, type Locator, type ElementHandle, type JSHandle, type Request } from "playwright";
import { expect as playwrightExpect } from "playwright/test";
import { resolveRepositoryLocator } from "./repositoryLocator.js";

export const PARAMETER_EXPRESSIONS_MARKER = "// @hellotest-parameter-bindings expressions-v1";
const FRAME_SCOPE_VERIFICATION_TIMEOUT_MS = 2000;

export type PlaywrightNavigationWait = {
  state: "navigation";
  status: "ready" | "timed_out";
  timeout_ms: number;
  duration_ms: number;
  timestamp: string;
  message: string;
};

function completedClickNavigationLog(message: string): boolean {
  const lines = message.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const start = lines.lastIndexOf("Call log:");
  if (start < 0) return false;
  const log = lines.slice(start + 1).map(line => line.replace(/^-\s*/, ""));
  const completed = log.lastIndexOf("click action done");
  if (completed < 0 || log[completed + 1] !== "waiting for scheduled navigations to finish") return false;
  // Pinned Playwright DOM/SignalBarrier progress may continue after commit.
  // Accept only navigation progress; later retries/actionability invalidate proof.
  return log.slice(completed + 2).every(line => line === "navigations have finished"
    || /^navigated to "[^"\r\n]+"$/.test(line)
    || /^"(?:commit|domcontentloaded|load|networkidle)" event fired$/.test(line));
}

/** Finish an accepted click's existing navigation without ever repeating the click. */
export async function runPlaywrightClick<T>(page: Page, action: () => Promise<T>, options: {
  navigationTimeout: number;
  actionOptions?: unknown;
  afterNavigation?: () => Promise<void>;
  onNavigationWait?: (wait: PlaywrightNavigationWait) => void;
}): Promise<T> {
  const authored = options.actionOptions as { timeout?: number; noWaitAfter?: boolean; trial?: boolean } | undefined;
  if (!Number.isFinite(options.navigationTimeout) || options.navigationTimeout <= 0
    || authored?.timeout !== undefined || authored?.noWaitAfter !== undefined || authored?.trial) return action();
  const mainFrame = page.mainFrame();
  const documentUrl = (value: string) => { const url = new URL(value); url.hash = ""; return url.href; };
  let pending: Request | undefined, navigationStarted = 0, committedAt = 0, closed = false;
  let notify: (() => void) | undefined;
  const requested = (request: Request) => {
    if (!request.isNavigationRequest() || request.frame() !== mainFrame) return;
    navigationStarted ||= Date.now();
    pending = request;
    committedAt = 0;
  };
  const navigated = (frame: Frame) => {
    // An unrelated same-document hash change cannot commit a pending request.
    if (frame !== mainFrame || !pending || documentUrl(frame.url()) !== documentUrl(pending.url())) return;
    pending = undefined;
    committedAt = Date.now();
    notify?.();
  };
  const failed = (request: Request) => { if (request === pending) { pending = undefined; notify?.(); } };
  const terminated = () => { closed = true; notify?.(); };
  page.on("request", requested);
  page.on("framenavigated", navigated);
  page.on("requestfailed", failed);
  page.on("close", terminated);
  page.on("crash", terminated);
  try {
    let result: T;
    try { result = await action(); }
    catch (error) {
      // Playwright 1.59 uses the action timer for its post-click signal barrier.
      // Recover only its completed-click/navigation log AND an observed pending
      // or committed document navigation. Commit may arrive before the native
      // timeout response. Actionability failures and other errors stay failures.
      const message = error instanceof Error ? error.message.replace(/\u001b\[[0-9;]*m/g, "") : "";
      if (!(error instanceof errors.TimeoutError) || (!pending && !committedAt) || closed
        || !completedClickNavigationLog(message)) throw error;
      const remaining = options.navigationTimeout - ((committedAt || Date.now()) - navigationStarted);
      let timedOut = remaining <= 0;
      if (!committedAt && !timedOut) await new Promise<void>(resolve => {
        const timer = setTimeout(() => { timedOut = true; resolve(); }, remaining);
        notify = () => { clearTimeout(timer); resolve(); };
      });
      if (closed || !timedOut && !committedAt) throw error;
      timedOut ||= (committedAt || Date.now()) - navigationStarted >= options.navigationTimeout;
      const wait: PlaywrightNavigationWait = {
        state: "navigation", status: timedOut ? "timed_out" : "ready", timeout_ms: options.navigationTimeout,
        duration_ms: (committedAt || Date.now()) - navigationStarted, timestamp: new Date().toISOString(),
        message: "Click completed; used its observed main-document navigation without repeating the action."
      };
      options.onNavigationWait?.(wait);
      if (timedOut) throw new errors.TimeoutError(`Main-document navigation: Timeout ${options.navigationTimeout}ms exceeded after the click completed. The click was not repeated.\n${message}`);
      // Native click resolves void; authored assertions still decide readiness.
      result = undefined as T;
    }
    if (committedAt) await options.afterNavigation?.();
    return result;
  } finally {
    page.off("request", requested);
    page.off("framenavigated", navigated);
    page.off("requestfailed", failed);
    page.off("close", terminated);
    page.off("crash", terminated);
  }
}

/** Only an actual leading line comment opts a section into native JS bindings. */
export function usesExpressionParameterBindings(source: unknown): boolean {
  if (typeof source !== "string") return false;
  let remaining = source;
  while ((remaining = remaining.trimStart())) {
    if (remaining.startsWith("//")) {
      const end = remaining.search(/[\r\n]/);
      if ((end < 0 ? remaining : remaining.slice(0, end)).trimEnd() === PARAMETER_EXPRESSIONS_MARKER) return true;
      if (end < 0) return false;
      remaining = remaining.slice(end);
    } else if (remaining.startsWith("/*")) {
      const end = remaining.indexOf("*/", 2);
      if (end < 0) return false;
      remaining = remaining.slice(end + 2);
    } else return false;
  }
  return false;
}

/** Keep the public Playwright API intact while resolving application data and repository references. */
export function createPlaywrightCodeBindings(page: Page, options: {
  interpolate: (value: string) => string;
  resolveLocator: (value: string) => string;
  resolveUrl: (value: string) => string;
  assertionTimeout: number;
  navigationTimeout?: number;
  afterNavigation?: () => Promise<void>;
  onNavigationWait?: (wait: PlaywrightNavigationWait) => void;
  parameterExpressions?: boolean;
}) {
  const click = <T>(action: () => Promise<T>, actionOptions: unknown) => options.navigationTimeout === undefined ? action()
    : runPlaywrightClick(page, action, { navigationTimeout: options.navigationTimeout, actionOptions,
      afterNavigation: options.afterNavigation, onNavigationWait: options.onNavigationWait });
  const interpolate = (value: string) => options.parameterExpressions ? value : options.interpolate(value);
  const originals = new WeakMap<object, object>();
  const proxies = new WeakMap<object, object>();
  type LocatorStep = { name: string; args: unknown[] };
  type FrameOwnerRecipe = { key: string; steps: LocatorStep[] };
  type FrameRecipe = { path: FrameOwnerRecipe[]; steps: LocatorStep[] };
  type FrameOwner = { owner: ElementHandle; parentDocument: JSHandle };
  const frameRecipes = new WeakMap<object, FrameRecipe>(), locatorRecipes = new WeakMap<object, FrameRecipe>(), frameOwners = new Map<string, FrameOwner>();
  const httpOrigin = (value: unknown) => { try { const url = new URL(String(value)); return ["http:", "https:"].includes(url.protocol) ? url.origin : undefined; } catch { return undefined; } };
  let frameOrigin = typeof page.url === "function" ? httpOrigin(page.url()) : undefined;
  const frameFailure = () => Object.assign(new Error("The embedded document is no longer a unique visible same-origin frame. No further frame operation was performed; inspect the current application before continuing."), { code: "AUTOMATION_FRAME_SCOPE_INVALID" });
  const frameBuilders = new Set(["locator", "getByRole", "getByText", "getByLabel", "getByPlaceholder", "getByTestId", "getByTitle", "getByAltText", "filter", "nth", "first", "last", "describe"]);
  const frameActions = new Set(["click", "dblclick", "tap", "fill", "type", "press", "pressSequentially", "selectOption", "check", "uncheck", "setChecked", "hover", "focus", "blur", "clear", "setInputFiles", "dispatchEvent"]);
  const frameReads = new Set(["count", "isVisible", "isHidden", "isEnabled", "isDisabled", "isEditable", "isChecked", "innerText", "textContent", "inputValue", "getAttribute", "allTextContents", "allInnerTexts", "waitFor", "boundingBox", "screenshot"]);
  const framePathValid = (path: FrameOwnerRecipe[]) => path.length > 0 && path.length <= 3
    && path.every(owner => owner.steps.length > 0 && owner.steps.length <= 20 && typeof owner.key === "string" && owner.key.trim() && owner.key.length <= 2000 && !/[\u0000-\u001f\u007f]/.test(owner.key));
  const pathKey = (path: FrameOwnerRecipe[]) => JSON.stringify(path.map(owner => owner.key));
  const samePath = (left: FrameOwnerRecipe[], right: FrameOwnerRecipe[]) => pathKey(left) === pathKey(right);
  const argumentsFor = (value: any, root: Page | Frame, path: FrameOwnerRecipe[]): any => {
    const nested = value && typeof value === "object" ? frameRecipes.get(value) || locatorRecipes.get(value) : undefined;
    if (nested) { if (!samePath(nested.path, path)) throw frameFailure(); return locate(root, nested.steps, path); }
    if (Array.isArray(value)) return value.map(item => argumentsFor(item, root, path));
    if (value && Object.getPrototypeOf(value) === Object.prototype) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, argumentsFor(item, root, path)]));
    return value;
  };
  const locate = (root: Page | Frame, steps: LocatorStep[], path: FrameOwnerRecipe[]): any => steps.reduce((locator: any, step) => locator[step.name](...step.args.map(value => argumentsFor(value, root, path))), root);
  // FrameLocator re-resolves its owner automatically. Validate a current frame
  // and then use that actual Frame, with pinned nodes for every interaction,
  // so replacement cannot redirect a checked operation to a foreign document.
  const frameContext = async (recipe: FrameRecipe, requestedTimeout?: number) => {
    if (!framePathValid(recipe.path)) throw frameFailure();
    const configuredTimeout = Math.max(1, Number(options.assertionTimeout) || 8000);
    const deadline = Date.now() + (requestedTimeout && requestedTimeout > 0 ? requestedTimeout : configuredTimeout);
    const remaining = () => Math.max(1, deadline - Date.now());
    let origin: string;
    try { const current = httpOrigin(page.url()); frameOrigin ||= current; if (!current || current !== frameOrigin) throw frameFailure(); origin = current; } catch { throw frameFailure(); }
    let root: Page | Frame = page;
    const anchors: Array<{ parent: Page | Frame; recipe: FrameOwnerRecipe; path: FrameOwnerRecipe[]; owner: ElementHandle; frame: Frame; document: JSHandle }> = [];
    const close = async () => { await Promise.all(anchors.map(anchor => anchor.document.dispose().catch(() => undefined))); };
    try {
      for (let depth = 0; depth < recipe.path.length; depth++) {
        const ownerRecipe = recipe.path[depth], parentPath = recipe.path.slice(0, depth), target = locate(root, ownerRecipe.steps, parentPath) as Locator, key = pathKey(recipe.path.slice(0, depth + 1));
        await target.waitFor({ state: "attached", timeout: remaining() });
        if (await target.count() !== 1) throw frameFailure();
        let known = frameOwners.get(key);
        if (known) {
          const sameDocument = await root.evaluate(documentHandle => documentHandle === document, known.parentDocument).catch(() => false);
          if (sameDocument && !await target.evaluate((element, owner) => element === owner, known.owner, { timeout: remaining() })) throw frameFailure();
          if (!sameDocument) { await Promise.all([known.owner.dispose(), known.parentDocument.dispose()].map(task => task.catch(() => undefined))); frameOwners.delete(key); known = undefined; }
        }
        if (!known) {
          if (frameOwners.size >= 12) throw frameFailure();
          const owner = await target.elementHandle({ timeout: remaining() }); if (!owner) throw frameFailure();
          known = { owner, parentDocument: await root.evaluateHandle(() => document) }; frameOwners.set(key, known);
        }
        let frame = await known.owner.contentFrame();
        if (!frame) {
          await target.waitFor({ state: "visible", timeout: remaining() });
          frame = await known.owner.contentFrame();
        }
        if (!frame || frame.isDetached()) throw frameFailure();
        if (frame.url() === "about:blank") {
          const declared = await known.owner.evaluate(element => { const owner = element as Element; return { src: owner.getAttribute("src"), base: owner.ownerDocument.baseURI, srcdoc: owner.hasAttribute("srcdoc") }; });
          // Initial inherited about:blank may precede a same-origin commit.
          // It never authorizes input, opaque documents or foreign targets.
          if (declared.srcdoc || declared.src && declared.src !== "about:blank" && httpOrigin(new URL(declared.src, declared.base).href) !== origin) throw frameFailure();
          try { if (await frame.evaluate(() => self.origin) !== origin) throw frameFailure(); }
          catch (error) { if ((error as { code?: string }).code === "AUTOMATION_FRAME_SCOPE_INVALID" || !/execution context was destroyed|cannot find context|context.*destroyed/i.test(String((error as Error).message))) throw error; }
          await frame.waitForURL(url => {
            if (url.href === "about:blank") return false;
            if (httpOrigin(url.href) !== origin) throw frameFailure();
            return true;
          }, { waitUntil: "commit", timeout: remaining() });
        }
        if (httpOrigin(frame.url()) !== origin || await frame.evaluate(() => self.origin) !== origin) throw frameFailure();
        await target.waitFor({ state: "visible", timeout: remaining() });
        if (await target.count() !== 1 || !await target.evaluate((element, original) => element === original, known.owner, { timeout: remaining() })) throw frameFailure();
        anchors.push({ parent: root, recipe: ownerRecipe, path: parentPath, owner: known.owner, frame, document: await frame.evaluateHandle(() => document) }); root = frame;
      }
      const current = async (timeoutMs = FRAME_SCOPE_VERIFICATION_TIMEOUT_MS) => {
        const scopeDeadline = Date.now() + timeoutMs;
        const scopeRemaining = () => Math.max(1, scopeDeadline - Date.now());
        let timer: ReturnType<typeof setTimeout> | undefined;
        const verify = async () => {
          if (new URL(page.url()).origin !== origin) throw frameFailure();
          for (const anchor of anchors) {
            const owner = locate(anchor.parent, anchor.recipe.steps, anchor.path) as Locator;
            if (anchor.frame.isDetached() || await owner.count() !== 1 || !await owner.isVisible()
              || !await owner.evaluate((element, original) => element === original, anchor.owner, { timeout: scopeRemaining() })
              || new URL(anchor.frame.url()).origin !== origin
              || !await anchor.frame.evaluate(({ documentHandle, origin }) => documentHandle === document && self.origin === origin, { documentHandle: anchor.document, origin })) throw frameFailure();
          }
        };
        try { await Promise.race([verify(), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(frameFailure()), timeoutMs); })]); }
        catch { throw frameFailure(); }
        finally { clearTimeout(timer); }
      };
      await current(remaining());
      return { frame: root as Frame, document: anchors.at(-1)!.document, locator: locate(root, recipe.steps, recipe.path), current, remaining, close };
    } catch { await close(); throw frameFailure(); }
  };
  const withVerifiedFrame = async <T>(context: Awaited<ReturnType<typeof frameContext>>, operation: () => Promise<T>) => {
    let result: T;
    try { result = await operation(); }
    catch (error) { await context.current(); throw error; }
    // Scope verification is a bounded identity check, not an assertion retry.
    // It must still run after the assertion has used its complete allowance.
    await context.current();
    return result;
  };
  const runFramed = async (recipe: FrameRecipe, name: string, args: unknown[]) => {
    const context = await frameContext(recipe);
    try {
      if (frameActions.has(name) || ["evaluate", "evaluateHandle", "elementHandle"].includes(name)) {
        if (await context.locator.count() !== 1) throw frameFailure();
        const handle: ElementHandle | null = await context.locator.elementHandle({ timeout: context.remaining() });
        if (!handle) throw frameFailure();
        try {
          await context.current(context.remaining());
          if (await handle.ownerFrame() !== context.frame || !await handle.evaluate((element, documentHandle) => element.ownerDocument === documentHandle, context.document)) throw frameFailure();
          if (name === "elementHandle") return handle;
          const method = (handle as any)[name === "pressSequentially" ? "type" : name === "clear" ? "fill" : name];
          if (typeof method !== "function") throw frameFailure();
          return await (name === "click" ? click(() => method.apply(handle, args), args[0])
            : method.apply(handle, name === "clear" ? ["", ...args] : args));
        } finally { if (name !== "elementHandle") await handle.dispose().catch(() => undefined); }
      }
      if (!frameReads.has(name)) throw frameFailure();
      return await withVerifiedFrame(context, () => context.locator[name](...args));
    }
    finally { await context.close(); }
  };
  const interpolateMethods = new Set(["getByRole", "getByText", "getByLabel", "getByPlaceholder", "getByTestId", "getByTitle", "getByAltText", "fill", "type", "press", "pressSequentially", "insertText", "selectOption", "filter", "waitForURL"]);
  const selectorMethods = new Set(["click", "dblclick", "fill", "type", "press", "check", "uncheck", "selectOption", "setInputFiles", "hover", "focus", "textContent", "innerText", "inputValue", "getAttribute", "waitForSelector"]);
  const semanticSelector = (value: string) => /^(?:page\.)?(?:getBy\w+|locator)\s*\(|^(?:role|label|placeholder|text|testid|data-testid|title|alt|alttext)=/.test(value);
  const withAssertionTimeout = (value: unknown) => {
    const settings = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    return settings.timeout === undefined ? { ...settings, timeout: options.assertionTimeout } : value;
  };
  const transform = (value: unknown, shouldInterpolate = false): any => {
    if (typeof value === "string") return shouldInterpolate ? interpolate(value) : value;
    if (!value || typeof value !== "object") return value;
    if (originals.has(value)) return originals.get(value);
    if (Array.isArray(value)) {
      const entries = value.map((entry) => transform(entry, shouldInterpolate));
      return entries.every((entry, index) => entry === value[index]) ? value : entries;
    }
    if (Object.getPrototypeOf(value) === Object.prototype) {
      const entries = Object.entries(value).map(([key, entry]) => [key, transform(entry, shouldInterpolate)] as const);
      return entries.every(([key, entry]) => entry === (value as Record<string, unknown>)[key]) ? value : Object.fromEntries(entries);
    }
    return value;
  };
  const keyboards = new WeakSet<object>();
  const wrap = (target: any, recipe?: FrameRecipe, locatorRecipe?: FrameRecipe): any => {
    if (!target || typeof target !== "object") return target;
    // Requests, responses, handles and arbitrary evaluate results keep their native values.
    const isLocator = typeof target.count === "function" && typeof target.click === "function";
    const isPageOrFrame = typeof target.goto === "function" && typeof target.locator === "function";
    const isFrameLocator = typeof target.frameLocator === "function" && typeof target.getByRole === "function";
    if (!isLocator && !isPageOrFrame && !isFrameLocator && !keyboards.has(target)) return target;
    if (recipe) frameRecipes.set(target, recipe);
    if (isLocator && (recipe || locatorRecipe)) locatorRecipes.set(target, (recipe || locatorRecipe)!);
    if (proxies.has(target)) return proxies.get(target);
    const proxy = new Proxy(target, {
      get(native, key) {
        const value = Reflect.get(native, key, native);
        if (isPageOrFrame && key === "keyboard" && value && typeof value === "object") {
          keyboards.add(value);
          return wrap(value);
        }
        if (typeof value !== "function" || key === "constructor") return value;
        return (...input: unknown[]) => {
          const name = String(key);
          const args = input.map((arg) => transform(arg, interpolateMethods.has(name)));
          const navigationOptions = name === "goto" ? args[1] : args[0];
          const defaultNavigationWait = native === page && ["goto", "reload", "goBack", "goForward"].includes(name)
            && (!navigationOptions || typeof navigationOptions !== "object" || (navigationOptions as { waitUntil?: string }).waitUntil === undefined);
          if (defaultNavigationWait) {
            if (name === "goto") args[1] = { ...(args[1] as object || {}), waitUntil: "commit" };
            else args[0] = { ...(args[0] as object || {}), waitUntil: "commit" };
          }
          // Playwright otherwise gives locator.waitFor() the shorter action
          // timeout. It is a read-only condition wait, so use the configured
          // assertion budget; preserve any timeout authored in the source.
          if (isLocator && name === "waitFor") args[0] = withAssertionTimeout(args[0]);
          if (isPageOrFrame && name === "waitForSelector") args[1] = withAssertionTimeout(args[1]);
          if (isPageOrFrame && name === "waitForFunction") {
            if (args.length < 2) args[1] = undefined;
            args[2] = withAssertionTimeout(args[2]);
          }
          const framed = frameRecipes.get(native);
          if (name === "toString") return value.apply(native, args);
          if (name === "contentFrame") {
            const owner = locatorRecipes.get(native);
            if (!isLocator || args.length || !owner?.steps.length) throw frameFailure();
            // Native MCP emits Locator.contentFrame(). Retain the original
            // owner chain and subject it to the same pinned-frame checks.
            const path = [...owner.path, { key: String(native), steps: owner.steps }];
            if (!framePathValid(path)) throw frameFailure();
            return wrap(value.apply(native, args), { path, steps: [] });
          }
          if (name === "frameLocator") {
            const parent = isLocator ? locatorRecipes.get(native) : framed;
            if (args.length !== 1 || typeof args[0] !== "string" || isLocator && !parent) throw frameFailure();
            const steps = [...(isLocator ? parent!.steps : []), { name: "locator", args }];
            const path = [...(parent?.path || []), { key: isLocator ? `${String(native)}.frameLocator(${JSON.stringify(args[0])})` : `frameLocator(${JSON.stringify(args[0])})`, steps }];
            if (!framePathValid(path)) throw frameFailure();
            return wrap(value.apply(native, args), { path, steps: [] });
          }
          // File payload buffers are data, never parameterized source. Only
          // path inputs (including path arrays) use the same late binding as
          // the instruction upload helper.
          if (name === "setInputFiles") {
            const index = isPageOrFrame ? 1 : 0;
            if (typeof args[index] === "string" || Array.isArray(args[index]) && args[index].every((entry: unknown) => typeof entry === "string")) args[index] = transform(args[index], true);
          }
          if (name === "locator" && typeof args[0] === "string") {
            args[0] = options.resolveLocator(interpolate(args[0]));
            if (isPageOrFrame && semanticSelector(args[0])) {
              const locator = resolveRepositoryLocator(native as Page, args[0]);
              return wrap(args[1] ? locator.filter(args[1]) : locator);
            }
          }
          if (isPageOrFrame && selectorMethods.has(name) && typeof args[0] === "string") {
            args[0] = options.resolveLocator(interpolate(args[0]));
            if (semanticSelector(args[0])) {
              const locator = resolveRepositoryLocator(native as Page, args[0]);
              if (name === "waitForSelector") {
                const settings = args[1] || {};
                return locator.waitFor(settings).then(() => ["hidden", "detached"].includes(settings.state) ? null : locator.elementHandle());
              }
              const method = (locator as any)[name];
              const result = name === "click" ? click(() => method.apply(locator, args.slice(1)), args[1]) : method.apply(locator, args.slice(1));
              return result && typeof result.then === "function" ? result.then(wrap) : wrap(result);
            }
          }
          if (isPageOrFrame && name === "goto" && typeof args[0] === "string") {
            args[0] = options.resolveUrl(interpolate(args[0]));
            if (native === page) frameOrigin ||= httpOrigin(args[0]);
          }
          if (framed) {
            if (frameBuilders.has(name)) return wrap(value.apply(native, args), { path: [...framed.path], steps: [...framed.steps, { name, args }] });
            return runFramed(framed, name, args);
          }
          const result = name === "click" && (isLocator || isPageOrFrame)
            ? click(() => value.apply(native, args), args[isPageOrFrame ? 1 : 0]) : value.apply(native, args);
          const parent = locatorRecipes.get(native);
          const ownerRecipe = frameBuilders.has(name) && (isPageOrFrame || isLocator && parent)
            ? { path: parent?.path || [], steps: [...(parent?.steps || []), { name, args }] } : undefined;
          return result && typeof result.then === "function" ? result.then(async (resolved: any) => {
            if (defaultNavigationWait) await options.afterNavigation?.();
            return wrap(resolved, undefined, ownerRecipe);
          }) : wrap(result, undefined, ownerRecipe);
        };
      }
    });
    originals.set(proxy, target);
    proxies.set(target, proxy);
    return proxy;
  };
  const nativeExpect = playwrightExpect.configure({ timeout: options.assertionTimeout });
  const matcherOptionsIndex = (name: string, args: unknown[]): number | undefined => {
    if (["toBeAttached", "toBeChecked", "toBeDisabled", "toBeEditable", "toBeEmpty", "toBeEnabled", "toBeFocused", "toBeHidden", "toBeInViewport", "toBeVisible"].includes(name)) return 0;
    if (["toHaveCSS", "toHaveJSProperty"].includes(name)) return 2;
    if (name === "toHaveAttribute") return args.length > 1 && (typeof args[1] === "string" || args[1] instanceof RegExp) ? 2 : 1;
    if (["toContainClass", "toContainText", "toHaveAccessibleDescription", "toHaveAccessibleErrorMessage", "toHaveAccessibleName", "toHaveClass", "toHaveCount", "toHaveId", "toHaveRole", "toHaveText", "toHaveValue", "toHaveValues", "toMatchAriaSnapshot"].includes(name)) return 1;
    return undefined;
  };
  const expectation = (native: any, receiver: any, args: unknown[]): any => {
    const actual = transform(args[0]), recipe = actual && typeof actual === "object" ? frameRecipes.get(actual) : undefined;
    if (!recipe) return wrapMatchers(Reflect.apply(native, receiver, args.map(arg => transform(arg))));
    const template = Reflect.apply(native, receiver, args.map(arg => transform(arg)));
    const framedMatchers = (target: any, path: PropertyKey[] = []): any => new Proxy(target, { get(matchers, key) {
      const value = Reflect.get(matchers, key, matchers);
      if (typeof value === "function") return async (...expected: unknown[]) => {
        const expectedArgs = expected.map(arg => transform(arg, true)), candidate = matcherOptionsIndex(String(key), expectedArgs);
        const supplied = candidate === undefined ? undefined : expectedArgs[candidate];
        const validSettings = supplied === undefined || supplied && typeof supplied === "object" && Object.getPrototypeOf(supplied) === Object.prototype;
        const timeout = validSettings ? (supplied as { timeout?: number } | undefined)?.timeout : undefined;
        const index = validSettings && (timeout === undefined || typeof timeout === "number" && Number.isFinite(timeout) && timeout >= 0) ? candidate : undefined;
        const settings = index === undefined ? undefined : supplied as { timeout?: number } | undefined;
        const context = await frameContext(recipe, settings?.timeout);
        try { return await withVerifiedFrame(context, async () => {
          let current: any = Reflect.apply(native, receiver, [context.locator, ...args.slice(1).map(arg => transform(arg))]);
          for (const property of path) current = Reflect.get(current, property, current);
          // Readiness and the native assertion share one allowance; waiting
          // for the iframe must not restart the full assertion timeout.
          if (index !== undefined) expectedArgs[index] = { ...settings, timeout: context.remaining() };
          return await Reflect.apply(Reflect.get(current, key, current), current, expectedArgs);
        }); }
        finally { await context.close(); }
      };
      return value && typeof value === "object" ? framedMatchers(value, [...path, key]) : value;
    } });
    return framedMatchers(template);
  };
  const wrapMatchers = (target: any): any => new Proxy(target, {
    get(native, key) {
      const value = Reflect.get(native, key, native);
      if (typeof value === "function") return (...args: unknown[]) => Reflect.apply(value, native, args.map(arg => transform(arg, true)));
      return value && typeof value === "object" ? wrapMatchers(value) : value;
    }
  });
  const wrapExpect = (target: typeof nativeExpect): typeof nativeExpect => new Proxy(target, {
    apply(native, receiver, args) { return expectation(native, receiver, args); },
    get(native, key) {
      const value = Reflect.get(native, key, native);
      if (key === "soft") return (...args: unknown[]) => expectation(value, native, args);
      if (key === "poll") return (...args: unknown[]) => wrapMatchers(Reflect.apply(value, native, args.map(arg => transform(arg))));
      if (key === "configure" || key === "extend") return (...args: unknown[]) => wrapExpect(Reflect.apply(value, native, args));
      // Static asymmetric matchers also accept expected values. Other native
      // helpers retain their original return types, including functions.
      if (key === "not") return wrapMatchers(value);
      return typeof value === "function" ? (...args: unknown[]) => Reflect.apply(value, native, args.map(arg => transform(arg, true))) : value;
    }
  });
  const expect = wrapExpect(nativeExpect);
  return { page: wrap(page) as Page, expect };
}
