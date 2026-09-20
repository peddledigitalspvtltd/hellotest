const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { config } = require("../src/config");
const storage = require("../src/services/objectStorage.service");
const vectors = require("../src/services/knowledgeVectorStore.service");

test("database writer fencing returns a safe project-deleting conflict", async () => {
  const app = require("fastify")({ logger: false });
  await app.register(require("../src/plugins/errorHandler"));
  app.post("/write", async () => { throw Object.assign(new Error("private database trigger details"), { code: "PJD01" }); });
  try {
    const response = await app.inject({ method: "POST", url: "/write" });
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().code, "PROJECT_DELETING");
    assert.doesNotMatch(response.body, /private database/);
  } finally { await app.close(); }
});

test("stored-file cleanup aborts a stalled S3 request within its budget", { timeout: 3000 }, async t => {
  const sockets = new Set();
  const server = http.createServer(() => {});
  server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const original = { provider: config.storageProvider, options: { ...config.objectStorage } };
  t.after(async () => {
    config.storageProvider = original.provider;
    Object.assign(config.objectStorage, original.options);
    sockets.forEach(socket => socket.destroy());
    await new Promise(resolve => server.close(resolve));
  });
  config.storageProvider = "minio";
  Object.assign(config.objectStorage, {
    endpoint: "127.0.0.1", port: server.address().port, useSsl: false,
    accessKey: "disposable", secretKey: "disposable-test-only", region: "us-east-1"
  });
  const started = performance.now();
  await assert.rejects(storage.removeObjectBounded({ bucket: "disposable", objectName: "file", timeoutMs: 40 }),
    failure => failure.name === "AbortError" || failure.code === "ABORT_ERR");
  assert.ok(performance.now() - started < 1500, "stalled network operations must settle");
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(storage.removeObjectBounded({ bucket: "disposable", objectName: "file", signal: controller.signal }),
    failure => failure.name === "AbortError" || failure.code === "ABORT_ERR");
});

test("vector cleanup discovers old collections and deletes only the selected project's points", async t => {
  const original = { ...config.knowledge.vectorStore };
  t.after(() => Object.assign(config.knowledge.vectorStore, original));
  Object.assign(config.knowledge.vectorStore, { provider: "qdrant", qdrantUrl: "https://vectors.example.test", qdrantCollectionPrefix: "project_cleanup" });
  const deletes = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (url.endsWith("/collections")) return Response.json({ result: { collections: [
      { name: "project_cleanup_d384" }, { name: "project_cleanup_d1536" },
      { name: "other_application_d384" }, { name: "project_cleanup_dnot_a_dimension" }
    ] } });
    deletes.push({ url, method: options.method, body: JSON.parse(options.body) });
    return Response.json({ status: "ok" });
  });
  assert.deepEqual(await vectors.deleteProject({ projectId: "target-project" }), { deleted: true, collections: 2 });
  assert.equal(deletes.length, 2);
  for (const request of deletes) {
    assert.equal(request.method, "POST");
    assert.deepEqual(request.body, { filter: { must: [{ key: "project_id", match: { value: "target-project" } }] } });
    assert.match(request.url, /project_cleanup_d(384|1536)\/points\/delete\?wait=true$/);
  }
  await assert.rejects(vectors.deleteProject({ projectId: "" }), /Project id is required/);
});

test("vector cleanup rejects upstream failure instead of reporting successful deletion", async t => {
  const original = { ...config.knowledge.vectorStore };
  t.after(() => Object.assign(config.knowledge.vectorStore, original));
  Object.assign(config.knowledge.vectorStore, { provider: "qdrant", qdrantUrl: "https://vectors.example.test", qdrantCollectionPrefix: "project_cleanup" });
  t.mock.method(globalThis, "fetch", async url => url.endsWith("/collections")
    ? Response.json({ result: { collections: [{ name: "project_cleanup_d384" }] } })
    : new Response("Unavailable", { status: 503 }));
  await assert.rejects(vectors.deleteProject({ projectId: "target-project" }), /HTTP 503/);
});
