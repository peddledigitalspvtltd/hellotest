const assert = require("node:assert/strict");
const test = require("node:test");
const { normalizeExecutionDates, formatStoredRunDate } = require("../src/utils/executionDates");

test("run planning dates are optional and allow a single date or same-day run", () => {
  assert.deepEqual(normalizeExecutionDates(), { start_date: null, end_date: null });
  assert.deepEqual(normalizeExecutionDates({ start_date: "", end_date: "" }), { start_date: null, end_date: null });
  assert.deepEqual(normalizeExecutionDates({ start_date: "2026-09-09" }), { start_date: "2026-09-09", end_date: null });
  assert.deepEqual(normalizeExecutionDates({ end_date: "2026-09-09" }), { start_date: null, end_date: "2026-09-09" });
  assert.deepEqual(normalizeExecutionDates({ start_date: "2028-02-29", end_date: "2028-02-29" }), {
    start_date: "2028-02-29", end_date: "2028-02-29"
  });
});

test("run planning dates reject impossible dates, timestamps, and reversed ranges", () => {
  for (const value of ["2026-02-29", "2026-04-31", "2026-13-01", "0000-01-01", "2026-9-9", "2026-09-09T00:00:00Z", 20260909]) {
    for (const field of ["start_date", "end_date"]) {
      assert.throws(() => normalizeExecutionDates({ [field]: value }), (error) => error.statusCode === 400, `${field}: ${value}`);
    }
  }
  assert.throws(() => normalizeExecutionDates({ start_date: "2027-01-01", end_date: "2026-12-31" }), {
    message: "End date must be on or after start date.", statusCode: 400
  });
});

test("database run dates retain the selected calendar day independent of UTC offset", () => {
  assert.equal(formatStoredRunDate(new Date(2026, 8, 9)), "2026-09-09");
  assert.equal(formatStoredRunDate("2028-02-29"), "2028-02-29");
  assert.equal(formatStoredRunDate(null), null);
});

test("run creation persists planning dates and returns them without changing execution timestamps", async (context) => {
  process.env.NODE_ENV = "test";
  const db = require("../src/db");
  const service = require("../../../testing/backend/services/execution.service");
  const mobileFeatureService = require("../services/mobileFeature.service");
  let storedRun;
  const query = async (statement) => {
    const sql = typeof statement === "string" ? statement : statement.text;
    const values = statement.values || [];
    if (/INSERT INTO executions\s*\(/.test(sql)) {
      const columns = sql.match(/INSERT INTO executions\s*\(([^)]+)\)/)[1].split(",").map((value) => value.trim());
      assert.equal(columns.length, values.length, "Every persisted field must have a matching SQL parameter.");
      storedRun = Object.fromEntries(columns.map((column, index) => [column, values[index]]));
      return { rows: [], rowCount: 1 };
    }
    if (/SELECT id FROM (projects|users) WHERE/.test(sql)) return { rows: [{ id: values[0] }], rowCount: 1 };
    if (/SELECT \*\s+FROM executions\s+WHERE id/.test(sql)) {
      return { rows: [{ ...storedRun, start_date: new Date(2026, 8, 9), end_date: new Date(2026, 8, 12), started_at: null, ended_at: null }] };
    }
    return { rows: [], rowCount: 0 };
  };
  context.mock.method(db.pool, "query", query);
  context.mock.method(db.pool, "connect", async () => ({ query, release() {} }));
  context.mock.method(mobileFeatureService, "assertExecutionMobileFeatureEnabled", async () => undefined);

  const created = await service.createExecution({
    project_id: "project-1", created_by: "user-1", name: "Planned regression",
    start_date: "2026-09-09", end_date: "2026-09-12"
  });
  assert.equal(storedRun.start_date, "2026-09-09");
  assert.equal(storedRun.end_date, "2026-09-12");
  assert.equal(storedRun.started_at, undefined);
  assert.equal(storedRun.ended_at, undefined);
  const fetched = await service.getExecution(created.id, true);
  assert.equal(fetched.start_date, "2026-09-09");
  assert.equal(fetched.end_date, "2026-09-12");
  assert.equal(fetched.started_at, null);
  assert.equal(fetched.ended_at, null);
});

test("invalid run dates are rejected before any database access", async (context) => {
  const db = require("../src/db");
  const service = require("../../../testing/backend/services/execution.service");
  const query = context.mock.method(db.pool, "query", async () => {
    throw new Error("Invalid planning dates must be rejected before database access.");
  });
  await assert.rejects(service.createExecution({
    project_id: "project-1", created_by: "user-1", start_date: "2026-09-12", end_date: "2026-09-09"
  }), { message: "End date must be on or after start date.", statusCode: 400 });
  assert.equal(query.mock.callCount(), 0);
});
