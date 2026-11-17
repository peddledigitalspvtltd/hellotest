import type {RepositoryCaseStep} from '../../lib/repositoryCaseBindings';
export type AutomationCaseObjectsWorkspaceProps={projectId:string;appTypeId:string;caseId:string;steps:RepositoryCaseStep[];parameterValues:Record<string,string>;sourceAccess:boolean};
export type RepositoryWorkspaceScope={projectId:string;appTypeId:string;setAppTypeId?:(id:string)=>void;caseBindings?:Omit<AutomationCaseObjectsWorkspaceProps,'projectId'|'appTypeId'>};
