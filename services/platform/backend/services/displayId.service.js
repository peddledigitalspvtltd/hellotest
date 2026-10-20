const db = require("../src/db");

const DISPLAY_ID_CONFIG = {
  project: {
    table: "projects",
    prefix: "PROJ-",
    minDigits: 1
  },
  requirement: {
    table: "requirements",
    prefix: "Req_",
    minDigits: 1
  },
  test_case: {
    table: "test_cases",
    prefix: "TC_",
    minDigits: 1
  },
  automation_case: {
    table: "test_cases",
    prefix: "AT_",
    minDigits: 1
  },
  test_suite: {
    table: "test_suites",
    prefix: "TS-",
    minDigits: 1
  },
  shared_step_group: {
    table: "shared_step_groups",
    prefix: "SG-",
    minDigits: 1
  },
  test_case_module: {
    table: "test_case_modules",
    prefix: "MOD-",
    minDigits: 1
  },
  requirement_iteration: {
    table: "requirement_iterations",
    prefix: "ITER-",
    minDigits: 1
  },
  requirement_release: {
    table: "requirement_releases",
    prefix: "REL-",
    minDigits: 1
  },
  issue: {
    table: "feedback",
    prefix: "BUG-",
    minDigits: 1
  }
};

exports.createDisplayId = async (kind) => {
  const config = DISPLAY_ID_CONFIG[kind];

  if (!config) {
    throw new Error(`Unsupported display id kind: ${kind}`);
  }

  if (kind === "test_case" || kind === "automation_case") {
    // Reserve the identifier atomically; parallel case creation cannot obtain
    // the same number even though its authoring transaction commits later.
    const row = await db.prepare(`INSERT INTO record_display_sequences(kind,value)
      SELECT ?,COALESCE(MAX(SUBSTRING(reference FROM ?)::bigint),0)+1 FROM (
        SELECT display_id AS reference FROM test_cases UNION ALL SELECT jsonb_array_elements_text(legacy_display_ids) FROM test_cases
      ) reserved
      ON CONFLICT(kind) DO UPDATE SET value=GREATEST(record_display_sequences.value+1,EXCLUDED.value)
      RETURNING value`).get(kind, kind === "automation_case" ? '^AT_([0-9]+)$' : '^TC_([0-9]+)$');
    return `${config.prefix}${row.value}`;
  }

  const row = await db.prepare(`
    SELECT COALESCE(MAX(NULLIF(regexp_replace(display_id, '\\D', '', 'g'), '')::INTEGER), 0) AS max_sequence
    FROM ${config.table}
    WHERE display_id IS NOT NULL
  `).get();

  const nextSequence = Number(row?.max_sequence || 0) + 1;
  return `${config.prefix}${String(nextSequence).padStart(config.minDigits, "0")}`;
};
