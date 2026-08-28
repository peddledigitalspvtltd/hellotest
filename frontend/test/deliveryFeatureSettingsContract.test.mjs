import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const readSource = (relativePath) => readFile(path.join(testDir, relativePath), "utf8");

test("Admin Feature Availability explains accumulated manual workflow boundaries", async () => {
  const [adminApp, adminApi, styles, featureTypes] = await Promise.all([
    readSource("../src/admin/AdminApp.tsx"),
    readSource("../src/admin/api.ts"),
    readSource("../src/admin/admin.css"),
    readSource("../src/types.ts")
  ]);

  assert.match(adminApp, /feature\.description \|\| ""/);
  assert.match(adminApp, /API permissions, and contextual creation controls/);
  assert.match(adminApp, /\{feature\.description \? <span>\{feature\.description\}<\/span> : null\}/);
  assert.match(adminApp, /aria-pressed=\{Boolean\(draft\[feature\.key\]\)\}/);
  assert.match(adminApp, /\(feature\.routes \|\| \[\]\)\.join\(" "\)/);
  assert.match(adminApi, /description\?: string/);
  assert.match(adminApi, /routes\?: string\[\]/);
  assert.match(featureTypes, /export type FeatureFlagDefinition[\s\S]*description\?: string/);
  assert.match(styles, /\.flag-row>div>span\{[^}]*line-height:1\.45/);
});
