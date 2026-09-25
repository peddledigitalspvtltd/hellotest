import type { SetupRole } from './api';

export function SetupRoles({ roles }: { roles: SetupRole[] }) {
  if (!roles.length) return null;
  return <section className="sample-roles" aria-labelledby="setup-roles-title">
    <div className="sample-roles-header">
      <div><h3 id="setup-roles-title">Role presets</h3></div>
      <span className="safe-chip">{roles.filter(role => role.role_id).length}/{roles.length} available</span>
    </div>
    <p>Install Workspace roles to create missing presets with the permissions below. Existing role permissions and user and project assignments are retained.</p>
    <div className="sample-role-grid">
      {roles.map(role => {
        const codes = role.role_id ? role.current_permission_codes : role.permission_codes;
        return <article className="sample-role-card" key={role.key}>
          <div><h4>{role.name}</h4><span>{role.status === 'customized' ? 'Customized · retained' : role.status === 'installed' ? 'Available' : 'Ready to install'}</span></div>
          <p>{role.description}</p>
          <details>
            <summary>{role.role_id ? 'Current' : 'Default'} permissions ({codes.length})</summary>
            {codes.length ? <ul>{codes.map(code => <li key={code}><code>{code}</code></li>)}</ul> : <p>This role currently has no permissions.</p>}
          </details>
        </article>;
      })}
    </div>
    <p className="sample-role-note">Feature availability still controls which granted actions can be used. Assign these roles to users or project members through access management.</p>
  </section>;
}
