const test = require("node:test");
const assert = require("node:assert/strict");
const db = require("../../../platform/backend/src/db");
const permissions = require("../../../platform/backend/services/permission.service");
const flags = require("../../../platform/backend/services/featureFlag.service");
const rag = require("../../backend/services/knowledgeRag.service");
const refresh = require("../../backend/services/knowledgeRefresh.service");
function setup(t, options = {}) {
  const writes = [],
    queued = [],
    checked = [];
  const row = {
    project_id: "p",
    created_by: "u",
    enabled: true,
    interval_ms: 300000,
    cursor: "",
    last_result: {},
  };
  t.mock.method(db, "transaction", (task) => () => task());
  t.mock.method(db, "prepare", (sql) => ({
    get: async () =>
      sql.includes("FROM ai_knowledge_refresh WHERE (enabled")
        ? row
        : sql.includes("FROM users")
          ? { id: "u" }
          : sql.includes("FROM ai_knowledge_ingestion_jobs")
            ? options.pending
            : undefined,
    all: async (...args) => {
      assert.match(sql, /WHERE project_id = \?/);
      assert.deepEqual(args, ["p", "", 30]);
      return [
        {
          kind: "requirement",
          id: "unchanged",
          cursor: "requirement:unchanged",
        },
        { kind: "test_case", id: "new", cursor: "test_case:new" },
        { kind: "bug", id: "changed", cursor: "bug:changed" },
        ...(options.includeRuns ? [{ kind: "execution", id: "run-new", cursor: "execution:run-new" }] : []),
      ];
    },
    run: async (...args) => {
      writes.push({ sql, args });
    },
  }));
  t.mock.method(
    permissions,
    "hasPermission",
    async (_user, permission, project) => {
      assert.equal(project, "p");
      return !options.denied?.includes(permission);
    },
  );
  t.mock.method(flags, "areEnabled", async () => options.enabled !== false);
  t.mock.method(
    rag,
    "isApplicationRecordIndexed",
    async (project, kind, id) => {
      checked.push({ project, kind, id });
      return id === "unchanged";
    },
  );
  t.mock.method(rag, "enqueueIngestion", async (input) => {
    queued.push(input);
    return { job: { id: "job-1" } };
  });
  return { writes, queued, checked };
}
test("incremental refresh skips indexed records and queues new/changed evidence in one bounded batch", async (t) => {
  const { queued, writes } = setup(t);
  const result = await refresh.processDue();
  assert.equal(result.scanned, 3);
  assert.equal(result.unchanged, 1);
  assert.equal(result.queued, 2);
  assert.deepEqual(queued[0].inputs, [
    { kind: "test_case", entity_id: "new" },
    { kind: "bug", entity_id: "changed" },
  ]);
  assert.equal(queued[0].projectId, "p");
  assert.equal(queued[0].user.id, "u");
  assert.equal(writes.at(-1).args[0], "");
  assert.equal(writes.at(-1).args[1], false);
});
test("refresh respects record permissions and does not queue inaccessible data", async (t) => {
  const { queued } = setup(t, { denied: ["feedback.view"] });
  const result = await refresh.processDue();
  assert.equal(result.inaccessible, 1);
  assert.deepEqual(queued[0].inputs, [{ kind: "test_case", entity_id: "new" }]);
});
test("refresh includes run summaries and respects run permissions independently", async t => {
  assert.match(refresh._internals.RECORDS_SQL, /'execution', id, project_id FROM executions/);
  const { queued } = setup(t, { includeRuns: true, denied: ['feedback.view'] });
  const result = await refresh.processDue();
  assert.equal(result.scanned, 4);
  assert.deepEqual(queued[0].inputs, [{ kind: 'test_case', id: 'new' }, { kind: 'execution', id: 'run-new' }].map(({ kind, id }) => ({ kind, entity_id: id })));
});

test("run access revocation excludes runs without blocking other permitted refresh sources", async t => {
  const { queued } = setup(t, { includeRuns: true, denied: ['run.view'] });
  const result = await refresh.processDue();
  assert.equal(result.inaccessible, 1);
  assert.ok(!queued[0].inputs.some(input => input.kind === 'execution'));
});
test("pending ingestion applies backpressure before scanning or enqueueing", async (t) => {
  const { queued, checked } = setup(t, { pending: { id: "existing" } });
  assert.equal((await refresh.processDue()).status, "waiting");
  assert.equal(queued.length, 0);
  assert.equal(checked.length, 0);
});
test("a revoked owner or disabled capability stops automatic refresh", async (t) => {
  const { writes, queued } = setup(t, { denied: ["knowledge.manage"] });
  assert.equal((await refresh.processDue()).status, "blocked");
  assert.match(writes[0].sql, /enabled = FALSE/);
  assert.equal(queued.length, 0);
});
test("refresh intervals are validated and denied writes never reach the database", async (t) => {
  for (const ms of [0, -1, 300, 4999, 86400001, "NaN", 5000.5])
    assert.throws(() => refresh._internals.interval(ms), /interval/);
  assert.equal(refresh._internals.interval("300000"), 300000);
  const { writes } = setup(t, { denied: ["knowledge.manage"] });
  await assert.rejects(refresh.request("p", { id: "u" }), { statusCode: 403 });
  assert.equal(writes.length, 0);
});
test("archived sources remain archived and child-content fingerprints detect changes", async (t) => {
  let metadata = null;
  t.mock.method(db, "prepare", (sql) => ({
    get: async () => {
      if (sql.includes("FROM ai_knowledge_sources s")) return metadata;
      if (sql.includes("FROM requirements WHERE"))
        return {
          id: "s",
          title: "Story",
          description: "Changed",
          updated_at: "2026-01-01",
        };
      throw new Error(sql);
    },
    all: async () => [],
  }));
  assert.equal(
    await rag.isApplicationRecordIndexed("p", "requirement", "s"),
    false,
  );
  metadata = { extraction_status: "archived" };
  assert.equal(
    await rag.isApplicationRecordIndexed("p", "requirement", "s"),
    true,
  );
  const record = await rag._internals.loadApplicationRecord(
    "p",
    "requirement",
    "s",
  );
  metadata = {
    extraction_status: "ready",
    metadata: {
      snapshot_fingerprint:
        rag._internals.applicationSnapshotFingerprint(record),
    },
  };
  assert.equal(
    await rag.isApplicationRecordIndexed("p", "requirement", "s"),
    true,
  );
  metadata.metadata.snapshot_fingerprint = "old-child-content";
  assert.equal(
    await rag.isApplicationRecordIndexed("p", "requirement", "s"),
    false,
  );
});
