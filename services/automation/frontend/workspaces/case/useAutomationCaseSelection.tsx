import { useEffect, useRef, useState } from 'react';
import { useAutomationSelection } from '../../hooks/AutomationAuthoringProvider';
import type { AutomationCaseScope } from './useAutomationCaseScope';
import type { AutomationCaseSectionKey, AutomationWorkspaceTab } from '../../lib/automationWorkspaceSupport';
const tabs:AutomationWorkspaceTab[]=['details','steps','data','hooks','build','repository','runs','history','suites','defects'];
export function useAutomationCaseSelection({searchParams}:AutomationCaseScope, defaultTab: AutomationWorkspaceTab = "steps"){
 const caseSelection=useAutomationSelection();
 const [selectedCaseId,setSelectedCaseId]=useState('');
 const closingCaseRouteRef=useRef(''),lastAutomationRouteRef=useRef('');
 const [activeAutomationWorkspaceTab,setActiveAutomationWorkspaceTab]=useState<AutomationWorkspaceTab>(()=>{const tab=searchParams.get('tab') as AutomationWorkspaceTab;return tabs.includes(tab)?tab:defaultTab;});
 const [expandedCaseSections,setExpandedCaseSections]=useState<Record<AutomationCaseSectionKey,boolean>>({case:true,build:true,steps:true,history:false});
 useEffect(()=>{const tab=searchParams.get('tab');if(tab&&['details','steps','data','hooks','build','repository','runs','history','suites','defects'].includes(tab))setActiveAutomationWorkspaceTab(tab as AutomationWorkspaceTab);},[searchParams.get('tab')]);
 const routeCaseId=searchParams.get('case')||'';
 useEffect(()=>{if(selectedCaseId)caseSelection.openCase(selectedCaseId,routeCaseId);},[selectedCaseId,routeCaseId]);
 return {caseSelection,selectedCaseId,setSelectedCaseId,closingCaseRouteRef,lastAutomationRouteRef,activeAutomationWorkspaceTab,setActiveAutomationWorkspaceTab,expandedCaseSections,setExpandedCaseSections,selectedAutomationCaseIds:caseSelection.state.caseIds,selectedAutomationStepIds:caseSelection.state.stepIds,expandedAutomationStepIds:caseSelection.state.expandedStepIds,visibleInstructionIds:caseSelection.state.visibleInstructionIds};
}
export type AutomationCaseSelection=ReturnType<typeof useAutomationCaseSelection>;
