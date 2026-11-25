import {useCurrentProject,useCurrentAppType} from '@hellotest/platform/frontend/src/platform/hooks/useCurrentProject';
import {useAutomationCasesController} from '../workspaces/cases/useAutomationCasesController';
import {AutomationCasesView} from '../workspaces/cases/AutomationCasesView';
export function AutomationCasesPage({ engineer = false }: { engineer?: boolean }) {
  const [projectId] = useCurrentProject();
  const [appTypeId, setAppTypeId] = useCurrentAppType(projectId);
  const controller = useAutomationCasesController({ projectId, appTypeId, setAppTypeId, engineer });
  return <AutomationCasesView controller={controller} engineer={engineer}/>;
}
