const crypto = require('node:crypto');
const db = require('../db');
const { DEFAULT_ROLE_PERMISSIONS } = require('../security/permissions.catalog');

async function ensureMemberRole() {
  const existing = await db.prepare("SELECT id FROM roles WHERE name = 'member'").get();
  if (existing) return existing.id;
  const created = await db.prepare("INSERT INTO roles (id, name) VALUES (?, 'member') ON CONFLICT (name) DO NOTHING RETURNING id").get(crypto.randomUUID());
  if (!created) return (await db.prepare("SELECT id FROM roles WHERE name = 'member'").get()).id;
  const codes = DEFAULT_ROLE_PERMISSIONS.member || [];
  if (codes.length) await db.prepare(`
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT ?, id FROM permissions WHERE code IN (${codes.map(() => '?').join(',')})
    ON CONFLICT (role_id, permission_id) DO NOTHING
  `).run(created.id, ...codes);
  return created.id;
}

// Called after verified signup or successful first login. Serialize concurrent
// first logins and preserve every existing membership and customized role.
exports.assign = db.transaction(async (userId) => {
  const user = await db.prepare('SELECT id, status, is_workspace_admin FROM users WHERE id = ? FOR UPDATE').get(userId);
  if (!user || user.status === 'suspended') return false;
  if (!user.is_workspace_admin && await db.prepare('SELECT 1 FROM project_members WHERE user_id = ? LIMIT 1').get(userId)) return false;
  const project = await db.prepare(`
    SELECT p.id FROM projects p
    WHERE (p.id IN ('sample-project', 'project-16')
      OR LOWER(COALESCE(p.display_id, '')) = 'project-16'
      OR LOWER(p.name) = 'hellotest')
      AND NOT EXISTS (SELECT 1 FROM project_deletion_jobs j WHERE j.project_id = p.id AND j.status IN ('queued', 'running', 'cleanup'))
    ORDER BY CASE WHEN p.id = 'sample-project' THEN 0 WHEN p.id = 'project-16' THEN 1 ELSE 2 END, p.created_at, p.id
    LIMIT 1 FOR KEY SHARE OF p
  `).get();
  if (!project) return false;
  // Recheck after acquiring the root lock if deletion admission was concurrent.
  if (await db.prepare("SELECT 1 FROM project_deletion_jobs WHERE project_id = ? AND status IN ('queued', 'running', 'cleanup')").get(project.id)) return false;
  if (await db.prepare('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?').get(project.id, userId)) return false;
  const roleId = user.is_workspace_admin
    ? (await db.prepare("SELECT id FROM roles WHERE LOWER(BTRIM(name)) = 'admin' ORDER BY id LIMIT 1").get())?.id
    : await ensureMemberRole();
  if (!roleId) return false;
  const result = await db.prepare(`
    INSERT INTO project_members (id, project_id, user_id, role_id) VALUES (?, ?, ?, ?)
    ON CONFLICT (project_id, user_id) DO NOTHING
  `).run(crypto.randomUUID(), project.id, userId, roleId);
  return Boolean(result.changes);
});
