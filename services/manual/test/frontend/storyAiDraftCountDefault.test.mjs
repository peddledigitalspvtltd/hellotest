import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../../frontend/pages/RequirementsPage.tsx", import.meta.url), "utf8");

// The AI studio used to start on three drafts, and a change of the initial state alone did nothing: opening the studio runs
// a reset that set the count again. These checks hold the initial state, the reset on open and the empty-select fallback to
// the same single default, so one of them cannot drift back to a different number unnoticed.
test("the Story AI studio asks for one draft by default, however it is opened", () => {
  const declared = page.match(/const DEFAULT_STORY_AI_DRAFT_COUNT = (\d+);/);
  assert.ok(declared, "the default is declared once, as a named constant");
  assert.equal(Number(declared[1]), 1, "a batch must come back complete for every draft, so the default stays at one");

  assert.match(page, /useState\(DEFAULT_STORY_AI_DRAFT_COUNT\)/, "the initial state uses the default");
  assert.match(page, /setRequirementAiDraftCount\(DEFAULT_STORY_AI_DRAFT_COUNT\);/, "opening the studio resets to the default");

  const fallbacks = page.match(/setRequirementAiDraftCount\(Number\(event\.target\.value\) \|\| DEFAULT_STORY_AI_DRAFT_COUNT\)/g) || [];
  assert.equal(fallbacks.length, 2, "both Count selects fall back to the default when the value is empty");
});

test("no other literal sets the Story AI draft count to a number", () => {
  // A template may legitimately ask for its own size (clamped to 1-6); a bare literal in a reset or fallback may not.
  const literalSetters = [...page.matchAll(/setRequirementAiDraftCount\((\d+)\)/g)].map((match) => match[0]);
  assert.deepEqual(literalSetters, [], "use DEFAULT_STORY_AI_DRAFT_COUNT instead of a number");
});

test("a person can still ask for up to six drafts", () => {
  assert.match(page, /\{\[1, 2, 3, 4, 5, 6\]\.map\(\(count\) => \(/);
});
