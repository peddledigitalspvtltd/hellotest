import {useCurrentProject,useCurrentAppType} from '@hellotest/platform/frontend/src/platform/hooks/useCurrentProject';
import {useAutomationCasesController} from '../workspaces/cases/useAutomationCasesController';
import {AutomationCasesView} from '../workspaces/cases/AutomationCasesView';
export function AutomationCasesPage(){const [projectId]=useCurrentProject();const [appTypeId,setAppTypeId]=useCurrentAppType(projectId);const controller=useAutomationCasesController({projectId,appTypeId,setAppTypeId});return <AutomationCasesView controller={controller}/>;}
