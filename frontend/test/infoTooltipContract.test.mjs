import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8");

test("information popovers open only from an explicit trigger activation", async () => {
  const tooltip = await readSource("../src/components/InfoTooltip.tsx");

  assert.match(tooltip, /onClick:[\s\S]*toggleOpen\(\)/);
  assert.match(tooltip, /event\.key !== "Enter" && event\.key !== " "/);
  assert.match(tooltip, /"aria-expanded": isOpen/);
  assert.doesNotMatch(tooltip, /onMouseEnter/);
  assert.doesNotMatch(tooltip, /onMouseLeave/);
  assert.doesNotMatch(tooltip, /onFocus/);
});

test("click-open information popovers retain complete dismissal behavior", async () => {
  const tooltip = await readSource("../src/components/InfoTooltip.tsx");

  assert.match(tooltip, /document\.addEventListener\("pointerdown", handlePointerDown\)/);
  assert.match(tooltip, /event\.key !== "Escape"/);
  assert.match(tooltip, /triggerRef\.current\?\.focus\(\)/);
});
