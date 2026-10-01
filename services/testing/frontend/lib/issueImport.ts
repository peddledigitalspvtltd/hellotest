import { parseCsvGrid } from "@hellotest/platform/frontend/src/shared/lib/csvGrid";
import type { JiraBugCreateMetadata } from "@hellotest/integration/frontend/lib/jiraIssueContracts";

export type IssueImportRow = Record<string, string | string[] | boolean> & { title: string; message: string };
export type IssueImportPreview = { rows: IssueImportRow[]; errors: Array<{ row: number; message: string }>; total: number };
export const MAX_BUG_IMPORT_ROWS = 500;
export const MAX_BUG_IMPORT_BYTES = 4 * 1024 * 1024;
const columns: Record<string, string[]> = {
  title: ["title", "bugtitle", "defecttitle", "summary"], message: ["description", "message", "details"],
  steps_to_reproduce: ["stepstoreproduce", "reproductionsteps"], expected_result: ["expectedresult"], actual_result: ["actualresult"],
  status: ["status"], severity: ["severity"], priority: ["priority"], environment: ["environment"], build: ["build"],
  assignee_id: ["assignee", "assigneeid"], user_id: ["reportedby", "reporter", "userid", "reporterid"],
  labels: ["labels", "tags"], sprint: ["sprint"], release: ["release"], fix_version: ["fixversion"],
  root_cause: ["rootcause", "primaryrootcause"], qa_root_cause: ["qarootcause"], bug_type: ["bugtype", "defecttype"],
  regression: ["regression"], jira_bug_key: ["externaldefectkey", "jirabugkey"]
};
const headerKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
export function parseIssueCsv(text: string): IssueImportRow[] {
  const grid = parseCsvGrid(text.replace(/^\uFEFF/, ""), { strict: true });
  if (grid.length < 2) throw new Error("Add at least one bug below the CSV column headers.");
  if (grid.length - 1 > MAX_BUG_IMPORT_ROWS) throw new Error(`Import up to ${MAX_BUG_IMPORT_ROWS} bugs at a time. Split this file into smaller imports.`);
  const keys = grid[0].map(header => Object.keys(columns).find(key => columns[key].includes(headerKey(header))));
  const unknown = grid[0].filter((_, index) => !keys[index]);
  if (unknown.length) throw new Error(`Unsupported columns: ${unknown.join(", ")}. Use the Bug template; this import creates new bugs.`);
  if (new Set(keys).size !== keys.length) throw new Error("The CSV has duplicate columns. Keep one column for each field.");
  if (!keys.includes("title") || !keys.includes("message")) throw new Error("Title and Description columns are required.");
  return grid.slice(1).map((cells, index) => {
    const fail = (message: string): never => { throw new Error(`Row ${index + 2}: ${message}`); };
    if (cells.length !== keys.length) fail("The number of cells does not match the headers. Quote text containing commas or line breaks.");
    const row: Record<string, string | string[] | boolean> = {};
    cells.forEach((cell, column) => {
      const key = keys[column]!;
      if (!cell.trim()) return;
      if (key === "labels") {
        let values: unknown;
        try { values = cell.startsWith("[") ? JSON.parse(cell) : cell.split(/[,|]/).map(value => value.trim()).filter(Boolean); }
        catch { fail("Labels must be a JSON list or separated by commas or |."); }
        if (!Array.isArray(values) || values.some(value => typeof value !== "string")) fail("Labels must contain text values only.");
        row[key] = [...new Set((values as string[]).map(value => value.trim()).filter(Boolean))];
      } else if (key === "regression") {
        if (!/^(true|false|yes|no)$/i.test(cell)) fail("Regression must be true, false, yes or no.");
        row[key] = /^(true|yes)$/i.test(cell);
      } else row[key] = cell;
    });
    if (String(row.title || "").trim().length < 2 || String(row.message || "").trim().length < 2) fail("Title and Description must each contain at least two characters.");
    return row as IssueImportRow;
  });
}

export function buildIssueImportTemplate(metadata?: JiraBugCreateMetadata): Array<Record<string, unknown>> {
  return [{
    Title: "Checkout shows an error for a valid payment", Description: "A valid payment cannot complete checkout.",
    "Steps to reproduce": "1. Add a product to the cart\n2. Enter valid payment details\n3. Submit the order",
    "Expected result": "The order is confirmed.", "Actual result": "An error appears and no order is created.",
    Status: metadata?.workflow_statuses?.default_status || "open", Severity: "high", Priority: "High",
    Environment: "Staging", Build: "", Assignee: "", "Reported by": "", Labels: ["checkout", "payment"],
    Sprint: "", Release: "", "Fix version": "", "Primary root cause": "", "QA root cause": "", "Defect type": "", Regression: false, "External defect key": ""
  }];
}
