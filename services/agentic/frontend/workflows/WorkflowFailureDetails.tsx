import type { AgenticWorkflowFailureDetails } from '@hellotest/platform/frontend/src/types';
import { WorkflowDataView } from './WorkflowDataView';

const fields=(value:unknown,keys:string[])=>value&&typeof value==='object'&&!Array.isArray(value)
  ?Object.fromEntries(keys.filter(key=>Object.prototype.hasOwnProperty.call(value,key)).map(key=>[key,(value as Record<string,unknown>)[key]])):undefined;

export function WorkflowFailureDetails({value}:{value:unknown}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const details=value as AgenticWorkflowFailureDetails;
  if (!details.code && !details.message) return null;
  const provider=details.provider_error;
  const artifact=details.artifact,model=details.model_execution;
  const issues=Array.isArray(details.validation_errors)?details.validation_errors.slice(0,8):[];
  // The JSON inspector follows the public diagnostic contract too. Raw model
  // candidates, prompts and unknown provider fields never become UI content.
  const recorded={...fields(details,['code','provider_failure_code','category','message','status_code','upstream_status_code','retryable','retry_after_ms','operation_id','outcome_unknown','reconciliation_required','generation_received','effect_dispatched','completed_sections','total_sections']),
    provider_error:fields(provider,['code','type','param','request_id']),origin:fields(details.origin,['node_id','node_name','loop_node_id','batch_index','iteration_path']),
    artifact:fields(artifact,['artifact_task','story_id','case_index','case_client_id']),model_execution:fields(model,['model_calls','max_model_calls','deadline_ms','format_repair_attempted']),
    ...(issues.length?{validation_errors:issues.map(item=>fields(item,['path','issue','message','keyword','required_property']))}:{}),
    ...(Array.isArray(details.validation_feedback)?{validation_feedback:details.validation_feedback.slice(0,8).map(item=>fields(item,['step_id','code','message']))}:{})};
  const rows:Array<[string,unknown]>=[['Error code',details.code],['Provider failure',details.provider_failure_code],['Category',details.category?.replace(/_/g,' ')],['HTTP status',details.status_code],
    ['Provider HTTP status',details.upstream_status_code],['Provider error type',provider?.type],['Provider error code',provider?.code],
    ['Rejected parameter',provider?.param],['Provider request ID',provider?.request_id],['Original operation',details.operation_id],
    ['Failed step',details.origin?.node_name || details.origin?.node_id],['Loop batch',details.origin?.batch_index == null ? undefined : details.origin.batch_index+1],
    ['Artifact task',artifact?.artifact_task?.replace(/-/g,' ')],['Story',artifact?.story_id],
    ['Test Case',artifact?.case_index == null ? undefined : artifact.case_index+1],['Case reference',artifact?.case_client_id],
    ['Model calls',model?.model_calls == null ? undefined : `${model.model_calls}${model.max_model_calls==null?'':` / ${model.max_model_calls}`}`],
    ['Format repair',model?.format_repair_attempted === true ? 'Attempted' : model?.format_repair_attempted === false ? 'Not attempted' : undefined],
    ['Model time budget',model?.deadline_ms == null ? undefined : `${model.deadline_ms / 1000} seconds`],
    ['Retry classification',details.retryable === true ? 'Transient failure' : details.retryable === false ? 'Automatic retry blocked' : undefined],
    ['Provider retry delay',details.retry_after_ms == null ? undefined : `${details.retry_after_ms} ms`]];
  return <details className="studio-failure-details">
    <summary>Failure details</summary>
    <dl>{rows.filter(([,value])=>value!=null&&value!=='').map(([label,value])=><div key={label}><dt>{label}</dt><dd>{String(value)}</dd></div>)}</dl>
    {issues.length?<section aria-label="Output validation issues"><h4>Output validation issues</h4><ol>{issues.map((issue,index)=><li key={index} style={{overflowWrap:'anywhere'}}><code>{issue.path || '(root)'}</code>{issue.required_property?<> · Missing field <code>{issue.required_property}</code></>:null}{issue.keyword || issue.issue?<> · {issue.keyword || issue.issue}</>:null}{issue.message?<p>{issue.message}</p>:null}</li>)}</ol></section>:null}
    {details.reconciliation_required?<p className="studio-notice">The original operation has an unknown outcome. Verify that operation before starting another execution.</p>:null}
    {details.generation_received?<p className="studio-caption">A model completion was received. This generation will not be replayed automatically.</p>:null}
    <WorkflowDataView value={recorded} defaultMode="json" jsonLabel="Node failure details JSON" />
  </details>;
}
