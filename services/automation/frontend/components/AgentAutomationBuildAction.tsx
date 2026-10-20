import { AutomationBuildVerificationSettings } from "./AutomationBuildVerificationSettings";
import { automationBuildPipelineRequest, type AutomationBuildVerificationChoice } from "../lib/automationBuildPipeline";
import "./AgentAutomationBuildAction.css";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { testingApi } from "@hellotest/testing/frontend/api.client";
import { useCapabilityAccess } from "@hellotest/platform/frontend/src/platform/hooks/useCapabilityAccess";
import type { AutomationAgentContextOptions } from "@hellotest/platform/frontend/src/types";
import { PlayIcon } from "@hellotest/platform/frontend/src/platform/components/AppIcons";
import { AutomationAgentActivity, type AutomationAgentActivityRecord } from "./AutomationAgentActivity";

/** The specialist plans; this explicit action queues the same durable full-case builder as Automation. */
export function AgentAutomationBuildAction({projectId,appTypeId,caseId,prompt,integrationId,context,allowBrowserActions,startUrl,environmentId,configurationId,dataSetId}: {
 projectId:string;appTypeId:string;caseId?:string;prompt:string;integrationId?:string;context:AutomationAgentContextOptions;allowBrowserActions?:boolean;startUrl?:string;environmentId?:string;configurationId?:string;dataSetId?:string;
}) {
 const {can}=useCapabilityAccess(projectId);const scope=`${projectId}:${appTypeId}:${caseId || ""}`;const latest=useRef(scope);latest.current=scope;
 const [receipt,setReceipt]=useState<{scope:string;id:string}|null>(null);
 const [activity,setActivity]=useState<AutomationAgentActivityRecord|null>(null);
 const queryClient=useQueryClient();
 const [verificationMode,setVerificationMode]=useState<AutomationBuildVerificationChoice>("generate_only");
 const canVerify=can("automation.run.local")&&can("run.create");
 useEffect(()=>{setReceipt(null);setActivity(null);},[scope]);
 const queue=useMutation({mutationFn:async()=>{if(!caseId||!appTypeId)throw new Error("Select one automation case before building.");return ({scope,response:await testingApi.testCases.buildAutomationBatch({ai_feature:"ai.agentic.automation-engineer",app_type_id:appTypeId,test_case_ids:caseId?[caseId]:[],integration_id:integrationId || undefined,
  ...automationBuildPipelineRequest({mode:verificationMode,driver:"mcp",canVerify,interactive:allowBrowserActions!==false}),
  agent_context:context,additional_context:prompt,allow_browser_actions:allowBrowserActions!==false,start_url:startUrl || undefined,test_environment_id:environmentId || undefined,test_configuration_id:configurationId || undefined,test_data_set_id:dataSetId || undefined})});},
  onSuccess:({scope:requested,response})=>{if(latest.current===requested){setActivity(null);setReceipt({scope:requested,id:response.transaction_id});}},onSettled:()=>void queryClient.invalidateQueries({queryKey:["automation-agent-activity",projectId,appTypeId,caseId]})});
 const selectedReceipt=receipt?.scope===scope?receipt:null;
 const busy=queue.isPending||Boolean(selectedReceipt&&!activity)||Boolean(activity&&["queued","running","pending"].includes(activity.status));
 return <section className="automation-specialist-build" aria-label="Build complete automation case"><div><strong>Develop the complete case</strong><p>Build every saved section with Playwright MCP browser evidence, requirements and scoped data. Generated instructions remain unverified until a Test Engine run passes.</p></div>
  <p>{allowBrowserActions !== false ? "Browser mode: perform steps while building (can click, type and submit forms)." : "Browser mode: inspect only. Browser actions will not be performed."}</p>
  <AutomationBuildVerificationSettings mode={verificationMode} onModeChange={setVerificationMode} canVerify={canVerify} interactive={allowBrowserActions!==false} disabled={busy}/>
  {!caseId?<p>Select the Test Case ID in Evidence scope.</p>:null}
  <button className="primary-button" type="button" disabled={!caseId||!appTypeId||!can("automation.build")||!can("automation.ai")||busy} onClick={()=>queue.mutate()}><PlayIcon size={16}/>{busy?"Building automation…":"Build complete case"}</button>
  {queue.isError?<p role="alert">{queue.error.message}</p>:null}
  {caseId?<AutomationAgentActivity projectId={projectId} appTypeId={appTypeId} caseId={caseId} transactionId={selectedReceipt?.id} onUpdate={setActivity}/>:null}
 </section>;
}
