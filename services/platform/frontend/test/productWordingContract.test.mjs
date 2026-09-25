import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const sourceRoots = [
  new URL("../src/", import.meta.url),
  new URL("../../backend/src/", import.meta.url)
];
const retiredProductName = ["qai", "ra"].join("");
const legacyVisibleProviderPattern = /\bJira\b/;

async function sourceFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), root);
    if (entry.isDirectory()) return sourceFiles(url);
    return /\.(?:js|ts|tsx)$/.test(entry.name) ? [url] : [];
  }));
  return nested.flat();
}

test("customer-visible product wording contains no legacy provider or product branding", async () => {
  const files = (await Promise.all(sourceRoots.map(sourceFiles))).flat();
  const violations = [];

  for (const file of files) {
    const source = await readFile(file, "utf8");
    const scriptKind = file.pathname.endsWith(".tsx") ? ts.ScriptKind.TSX : file.pathname.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS;
    const ast = ts.createSourceFile(file.pathname, source, ts.ScriptTarget.Latest, true, scriptKind);
    const visit = (node) => {
      if (
        ts.isStringLiteral(node)
        || ts.isNoSubstitutionTemplateLiteral(node)
        || ts.isTemplateHead(node)
        || ts.isTemplateMiddle(node)
        || ts.isTemplateTail(node)
        || ts.isJsxText(node)
      ) {
        const visibleText = source.slice(node.getStart(ast), node.end);
        if (legacyVisibleProviderPattern.test(visibleText) || visibleText.toLowerCase().includes(retiredProductName)) {
          const line = ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1;
          violations.push(`${path.basename(file.pathname)}:${line}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }

  assert.deepEqual(violations, []);
  const seed = await readFile(new URL("../../backend/instance-setup-data/workspace/projects.json", import.meta.url), "utf8");
  assert.doesNotMatch(seed, new RegExp(`['"]${retiredProductName}(?: Support)?['"]`, "i"));
});
