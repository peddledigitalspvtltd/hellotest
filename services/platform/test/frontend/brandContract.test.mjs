import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (relativePath) =>
  readFile(new URL(relativePath, import.meta.url), "utf8");

test("the shared brand lockup renders the HelloTest target mark and wordmark", async () => {
  const wordmark = await readSource("../../frontend/src/platform/components/BrandWordmark.tsx");

  assert.match(wordmark, /aria-label=\{subtitle \? `HelloTest/);
  assert.match(wordmark, /className="hellotest-brand-icon"/);
  assert.match(wordmark, /className="hellotest-brand-hello">Hello/);
  assert.match(wordmark, /className="hellotest-brand-test">Test/);
  assert.doesNotMatch(wordmark, />Q<\/span>/);
});

test("the login page uses the supplied HelloTest platform tagline", async () => {
  const authPage = await readSource("../../frontend/pages/AuthPage.tsx");
  const index = await readSource("../../frontend/index.html");

  assert.match(authPage, /subtitle="AI Agentic Test Platform"/);
  assert.match(authPage, /Sign in to HelloTest/);
  assert.doesNotMatch(authPage, /Secure workspace access/);
  assert.match(index, /<title>HelloTest<\/title>/);
});

test("brand styling keeps the full and compact lockups responsive", async () => {
  const styles = await readSource("../../frontend/src/styles.css");

  assert.match(styles, /\.hellotest-brand-icon/);
  assert.match(styles, /\.hellotest-brand-test \{[\s\S]*?linear-gradient/);
  assert.match(styles, /\.sidebar\.is-collapsed[\s\S]*?\.hellotest-brand-wordmark\.is-mark-only/);
  assert.match(styles, /@media \(max-width: 560px\)/);
  assert.match(styles, /\.auth-page \.left\.auth-aside \{\s+display: none/);
});
