import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRegionalPreferences, createRegionalFormatters, interpolateTranslation } from "../src/platform/lib/regionalPreferences.ts";

test("corrupt, unsupported and script-like regional settings fall back independently", () => {
  assert.deepEqual(normalizeRegionalPreferences({ language:"xx", locale:"<script>", timeZone:"Mars", hourCycle:"h24" }), { language:"workspace", locale:"auto", timeZone:"auto", hourCycle:"auto" });
  assert.equal(normalizeRegionalPreferences({ locale:"EN-in", timeZone:"Asia/Kolkata", language:"es" }).locale, "en-IN");
});
test("timestamps honor a selected time zone and hour cycle", () => {
  const format = createRegionalFormatters(normalizeRegionalPreferences({ locale:"en-GB", timeZone:"Asia/Kolkata", hourCycle:"h23" }));
  assert.match(format.formatDate("2026-09-10T00:00:00Z"), /05:30/);
  assert.equal(format.formatNumber(1234567.89), "1,234,567.89");
});
test("calendar dates remain the same across extreme viewer time zones", () => {
  for (const timeZone of ["Pacific/Honolulu", "Pacific/Kiritimati"]) {
    const format = createRegionalFormatters(normalizeRegionalPreferences({ locale:"en-GB", timeZone }));
    assert.equal(format.formatDate("2026-09-10"), "10 Sept 2026");
  }
});
test("invalid dates and nonfinite counts never crash rendering", () => {
  const format = createRegionalFormatters(normalizeRegionalPreferences(null));
  for (const value of [null, undefined, "", "not a date"]) assert.equal(format.formatDate(value), "—");
  assert.equal(format.formatNumber(NaN), "—");
});
test("translation interpolation handles repeated values and preserves missing placeholders", () => {
  assert.equal(interpolateTranslation("{count} of {count}; {missing}", { count:0 }), "0 of 0; {missing}");
  assert.equal(interpolateTranslation("{toString}", {}), "{toString}");
});
