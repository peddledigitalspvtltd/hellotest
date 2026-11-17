import type { QueryClient } from '@tanstack/react-query';
import type { useNavigate, useSearchParams } from 'react-router-dom';
import type { useAutomationBuildParameters } from '../../hooks/useAutomationBuildParameters';
import type { automationBuildPipelineRequest } from '../../lib/automationBuildPipeline';
import type { AutomationCreationMode } from '../../lib/automationWorkspaceSupport';
import type { AutomationCasesAccess } from './useAutomationCasesAccess';
import type { AutomationCasesState } from './useAutomationCasesState';
import type { AutomationCasesQueries } from './useAutomationCasesQueries';
import type { AutomationCasesModel } from './useAutomationCasesModel';
export type AutomationCasesActionPorts=AutomationCasesAccess&AutomationCasesState&AutomationCasesQueries&AutomationCasesModel&{
 projectId:string;appTypeId:string;queryClient:QueryClient;navigate:ReturnType<typeof useNavigate>;searchParams:URLSearchParams;setSearchParams:ReturnType<typeof useSearchParams>[1];
 invalidateAutomationData:()=>void;showError:(error:unknown,fallback:string)=>void;showSuccess:(message:string)=>void;selectAutomationCase:(id:string)=>void;
 reviewBuildParameters:ReturnType<typeof useAutomationBuildParameters>['reviewBuildParameters'];buildPipelineOptions:ReturnType<typeof automationBuildPipelineRequest>;
 canCreateAutomationCase:boolean;automationCreationMode:AutomationCreationMode;importedApiPlanReady:boolean;
};
