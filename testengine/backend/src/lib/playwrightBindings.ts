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
  const interpolateMethods = new Set(["getByRole", "getByText", "getByLabel", "getByPlaceholder", "getByTestId", "getByTitle", "getByAltText", "fill", "type", "press", "pressSequentially", "selectOption", "filter"]);
  const selectorMethods = new Set(["click", "dblclick", "fill", "type", "press", "check", "uncheck", "selectOption", "setInputFiles", "hover", "focus", "textContent", "innerText", "inputValue", "getAttribute", "waitForSelector"]);
  const transform = (value: unknown, interpolate = false): any => {
    if (typeof value === "string") return interpolate ? options.interpolate(value) : value;
    if (!value || typeof value !== "object") return value;
    if (originals.has(value)) return originals.get(value);
    if (Array.isArray(value)) return value.map((entry) => transform(entry, interpolate));
    if (Object.getPrototypeOf(value) === Object.prototype) return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, transform(entry, interpolate)]));
    return value;
  };
  const wrap = (target: any): any => {
    if (!target || typeof target !== "object") return target;
    // Requests, responses, handles and arbitrary evaluate results keep their native values.
    const isLocator = typeof target.count === "function" && typeof target.click === "function";
    const isPageOrFrame = typeof target.goto === "function" && typeof target.locator === "function";
    const isFrameLocator = typeof target.frameLocator === "function" && typeof target.getByRole === "function";
    if (!isLocator && !isPageOrFrame && !isFrameLocator) return target;
    if (proxies.has(target)) return proxies.get(target);
    const proxy = new Proxy(target, {
      get(native, key) {
        const value = Reflect.get(native, key, native);
        if (typeof value !== "function" || key === "constructor") return value;
        return (...input: unknown[]) => {
          const name = String(key);
          const args = input.map((arg) => transform(arg, interpolateMethods.has(name)));
          if (name === "locator" && typeof args[0] === "string") {
            args[0] = options.resolveLocator(options.interpolate(args[0]));
            if (isPageOrFrame && /^(?:page\.)?(?:getBy\w+|locator)\s*\(|^(?:role|label|placeholder|text|testid|data-testid)=/.test(args[0])) {
              const locator = resolveRepositoryLocator(native as Page, args[0]);
              return wrap(args[1] ? locator.filter(args[1]) : locator);
            }
          }
          if (isPageOrFrame && selectorMethods.has(name) && typeof args[0] === "string") args[0] = options.resolveLocator(options.interpolate(args[0]));
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
  const expect = new Proxy(nativeExpect, {
    apply(target, receiver, args) { return Reflect.apply(target, receiver, args.map((arg) => transform(arg))); }
  });
  return { page: wrap(page) as Page, expect };
}
