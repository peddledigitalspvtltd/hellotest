import type { Page } from "playwright";
import { expect as playwrightExpect } from "playwright/test";
import { resolveRepositoryLocator } from "./repositoryLocator.js";

/** Keep the public Playwright API intact while resolving application data and repository references. */
export function createPlaywrightCodeBindings(page: Page, options: {
  interpolate: (value: string) => string;
  resolveLocator: (value: string) => string;
  resolveUrl: (value: string) => string;
  assertionTimeout: number;
}) {
  const originals = new WeakMap<object, object>();
  const proxies = new WeakMap<object, object>();
  const interpolateMethods = new Set(["getByRole", "getByText", "getByLabel", "getByPlaceholder", "getByTestId", "getByTitle", "getByAltText", "fill", "type", "press", "pressSequentially", "insertText", "selectOption", "filter", "waitForURL"]);
  const selectorMethods = new Set(["click", "dblclick", "fill", "type", "press", "check", "uncheck", "selectOption", "setInputFiles", "hover", "focus", "textContent", "innerText", "inputValue", "getAttribute", "waitForSelector"]);
  const semanticSelector = (value: string) => /^(?:page\.)?(?:getBy\w+|locator)\s*\(|^(?:role|label|placeholder|text|testid|data-testid|title|alt|alttext)=/.test(value);
  const transform = (value: unknown, interpolate = false): any => {
    if (typeof value === "string") return interpolate ? options.interpolate(value) : value;
    if (!value || typeof value !== "object") return value;
    if (originals.has(value)) return originals.get(value);
    if (Array.isArray(value)) {
      const entries = value.map((entry) => transform(entry, interpolate));
      return entries.every((entry, index) => entry === value[index]) ? value : entries;
    }
    if (Object.getPrototypeOf(value) === Object.prototype) {
      const entries = Object.entries(value).map(([key, entry]) => [key, transform(entry, interpolate)] as const);
      return entries.every(([key, entry]) => entry === (value as Record<string, unknown>)[key]) ? value : Object.fromEntries(entries);
    }
    return value;
  };
  const keyboards = new WeakSet<object>();
  const wrap = (target: any): any => {
    if (!target || typeof target !== "object") return target;
    // Requests, responses, handles and arbitrary evaluate results keep their native values.
    const isLocator = typeof target.count === "function" && typeof target.click === "function";
    const isPageOrFrame = typeof target.goto === "function" && typeof target.locator === "function";
    const isFrameLocator = typeof target.frameLocator === "function" && typeof target.getByRole === "function";
    if (!isLocator && !isPageOrFrame && !isFrameLocator && !keyboards.has(target)) return target;
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
          // File payload buffers are data, never parameterized source. Only
          // path inputs (including path arrays) use the same late binding as
          // the instruction upload helper.
          if (name === "setInputFiles") {
            const index = isPageOrFrame ? 1 : 0;
            if (typeof args[index] === "string" || Array.isArray(args[index]) && args[index].every((entry: unknown) => typeof entry === "string")) args[index] = transform(args[index], true);
          }
          if (name === "locator" && typeof args[0] === "string") {
            args[0] = options.resolveLocator(options.interpolate(args[0]));
            if (isPageOrFrame && semanticSelector(args[0])) {
              const locator = resolveRepositoryLocator(native as Page, args[0]);
              return wrap(args[1] ? locator.filter(args[1]) : locator);
            }
          }
          if (isPageOrFrame && selectorMethods.has(name) && typeof args[0] === "string") {
            args[0] = options.resolveLocator(options.interpolate(args[0]));
            if (semanticSelector(args[0])) {
              const locator = resolveRepositoryLocator(native as Page, args[0]);
              if (name === "waitForSelector") {
                const settings = args[1] || {};
                return locator.waitFor(settings).then(() => ["hidden", "detached"].includes(settings.state) ? null : locator.elementHandle());
              }
              const method = (locator as any)[name];
              const result = method.apply(locator, args.slice(1));
              return result && typeof result.then === "function" ? result.then(wrap) : wrap(result);
            }
          }
          if (isPageOrFrame && name === "goto" && typeof args[0] === "string") args[0] = options.resolveUrl(options.interpolate(args[0]));
          const result = value.apply(native, args);
          return result && typeof result.then === "function" ? result.then(wrap) : wrap(result);
        };
      }
    });
    originals.set(proxy, target);
    proxies.set(target, proxy);
    return proxy;
  };
  const nativeExpect = playwrightExpect.configure({ timeout: options.assertionTimeout });
  const wrapMatchers = (target: any): any => new Proxy(target, {
    get(native, key) {
      const value = Reflect.get(native, key, native);
      if (typeof value === "function") return (...args: unknown[]) => Reflect.apply(value, native, args.map(arg => transform(arg, true)));
      return value && typeof value === "object" ? wrapMatchers(value) : value;
    }
  });
  const wrapExpect = (target: typeof nativeExpect): typeof nativeExpect => new Proxy(target, {
    apply(native, receiver, args) { return wrapMatchers(Reflect.apply(native, receiver, args.map(arg => transform(arg)))); },
    get(native, key) {
      const value = Reflect.get(native, key, native);
      if (key === "soft" || key === "poll") return (...args: unknown[]) => wrapMatchers(Reflect.apply(value, native, args.map(arg => transform(arg))));
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
