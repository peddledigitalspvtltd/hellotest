const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const readSource = (relativePath) => readFile(path.join(__dirname, relativePath), "utf8");

test("dedicated administration routes protect every control-plane mutation", async () => {
  const routes = await readSource("../src/routes/adminPortal.routes.js");

  assert.match(routes, /fastify\.post\("\/admin-portal\/auth\/login"/);
  assert.match(routes, /fastify\.get\("\/admin-portal\/overview", \{ preHandler: \[fastify\.requireAdmin\] \}/);

  for (const route of [
    "/admin-portal/setup/schema",
    "/admin-portal/setup/sample-data",
    "/admin-portal/users",
    "/admin-portal/feature-flags",
    "/admin-portal/integrations",
    "/admin-portal/security/password"
  ]) {
    const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(routes, new RegExp(`fastify\\.(?:post|put|delete)\\(\"${escaped}(?:/:id)?\", \\{ preHandler: \\[fastify\\.requireAdmin\\]`));
  }
});

test("admin foundation is additive, auditable, and forces bootstrap password replacement", async () => {
  const [service, schema, bootstrap, samples] = await Promise.all([
    readSource("../src/services/adminPortal.service.js"),
    readSource("../../db/schema.sql"),
    readSource("../src/db/bootstrap.js"),
    readSource("../src/services/sampleData/index.js")
  ]);

  assert.match(service, /BOOTSTRAP_EMAIL/);
  assert.match(service, /must_change_password[\s\S]*TRUE/);
  const membershipSetup = service.slice(
    service.indexOf("const ensureSampleWorkspace = async"),
    service.indexOf("exports.getSampleCatalog")
  );
  assert.match(membershipSetup, /ON CONFLICT \(project_id, user_id\) DO NOTHING/);
  assert.match(membershipSetup, /COALESCE\(users\.is_workspace_admin, FALSE\) = TRUE/);
  assert.match(membershipSetup, /COALESCE\(users\.status, 'active'\) <> 'suspended'/);
  assert.match(membershipSetup, /administrator\.id === actorId/);
  assert.doesNotMatch(membershipSetup, /DO UPDATE|INSERT INTO projects|INSERT INTO app_types|JOIN roles/);
  assert.match(samples, /administrator_memberships: administratorMemberships/);
  assert.match(samples, /idempotent: true/);
  assert.match(service, /recordAudit/);
  assert.match(schema, /CREATE TABLE admin_audit_log/);
  assert.match(schema, /must_change_password BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(bootstrap, /reapplyRuntimeSchema/);
  assert.match(bootstrap, /rebrandJsonColumn\("integrations", "config"\)/);
  assert.match(bootstrap, /rebrandJsonColumn\("app_settings", "value"\)/);
  assert.match(bootstrap, /rebrandJsonColumn\("quality_dashboards", "gadgets"\)/);
});

test("workspace role samples are independently selectable and never implied by content dependencies", () => {
  const { modules, resolveModules } = require("../src/services/sampleData/catalog");
  assert.deepEqual(resolveModules(["workspace_roles"]), { requested: ["workspace_roles"], installed: ["workspace_roles"], dependencies_added: [] });
  assert.equal(modules.find(module => module.key === "workspace_roles").group, "People & access");
  assert.ok(resolveModules().installed.includes("workspace_roles"));
  for (const module of modules.filter(module => module.key !== "workspace_roles")) {
    assert.ok(!resolveModules([module.key]).installed.includes("workspace_roles"), module.key);
  }
});

test("admin frontend has a dedicated entry point, port, and production listener", async () => {
  const [packageJson, viteConfig, nginx, dockerfile, gateway, launcher, localCompose, fullCompose] = await Promise.all([
    readSource("../../../frontend/package.json"),
    readSource("../../../frontend/vite.admin.config.ts"),
    readSource("../../../frontend/nginx.conf"),
    readSource("../../../frontend/Dockerfile"),
    readSource("../src/routes/adminUi.routes.js"),
    readSource("../../../hellotest.sh"),
    readSource("../../../local-run/docker-compose.yml"),
    readSource("../../../docker-compose.full.yml")
  ]);

  assert.match(packageJson, /"dev:admin": "vite --config vite\.admin\.config\.ts"/);
  assert.match(viteConfig, /base: "\.\/"/);
  assert.match(viteConfig, /port: 5174/);
  assert.match(viteConfig, /request\.url = `\/admin\.html\$\{url\.search\}`/);
  assert.match(nginx, /location = \/admin/);
  assert.match(nginx, /listen 81;/);
  assert.match(nginx, /root \/usr\/share\/nginx\/admin;/);
  assert.match(dockerfile, /RUN npm run build:all/);
  assert.match(gateway, /fastify\.get\("\/admin"/);
  assert.match(gateway, /fastify\.get\("\/admin\/runtime-config\.js"/);
  assert.match(gateway, /API_BASE_URL = ''/);
  assert.match(launcher, /compose build --no-cache/);
  assert.match(launcher, /Administration: \$HELLOTEST_ADMIN_URL/);
  assert.match(localCompose, /\$\{HELLOTEST_ADMIN_PORT:-8081\}:81/);
  assert.match(fullCompose, /\$\{HELLOTEST_ADMIN_PORT:-8081\}:81/);
});
