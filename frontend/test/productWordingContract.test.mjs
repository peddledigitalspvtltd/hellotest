import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const sourceRoots = [
  new URL("../src/", import.meta.url),
  new URL("../../backend/api/src/", import.meta.url)
];

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
        if (/\bJira\b|\b(?:QAira|Qaira|QAIRA)\b/.test(visibleText)) {
          const line = ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1;
          violations.push(`${path.basename(file.pathname)}:${line}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }

  assert.deepEqual(violations, []);
  const seed = await readFile(new URL("../../backend/db/seed.sql", import.meta.url), "utf8");
  assert.doesNotMatch(seed, /['"](?:QAira|Qaira|QAIRA)(?: Support)?['"]/);
});
