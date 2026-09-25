const assert = require("node:assert/strict");
const test = require("node:test");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");

function fixture() {
  const writes = [];
  const roles = [
    { id: "workspace-admin", name: "admin" }, { id: "default-member", name: "member" },
    { id: "product-owner", name: "Product Owner" }, { id: "custom-reviewer", name: "Release Reviewer" },
    { id: "jira-admin", name: "Jira Administrator" }
  ];
  const users = ["creator", "designer", "reviewer"].map((id) => ({ id, is_workspace_admin: false })).concat({ id: "administrator", is_workspace_admin: true });
  const db = {
    prepare(sql) { return {
      async get(id) {
        if (/FROM roles/.test(sql)) return roles.find((role) => /WHERE name/.test(sql) ? role.name === id : role.id === id);
        if (/FROM users/.test(sql)) return users.find((user) => user.id === id);
        throw new Error(`Unexpected lookup ${sql}`);
      },
      async all() { assert.match(sql, /FROM users/); return users.filter((user) => user.is_workspace_admin); },
      async run(...params) { writes.push({ sql, params }); }
    }; },
    transaction(fn) { return async () => fn(); }
  };
  const exports = {};
  vm.runInNewContext(readFileSync(require.resolve("../../backend/services/project.service"), "utf8"), {
    exports,
    require(id) {
      if (id === "../src/db") return db;
      if (id === "crypto") return require("node:crypto");
      if (id === "../src/domain/catalog") return require("../../backend/src/domain/catalog");
      if (id === "./displayId.service") return { createDisplayId: async () => "PROJ-NEW" };
      if (id === "./projectRoleAssignment") return require("../../backend/services/projectRoleAssignment");
      if (["./attachment.service", "./projectDeletion.repository"].includes(id)) return {};
      throw new Error(`Unexpected dependency ${id}`);
    }
  });
  return { create: exports.createProject, writes, members: () => writes.filter((write) => /INSERT INTO project_members/.test(write.sql)).map(({ params }) => ({ user_id: params[2], role_id: params[3] })) };
}
const input = { name: "Delivery", created_by: "creator", visibility: "public", app_types: [{ name: "Checkout", type: "web" }] };

test("project creation persists each configured member role and preserves automatic creator/admin grants", async () => {
  const f = fixture();
  const result = await f.create({ ...input, members: [{ user_id: "designer", role_id: "product-owner" }, { user_id: "reviewer", role_id: "custom-reviewer" }] });
  assert.equal(result.members_added, 4);
  assert.deepEqual(f.members(), [
    { user_id: "administrator", role_id: "workspace-admin" }, { user_id: "creator", role_id: "default-member" },
    { user_id: "designer", role_id: "product-owner" }, { user_id: "reviewer", role_id: "custom-reviewer" }
  ]);
});

test("unknown and privileged role assignments fail before creating project resources", async () => {
  for (const [role_id, statusCode] of [["deleted-role", 400], ["workspace-admin", 403], ["jira-admin", 403]]) {
    const f = fixture();
    await assert.rejects(f.create({ ...input, members: [{ user_id: "designer", role_id }] }), { statusCode });
    assert.equal(f.writes.length, 0, role_id + " cannot leave a partially created project");
  }
});

test("legacy member IDs retain the configured member default and private projects omit invitations", async () => {
  const publicFixture = fixture();
  await publicFixture.create({ ...input, member_ids: ["designer", "designer"] });
  assert.deepEqual(publicFixture.members().filter((member) => member.user_id === "designer"), [{ user_id: "designer", role_id: "default-member" }]);
  const privateFixture = fixture();
  await privateFixture.create({ ...input, visibility: "private", members: [{ user_id: "designer", role_id: "product-owner" }] });
  assert.deepEqual(privateFixture.members(), [{ user_id: "creator", role_id: "default-member" }]);
});
