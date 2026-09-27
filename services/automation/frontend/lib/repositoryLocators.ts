/** Use captured attributes as data; never evaluate a locator or captured HTML. */
export function buildAttributeLocator(tag: string, attributes: Array<[string, string]>, scope = "", index?: number) {
  const quote = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\n\r\f]/g, "\\a ")}"`;
  const element = /^[a-z][a-z0-9-]*$/i.test(tag) ? tag.toLowerCase() : "*";
  const selector = element + attributes.filter(([name]) => /^[a-z_][a-z0-9_-]*$/i.test(name)).map(([name, value]) => `[${name}=${quote(value)}]`).join("");
  const scoped = scope.trim() ? `${scope.trim()} ${selector}` : selector;
  return index !== undefined && Number.isInteger(index) && index >= 0 ? `${scoped} >> nth=${index}` : scoped;
}

type Member = { ref: string; entry: { id: string; test_case_id?: string | null; locator?: string | null } };
/** Only exact string references count; a similar field name must not associate another case. */
export function isRepositoryMemberUsed(member: Member, caseId: string | undefined, steps: Array<{ automation_code?: string | null; objectRefs?: string[] }>) {
  if (!caseId) return false;
  if (member.entry.test_case_id === caseId) return true;
  const references = new Set([member.ref, member.entry.locator].filter(Boolean));
  return steps.some((step) => {
    if (step.objectRefs?.some((value) => references.has(value))) return true;
    // Consume comments before strings so example/commented-out code does not
    // associate unrelated repository objects. Dynamic templates are not bindings.
    const literals = (step.automation_code || "").matchAll(/\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|(["'`])((?:\\.|(?!\1)[^\\\r\n])*)\1/g);
    for (const match of literals) {
      if (!match[1] || (match[1] === "`" && match[2].includes("${"))) continue;
      const value = match[2].replace(/\\(["'`\\])/g, "$1");
      if (references.has(value)) return true;
    }
    return false;
  });
}
