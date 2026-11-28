import type { Page } from "playwright";
import type { HelloTestWebFailureReport } from "../contracts/hellotest.js";

export function classifyWebFailure(error: Error): HelloTestWebFailureReport["code"] {
  const message = error.message.slice(0, 2_000).replace(/\x1b\[[0-9;]*m/g, "");
  const first = message.split("\n", 1)[0];
  const nativeLocator = /^(?:locator\.[a-zA-Z]+:|expect\(locator\)\.)/.test(first);
  if (nativeLocator && (/\bstrict mode violation:/i.test(first) || /^\s*(?:Error:\s*)?strict mode violation:/im.test(message))) return "locator_ambiguous";
  if (nativeLocator && /^\s*(?:Error:\s*)?element\(s\) not found\s*$/im.test(message)) return "locator_missing";
  if (/^expect\(locator\)\.to[A-Z]/.test(first) && /^Expected(?: [a-z]+)?:/m.test(message) && /^Received(?: [a-z]+)?:/m.test(message)) return "assertion_mismatch";
  if (/^(?:page\.(?:goto|reload|goBack|goForward|waitForLoadState|waitForURL|waitForNavigation):) Timeout \d+ms exceeded/.test(first)) return "navigation_timeout";
  if (/^(?:(?:page|locator|browser|browserContext)\.\w+: )?(?:Target page, context or browser has been closed|Browser has been closed)/i.test(first) || /^page\.(?:goto|reload): net::ERR_(?:NAME_NOT_RESOLVED|CONNECTION_REFUSED|INTERNET_DISCONNECTED|ADDRESS_UNREACHABLE)\b/.test(first)) return "environment_unavailable";
  if (error.name === "TimeoutError" || /^(?:locator\.[a-zA-Z]+:|page\.[a-zA-Z]+:) Timeout \d+ms exceeded/.test(first)) return "operation_timeout";
  return "unclassified";
}

export async function observeFailedWebPage(page: Page, baseUrl: string, deadline: number, stopped: () => boolean): Promise<HelloTestWebFailureReport["page"]> {
  let base: URL;
  try { base = new URL(baseUrl); } catch { return; }
  const startedAt = Date.now();
  const budget = Math.min(350, deadline - startedAt - 100);
  if (!/^https?:$/.test(base.protocol) || budget < 100 || stopped() || page.isClosed()) return;

  const url = page.url();
  let atEnvironmentStart: boolean;
  try {
    const current = new URL(url);
    if (current.origin !== base.origin) return;
    atEnvironmentStart = current.pathname === base.pathname;
  } catch { return; }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const observe = async () => {
      const result = await page.evaluate(() => {
        const nodes = document.querySelectorAll('[data-testid]');
        const candidates: Array<{ test_id: string; control: string }> = [];
        const seen = new Set<string>();
        for (let index = 0; index < Math.min(nodes.length, 500) && candidates.length < 12; index++) {
          const node = nodes[index];
          const testId = node.getAttribute('data-testid') || '';
          if (seen.has(testId) || !/^[a-z][a-z0-9_-]{1,49}$/i.test(testId) || /\d{5,}|[a-z0-9]{24}/i.test(testId)) continue;
          const control = node.localName;
          if (!['a', 'button', 'input', 'select', 'textarea', 'summary', 'h1', 'h2', 'output'].includes(control)) continue;
          if (node.closest('[hidden],[inert],[aria-hidden="true"]') || node.matches('input[type="password"],input[type="hidden"]')) continue;
          const style = window.getComputedStyle(node);
          if (style.visibility !== 'visible' || !node.getClientRects().length) continue;
          seen.add(testId);
          candidates.push({ test_id: testId, control });
        }
        return {
          document_state: document.readyState,
          document_busy: document.documentElement?.getAttribute('aria-busy') === 'true' || document.body?.getAttribute('aria-busy') === 'true',
          candidates
        };
      });
      if (stopped() || page.isClosed() || page.url() !== url || Date.now() - startedAt >= budget) return;
      // Playwright selectors include open shadow roots. Check the same locator
      // that a proposed patch would use for each candidate.
      const counts = await Promise.all(result.candidates.map(candidate => page.getByTestId(candidate.test_id).count()));
      return { ...result, candidates: result.candidates.filter((_candidate, index) => counts[index] === 1) };
    };
    const observed = await Promise.race([observe(), new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), budget); })]);
    if (!observed || stopped() || page.isClosed() || page.url() !== url || Date.now() - startedAt >= budget) return;
    return { at_environment_start: atEnvironmentStart, ...observed };
  } catch {
    // A detached or unresponsive page cannot change the original failure.
    return;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
