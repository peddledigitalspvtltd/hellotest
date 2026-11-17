import type {AppType, WorkspaceProjectScope} from '../../types';

/** Activate only after the signed-in scope response and its cache agree. */
export async function activateCreatedProjectScope(options: {
  projectId: string;
  loadScopes: () => Promise<{projects: WorkspaceProjectScope[]}>;
  loadApps: (projectId: string) => Promise<AppType[]>;
  cacheScopes: (snapshot: {projects: WorkspaceProjectScope[]}) => void;
  activate: (projectId: string, appTypeId: string) => void;
}) {
  const scopes = await options.loadScopes();
  options.cacheScopes(scopes);
  if (!scopes.projects.some(project => String(project.id) === options.projectId && project.has_access !== false)) return false;
  const apps = await options.loadApps(options.projectId).catch(() => []);
  options.activate(options.projectId, apps[0]?.id || '');
  return true;
}
