const { sourceFile } = require("../../../platform/backend/test/helpers/sourceFile");
const { dependencyName } = require("../../../platform/backend/test/helpers/sourceFile");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { Readable } = require("node:stream");
const { gunzipSync } = require("node:zlib");
const test = require("node:test");

function fixture() {
  const user = { id: "qa", name: "QA Reviewer" };
  const state = {
    attachments: new Map(), objects: new Map(), depth: 0, writeCount: 0,
    permissions: new Set(["attachment.view", "attachment.create", "attachment.delete", "result.view", "result.manage"]),
    results: new Map([["result", { id: "result", execution_id: "run", project_id: "project", test_case_id: "case", status: "pending", duration_ms: 0, started_at: null, revision: 1, logs: JSON.stringify({ stepNotes: { step: "Keep this note" } }) }]]),
    failMetadata: false, failPut: false, failDelete: false, afterPut: null
  };
  const db = {
    transaction: callback => async (...args) => {
      const snapshot = { attachments: structuredClone(state.attachments), results: structuredClone(state.results) };
      state.depth++;
      try { return await callback(...args); }
      catch (error) { state.attachments = snapshot.attachments; state.results = snapshot.results; throw error; }
      finally { state.depth--; }
    },
    prepare: statement => {
      const sql = statement.replace(/\s+/g, " ").trim();
      return {
        get: async (...args) => {
          if (sql.startsWith("INSERT INTO attachments")) {
            const columns = sql.match(/attachments \(([^)]+)\)/)[1].split(",").map(value => value.trim());
            assert.equal(columns.length, args.length);
            const row = { ...Object.fromEntries(columns.map((column, index) => [column, args[index]])), created_at: "2026-09-10T08:00:00Z" };
            state.attachments.set(row.id, row);
            return row;
          }
          if (sql.includes("FROM attachments")) return state.attachments.get(args[0]);
          if (sql.includes("FROM execution_step_snapshots")) return args.length < 3 || args[2] === "step" ? { snapshot_step_id: "step" } : null;
          if (sql.includes("FROM execution_results")) return state.results.get(args[0]) ? { ...state.results.get(args[0]) } : null;
          throw new Error(`Unhandled read: ${sql}`);
        },
        all: async (...args) => sql.includes("FROM attachments") ? [...state.attachments.values()].filter(row => row.entity_type === args[0] && row.entity_id === args[1] && row.project_id === args[2]) : [],
        run: async (...args) => {
          if (sql.startsWith("UPDATE execution_results SET logs")) {
            assert.ok(state.depth > 0, "Evidence metadata changes share the attachment transaction");
            if (state.failMetadata) throw new Error("Metadata write failed");
            Object.assign(state.results.get(args[2]), { logs: args[0], revision: args[1] });
          } else if (sql.startsWith("DELETE FROM attachments")) state.attachments.delete(args[0]);
          else throw new Error(`Unhandled write: ${sql}`);
        }
      };
    }
  };
  const permission = { hasPermission: async (_user, code, projectId) => projectId === "project" && state.permissions.has(code) };
  const objectStorage = {
    isEnabled: () => true,
    putObject: async ({ objectName, stream, mimeType }) => {
      state.writeCount++;
      if (state.failPut) throw new Error("Storage unavailable");
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const bytes = Buffer.concat(chunks);
      state.objects.set(objectName, { bytes, mimeType });
      state.afterPut?.();
      return { bucket: "private", etag: "etag", size: bytes.length };
    },
    getObject: async ({ objectName }) => Readable.from(state.objects.get(objectName).bytes),
    removeObject: async ({ objectName }) => { if (state.failDelete) throw new Error("Storage delete failed"); state.objects.delete(objectName); }
  };
  const load = (filename, dependencies) => {
    const context = { module: { exports: {} }, exports: {}, Buffer, require: dependency => {
      const key = Object.keys(dependencies).find(candidate => candidate.split('/').pop() === dependency.split('/').pop());
      return key === undefined ? require(dependency) : dependencies[key];
    } };
    vm.runInNewContext(readFileSync(sourceFile(filename, "services"), "utf8"), context, { filename });
    return context.module.exports;
  };
  const scopes = load("entityScope.service.js", { "@hellotest/platform/backend/src/db": db, "./permission.service": permission });
  const attachments = load("attachment.service.js", { "@hellotest/platform/backend/src/db": db, "../config": { config: { objectStorage: { maxAttachmentBytes: 1024, bucket: "private" }, storageProvider: "minio" } }, "./objectStorage.service": objectStorage, "./entityScope.service": scopes, "./permission.service": permission });
  const service = load("executionAttachment.service.js", { "@hellotest/platform/backend/src/db": db, "./attachment.service": attachments, "./permission.service": permission, "../utils/revision": require("../../../platform/backend/src/utils/revision") });
  const upload = (options = {}) => service.upload({ user, resultId: "result", fileName: "case.log", mimeType: "text/plain", stream: Readable.from("evidence ".repeat(50)), ...options });
  return { state, user, service, attachments, upload };
}

test("case evidence stores compressed text in object storage and downloads the exact original bytes", async () => {
  const { upload, state, user, attachments, service } = fixture();
  const { attachment } = await upload();
  assert.equal(attachment.entity_type, "execution_result");
  assert.equal(attachment.entity_id, "result");
  assert.equal(attachment.compression, "gzip");
  assert.equal(attachment.size, 450);
  assert.ok(attachment.storedSize < attachment.size);
  assert.equal(gunzipSync([...state.objects.values()][0].bytes).toString(), "evidence ".repeat(50));
  const downloaded = await attachments.download({ user, id: attachment.id });
  const chunks = [];
  for await (const chunk of downloaded.stream) chunks.push(chunk);
  assert.equal(Buffer.concat(chunks).toString(), "evidence ".repeat(50));
  assert.equal((await service.list({ user, resultId: "result" })).length, 1);
  assert.equal(state.results.get("result").status, "pending");
  assert.equal(state.results.get("result").started_at, null);
  assert.equal(state.results.get("result").revision, 1);
});

test("already-compressed media and archives keep original bytes and MIME type", async () => {
  const { upload, state } = fixture();
  const bytes = Buffer.from([80, 75, 3, 4, 23, 92, 44, 80]);
  const { attachment } = await upload({ fileName: "trace.zip", mimeType: "application/zip", stream: Readable.from(bytes) });
  assert.equal(attachment.compression, "none");
  assert.deepEqual([...state.objects.values()][0].bytes, bytes);
  assert.equal([...state.objects.values()][0].mimeType, "application/zip");
});

test("step upload commits only durable attachment metadata, preserving lifecycle and notes", async () => {
  const { upload, state, service, user } = fixture();
  const saved = await upload({ stepId: "step", expectedRevision: 1 });
  const result = state.results.get("result");
  const logs = JSON.parse(result.logs);
  assert.equal(logs.stepEvidence.step.attachmentId, saved.attachment.id);
  assert.equal(logs.stepEvidence.step.dataUrl, undefined);
  assert.equal(logs.stepNotes.step, "Keep this note");
  assert.equal(result.status, "pending");
  assert.equal(result.duration_ms, 0);
  assert.equal(result.started_at, null);
  assert.equal(result.revision, 2);
  assert.equal((await service.list({ user, resultId: "result" }))[0].step_id, "step");
});

test("scope, result permission and step ownership reject before storing bytes", async () => {
  const { upload, state, service, user } = fixture();
  await assert.rejects(upload({ resultId: "other-case-result" }), { statusCode: 404 });
  await assert.rejects(upload({ stepId: "foreign-step" }), /does not belong/);
  state.permissions.delete("result.manage");
  await assert.rejects(upload(), { statusCode: 403 });
  state.permissions.add("result.manage");
  state.permissions.delete("attachment.create");
  await assert.rejects(upload(), { statusCode: 403 });
  state.permissions.delete("result.view");
  await assert.rejects(service.list({ user, resultId: "result" }), { statusCode: 403 });
  assert.equal(state.writeCount, 0);
});

test("stale step saves and persistence failures leave no new object or metadata", async () => {
  const { upload, state } = fixture();
  await assert.rejects(upload({ stepId: "step", expectedRevision: 2 }), { statusCode: 409 });
  state.afterPut = () => state.results.get("result").revision++;
  await assert.rejects(upload({ stepId: "step", expectedRevision: 1 }), { statusCode: 409 });
  assert.equal(state.attachments.size, 0);
  assert.equal(state.objects.size, 0);
  state.afterPut = null;
  state.failMetadata = true;
  await assert.rejects(upload({ stepId: "step", expectedRevision: 2 }), /Metadata write failed/);
  assert.equal(state.attachments.size, 0);
  assert.equal(state.objects.size, 0);
});

test("empty, oversized, unsupported and failed storage uploads never persist file metadata", async () => {
  const { upload, state } = fixture();
  await assert.rejects(upload({ stream: Readable.from("") }), { statusCode: 400 });
  await assert.rejects(upload({ stream: Readable.from(Buffer.alloc(1025)) }), { statusCode: 413 });
  await assert.rejects(upload({ mimeType: "text/html", fileName: "script.html" }), /Use an image/);
  state.failPut = true;
  await assert.rejects(upload(), /Storage unavailable/);
  assert.equal(state.attachments.size, 0);
  assert.equal(state.objects.size, 0);
});

test("deletion is scoped to its exact result and clears references without changing lifecycle", async () => {
  const { upload, state, service, user, attachments } = fixture();
  const saved = await upload({ stepId: "step" });
  state.results.set("other", { ...state.results.get("result"), id: "other" });
  await assert.rejects(service.remove({ user, resultId: "other", attachmentId: saved.attachment.id }), { statusCode: 404 });
  state.permissions.delete("result.manage");
  await assert.rejects(attachments.remove({ user, id: saved.attachment.id }), { statusCode: 403 });
  state.permissions.add("result.manage");
  state.failDelete = true;
  await assert.rejects(service.remove({ user, resultId: "result", attachmentId: saved.attachment.id }), /Storage delete failed/);
  assert.equal(JSON.parse(state.results.get("result").logs).stepEvidence.step.attachmentId, saved.attachment.id);
  state.failDelete = false;
  await service.remove({ user, resultId: "result", attachmentId: saved.attachment.id });
  assert.deepEqual(JSON.parse(state.results.get("result").logs).stepEvidence, {});
  assert.equal(state.results.get("result").status, "pending");
  assert.equal(state.attachments.size, 0);
  assert.equal(state.objects.size, 0);
});

test("replacing step evidence requires delete permission and preserves the earlier file", async () => {
  const { upload, state } = fixture();
  const first = await upload({ stepId: "step" });
  state.permissions.delete("attachment.delete");
  await assert.rejects(upload({ stepId: "step", expectedRevision: 2 }), { statusCode: 403 });
  state.permissions.add("attachment.delete");
  const next = await upload({ stepId: "step", expectedRevision: 2 });
  assert.equal(state.attachments.size, 2);
  assert.ok(state.attachments.has(first.attachment.id));
  assert.equal(JSON.parse(state.results.get("result").logs).stepEvidence.step.attachmentId, next.attachment.id);
});

test("paused and finished case attachments leave timing and history unchanged and never leak to a new result", async () => {
  const { upload, state, service, user } = fixture();
  for (const status of ["paused", "passed"]) {
    const result = state.results.get("result");
    Object.assign(result, { status, duration_ms: 1200, timer_started_at: null, started_at: "2026-09-10T07:00:00Z", lifecycle_history: [{ action: status, duration_ms: 1200 }] });
    const saved = await upload();
    assert.equal(result.status, status);
    assert.equal(result.duration_ms, 1200);
    assert.equal(result.timer_started_at, null);
    assert.deepEqual(result.lifecycle_history, [{ action: status, duration_ms: 1200 }]);
    assert.equal(saved.attachment.entity_id, "result");
  }
  state.results.set("new-attempt", { ...state.results.get("result"), id: "new-attempt", status: "pending", logs: "{}" });
  assert.equal((await service.list({ user, resultId: "new-attempt" })).length, 0);
  assert.equal((await service.list({ user, resultId: "result" })).length, 2);
});

test("attachment route authenticates and checks both scoped permissions before reading multipart bytes", async () => {
  const routes = new Map();
  let readFiles = 0;
  let denied = "";
  let authenticated = true;
  const scopedCalls = [];
  const module = { exports: {} };
  vm.runInNewContext(readFileSync(path.join(__dirname, "../../backend/routes/executionResults.routes.js"), "utf8"), {
    module,
    require: name => {
      if (dependencyName(name) === "executionResult.service") return { getExecutionResult: async () => ({ id: "result", execution_id: "run" }) };
      if (dependencyName(name) === "execution.service") return { getExecution: async () => ({ id: "run", project_id: "project" }) };
      if (dependencyName(name) === "projectAccess") return { getProject: async () => ({ id: "project" }) };
      if (dependencyName(name) === "executionAttachment.service") return { MAX_EVIDENCE_BYTES: 25 * 1024 * 1024, upload: async args => ({ resultId: args.resultId }) };
      return {};
    }
  });
  const fastify = {
    ...Object.fromEntries(["get", "post", "put", "delete"].map(method => [method, (url, handler) => routes.set(`${method} ${url}`, handler)])),
    authenticate: async () => { if (!authenticated) throw Object.assign(new Error("Unauthorized"), { statusCode: 401 }); },
    requirePermission: (code, scope) => async () => { scopedCalls.push({ code, scope }); if (code === denied) throw Object.assign(new Error("Forbidden"), { statusCode: 403 }); },
    validate: () => {}
  };
  await module.exports(fastify);
  const req = { params: { id: "result" }, user: { id: "qa" }, file: async options => {
    readFiles++; assert.equal(options.limits.fileSize, 25 * 1024 * 1024);
    return { filename: "evidence.txt", mimetype: "text/plain", file: Readable.from("evidence"), fields: {} };
  } };
  const upload = routes.get("post /execution-results/:id/attachments");
  authenticated = false;
  await assert.rejects(upload(req), { statusCode: 401 });
  authenticated = true;
  for (const code of ["result.manage", "attachment.create"]) { denied = code; await assert.rejects(upload(req), { statusCode: 403 }); }
  assert.equal(readFiles, 0);
  denied = "";
  assert.equal((await upload(req)).resultId, "result");
  assert.equal(readFiles, 1);
  assert.ok(scopedCalls.every(call => call.scope.projectId === "project"));
});
