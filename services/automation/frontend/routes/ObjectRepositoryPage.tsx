import {useCurrentProject,useCurrentAppType} from '@hellotest/platform/frontend/src/platform/hooks/useCurrentProject';
import {useRepositoryWorkspaceController} from '../workspaces/repository/useRepositoryWorkspaceController';
import {RepositoryWorkspaceView} from '../workspaces/repository/RepositoryWorkspaceView';
export function ObjectRepositoryPage(){const [projectId]=useCurrentProject();const [appTypeId,setAppTypeId]=useCurrentAppType(projectId);const controller=useRepositoryWorkspaceController({projectId,appTypeId,setAppTypeId});return <RepositoryWorkspaceView controller={controller}/>;}
export default ObjectRepositoryPage;
