import { useMemo } from "react";
import type {AutomationCaseObjectsWorkspaceProps} from './repositoryWorkspaceTypes';
import {useRepositoryWorkspaceController} from './useRepositoryWorkspaceController';
import {RepositoryWorkspaceView} from './RepositoryWorkspaceView';
export function AutomationCaseObjectsWorkspace({projectId,appTypeId,caseId,steps,parameterValues,sourceAccess}:AutomationCaseObjectsWorkspaceProps){
const caseBindings=useMemo(()=>({caseId,steps,parameterValues,sourceAccess}),[caseId,steps,parameterValues,sourceAccess]);
const controller=useRepositoryWorkspaceController({projectId,appTypeId,caseBindings});
const fieldCount=controller.pageObjectModels.reduce((total,page)=>total+page.members.length,0);
if(!sourceAccess)return <section role="tabpanel" aria-label="Automation object bindings"><div className="empty-state compact"><strong>Bindings unavailable</strong><p>Source access is required to inspect this case’s repository bindings.</p></div></section>;
return <section role="tabpanel" aria-label="Automation object bindings"><p className="muted">{controller.pageObjectModels.length} screen{controller.pageObjectModels.length===1?'':'s'} · {fieldCount} field{fieldCount===1?'':'s'}</p><RepositoryWorkspaceView controller={controller}/></section>;
}
export type {AutomationCaseObjectsWorkspaceProps} from './repositoryWorkspaceTypes';
