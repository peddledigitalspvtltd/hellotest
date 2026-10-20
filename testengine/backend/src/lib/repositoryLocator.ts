import type { Page, Locator } from "playwright";
import { parseExpressionAt } from "acorn";

const readRepositoryExpression = (expression: string, method: string) => {
  let node: any;
  try { node = parseExpressionAt(expression, 0, { ecmaVersion: "latest" }); }
  catch { throw new Error("Invalid repository locator expression."); }
  if (node.type !== "CallExpression" || node.end !== expression.length || !node.arguments.length || node.arguments.length > 2) throw new Error("Unsupported repository locator expression.");
  const literal = (argument: any): string => {
    if (argument?.type === "Literal" && typeof argument.value === "string" && !argument.regex) return argument.value;
    if (argument?.type === "TemplateLiteral" && !argument.expressions.length && typeof argument.quasis[0].value.cooked === "string") return argument.quasis[0].value.cooked;
    throw new Error("Repository locator arguments must use supported quoted string literals; regex and variable arguments cannot be widened to a different locator.");
  };
  const value = literal(node.arguments[0]);
  const options: { name?: string; exact: boolean } = { exact: true };
  if (node.arguments.length === 2) {
    const argument = node.arguments[1];
    if (argument.type !== "ObjectExpression") throw new Error("Repository locator options must be a literal object.");
    const seen = new Set<string>();
    for (const property of argument.properties) {
      const key = property.key?.name ?? property.key?.value;
      if (property.type !== "Property" || property.computed || property.method || property.shorthand || !["name", "exact"].includes(key) || key === "name" && method !== "getbyrole" || method === "locator" || method === "getbytestid" || seen.has(key)) throw new Error("Unsupported repository locator option; use an explicit supported locator instead of discarding its constraints.");
      seen.add(key);
      if (key === "name") options.name = literal(property.value);
      else if (property.value.type === "Literal" && typeof property.value.value === "boolean") options.exact = property.value.value;
      else throw new Error("Repository locator exact must be a literal boolean.");
    }
  }
  return { value, options };
};

const resolveBaseRepositoryLocator = (page: Page, expression: string): Locator => {
  const locator = String(expression || "").trim();
  const getByMatch = locator.match(/^(?:page\.)?(getByRole|getByLabel|getByPlaceholder|getByText|getByTestId|getByTitle|getByAltText)\s*\(/i);

  if (getByMatch) {
    const method = getByMatch[1].toLowerCase();
    const { value, options } = readRepositoryExpression(locator, method);
    if (method === "getbytestid") return page.getByTestId(value);
    if (method === "getbylabel") return page.getByLabel(value, options);
    if (method === "getbyplaceholder") return page.getByPlaceholder(value, options);
    if (method === "getbytext") return page.getByText(value, options);
    if (method === "getbytitle") return page.getByTitle(value, options);
    if (method === "getbyalttext") return page.getByAltText(value, options);
    const role = value as Parameters<Page["getByRole"]>[0];
    return page.getByRole(role, options);
  }

  if (/^(?:page\.)?locator\s*\(/i.test(locator)) return page.locator(readRepositoryExpression(locator, "locator").value);
  if (/^(?:page\.)?getBy\w+\s*\(/i.test(locator)) throw new Error("Unsupported semantic repository locator method.");
  const roleMatch = locator.match(/^role=([^\[]+)(?:\[name=["']?(.+?)["']?\])?$/i);
  if (roleMatch) {
    const role = roleMatch[1].trim() as Parameters<Page["getByRole"]>[0];
    return page.getByRole(role, roleMatch[2] ? { name: roleMatch[2], exact: !/\bexact\s*:\s*false\b/i.test(locator) } : undefined);
  }
  const textMatch = locator.match(/^text=(.+)$/i);
  if (textMatch) return page.getByText(textMatch[1].replace(/^["']|["']$/g, ""), { exact: true });
  const labelMatch = locator.match(/^label=(.+)$/i);
  if (labelMatch) return page.getByLabel(labelMatch[1].replace(/^["']|["']$/g, ""), { exact: !/\bexact\s*:\s*false\b/i.test(locator) });
  const placeholderMatch = locator.match(/^placeholder=(.+)$/i);
  if (placeholderMatch) return page.getByPlaceholder(placeholderMatch[1].replace(/^["']|["']$/g, ""), { exact: !/\bexact\s*:\s*false\b/i.test(locator) });
  const titleMatch = locator.match(/^title=(.+)$/i);
  if (titleMatch) return page.getByTitle(titleMatch[1].replace(/^["']|["']$/g, ""), { exact: true });
  const altMatch = locator.match(/^(?:alt|alttext)=(.+)$/i);
  if (altMatch) return page.getByAltText(altMatch[1].replace(/^["']|["']$/g, ""), { exact: true });
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
