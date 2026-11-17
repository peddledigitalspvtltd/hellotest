const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");
const Fastify = require("fastify");
const { parseDocument } = require("yaml");

const registerRoutes = require("../src/routes");

const OPENAPI_PATH = path.join(__dirname, "../../../../openapi.yaml");
const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace"]);

const parseOpenApi = async () => {
  const source = await readFile(OPENAPI_PATH, "utf8");
  const document = parseDocument(source, { uniqueKeys: true });

  assert.deepEqual(
    document.errors.map((error) => error.message),
    [],
    "openapi.yaml must be valid YAML without duplicate mapping keys"
  );

  return document.toJS();
};

const resolveLocalRef = (root, ref) => {
  assert.match(ref, /^#\//, `expected a local OpenAPI reference, received ${ref}`);

  return ref
    .slice(2)
    .split("/")
    .map((token) => decodeURIComponent(token).replace(/~1/g, "/").replace(/~0/g, "~"))
    .reduce((value, token) => {
      assert.ok(value && Object.prototype.hasOwnProperty.call(value, token), `unresolved OpenAPI reference: ${ref}`);
      return value[token];
    }, root);
};

const resolvePathItem = (openapi, pathItem, visited = new Set()) => {
  if (!pathItem?.$ref) return pathItem || {};

  assert.ok(!visited.has(pathItem.$ref), `cyclic OpenAPI path-item reference: ${pathItem.$ref}`);
  visited.add(pathItem.$ref);
  const target = resolveLocalRef(openapi, pathItem.$ref);

  return {
    ...resolvePathItem(openapi, target, visited),
    ...Object.fromEntries(Object.entries(pathItem).filter(([key]) => key !== "$ref"))
  };
};

const normalizeOpenApiPath = (value) => value.replace(/\{([^}]+)\}/g, ":$1");

const collectDocumentedRoutes = (openapi) => {
  const routes = new Set();

  for (const [pathName, rawPathItem] of Object.entries(openapi.paths || {})) {
    const pathItem = resolvePathItem(openapi, rawPathItem);
    for (const method of Object.keys(pathItem)) {
      if (HTTP_METHODS.has(method)) {
        routes.add(`${method.toUpperCase()} ${normalizeOpenApiPath(pathName)}`);
      }
    }
  }

  return routes;
};

const collectRuntimeRoutes = async (prefix = "") => {
  const app = Fastify({ logger: false });
  const routes = new Set();
  const noopAuth = async () => {};

  // Registration only: these decorations satisfy route-level preHandler references.
  // No handler, database, network, or background service is started by this collector.
  app.decorate("authenticate", noopAuth);
  app.decorate("requireAdmin", noopAuth);
  app.addHook("onRoute", (options) => {
    for (const method of [].concat(options.method)) {
      // Fastify synthesizes a HEAD operation for every GET. It is not a literal
      // application route and therefore is intentionally outside this contract.
      if (method !== "HEAD") routes.add(`${method} ${options.url}`);
    }
  });
  app.register(registerRoutes, prefix ? { prefix } : undefined);

  try {
    await app.ready();
  } finally {
    await app.close();
  }

  return routes;
};

const sortedDifference = (left, right) => [...left].filter((value) => !right.has(value)).sort();

test("OpenAPI and registered Fastify operations have exact route parity", async () => {
  const [openapi, runtimeRoutes] = await Promise.all([parseOpenApi(), collectRuntimeRoutes()]);
  const documentedRoutes = collectDocumentedRoutes(openapi);

  assert.deepEqual(
    sortedDifference(runtimeRoutes, documentedRoutes),
    [],
    "every registered Fastify operation must be documented in openapi.yaml"
  );
  assert.deepEqual(
    sortedDifference(documentedRoutes, runtimeRoutes),
    [],
    "openapi.yaml must not advertise operations that the Fastify API does not register"
  );
});

test('documented request and response schemas retain valid required/enum/item shapes', async () => {
  const openapi = await parseOpenApi();
  const inspect = (schema, label) => {
    if (!schema || typeof schema !== 'object') return;
    if (schema.required !== undefined) assert.ok(Array.isArray(schema.required) && schema.required.every(item => typeof item === 'string'), `${label}: required is a name array`);
    if (schema.enum !== undefined) assert.ok(Array.isArray(schema.enum), `${label}: enum is an array`);
    if (schema.items !== undefined) { assert.equal(typeof schema.items, 'object', `${label}: items is a schema`);inspect(schema.items, `${label}.items`); }
    for (const [key, value] of Object.entries(schema.properties || {})) inspect(value, `${label}.${key}`);
    for (const key of ['allOf', 'oneOf', 'anyOf']) for (const child of schema[key] || []) inspect(child, `${label}.${key}`);
    if (schema.additionalProperties && typeof schema.additionalProperties === 'object') inspect(schema.additionalProperties, `${label}.additionalProperties`);
  };
  for (const [name, schema] of Object.entries(openapi.components.schemas)) inspect(schema, name);
  for (const [pathName, item] of Object.entries(openapi.paths)) for (const [method, operation] of Object.entries(resolvePathItem(openapi, item))) {
    if (!HTTP_METHODS.has(method)) continue;
    for (const parameter of operation.parameters || []) inspect(parameter.schema, `${method} ${pathName} parameter`);
    for (const [media, content] of Object.entries(operation.requestBody?.content || {})) inspect(content.schema, `${method} ${pathName} ${media}`);
    for (const response of Object.values(operation.responses || {})) for (const [media, content] of Object.entries(response.content || {})) inspect(content.schema, `${method} ${pathName} response ${media}`);
  }
});

test('new activity, authoring, webhook and resume operations document their distinct runtime boundaries', async () => {
  const openapi = await parseOpenApi();
  const stream = openapi.paths['/test-cases/automation/jobs/{transactionId}/events'].get;
  assert.ok(stream.responses['200'].content['text/event-stream']);
  assert.ok(stream.parameters.some(parameter => parameter.name === 'Last-Event-ID' && parameter.in === 'header'));
  assert.ok(openapi.components.schemas.AutomationAuthoringState.properties.can_record);
  assert.deepEqual(openapi.paths['/agentic-workflow-hooks/{id}'].post.security, [{ workflowWebhookSignature: [] }]);
  assert.deepEqual(openapi.paths['/agentic-workflow-runs/{id}/resume'].post.security, [{ bearerAuth: [] }]);
  assert.deepEqual(openapi.components.schemas.WorkflowResumeRequest.required, ['node_id', 'source_hash', 'request_id']);
  assert.equal(openapi.paths['/projects/{project_id}/knowledge/graph/expand'].post.requestBody.content['application/json'].schema.properties.seeds.maxItems, 6);
});

test("route collection honors Fastify plugin prefixes", async () => {
  const prefix = "/contract-prefix";
  const [unprefixed, prefixed] = await Promise.all([
    collectRuntimeRoutes(),
    collectRuntimeRoutes(prefix)
  ]);
  const normalizedPrefixed = new Set(
    [...prefixed].map((route) => {
      const separator = route.indexOf(" ");
      const method = route.slice(0, separator);
      const routePath = route.slice(separator + 1);
      assert.ok(routePath.startsWith(`${prefix}/`), `route did not inherit plugin prefix: ${route}`);
      return `${method} ${routePath.slice(prefix.length)}`;
    })
  );

  assert.deepEqual([...normalizedPrefixed].sort(), [...unprefixed].sort());
});

test("all local OpenAPI references resolve", async () => {
  const openapi = await parseOpenApi();
  const pending = [openapi];
  let localReferenceCount = 0;

  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== "object") continue;

    if (typeof value.$ref === "string" && value.$ref.startsWith("#/")) {
      resolveLocalRef(openapi, value.$ref);
      localReferenceCount += 1;
    }

    pending.push(...Object.values(value));
  }

  assert.ok(localReferenceCount > 0, "expected openapi.yaml to contain local references");
});

test("auth, notification, admin, and internal-service security contracts remain explicit", async () => {
  const openapi = await parseOpenApi();
  const operation = (pathName, method) => resolvePathItem(openapi, openapi.paths[pathName])[method];

  assert.equal(openapi.paths["/auth/signup"], undefined, "the removed one-step signup route must not be advertised");

  for (const [pathName, method] of [
    ["/auth/setup", "get"],
    ["/auth/signup/request-code", "post"],
    ["/auth/signup/verify", "post"],
    ["/auth/login", "post"],
    ["/auth/login/google", "post"],
    ["/auth/forgot-password/request-code", "post"],
    ["/auth/forgot-password/verify", "post"],
    ["/admin", "get"],
    ["/admin-portal/status", "get"],
    ["/admin-portal/auth/login", "post"]
  ]) {
    assert.deepEqual(operation(pathName, method).security, [], `${method.toUpperCase()} ${pathName} must be public`);
  }

  assert.deepEqual(operation("/auth/session", "get").security, [{ bearerAuth: [] }]);
  assert.deepEqual(operation("/admin-portal/overview", "get").security, [{ bearerAuth: [] }]);

  for (const [pathName, method] of [
    ["/api/engine/runs/claim", "post"],
    ["/api/engine/runs/{runId}/snapshot", "get"],
    ["/automation-generator/internal/jobs/lease", "post"],
    ["/testengine/internal/jobs/queue-stats", "get"]
  ]) {
    assert.deepEqual(
      operation(pathName, method).security,
      [{ testEngineSecret: [] }],
      `${method.toUpperCase()} ${pathName} must use the Test Engine shared-secret scheme`
    );
  }

  for (const [pathName, method] of [
    ["/notifications", "get"],
    ["/notifications", "delete"],
    ["/notifications/unread-count", "get"],
    ["/notifications/read-all", "put"],
    ["/notifications/{id}/read", "put"],
    ["/notifications/{id}", "delete"]
  ]) {
    assert.ok(operation(pathName, method), `${method.toUpperCase()} ${pathName} must be documented`);
  }
});
