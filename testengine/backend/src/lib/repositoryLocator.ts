import type { Page, Locator } from "playwright";

const readRepositoryLocatorArgument = (expression: string, name = "") => {
  const pattern = name
    ? new RegExp(`\\b${name}\\s*:\\s*(["'\x60])((?:\\\\.|(?!\\1)[\\s\\S])*?)\\1`, "i")
    : /\(\s*(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/;
  const match = expression.match(pattern);
  if (!match) return "";
  if (match[1] === '"') {
    try {
      return JSON.parse(`"${match[2]}"`);
    } catch {
      // Fall through to the conservative literal unescape below.
    }
  }
  return match[2].replace(/\\(["'`\\])/g, "$1");
};

const resolveBaseRepositoryLocator = (page: Page, expression: string): Locator => {
  const locator = String(expression || "").trim();
  const getByMatch = locator.match(/^(?:page\.)?(getByRole|getByLabel|getByPlaceholder|getByText|getByTestId)\s*\(/i);

  if (getByMatch) {
    const method = getByMatch[1].toLowerCase();
    const value = readRepositoryLocatorArgument(locator);
    if (method === "getbytestid") return page.getByTestId(value);
    if (method === "getbylabel") return page.getByLabel(value, { exact: !/\bexact\s*:\s*false\b/i.test(locator) });
    if (method === "getbyplaceholder") return page.getByPlaceholder(value, { exact: !/\bexact\s*:\s*false\b/i.test(locator) });
    if (method === "getbytext") return page.getByText(value, { exact: !/\bexact\s*:\s*false\b/i.test(locator) });
    const role = value as Parameters<Page["getByRole"]>[0];
    const name = readRepositoryLocatorArgument(locator, "name");
    return page.getByRole(role, name ? { name, exact: !/\bexact\s*:\s*false\b/i.test(locator) } : undefined);
  }

  if (/^(?:page\.)?locator\s*\(/i.test(locator)) return page.locator(readRepositoryLocatorArgument(locator));
  const roleMatch = locator.match(/^role=([^\[]+)(?:\[name=["']?(.+?)["']?\])?$/i);
  if (roleMatch) {
    const role = roleMatch[1].trim() as Parameters<Page["getByRole"]>[0];
    return page.getByRole(role, roleMatch[2] ? { name: roleMatch[2], exact: !/\bexact\s*:\s*false\b/i.test(locator) } : undefined);
  }
  const textMatch = locator.match(/^text=(.+)$/i);
  if (textMatch) return page.getByText(textMatch[1].replace(/^["']|["']$/g, ""), { exact: !/\bexact\s*:\s*false\b/i.test(locator) });
  const labelMatch = locator.match(/^label=(.+)$/i);
  if (labelMatch) return page.getByLabel(labelMatch[1].replace(/^["']|["']$/g, ""), { exact: !/\bexact\s*:\s*false\b/i.test(locator) });
  const placeholderMatch = locator.match(/^placeholder=(.+)$/i);
  if (placeholderMatch) return page.getByPlaceholder(placeholderMatch[1].replace(/^["']|["']$/g, ""), { exact: !/\bexact\s*:\s*false\b/i.test(locator) });
  const testIdMatch = locator.match(/^(?:testid|data-testid)=(.+)$/i);
  if (testIdMatch) return page.getByTestId(testIdMatch[1].replace(/^["']|["']$/g, ""));
  return page.locator(locator.replace(/^xpath=/i, "xpath="));
};

/** Shared by inspection, MCP and playback. No eval and no implicit first match. */
export function resolveRepositoryLocator(page: Page, expression: string): Locator {
  const source = String(expression || "").trim();
  const suffix = source.match(/\.(nth\(\s*(\d+)\s*\)|first\(\s*\)|last\(\s*\))$/);
  const base = suffix ? source.slice(0, suffix.index) : source;
  if (/^(?:page\.)?(?:getBy\w+|locator)\s*\(/.test(base)) {
    let depth = 0;
    let quote = "";
    let escaped = false;
    let closed = false;
    for (let index = base.indexOf("("); index < base.length; index++) {
      const char = base[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === quote) quote = "";
      } else if (["\"", "'", "`"].includes(char)) quote = char;
      else if (char === "(") depth++;
      else if (char === ")" && --depth === 0) {
        if (base.slice(index + 1).trim()) throw new Error("Unsupported locator chain. Use a scoped CSS selector or a single semantic locator with an explicit index.");
        closed = true;
        break;
      }
    }
    if (!closed) throw new Error("Invalid repository locator");
  }
  const locator = resolveBaseRepositoryLocator(page, base);
  return suffix ? suffix[1].startsWith("nth") ? locator.nth(Number(suffix[2])) : suffix[1].startsWith("last") ? locator.last() : locator.first() : locator;
}
