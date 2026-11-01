import type { AgenticWorkflowFailureDetails } from '@hellotest/platform/frontend/src/types';
import { WorkflowDataView } from './WorkflowDataView';

export function WorkflowFailureDetails({value}:{value:unknown}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const details=value as AgenticWorkflowFailureDetails;
  if (!details.code && !details.message) return null;
  const provider=details.provider_error;
  const rows:Array<[string,unknown]>=[['Error code',details.code],['Provider failure',details.provider_failure_code],['Category',details.category?.replace(/_/g,' ')],['HTTP status',details.status_code],
    ['Provider HTTP status',details.upstream_status_code],['Provider error type',provider?.type],['Provider error code',provider?.code],
    ['Rejected parameter',provider?.param],['Provider request ID',provider?.request_id],['Original operation',details.operation_id],
    ['Failed step',details.origin?.node_name || details.origin?.node_id],['Loop batch',details.origin?.batch_index == null ? undefined : details.origin.batch_index+1],
    ['Retry classification',details.retryable === true ? 'Transient failure' : details.retryable === false ? 'Automatic retry blocked' : undefined],
    ['Provider retry delay',details.retry_after_ms == null ? undefined : `${details.retry_after_ms} ms`]];
  return <details className="studio-failure-details">
    <summary>Failure details</summary>
    <dl>{rows.filter(([,value])=>value!=null&&value!=='').map(([label,value])=><div key={label}><dt>{label}</dt><dd>{String(value)}</dd></div>)}</dl>
    {details.reconciliation_required?<p className="studio-notice">The original operation has an unknown outcome. Verify that operation before starting another execution.</p>:null}
    {details.generation_received?<p className="studio-caption">A model completion was received. This generation will not be replayed automatically.</p>:null}
    <WorkflowDataView value={details} defaultMode="json" jsonLabel="Node failure details JSON" />
  </details>;
}
