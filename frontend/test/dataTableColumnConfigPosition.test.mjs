import assert from "node:assert/strict";
import test from "node:test";

import { resolveColumnConfigPanelPosition } from "../src/lib/tablePreferences/columnConfigPosition.ts";

const viewport = { height: 900, width: 1200 };

test("column configuration opens below when the lower viewport has room", () => {
  const position = resolveColumnConfigPanelPosition(
    { top: 100, bottom: 140, left: 1120, right: 1160 },
    viewport
  );

  assert.equal(position.placement, "below");
  assert.equal(position.top, 148);
  assert.equal(position.bottom, "auto");
  assert.equal(position.maxHeight, 544);
});

test("column configuration opens above when that side exposes more of the list", () => {
  const position = resolveColumnConfigPanelPosition(
    { top: 760, bottom: 800, left: 1120, right: 1160 },
    viewport
  );

  assert.equal(position.placement, "above");
  assert.equal(position.top, "auto");
  assert.equal(position.bottom, 148);
  assert.equal(position.maxHeight, 544);
});

test("column configuration uses a viewport-contained scroll panel when neither side is usable", () => {
  const position = resolveColumnConfigPanelPosition(
    { top: 190, bottom: 230, left: 360, right: 400 },
    { height: 420, width: 420 }
  );

  assert.equal(position.placement, "viewport");
  assert.equal(position.top, 12);
  assert.equal(position.bottom, "auto");
  assert.equal(position.maxHeight, 396);
});

test("column configuration remains horizontally inside the viewport", () => {
  const position = resolveColumnConfigPanelPosition(
    { top: 100, bottom: 140, left: 20, right: 60 },
    viewport
  );

  assert.equal(position.right, 804);
});
