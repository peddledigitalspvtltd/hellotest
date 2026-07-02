const db = require("../db");

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
  }
};

exports.createDisplayId = async (kind) => {
  const config = DISPLAY_ID_CONFIG[kind];

  if (!config) {
    throw new Error(`Unsupported display id kind: ${kind}`);
  }

  const row = await db.prepare(`
    SELECT COALESCE(MAX(NULLIF(regexp_replace(display_id, '\\D', '', 'g'), '')::INTEGER), 0) AS max_sequence
    FROM ${config.table}
    WHERE display_id IS NOT NULL
  `).get();

  const nextSequence = Number(row?.max_sequence || 0) + 1;
  return `${config.prefix}${String(nextSequence).padStart(config.minDigits, "0")}`;
};
