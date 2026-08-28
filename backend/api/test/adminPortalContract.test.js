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
  const [service, schema, bootstrap] = await Promise.all([
    readSource("../src/services/adminPortal.service.js"),
    readSource("../../db/schema.sql"),
    readSource("../src/db/bootstrap.js")
  ]);

  assert.match(service, /BOOTSTRAP_EMAIL/);
  assert.match(service, /must_change_password[\s\S]*TRUE/);
  const administratorSelection = service.slice(
    service.indexOf("const administrators = await db.prepare"),
    service.indexOf("for (const administrator of administrators)")
  );
  assert.match(administratorSelection, /SELECT DISTINCT users\.id[\s\S]*users\.is_workspace_admin/);
  assert.doesNotMatch(administratorSelection, /JOIN roles|project_members/);
  assert.match(service, /ON CONFLICT \(project_id, user_id\)[\s\S]*DO UPDATE SET role_id = EXCLUDED\.role_id/);
  assert.match(service, /administrator_memberships: administratorMemberships/);
  assert.match(service, /idempotent: true/);
  assert.match(service, /recordAudit/);
  assert.match(schema, /CREATE TABLE admin_audit_log/);
  assert.match(schema, /must_change_password BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(bootstrap, /reapplyRuntimeSchema/);
  assert.match(bootstrap, /rebrandJsonColumn\("integrations", "config"\)/);
  assert.match(bootstrap, /rebrandJsonColumn\("app_settings", "value"\)/);
  assert.match(bootstrap, /rebrandJsonColumn\("quality_dashboards", "gadgets"\)/);
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
  assert.match(viteConfig, /request\.url = "\/admin\.html"/);
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
