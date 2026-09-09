const assert = require("node:assert/strict");
const test = require("node:test");
const http = require("node:http");
const Fastify = require("fastify");

const accessControlPlugin = require("../src/plugins/accessControl");
const errorHandlerPlugin = require("../src/plugins/errorHandler");
const validatorPlugin = require("../src/plugins/validator");
const knowledgeRoutes = require("../src/routes/aiKnowledge.routes");
const knowledgeAssistantService = require("../src/services/knowledgeAssistant.service");
const projectService = require("../src/services/project.service");
const permissionService = require("../src/services/permission.service");
const featureFlagService = require("../src/services/featureFlag.service");
const execution = require("../src/services/knowledgeExecution.service");

const SERVER_USER = Object.freeze({
  id: "server-user",
  role: "member",
  tenant_id: "server-tenant",
  status: "active"
});
const AUTH_HEADERS = { authorization: "Bearer route-fixture" };
const CONTEXT_BODY = {
  contract_type: "RetrievalRequest",
  contract_version: "1.0",
  project_id: "authorized-project",
  query: "Show evidence for UX-227"
};

const createFixture = async (t, { denyPermission = false, denyProject = false } = {}) => {
  const calls = { projects: [], permissions: [], sessions: [], retrieve: [], respond: [] };
  t.mock.method(projectService, "getProject", async (projectId, userId) => {
    calls.projects.push({ projectId, userId });
    if (denyProject || projectId !== CONTEXT_BODY.project_id || userId !== SERVER_USER.id) {
      throw Object.assign(new Error("Project access denied"), { statusCode: 403 });
    }
    return { id: projectId };
  });
  t.mock.method(permissionService, "hasPermission", async (user, permissionCode, projectId) => {
    calls.permissions.push({ user, permissionCode, projectId });
    return !denyPermission && user.id === SERVER_USER.id && permissionCode === "knowledge.view";
  });
  t.mock.method(featureFlagService, "areEnabled", async () => true);
  t.mock.method(knowledgeAssistantService, "getSession", async (input) => {
    calls.sessions.push(input);
    return { id: input.id, project_id: CONTEXT_BODY.project_id, status: "active" };
  });
  t.mock.method(knowledgeAssistantService, "retrieve", async (input) => {
    calls.retrieve.push(input);
    input.onProgress?.({ event_type: "progress", stage: "authorization", status: "COMPLETED" });
    return { context_packet_id: "packet-fixture", evidence: [] };
  });
  t.mock.method(knowledgeAssistantService, "respond", async (input) => {
    calls.respond.push(input);
    input.onProgress?.({ event_type: "progress", stage: "retrieval", status: "COMPLETED" });
    return { response_mode: input.responseMode, message: { id: "message-fixture" } };
  });

  const app = Fastify({ logger: false });
  t.after(() => app.close());
  await app.register(errorHandlerPlugin);
  await app.register(validatorPlugin);
  await app.register(accessControlPlugin);
  // Supply an already authenticated server identity, as upstream authentication
  // does. The real access-control plugin still rejects absent credentials and
  // enforces route/project permissions. No request-body fields set this identity.
  app.addHook("onRequest", async (request) => {
    if (request.headers.authorization === AUTH_HEADERS.authorization) {
      request.user = { ...SERVER_USER };
      request.authMethod = "session";
    }
  });
  await app.register(knowledgeRoutes);
  await app.ready();
  return { app, calls };
};

const assertJsonRejection = (response, statusCode) => {
  assert.equal(response.statusCode, statusCode);
  assert.match(response.headers["content-type"], /^application\/json\b/);
  assert.equal(response.headers["x-accel-buffering"], undefined);
  assert.doesNotMatch(response.body, /(?:^|\n)event: (?:progress|result|error)/);
  assert.equal(response.json().success, false);
};

test("context routes reject unsupported contract major/type before opening a stream or retrieving", async (t) => {
  const { app, calls } = await createFixture(t);
  for (const url of ["/v1/context/retrieve", "/v1/context/retrieve-stream"]) {
    for (const invalid of [
      { contract_version: "2.0" },
      { contract_version: "RetrievalRequest.v2" },
      { contract_type: "ContextPacket" }
    ]) {
      const response = await app.inject({
        method: "POST", url, headers: AUTH_HEADERS, payload: { ...CONTEXT_BODY, ...invalid }
      });
      assertJsonRejection(response, 422);
      assert.equal(response.json().code, "ERR_CONTRACT_VERSION");
    }
  }
  assert.equal(calls.retrieve.length, 0);
  assert.equal(calls.projects.length, 0, "invalid contracts stop before project/service work");
});

test("both streaming routes reject absent authentication before services or SSE ownership", async (t) => {
  const { app, calls } = await createFixture(t);
  for (const [url, payload] of [
    ["/v1/context/retrieve-stream", CONTEXT_BODY],
    ["/knowledge/assistant/sessions/session-fixture/messages/stream", { message: "Show evidence" }]
  ]) {
    const response = await app.inject({
      method: "POST", url,
      payload: { ...payload, user: { id: "forged-admin", role: "admin" }, authorization: { allowed: true } }
    });
    assertJsonRejection(response, 401);
    assert.equal(response.json().code, "AUTHENTICATION_REQUIRED");
  }
  assert.deepEqual(calls, { projects: [], permissions: [], sessions: [], retrieve: [], respond: [] });
});

for (const denial of ["permission", "project membership"]) {
  test(`both streaming routes reject denied ${denial} before SSE ownership`, async (t) => {
    const { app, calls } = await createFixture(t, {
      denyPermission: denial === "permission", denyProject: denial === "project membership"
    });
    for (const [url, payload] of [
      ["/v1/context/retrieve-stream", CONTEXT_BODY],
      ["/knowledge/assistant/sessions/session-fixture/messages/stream", { message: "Show evidence" }]
    ]) {
      const response = await app.inject({ method: "POST", url, headers: AUTH_HEADERS, payload });
      assertJsonRejection(response, 403);
      assert.equal(response.json().code, "ACCESS_DENIED");
    }
    assert.equal(calls.retrieve.length, 0);
    assert.equal(calls.respond.length, 0);
    if (denial === "project membership") {
      assert.deepEqual(calls.projects, Array.from({ length: 2 }, () => ({
        projectId: CONTEXT_BODY.project_id, userId: SERVER_USER.id
      })));
    }
  });
}

test("evidence-only turns preserve the mode and server identity through JSON and live SSE routes", async (t) => {
  const { app, calls } = await createFixture(t);
  const payload = {
    message: "Find supporting documents",
    response_mode: "evidence",
    client_turn_id: "turn-fixture-123",
    retrieval_budgets: { max_retrieval_rounds: 1 },
    user: { id: "forged-admin", role: "admin", tenant_id: "foreign-tenant" },
    user_id: "forged-admin",
    tenant_id: "foreign-tenant",
    authorization: { permissions: ["*"], tenant_id: "foreign-tenant" },
    permissions: ["*"]
  };
  for (const suffix of ["", "/stream"]) {
    const response = await app.inject({
      method: "POST", url: `/knowledge/assistant/sessions/session-fixture/messages${suffix}`,
      headers: AUTH_HEADERS, payload
    });
    assert.equal(response.statusCode, 200);
    if (suffix) {
      assert.match(response.headers["content-type"], /^text\/event-stream\b/);
      assert.match(response.body, /event: progress\ndata: /);
      assert.match(response.body, /event: result\ndata: /);
      assert.match(response.body, /"response_mode":"evidence"/);
      assert.ok(calls.respond.at(-1).signal instanceof AbortSignal);
    } else {
      assert.equal(response.json().response_mode, "evidence");
    }
    const input = calls.respond.at(-1);
    assert.equal(input.responseMode, "evidence");
    assert.equal(input.clientTurnId, payload.client_turn_id);
    assert.deepEqual(input.retrievalBudgets, payload.retrieval_budgets);
    assert.deepEqual(input.user, SERVER_USER);
    for (const field of ["authorization", "permissions", "user_id", "tenant_id"]) {
      assert.equal(Object.hasOwn(input, field), false, `client ${field} must not become trusted service input`);
    }
  }
  assert.equal(calls.respond.length, 2);
  assert.ok(calls.sessions.every((input) => input.user.id === SERVER_USER.id && input.includeMessages === false));
  assert.ok(calls.projects.every((input) => input.userId === SERVER_USER.id));
  assert.ok(calls.permissions.every((input) => input.user.id === SERVER_USER.id));
});

test("context retrieval accepts v1 compatibility spelling and forwards only server-owned identity", async (t) => {
  const { app, calls } = await createFixture(t);
  for (const contractVersion of ["1.0", "RetrievalRequest.v1"]) {
    const response = await app.inject({
      method: "POST", url: "/v1/context/retrieve", headers: AUTH_HEADERS,
      payload: {
        ...CONTEXT_BODY, contract_version: contractVersion,
        user: { id: "forged-admin", role: "admin" },
        authorization: { enforced: true, user_id: "forged-admin" },
        principal: { id: "forged-admin" },
        roles: ["admin"], tenant_id: "foreign-tenant", user_id: "forged-admin",
        budgets: { max_candidate_documents: 10 }, filters: { asset_type: "Requirement" }
      }
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().context_packet_id, "packet-fixture");
    assert.deepEqual(calls.retrieve.at(-1), {
      projectId: CONTEXT_BODY.project_id, appTypeId: undefined, query: CONTEXT_BODY.query,
      budgets: { max_candidate_documents: 10 }, filters: { asset_type: "Requirement" }, user: SERVER_USER
    });
  }
});

test("an invalid response mode is rejected before creating either JSON or streamed turns", async (t) => {
  const { app, calls } = await createFixture(t);
  for (const suffix of ["", "/stream"]) {
    const response = await app.inject({
      method: "POST", url: `/knowledge/assistant/sessions/session-fixture/messages${suffix}`,
      headers: AUTH_HEADERS, payload: { message: "Show evidence", response_mode: "unrestricted" }
    });
    assertJsonRejection(response, 400);
    assert.match(response.json().message, /response_mode/);
  }
  assert.equal(calls.respond.length, 0);
  assert.equal(calls.sessions.length, 0);
});

for (const [url, payload] of [
  ["/v1/context/retrieve", CONTEXT_BODY],
  ["/v1/context/retrieve-stream", CONTEXT_BODY],
  ["/knowledge/assistant/sessions/session-fixture/messages", { message: "Show evidence" }],
  ["/knowledge/assistant/sessions/session-fixture/messages/stream", { message: "Show evidence" }]
]) {
  test(`${url} ends slow preflight with safe JSON before execution or SSE ownership`, async (t) => {
    const { app, calls } = await createFixture(t);
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let releaseRead;
    let readSignal;
    let notifyReadStarted;
    const readStarted = new Promise((resolve) => { notifyReadStarted = resolve; });
    t.mock.method(projectService, "getProject", () => {
      readSignal = execution.current().signal;
      notifyReadStarted();
      return new Promise((resolve) => { releaseRead = resolve; });
    });

    let settled = false;
    const pendingResponse = app.inject({ method: "POST", url, headers: AUTH_HEADERS, payload })
      .then((response) => { settled = true; return response; });
    await readStarted;
    const completedPermissionChecks = calls.permissions.length;
    t.mock.timers.tick(4_999);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false, "the route should allow reads until its deadline");
    t.mock.timers.tick(1);
    const response = await pendingResponse;
    assertJsonRejection(response, 503);
    assert.equal(response.json().code, "ASSISTANT_SETUP_TIMEOUT");
    assert.equal(response.json().retryable, true);
    assert.match(response.json().message, /could not be prepared in time/);
    assert.equal(readSignal.aborted, true);

    releaseRead({ id: CONTEXT_BODY.project_id });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls.permissions.length, completedPermissionChecks, "a late project read cannot start another permission check");
    assert.equal(calls.retrieve.length, 0);
    assert.equal(calls.respond.length, 0);
  });
}

test("assistant preflight shares one deadline across session and project reads", async (t) => {
  const { app, calls } = await createFixture(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let releaseSession;
  let releaseProject;
  let notifySessionStarted;
  let notifyProjectStarted;
  const sessionStarted = new Promise((resolve) => { notifySessionStarted = resolve; });
  const projectStarted = new Promise((resolve) => { notifyProjectStarted = resolve; });
  t.mock.method(knowledgeAssistantService, "getSession", () => {
    notifySessionStarted();
    return new Promise((resolve) => { releaseSession = resolve; });
  });
  t.mock.method(projectService, "getProject", () => {
    notifyProjectStarted();
    return new Promise((resolve) => { releaseProject = resolve; });
  });
  const pendingResponse = app.inject({
    method: "POST", url: "/knowledge/assistant/sessions/session-fixture/messages/stream",
    headers: AUTH_HEADERS, payload: { message: "Show evidence" }
  }).then((response) => response);
  await sessionStarted;
  t.mock.timers.tick(3_000);
  releaseSession({ id: "session-fixture", project_id: CONTEXT_BODY.project_id, status: "active" });
  await projectStarted;
  const completedPermissionChecks = calls.permissions.length;
  t.mock.timers.tick(2_000);
  const response = await pendingResponse;
  assertJsonRejection(response, 503);
  assert.equal(response.json().code, "ASSISTANT_SETUP_TIMEOUT");
  releaseProject({ id: CONTEXT_BODY.project_id });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.permissions.length, completedPermissionChecks);
  assert.equal(calls.respond.length, 0);
});

test("disconnecting before SSE aborts preflight and prevents work after a late read", async (t) => {
  const { app, calls } = await createFixture(t);
  let releaseRead;
  let notifyReadStarted;
  let notifyAborted;
  const readStarted = new Promise((resolve) => { notifyReadStarted = resolve; });
  const aborted = new Promise((resolve) => { notifyAborted = resolve; });
  t.mock.method(projectService, "getProject", () => {
    execution.current().signal.addEventListener("abort", notifyAborted, { once: true });
    notifyReadStarted();
    return new Promise((resolve) => { releaseRead = resolve; });
  });
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const request = http.request(`${address}/v1/context/retrieve-stream`, {
    method: "POST", headers: { ...AUTH_HEADERS, "content-type": "application/json" }
  });
  request.on("error", () => {}); // The client intentionally closes this request.
  request.end(JSON.stringify(CONTEXT_BODY));
  await readStarted;
  const completedPermissionChecks = calls.permissions.length;
  request.destroy();
  await aborted;
  releaseRead({ id: CONTEXT_BODY.project_id });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.permissions.length, completedPermissionChecks);
  assert.equal(calls.retrieve.length, 0);
  assert.equal(calls.respond.length, 0);
});
