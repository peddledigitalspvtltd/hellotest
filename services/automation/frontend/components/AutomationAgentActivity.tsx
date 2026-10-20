import "./AutomationAgentActivity.css";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { testingApi } from "@hellotest/testing/frontend/api.client";
import type { WorkspaceTransaction, WorkspaceTransactionEvent } from "@hellotest/platform/frontend/src/types";
import { richTextToPlainText } from "@hellotest/platform/frontend/src/platform/components/RichTextEditor";
import { AutomationEngineerWorkspace, type AutomationAgentInitialStep, type AutomationAgentInitialManualStep, type AutomationAgentWorkspaceStep } from "./AutomationEngineerWorkspace";
import { useCapabilityAccess } from "@hellotest/platform/frontend/src/platform/hooks/useCapabilityAccess";
import { automationActivityBrowserMetadata, automationActivityFailureReasons, automationActivityPollingDelay, automationActivityStepErrors } from "../lib/automationActivityMonitoring";
export type { AutomationAgentInitialStep, AutomationAgentInitialManualStep } from "./AutomationEngineerWorkspace";

export type AutomationAgentActivityRecord=WorkspaceTransaction & {events?:WorkspaceTransactionEvent[];events_has_more?:boolean;events_next_offset?:number;events_total?:number};
type BuildDependency={step_id:string;step_order?:number;reason:string;required_context?:string[];required_parameters?:string[]};
type CaseOutcome={test_case_id:string;source_test_case_id?:string;active_step_id?:string;title?:string;status?:string;code?:string;error_code?:string;failure_stage?:string;blocked_steps?:BuildDependency[];generated_step_count?:number;completion_attempts?:number;message?:string;completed_sections?:number;total_sections?:number};
type StepProgress=AutomationAgentWorkspaceStep;
type ActivitySummary=Pick<WorkspaceTransaction,"id"|"project_id"|"app_type_id"|"status"|"description"|"created_at">;
const strings=(value:unknown)=>Array.isArray(value)?value.filter((item):item is string=>typeof item==="string"):[];
export function AutomationAgentActivity({projectId,appTypeId,caseId,caseTitle,initialSteps=[],initialManualSteps=[],initialManualLoading=false,initialParameterValues={},transactionId,onUpdate,onRetry}: {
 projectId:string;appTypeId:string;caseId?:string;caseTitle?:string;initialSteps?:AutomationAgentInitialStep[];initialManualSteps?:AutomationAgentInitialManualStep[];initialManualLoading?:boolean;initialParameterValues?:Record<string,string>;transactionId?:string;onUpdate?:(activity:AutomationAgentActivityRecord)=>void;onReview?:(caseId:string)=>void;onRetry?:(caseIds:string[])=>void;
}) {
 const {can}=useCapabilityAccess(projectId);
 const allowed=["automation.view","automation.build","automation.code.view","automation.ai"].every(permission=>can(permission));
 const update=useRef(onUpdate);update.current=onUpdate;
 const [selectedId,setSelectedId]=useState("");
 const [older,setOlder]=useState<{scope:string;items:ActivitySummary[];next:string|null}|null>(null);
 const [historyError,setHistoryError]=useState("");
 const [loadingHistory,setLoadingHistory]=useState(false);
 const scope=`${projectId}:${appTypeId}:${caseId||""}`;
 const observationStarted=useRef(Date.now());
 useEffect(()=>{observationStarted.current=Date.now();setSelectedId("");setOlder(null);},[scope]);
 useEffect(()=>{observationStarted.current=Date.now();if(transactionId){setSelectedId("");setOlder(null);}},[transactionId]);
 const currentQuery=useQuery({queryKey:["automation-agent-activity",projectId,appTypeId,caseId,transactionId],queryFn:async()=>{
  const activity=transactionId?await testingApi.testCases.automationBuildStatus(transactionId):await testingApi.testCases.automationAgentActivity({app_type_id:appTypeId,test_case_id:caseId});
  if(activity&&(activity.project_id!==projectId||activity.app_type_id!==appTypeId))throw new Error("Agent activity is unavailable in this application.");
  return activity;
 },enabled:Boolean(allowed&&projectId&&appTypeId),retry:false,refetchOnWindowFocus:"always",refetchInterval:state=>automationActivityPollingDelay(state.state.data,Boolean(transactionId),observationStarted.current)});
 useEffect(()=>{if(allowed&&currentQuery.data)update.current?.(currentQuery.data);},[allowed,currentQuery.data]);
 const historyQuery=useQuery({queryKey:["automation-agent-history",projectId,appTypeId,caseId],queryFn:()=>testingApi.testCases.automationAgentActivities({app_type_id:appTypeId,test_case_id:caseId}),enabled:Boolean(allowed&&projectId&&appTypeId),retry:false,refetchInterval:()=>{const delay=automationActivityPollingDelay(currentQuery.data,Boolean(transactionId),observationStarted.current);return currentQuery.data&&["queued","running","pending"].includes(currentQuery.data.status)&&delay?Math.max(5000,delay):false;}});
 const previousQuery=useQuery({queryKey:["automation-agent-record",scope,selectedId],queryFn:async()=>{const item=await testingApi.testCases.automationBuildStatus(selectedId);if(item.project_id!==projectId||item.app_type_id!==appTypeId)throw new Error("Activity is unavailable in this application.");return item;},enabled:Boolean(allowed&&selectedId&&selectedId!==currentQuery.data?.id),retry:false});
 useEffect(()=>{const resume=()=>{observationStarted.current=Date.now();};window.addEventListener("focus",resume);return()=>window.removeEventListener("focus",resume);},[]);
 const viewingHistory=Boolean(selectedId&&selectedId!==currentQuery.data?.id);
 const query=viewingHistory?previousQuery:currentQuery;
 if(!allowed)return <p className="automation-agent-access-message">Automation view, build, AI and source permissions are required to view this Engineer workspace.</p>;
 if(!currentQuery.data&&!currentQuery.isError&&!selectedId&&!initialSteps.length&&!initialManualSteps.length&&!initialManualLoading&&!caseTitle)return null;
 const activity=query.data;
 const metadata=automationActivityBrowserMetadata(activity?.metadata||{},activity?.events||[]);
 const outcomes=(Array.isArray(metadata.case_outcomes)?metadata.case_outcomes:[]) as CaseOutcome[];
 const stepErrors=automationActivityStepErrors(metadata,activity?.events||[]);
 const verificationMap=metadata.verification_by_case&&typeof metadata.verification_by_case==='object'?metadata.verification_by_case as Record<string,unknown>:{};
 const verifications=Object.entries(verificationMap).filter(([id])=>!caseId||id===caseId||outcomes.some(outcome=>outcome.test_case_id===id&&outcome.source_test_case_id===caseId)||Array.isArray(metadata.manual_step_progress)&&metadata.manual_step_progress.some((row:unknown)=>Boolean(row&&typeof row==='object'&&(row as Record<string,unknown>).test_case_id===id&&(row as Record<string,unknown>).manual_test_case_id===caseId))).map(([id,value])=>({id,value:value&&typeof value==='object'?value as Record<string,unknown>:{}})).filter(({value})=>['running','passed','failed','blocked'].includes(String(value.status)));

 const dependencies=outcomes.flatMap(item=>(Array.isArray(item.blocked_steps)?item.blocked_steps:[]).map(blocker=>({...blocker,test_case_id:item.test_case_id}))).filter(item=>item&&typeof item.reason==="string"&&!stepErrors.some(error=>error.test_case_id===item.test_case_id&&error.step_id===item.step_id));
 const needsContext=outcomes.some(item=>item.code==="AUTOMATION_DEPENDENCY_MISSING");
 const steps=(Array.isArray(metadata.step_progress)?metadata.step_progress:[]) as StepProgress[];
 const manualSteps=(Array.isArray(metadata.manual_step_progress)?metadata.manual_step_progress:[]) as StepProgress[];
 const buildDataArtifacts=metadata.build_data_artifacts&&typeof metadata.build_data_artifacts==="object"&&!Array.isArray(metadata.build_data_artifacts)?metadata.build_data_artifacts as Record<string,string>:undefined;
 const historyItems=[...new Map([...(currentQuery.data?[currentQuery.data]:[]),...(Array.isArray(historyQuery.data?.items)?historyQuery.data.items:[]),...(older?.scope===scope?older.items:[])].map(item=>[item.id,item])).values()];
 const historyCursor=older?.scope===scope?older.next:historyQuery.data?.next_cursor;
 const loadHistory=async()=>{if(!historyCursor||loadingHistory)return;setLoadingHistory(true);setHistoryError("");try{const response=await testingApi.testCases.automationAgentActivities({app_type_id:appTypeId,test_case_id:caseId,cursor:historyCursor});setOlder({scope,items:[...(older?.scope===scope?older.items:[]),...response.items],next:response.next_cursor});}catch(error){setHistoryError(error instanceof Error?error.message:"Activity history could not be loaded.");}finally{setLoadingHistory(false);}};
 const retryIds=strings(metadata.retry_test_case_ids);
 const working=Boolean(activity&&["queued","running","pending"].includes(activity.status));
 const incomplete=activity?.status==="failed"||metadata.outcome_status==="incomplete";
 const partial=metadata.outcome_status==="partial"||Boolean(activity?.status==="completed"&&(Number(metadata.failed)>0||Number(metadata.skipped)>0));
 const failureReasons=!working&&(incomplete||partial)?automationActivityFailureReasons(metadata,caseId,stepErrors):[];
 const failedCase=outcomes.find(item=>(!caseId||item.test_case_id===caseId||item.source_test_case_id===caseId||manualSteps.some(step=>step.manual_test_case_id===caseId&&step.test_case_id===item.test_case_id))&&Boolean(item.failure_stage||item.error_code||item.code));
 const browserSetupFailed=failedCase?.failure_stage==="browser_startup"||["AUTOMATION_BROWSER_STARTUP_FAILED","AUTOMATION_BROWSER_INSPECTION_FAILED","AUTOMATION_BROWSER_BOOTSTRAP_OUTCOME_UNKNOWN"].includes(failedCase?.error_code||failedCase?.code||"")||failureReasons.includes("Browser could not start before generation. Check Test Engine and retry.");
 const failureTitle=browserSetupFailed?"Browser setup could not finish":failedCase?.failure_stage==="browser"?"Browser interaction could not finish":failedCase?.failure_stage==="save"?"Generated instructions could not be saved":failedCase?.failure_stage==="context"?"Required context could not be loaded":failedCase?.failure_stage==="model"?"The model could not complete the build":"The build could not finish";
 const stepFailurePhase=stepErrors.some(error=>!error.resolved_at&&error.phase===metadata.current_phase);
 const phaseMessage=working&&!stepFailurePhase&&typeof metadata.phase_message==="string"?richTextToPlainText(metadata.phase_message).slice(0,600):"";
 const refreshActivity=()=>{observationStarted.current=Date.now();void currentQuery.refetch();void historyQuery.refetch();if(viewingHistory)void previousQuery.refetch();};
 const label=query.isPending?"Loading activity":query.isError?"Progress unavailable":!activity?"Ready to develop":working?activity?.status==="queued"?"Queued":"Developing":needsContext?"Needs context":incomplete?"Incomplete":partial?"Partially generated":"Instructions generated";
 return <div className="automation-agent-activity-list"><div className="automation-agent-history-toolbar"><label><span>Activity history</span><select aria-label="Activity history" disabled={!historyItems.length} value={selectedId||activity?.id||""} onChange={event=>{setSelectedId(event.target.value);}}>{!historyItems.length?<option value="">No saved activity</option>:null}{historyItems.map((item,index)=><option key={item.id} value={item.id}>{index===0?"Latest · ":""}{item.created_at?new Date(item.created_at).toLocaleString():"Undated activity"} · {item.status}</option>)}</select></label>{historyCursor?<button className="ghost-button compact" type="button" disabled={loadingHistory} onClick={()=>void loadHistory()}>{loadingHistory?"Loading…":"Load older activities"}</button>:null}{historyQuery.isError||historyError?<small role="status">{historyError||"Previous activities are temporarily unavailable. Current activity remains available."}</small>:null}</div><section key={activity?.id||"unavailable"} className="automation-agent-activity" data-status={incomplete?"incomplete":partial?"partial":working?"working":"generated"} aria-label="Automation engineer activity">
  <header className="automation-agent-activity-header"><span className="automation-agent-activity-identity"><strong>Automation Engineer</strong><span>{query.isPending?"Loading saved activity details…":"Develop the complete case from its steps, requirements and scoped evidence."}</span></span><div className="automation-agent-activity-actions"><button className="ghost-button compact" type="button" disabled={query.isFetching} onClick={refreshActivity}>Refresh activity</button>{!working&&retryIds.length&&onRetry?<button className="ghost-button compact" type="button" onClick={()=>onRetry(retryIds)}>Retry {retryIds.length} unfinished case{retryIds.length===1?"":"s"}</button>:null}<span className="automation-agent-activity-status" role="status">{working?<span className="automation-live-dot"/>:null}{label}</span></div></header>
  <div className="automation-agent-activity-body">
   {verifications.map(({id,value})=><section key={id} aria-label="Generated test verification" className="automation-agent-verification" data-status={String(value.status)}><strong>{value.status==='passed'?'Isolated run passed':value.status==='running'?'Verifying saved instructions':value.status==='blocked'?'Verification needs review':'Isolated run did not pass'}</strong><p>{typeof value.message==='string'?richTextToPlainText(value.message):''}</p>{typeof value.source_fingerprint==='string'?<small>Saved source {value.source_fingerprint.slice(0,12)} · {Number(value.attempts)||0} run(s) · {Number(value.repair_count)||0} locator repair(s). Later Plan edits require a new run.</small>:null}</section>)}
   {phaseMessage?<p className="automation-agent-live-progress" role="status">{phaseMessage}</p>:null}
   {failureReasons.length?<div className="automation-agent-failure" role="alert"><strong>{failureTitle}</strong>{failureReasons.map(reason=><p key={reason}>{richTextToPlainText(reason)}</p>)}<p>Saved sections remain available in Plan. {browserSetupFailed?"Restore the browser connection or correct the Start URL, then retry.":failedCase?.failure_stage==="browser"?"Review the latest browser evidence and correct the failed step before retrying.":"Review the relevant model response or correct the issue before retrying."}</p></div>:null}
   {query.isError?<div role="alert"><p>{query.error.message}</p><button className="ghost-button compact" type="button" onClick={()=>void query.refetch()}>Retry progress</button></div>:null}
   {activity?<>
    {dependencies.length?<details className="automation-agent-dependencies" aria-label="Required automation context"><summary>Context needed to complete this case</summary><p>Configure the required sources or parameters, then retry. Existing instructions are retained.</p><ul>{dependencies.map((item,index)=><li key={`${item.step_id}:${index}`}><strong>Section {item.step_order||steps.find(step=>step.step_id===item.step_id)?.step_order||index+1}</strong><p>{richTextToPlainText(item.reason)}</p>{strings(item.required_context).length?<p><strong>Required context: </strong>{strings(item.required_context).join("; ")}</p>:null}{strings(item.required_parameters).length?<p><strong>Required parameters: </strong>{strings(item.required_parameters).join(", ")}</p>:null}</li>)}</ul></details>:null}
    <AutomationEngineerWorkspace key={`${scope}:${activity?.id||"idle"}`} projectId={projectId} appTypeId={appTypeId} activityId={activity?.id} caseId={caseId} caseTitle={caseTitle} initialSteps={viewingHistory?[]:initialSteps} initialManualSteps={viewingHistory?[]:initialManualSteps} initialManualLoading={!viewingHistory&&initialManualLoading} steps={steps} manualSteps={manualSteps} cases={outcomes} application={metadata.workspace_application} buildDataArtifacts={buildDataArtifacts} verificationByCase={verificationMap} stepErrors={stepErrors} progressionPolicy={typeof metadata.progression_policy==="string"?metadata.progression_policy:undefined} historical={viewingHistory&&!working} working={working} incomplete={incomplete}/>
   </>:<AutomationEngineerWorkspace key={`${scope}:idle`} projectId={projectId} appTypeId={appTypeId} caseId={caseId} caseTitle={caseTitle} initialSteps={initialSteps} initialManualSteps={initialManualSteps} initialManualLoading={initialManualLoading} initialParameterValues={initialParameterValues} steps={[]} manualSteps={[]} cases={[]} working={false} incomplete={false}/>}
  </div>
 </section></div>;
}
