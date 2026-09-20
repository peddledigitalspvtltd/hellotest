import type { StepApiRequest, TestStep, TestDataOptions } from "../types";
import { normalizeApiRequest, normalizeStepType } from "./stepAutomation";
import { parseCsvGrid } from "./csvGrid";

export type ImportedTestCaseStep = {
  step_order?: number;
  action?: string;
  expected_result?: string;
  step_type?: TestStep["step_type"];
  automation_code?: string;
  api_request?: StepApiRequest | null;
  step_group_name?: string;
  step_group_kind?: string;
  shared_group_id?: string;
  group_id?: string;
  group_name?: string;
  group_kind?: string;
  reusable_group_id?: string;
};

export type ImportedTestCaseRow = {
  title: string;
  labels?: string[];
  author?: string;
  reviewer?: string;
  authoring_mode?: string;
  test_case_type?: string;
  gherkin_document?: string;
  automation_status?: string;
  action?: string;
  expected_result?: string;
  requirements?: string;
  requirement?: string;
  suites?: string;
  suite?: string;
  modules?: string;
  module?: string;
  test_data_references?: string;
  test_data_options?: TestDataOptions;
  shared_groups?: Array<Record<string, unknown>>;
  description?: string;
  external_references?: string[];
  automated?: string;
  priority?: number;
  status?: string;
  step_group_name?: string;
  step_group_kind?: string;
  shared_group_id?: string;
  parameter_values?: Record<string, string>;
  steps?: ImportedTestCaseStep[];
};

type ParsedCsv = {
  headers: string[];
  rows: ImportedTestCaseRow[];
  warnings: string[];
};

const HEADER_ALIASES: Record<keyof ImportedTestCaseRow, string[]> = {
  labels: ["labels", "tags"],
  author: ["author", "authorid"],
  reviewer: ["reviewer", "reviewerid"],
  authoring_mode: ["authoringmode", "stepformat"],
  test_case_type: ["testcasetype", "casetype"],
  gherkin_document: ["gherkindocument", "gherkin"],
  automation_status: ["automationstatus"],
  title: ["title", "testcasetitle", "testcase", "testcasename", "name"],
  action: ["action", "actions", "step", "teststep", "teststeps"],
  expected_result: ["expectedresult", "expectedresults", "expected", "result", "outcome"],
  requirements: ["stories", "storytitles", "linkedstories", "requirements", "requirementtitles", "linkedrequirements"],
  requirement: ["story", "storytitle", "linkedstory", "requirement", "requirementtitle", "linkedrequirement"],
  suites: ["suites", "suitenames", "linkedsuites"],
  suite: ["suite", "suitename", "linkedsuite"],
  modules: ["modules", "modulenames", "linkedmodules"],
  module: ["module", "modulename", "linkedmodule"],
  test_data_references: ["testdatareferences", "testdatasetids", "testdatasets", "linkeddatasets"],
  test_data_options: ["testdataoptions", "dataoverrideoptions"],
  shared_groups: ["sharedgroups", "sharedstepgroups", "reusablegroups"],
  description: ["description", "details", "notes", "scenario"],
  external_references: ["externalreferences", "externalreference", "references", "reference", "externallinks", "externaltickets", "ticketlinks", "tickets", "jira", "issue", "issues"],
  automated: ["automated", "automation", "isautomated", "automatedcase", "autocoverage"],
  priority: ["priority", "severity"],
  status: ["status", "state"],
  step_group_name: ["stepgroupname", "groupname", "sharedgroupname", "stepgroup", "group"],
  step_group_kind: ["stepgroupkind", "groupkind", "sharedgroupkind", "grouptype", "grouprole"],
  shared_group_id: ["sharedgroupid", "reusablegroupid", "stepgroupsourceid", "sharedgroupref"],
  parameter_values: ["testdata", "test_data", "testdatavalues", "parametervalues", "parameters", "data", "variables"],
  steps: ["steps", "stepdetails", "teststepsjson"]
};

const normalizeHeader = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, "");
const parseReferenceList = (value: string) =>
  Array.from(new Set(value.split(/,|\r?\n|\|/).map((item) => item.trim()).filter(Boolean)));

const findCanonicalKey = (header: string) => {
  const normalized = normalizeHeader(header);

  return (Object.entries(HEADER_ALIASES) as Array<[keyof ImportedTestCaseRow, string[]]>).find(([, aliases]) =>
    aliases.includes(normalized)
  )?.[0];
};

const normalizeParameterName = (value: string) =>
  value
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();

const parseParameterValuesText = (value: string) =>
  value
    .split(/\r?\n|\|/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((next, entry) => {
      const separatorIndex = entry.search(/[:=]/);
      const key = normalizeParameterName(separatorIndex >= 0 ? entry.slice(0, separatorIndex) : entry);

      if (!key) {
        return next;
      }

      next[key] = separatorIndex >= 0 ? entry.slice(separatorIndex + 1).trim() : "";
      return next;
    }, {});

const parseJsonValue = (value: string) => {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
};

const normalizeExplicitImportedSteps = (steps: ImportedTestCaseRow["steps"]) =>
  Array.isArray(steps)
    ? steps
        .map((step, index) => ({
          step_order: step?.step_order || index + 1,
          action: String(step?.action || "").trim(),
          expected_result: String(step?.expected_result || "").trim(),
          step_type: normalizeStepType(step?.step_type),
          automation_code: String(step?.automation_code || "").trim(),
          api_request: normalizeApiRequest(step?.api_request),
          step_group_name: String(step?.step_group_name || step?.group_name || "").trim(),
          step_group_kind: String(step?.step_group_kind || step?.group_kind || "").trim(),
          shared_group_id: String(step?.shared_group_id || step?.reusable_group_id || "").trim()
        }))
        .filter((step) => step.action || step.expected_result || step.automation_code || step.api_request)
        .sort((left, right) => left.step_order - right.step_order)
    : [];

/** A malformed row never becomes an incomplete case: fix the file before queuing it. */
export function parseTestCaseCsv(text: string): ParsedCsv {
  const grid = parseCsvGrid(text.replace(/^\uFEFF/, ""), { strict: true });
  if (!grid.length) return { headers: [], rows: [], warnings: ["The CSV file is empty."] };
  const headers = grid[0];
  const headerMap = headers.map(findCanonicalKey);
  if (!headerMap.includes("title")) throw new Error("A Title column is required.");
  const mapped = headerMap.filter(Boolean);
  if (new Set(mapped).size !== mapped.length) throw new Error("Two columns map to the same field. Keep one column per field.");
  const warnings = headers.filter((_header, index) => !headerMap[index]).map((header) => `Unrecognized column: ${header}`);
  const rows = grid.slice(1).map((cells, rowIndex) => {
    const invalid = (message: string): never => { throw new Error(`Row ${rowIndex + 2}: ${message}`); };
    if (cells.length !== headers.length) invalid(`Expected ${headers.length} columns; found ${cells.length}. Quote values that contain commas.`);
    const row: Partial<ImportedTestCaseRow> = {};
    cells.forEach((raw, index) => {
      const value = raw.trim();
      const key = headerMap[index];
      if (!value) return;
      if (!key) invalid(`Unsupported column "${headers[index]}" contains data.`);
      const json = () => { try { return JSON.parse(value) as unknown; } catch { return invalid(`${headers[index]} must contain valid JSON.`); } };
      if (key === "priority") {
        const priority = Number(value.replace(/^P/i, ""));
        if (!Number.isInteger(priority) || priority < 1 || priority > 5) invalid("Priority must be an integer from 1 to 5.");
        row.priority = priority;
      } else if (key === "test_data_options") {
        const parsed = json();
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
          || Object.entries(parsed).some(([name, entry]) => !["override_lower_scopes", "override_shared_steps"].includes(name) || typeof entry !== "boolean")) {
          invalid("Test Data Options must be a JSON object with boolean override_shared_steps or override_lower_scopes values.");
        }
        row.test_data_options = parsed as TestDataOptions;
      } else if (key === "parameter_values") {
        const parsed = value.startsWith("{") ? json() : parseParameterValuesText(value);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.values(parsed).some((entry) => entry !== null && typeof entry === "object")) invalid("Parameter Values must be a JSON object of scalar values or name=value pairs.");
        row.parameter_values = Object.fromEntries(Object.entries(parsed as Record<string, unknown>).map(([name, entry]) => [name, String(entry ?? "")]));
      } else if (key === "steps" || key === "shared_groups") {
        if (key === "steps" && !value.startsWith("[") && !value.startsWith("{")) {
          row.action = value; // Legacy plain-text Steps columns remain supported.
          return;
        }
        const parsed = json();
        if (!Array.isArray(parsed) || parsed.some((entry) => !entry || typeof entry !== "object" || Array.isArray(entry))) invalid(`${headers[index]} must be a JSON array of objects.`);
        row[key] = parsed as never;
      } else if (key === "external_references" || key === "labels") {
        row[key] = parseReferenceList(value);
      } else {
        row[key!] = value as never;
      }
    });
    if (!row.title?.trim()) invalid("Title is required.");
    if (row.authoring_mode && !["structured", "gherkin"].includes(row.authoring_mode)) invalid("Authoring Mode must be structured or gherkin.");
    if (row.authoring_mode === "gherkin" && !row.gherkin_document?.trim()) invalid("Gherkin Document is required for Gherkin authoring.");
    return row as ImportedTestCaseRow;
  });
  return { headers, rows, warnings };
}

/** Downloadable template is accepted unchanged and demonstrates structured metadata. */
export function buildTestCaseImportTemplate(): Array<Record<string, unknown>> {
  const sharedSteps = [{ step_order: 1, action: "Open @base_url", expected_result: "Sign-in page appears", step_type: "web" }];
  return [{
    Title: "Verify sign-in with a valid account", Description: "A registered user can access the application using valid credentials.",
    Status: "draft", Priority: 2, "Test Case Type": "functional", Author: "", Reviewer: "", Labels: "smoke|authentication",
    "Authoring Mode": "structured", "Gherkin Document": "", Automated: "no", "Automation Status": "not_automated", "External References": "",
    Stories: "", Suites: "", Modules: "", "Test Data References": "",
    "Test Data Options": { override_shared_steps: true },
    "Parameter Values": { base_url: "https://example.test", username: "sample-user", password: "sample-password" },
    Steps: [
      { ...sharedSteps[0], group_name: "Example sign-in setup", group_kind: "reusable" },
      { step_order: 2, action: "Enter @username and @password", expected_result: "Credentials are populated", group_name: "Credentials", group_kind: "local", step_type: "web" },
      { step_order: 3, action: "Submit the form", expected_result: "Account home is displayed", group_name: "Credentials", group_kind: "local", step_type: "web" }
    ],
    "Shared Step Groups": [{ name: "Example sign-in setup", description: "Reusable navigation precondition", steps: sharedSteps, parameter_values: { base_url: "https://example.test" }, test_data_set_id: null, test_data_row_index: 0 }]
  }];
}

const splitSequence = (value?: string) =>
  String(value || "")
    .split(/\r?\n|\|/)
    .map((item) => item.trim())
    .filter(Boolean);

const pickSequenceValue = (items: string[], index: number) => {
  if (!items.length) {
    return "";
  }

  if (index < items.length) {
    return items[index] || "";
  }

  return items.length === 1 ? items[0] || "" : "";
};

const normalizeImportedGroupKind = (value?: string) => {
  const normalized = String(value || "").trim().toLowerCase().replace(/[^a-z]/g, "");

  if (!normalized) {
    return "";
  }

  if (normalized === "reusable" || normalized === "shared" || normalized === "sharedgroup" || normalized === "sharedstepgroup" || normalized === "snapshot") {
    return "reusable";
  }

  if (normalized === "local" || normalized === "grouped" || normalized === "group") {
    return "local";
  }

  return "";
};

const IMPORTED_ACTION_PREFIX_PATTERN = /^\[(shared step group|shared steps|sharedgroup|shared|group|grouped|local)\s*:\s*([^\]]+)\]\s*(.*)$/i;

const parseAnnotatedActionLine = (value?: string) => {
  const raw = String(value || "").trim();

  if (!raw) {
    return {
      action: "",
      group_name: "",
      group_kind: ""
    };
  }

  const match = raw.match(IMPORTED_ACTION_PREFIX_PATTERN);

  if (!match) {
    return {
      action: raw,
      group_name: "",
      group_kind: ""
    };
  }

  const [, kindToken, groupName, actionBody] = match;
  const canonicalKind = normalizeImportedGroupKind(kindToken);

  return {
    action: String(actionBody || "").trim(),
    group_name: String(groupName || "").trim(),
    group_kind: canonicalKind
  };
};

export function buildImportedStepPreview(row: ImportedTestCaseRow) {
  const explicitSteps = normalizeExplicitImportedSteps(row.steps);

  if (explicitSteps.length) {
    return explicitSteps.map((step) => ({
      action:
        step.step_type === "api" && step.api_request?.url
          ? `${String(step.api_request.method || "GET").toUpperCase()} ${step.api_request.url}`
          : step.action,
      expected_result: step.expected_result,
      step_group_name: step.step_group_name,
      step_group_kind: normalizeImportedGroupKind(step.step_group_kind),
      shared_group_id: step.shared_group_id
    }));
  }

  const actions = splitSequence(row.action);
  const expectedResults = splitSequence(row.expected_result);
  const groupNames = splitSequence(row.step_group_name);
  const groupKinds = splitSequence(row.step_group_kind);
  const sharedGroupIds = splitSequence(row.shared_group_id);
  const size = Math.max(actions.length, expectedResults.length, groupNames.length, groupKinds.length, sharedGroupIds.length, 0);

  return Array.from({ length: size }, (_, index) => {
    const annotatedAction = parseAnnotatedActionLine(pickSequenceValue(actions, index));
    const legacyGroupName = pickSequenceValue(groupNames, index);
    const sharedGroupId = pickSequenceValue(sharedGroupIds, index);
    const resolvedGroupKind =
      annotatedAction.group_kind
      || normalizeImportedGroupKind(pickSequenceValue(groupKinds, index))
      || (sharedGroupId ? "reusable" : legacyGroupName ? "local" : "");
    const resolvedGroupName = annotatedAction.group_name || legacyGroupName;

    return {
      action: annotatedAction.action,
      expected_result: pickSequenceValue(expectedResults, index),
      step_group_name: resolvedGroupName,
      step_group_kind: resolvedGroupKind,
      shared_group_id: sharedGroupId
    };
  }).filter((step) => step.action || step.expected_result || step.step_group_name || step.shared_group_id);
}

export function countImportedSteps(row: ImportedTestCaseRow) {
  return buildImportedStepPreview(row).length;
}

export function countImportedSuites(row: ImportedTestCaseRow) {
  return splitSequence(row.suites || row.suite).length;
}

export function countImportedGroups(row: ImportedTestCaseRow) {
  let previousSignature = "";
  let count = 0;

  buildImportedStepPreview(row).forEach((step) => {
    const signature =
      step.step_group_name || step.shared_group_id || step.step_group_kind
        ? `${step.step_group_kind || "local"}::${step.step_group_name || ""}::${step.shared_group_id || ""}`
        : "";

    if (signature && signature !== previousSignature) {
      count += 1;
    }

    previousSignature = signature;
  });

  return count;
}

export function getImportedStepPreviewLabel(row: ImportedTestCaseRow) {
  const firstStep = buildImportedStepPreview(row)[0];

  if (!firstStep) {
    return "No step content supplied";
  }

  const summary = firstStep.action || firstStep.expected_result || "Step";

  if (!firstStep.step_group_name) {
    return summary;
  }

  return `${summary} · ${firstStep.step_group_kind === "reusable" ? "Shared Step Group" : "Group"}: ${firstStep.step_group_name}`;
}
