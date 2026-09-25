import { parseCsvGrid } from "@hellotest/platform/frontend/src/shared/lib/csvGrid";
import { normalizeStepParameterName } from "@hellotest/platform/frontend/src/shared/lib/stepParameters";

export function parseRunDataCsv(text: string, defaultScope: "s" | "r" = "r") {
  const grid = parseCsvGrid(text.replace(/^\uFEFF/, ""), { preserveWhitespace: true, strict: true });
  const header = grid.shift() || [];
  if (!header.length || header.some(value => !value.trim())) throw new Error("Every CSV column needs a parameter name.");
  const columns = header.map(value => normalizeStepParameterName(value, defaultScope));
  if (new Set(columns).size !== columns.length) throw new Error("Two columns refer to the same parameter. Use distinct t., s., or r. names; @name and r.name are the same run parameter.");
  if (columns.length > 500) throw new Error("Use at most 500 parameter columns in one data set.");
  const dataRows = grid.filter(row => row.some(value => value.length));
  if (dataRows.length > 5000) throw new Error("Use at most 5,000 data rows in one data set.");
  // CSV headers are repeated in each JSON row. Bound the expanded request before
  // allocating all row objects, leaving room below the API's 4 MB body limit.
  const encoder = new TextEncoder();
  const jsonBytes = (value: unknown) => encoder.encode(JSON.stringify(value)).byteLength;
  const rowKeyBytes = columns.reduce((total, column) => total + jsonBytes(column) + 2, 2);
  let payloadBytes = jsonBytes(columns) + 32;
  const rows = dataRows.map((row, index) => {
    if (row.length !== columns.length) throw new Error(`Row ${index + 2} has ${row.length} cells; the header has ${columns.length}. Quote values containing commas or line breaks.`);
    payloadBytes += rowKeyBytes + row.reduce((total, value) => total + jsonBytes(value), 0);
    if (payloadBytes > 3 * 1024 * 1024) throw new Error("This CSV expands beyond the 3 MB test-data import limit. Split it into smaller data sets or shorten the parameter names.");
    return Object.fromEntries(columns.map((column, offset) => [column, row[offset]]));
  });
  if (!rows.length) throw new Error("Fill at least one data row before importing the template.");
  return { columns, rows };
}

export function expandSelectedSuiteIds(suites: Array<{ id: string; parent_id?: string | null }>, selected: string[]) {
  const result = new Set(selected);
  let changed = true;
  while (changed) {
    changed = false;
    for (const suite of suites) if (suite.parent_id && result.has(suite.parent_id) && !result.has(suite.id)) {
      result.add(suite.id); changed = true;
    }
  }
  return result;
}
