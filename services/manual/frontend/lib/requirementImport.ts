import { parseCsvGrid } from "@hellotest/platform/frontend/src/shared/lib/csvGrid";
import type { RequirementIteration, RequirementRelease } from "@hellotest/platform/frontend/src/types";

export type ImportedRequirementRow = {
  story_id?: string;
  expected_revision?: number;
  title: string;
  description?: string;
  acceptance_criteria?: string[];
  additional_fields?: Record<string, unknown>;
  gherkin_scenarios?: string[];
  specification_format?: 'gherkin' | 'speckit';
  specification_content?: string;
  dev_completion_target_date?: string;
  qa_completion_target_date?: string;
  scrum_team?: string;
  external_references?: string[];
  labels?: string[];
  sprint?: string;
  fix_version?: string;
  release?: string;
  iteration_id?: string;
  release_id?: string;
  linked_test_cases?: string[];
  linked_bugs?: string[];
  priority?: number;
  status?: string;
};

type ParsedCsv = {
  headers: string[];
  rows: ImportedRequirementRow[];
  warnings: string[];
  errors: string[];
};

const HEADER_ALIASES: Record<keyof ImportedRequirementRow, string[]> = {
  story_id: ["storyid", "requirementid", "id"],
  expected_revision: ["expectedrevision", "revision"],
  title: ["title", "story", "storytitle", "requirement", "requirementtitle", "name", "summary"],
  description: ["description", "details", "notes"],
  acceptance_criteria: ["acceptancecriteria", "acceptancecriterion", "acceptance"],
  additional_fields: ["additionalfields", "additionalfieldsjson", "customfields", "customfieldsjson"],
  gherkin_scenarios: ["gherkinscenarios", "gherkin"],
  specification_format: ["specificationformat", "specformat"],
  specification_content: ["specificationcontent", "speckit", "specification"],
  dev_completion_target_date: ["devcompletiontargetdate", "devtargetdate"],
  qa_completion_target_date: ["qacompletiontargetdate", "qatargetdate"],
  scrum_team: ["scrumteam", "team"],
  external_references: ["externalreferences", "externalreference", "references", "reference", "externallinks", "externaltickets", "ticketlinks", "tickets", "jira", "issue", "issues"],
  labels: ["labels", "label", "tags", "tag"],
  sprint: ["sprint", "iteration"],
  fix_version: ["fixversion", "fixversions", "targetversion", "version"],
  release: ["release", "releaseversion", "targetrelease"],
  iteration_id: ["sprintid", "iterationid", "requirementiteration", "iterationname"],
  release_id: ["releaseid", "requirementrelease"],
  linked_test_cases: ["linkedtestcases", "testcaseids", "testcases", "linkedtests"],
  linked_bugs: ["linkedbugs", "bugids", "bugs", "defects", "linkeddefects", "defectids"],
  priority: ["priority", "severity"],
  status: ["status", "state"]
};

export function resolveImportedRequirementPlanning(rows: ImportedRequirementRow[], iterations: RequirementIteration[], releases: RequirementRelease[]) {
  const normalize = (value?: string | null) => String(value || "").trim().toLowerCase();
  return rows.map(row => {
    const next = { ...row };
    const sprintValue = normalize(row.iteration_id || row.sprint);
    if (sprintValue) {
      const matches = iterations.filter(iteration => [iteration.id, iteration.display_id, iteration.name].some(value => normalize(value) === sprintValue));
      if (matches.length > 1) throw new Error(`Sprint "${row.iteration_id || row.sprint}" is ambiguous. Use its Sprint ID in the CSV.`);
      if (!matches.length && row.iteration_id) throw new Error(`Sprint "${row.iteration_id}" is not available in this project.`);
      if (matches[0]) {
        if (matches[0].state === "closed" && !row.story_id) throw new Error(`Completed Sprint "${matches[0].name}" cannot accept imported Stories.`);
        next.iteration_id = matches[0].id;
        next.sprint = matches[0].name;
      }
    }
    const releaseValue = normalize(row.release_id || row.release || row.fix_version);
    if (releaseValue) {
      const matches = releases.filter(release => [release.id, release.display_id, release.name, release.fix_version].some(value => normalize(value) === releaseValue));
      if (matches.length > 1) throw new Error(`Release "${row.release_id || row.release || row.fix_version}" is ambiguous. Use its Release ID in the CSV.`);
      if (!matches.length && row.release_id) throw new Error(`Release "${row.release_id}" is not available in this project.`);
      if (matches[0]) {
        if ((matches[0].persisted_state || matches[0].state) === "released" && !row.story_id) throw new Error(`Completed Release "${matches[0].name}" cannot accept imported Stories.`);
        next.release_id = matches[0].id;
        next.release = matches[0].name;
        next.fix_version = matches[0].fix_version;
      }
    }
    return next;
  });
}

const normalizeHeader = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, "");
const parseReferenceList = (value: string) =>
  Array.from(new Set(value.split(/,|\r?\n|\|/).map((item) => item.trim()).filter(Boolean)));

const parseList = (value: string, criteria = false) => {
  if (value.trim().startsWith('[')) {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed) || parsed.some(item => typeof item !== 'string')) throw new Error('Use a JSON array of text values.');
    return [...new Set(parsed.map(item => item.trim()).filter(Boolean))] as string[];
  }
  return criteria ? [...new Set(value.split(/\r?\n/).map(item => item.trim()).filter(Boolean))] : parseReferenceList(value);
};

const findCanonicalKey = (header: string) => {
  const normalized = normalizeHeader(header);

  return (Object.entries(HEADER_ALIASES) as Array<[keyof ImportedRequirementRow, string[]]>).find(([, aliases]) =>
    aliases.includes(normalized)
  )?.[0];
};

export function parseRequirementCsv(text: string): ParsedCsv {
  const grid = parseCsvGrid(text.replace(/^\uFEFF/, ''), {strict:true, preserveWhitespace:true});

  if (!grid.length) {
    return {
      headers: [],
      rows: [],
      warnings: ["The CSV file is empty."], errors: ['The CSV file is empty.']
    };
  }

  const headers = grid[0];
  const headerMap = headers.map((header) => findCanonicalKey(header));
  const rows = grid.slice(1);
  const warnings: string[] = [];
  const errors: string[] = [];
  if (rows.length > 10000) errors.push('A Story import supports up to 10,000 rows. Split the CSV into smaller imports.');

  if (!headerMap.includes("title")) {
    errors.push("A title column is required. Supported aliases include Title, Story, or Summary.");
  }
  headerMap.forEach((key, index) => {
    if (!key) errors.push(`Unsupported column "${headers[index]}". Use the downloaded Story template.`);
    else if (headerMap.indexOf(key) !== index) errors.push(`Column "${headers[index]}" duplicates another ${key} column.`);
  });

  const normalizedRows = rows
    .map((row, rowIndex) => {
      if (row.length !== headers.length) errors.push(`Row ${rowIndex + 2}: expected ${headers.length} columns, received ${row.length}.`);
      const normalized = row.reduce<Partial<ImportedRequirementRow>>((accumulator, value, index) => {
        const key = headerMap[index];

        if (!key || !value.trim()) {
          return accumulator;
        }

        try {
        if (key === "priority" || key === "expected_revision") {
          const parsed = Number(value.replace(/^P/i, ''));
          if (!Number.isInteger(parsed) || parsed < 1 || (key === 'priority' && parsed > 5)) throw new Error(key === 'priority' ? 'Priority must be P1–P5 or 1–5.' : 'Expected Revision must be a positive integer.');
          accumulator[key] = parsed;
          return accumulator;
        }

        if (key === "external_references" || key === "labels" || key === "linked_test_cases" || key === "linked_bugs" || key === "acceptance_criteria" || key === "gherkin_scenarios") {
          accumulator[key] = parseList(value, key === 'acceptance_criteria' || key === 'gherkin_scenarios');
          return accumulator;
        }

        if (key === "additional_fields") {
          const parsed: unknown = JSON.parse(value);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).some(key => key.startsWith('_'))) throw new Error('Additional Fields must be a JSON object without reserved keys beginning with _.');
          accumulator.additional_fields = parsed as Record<string, unknown>;
          return accumulator;
        }
        if (key === 'specification_format') {
          const format = value.trim().toLowerCase();
          if (format !== 'gherkin' && format !== 'speckit') throw new Error('Specification Format must be gherkin or speckit.');
          accumulator.specification_format = format;
          return accumulator;
        }
        if (key.endsWith('_target_date')) {
          const date = new Date(value.trim());
          if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value.trim()) || !Number.isFinite(date.getTime()) || (!value.includes('T') && date.toISOString().slice(0,10) !== value.trim())) throw new Error('Use a valid ISO date such as 2026-10-15.');
        }
        accumulator[key] = value.trim() as never;
        } catch (error) { errors.push(`Row ${rowIndex + 2}, ${headers[index]}: ${error instanceof Error ? error.message : 'Invalid value.'}`); }
        return accumulator;
      }, {});
      if (!normalized.title || normalized.title.trim().length < 2) errors.push(`Row ${rowIndex + 2}: Title must contain at least two characters.`);
      if (normalized.story_id && !normalized.expected_revision) errors.push(`Row ${rowIndex + 2}: Expected Revision is required when updating a Story ID.`);
      if (normalized.acceptance_criteria && (normalized.acceptance_criteria.length > 100 || normalized.acceptance_criteria.some(value => value.length > 2000))) errors.push(`Row ${rowIndex + 2}: Acceptance Criteria allows up to 100 entries of 2,000 characters each.`);
      if (normalized.gherkin_scenarios && (normalized.gherkin_scenarios.length > 20 || normalized.gherkin_scenarios.some(value => value.length > 4000))) errors.push(`Row ${rowIndex + 2}: Gherkin allows up to 20 scenarios of 4,000 characters each.`);
      if (normalized.dev_completion_target_date && normalized.qa_completion_target_date && new Date(normalized.qa_completion_target_date) < new Date(normalized.dev_completion_target_date)) errors.push(`Row ${rowIndex + 2}: QA target must be on or after the development target.`);
      return normalized;
    })
    .filter((row): row is ImportedRequirementRow => Boolean(row.title?.trim()));

  if (!normalizedRows.length && rows.length) {
    warnings.push("No valid rows were found. Every imported row must include a story title.");
  }

  return {
    headers,
    rows: normalizedRows,
    warnings, errors
  };
}

type ImportMetadata = {
  workflow_statuses?: {default_status?: string | null; statuses?: Array<{value: string; label?: string}>};
  core_fields?: Array<{id: string; allowed_values?: Array<{value?: unknown; id?: string}>}>;
  fields?: Array<{id: string; schema?: {type?: string}; allowed_values?: Array<{value?: unknown; id?: string}>}>;
};

export function createStoryImportTemplate(metadata: ImportMetadata, iterations: RequirementIteration[], releases: RequirementRelease[]) {
  const sprint = iterations.find(item => item.state !== 'closed');
  const release = releases.find(item => (item.persisted_state || item.state) !== 'released');
  const custom = Object.fromEntries((metadata.fields || []).map(field => [field.id, field.allowed_values?.[0]?.value ?? field.allowed_values?.[0]?.id ?? (field.schema?.type === 'array' ? [] : field.schema?.type === 'number' ? 0 : field.schema?.type === 'boolean' ? false : '')]));
  return {
    'Story ID':'', 'Expected Revision':'', Title:'Example Story: Open My Workspace',
    Description:'As a workspace member, I want to open my project so that I can review delivery progress.',
    'Acceptance Criteria':['Given an active membership, when I open my project, then I can view its Stories.'],
    Priority:3, Status:metadata.workflow_statuses?.default_status || 'open', Labels:['imported'],
    'Sprint ID':sprint?.id || '', 'Release ID':release?.id || '',
    'External References':[], 'Dev Completion Target Date':'', 'QA Completion Target Date':'', 'Scrum Team':'',
    'Specification Format':'gherkin', 'Gherkin Scenarios':['Feature: Open my workspace\nScenario: Open an assigned project\n Given an active project membership\n When I open the project\n Then I can view its Stories'],
    'Specification Content':'', 'Additional Fields JSON':custom, 'Linked Test Cases':'', 'Linked Defects':''
  };
}

export function validateStoryImportMetadata(rows: ImportedRequirementRow[], metadata: ImportMetadata): ImportedRequirementRow[] {
  const statuses = metadata.workflow_statuses?.statuses || [];
  return rows.map((row, index) => {
    if (!row.status || !statuses.length) return row;
    const status = statuses.find(option => [option.value, option.label].some(value => value?.toLowerCase() === row.status?.toLowerCase()));
    if (!status) throw new Error(`Row ${index + 2}: Status "${row.status}" is not available in the Story creation form.`);
    return {...row, status:status.value};
  });
}
