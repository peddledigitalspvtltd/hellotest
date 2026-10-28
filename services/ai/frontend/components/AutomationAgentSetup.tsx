import "./AutomationAgentSetup.css";
import { AgenticCommandComposer, HELLOTEST_AGENT_CATALOG } from "@hellotest/agentic/frontend/components/AgenticExperience";
import { AgentEvidenceScope } from "@hellotest/agentic/frontend/components/AgentEvidenceScope";
import type { SmartContextSelection } from "./SmartContextWorkbench";
import type { ReactNode } from "react";
export type AutomationAgentSelection = { scopes: string[]; inputs: Record<string,string>; smart: SmartContextSelection | null; integrationId: string };
export const automationAgentSelection = (): AutomationAgentSelection => ({scopes:["automation","test-cases","stories","runs","knowledge"],inputs:{},smart:null,integrationId:""});
export function AutomationAgentSetup({agentId,projectId,appTypeId,testCaseId,prompt,onPromptChange,value,onChange,onSubmit,disabled,submitDisabled,running,submitLabel,options,integrations=[]}: {
 agentId:"automation-engineer"|"automation-repair";projectId:string;appTypeId?:string;testCaseId?:string;prompt:string;onPromptChange:(value:string)=>void;
 value:AutomationAgentSelection;onChange:(value:AutomationAgentSelection)=>void;onSubmit:()=>void;disabled?:boolean;submitDisabled?:boolean;running?:boolean;submitLabel:string;options?:ReactNode;
 integrations?: Array<{id:string;name:string;model?:string|null;is_active?:boolean;type?:string}>;
}) {
 const pinned={...value.inputs,...(testCaseId?{test_case_id:testCaseId}:{})};
 return <div className="automation-agent-setup"><AgenticCommandComposer agents={HELLOTEST_AGENT_CATALOG.filter(agent=>agent.id===agentId)} agentId={agentId} onAgentChange={()=>undefined}
  projectId={projectId} appTypeId={appTypeId} contextScopes={value.scopes} onContextScopesChange={scopes=>onChange({...value,scopes,smart:null})}
  evidenceScope={pinned} evidenceScopeControl={<AgentEvidenceScope projectId={projectId} appTypeId={appTypeId} scopes={value.scopes} values={pinned} disabled={disabled||running} readOnlyFields={testCaseId?["test_case_id"]:[]} onChange={(key,input)=>onChange({...value,inputs:{...value.inputs,[key]:input},smart:null})}/>}
  integrationId={value.integrationId} integrations={integrations} onIntegrationChange={integrationId=>onChange({...value,integrationId})}
  smartContext={value.smart} onSmartContextChange={smart=>onChange({...value,smart,scopes:value.scopes.includes("knowledge")?value.scopes:[...value.scopes,"knowledge"]})}
  prompt={prompt} promptLabel={agentId==="automation-engineer"?"Build instructions (optional)":"Repair instructions (optional)"} onPromptChange={onPromptChange}
  identityDescription={agentId==="automation-engineer"?"Manual case or prompt · Playwright MCP":"Saved case and run evidence · Playwright MCP"} allowEmptyPrompt submitLabel={submitLabel} onSubmit={onSubmit} disabled={disabled} submitDisabled={submitDisabled} running={running} optionsContent={options}/>
  <p className="muted">{agentId==="automation-engineer"?"Linked manual tests and saved steps are included automatically. Describe a new flow or add only missing setup and constraints.":"The case and saved sections are included. Select the failed run in Evidence scope and add repair priorities."} Context sources add accessible evidence. Playwright MCP grounds web automation in live observations. Run the saved case to verify it.</p>
 </div>;
}
export function automationAgentRequest(value:AutomationAgentSelection) {
 return {context_scopes:value.scopes,inputs:value.inputs,smart_context:value.smart?{query:value.smart.query,source_ids:value.smart.sourceIds,source_kinds:value.smart.sourceKinds,reviewed_context:value.smart.contextText}:undefined};
}
