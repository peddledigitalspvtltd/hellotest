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
