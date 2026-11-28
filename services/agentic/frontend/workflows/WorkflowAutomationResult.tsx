import { useState } from 'react';
import type { AgenticWorkflowFailureDetails } from '@hellotest/platform/frontend/src/types';
import { useCapabilityAccess } from '@hellotest/platform/frontend/src/platform/hooks/useCapabilityAccess';
import { agenticApi } from '../api.client';
import { WorkflowAutomationSections } from './WorkflowAutomationSections';
import { WorkflowFailureResolution } from './WorkflowFailureDetails';
import { automationExecutionIssue, automationVerificationId, type SprintAutomation, type SprintAutomationRow, type SprintTestData } from './sprintDraftResults';
import { WorkflowTestDataDetails } from './WorkflowTestDataResult';

type CaseResult = {
  manual_case?: {id?: string; display_id?: string; title?: string; revision?: number};
  automation?: SprintAutomation;
  test_data?: SprintTestData;
  saved_automation_case_id?: string;
  automation_input_required?: {message?: string; required_context?: string[]; required_parameters?: string[];
    blocked_steps?: Array<{reason?: string}>; review_prior_actions?: boolean};
  automation_failure?: AgenticWorkflowFailureDetails;
};

function AutomationVerificationStatus({draft}:{draft:SprintAutomation}) {
  const receipt = automationVerificationId(draft);
  const issue = automationExecutionIssue(draft);
  const failure = receipt ? undefined : draft.verification?.failure;
  const failedSection = failure?.step_id ? draft.steps?.find(step => step.id === failure.step_id)?.step_order : undefined;
  return <>
    <p role="status" title={receipt ? `Verification receipt ${receipt}` : undefined}>
      {receipt ? (draft.verification?.repair_count
        ? 'Verified after locator recovery'
        : 'Verified in an isolated browser check') : `Generated, unverified${issue ? ` · ${issue}` : ''}`}
    </p>
    {failedSection ? <p>Verification stopped in section {failedSection}{failure?.operation_index ? ` at operation ${failure.operation_index}` : ''}.</p> : null}
  </>;
}

export function WorkflowAutomationResult({value,runId,nodeId,projectId,iterationPath,canAccept}:{
  value:unknown;runId:string;nodeId:string;projectId:string;iterationPath?:Array<string|number>;canAccept:boolean;
}) {
  const {can}=useCapabilityAccess(projectId);
  const [saved,setSaved]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = value as CaseResult;
  if (!result.manual_case) return null;
  const draft = result.automation, input = result.automation_input_required;
  const savedCaseId = can('testcase.view') ? result.saved_automation_case_id || saved : '';
  const save = async () => {
    setBusy(true);setError('');
    try {
      const result=await agenticApi.agenticWorkflows.acceptWorkflowDraft(runId,{node_id:nodeId,story_index:0,case_index:0,kind:'automation',
        ...(iterationPath?.length ? {iteration_path:iterationPath} : {})});
      setSaved(result.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The automation draft could not be saved.');
    } finally { setBusy(false); }
  };
  return <section aria-label="Manual Test Case automation">
    <h4>{result.manual_case.title || result.manual_case.display_id || 'Manual Test Case'}</h4>
    {result.manual_case.id && <a href={`/test-cases?case=${encodeURIComponent(result.manual_case.id)}`}>Open manual Test Case</a>}
    {result.test_data && <details>
      <summary>Test data · {result.test_data.status === 'ready' ? 'Ready' : 'Needs input'}</summary>
      <WorkflowTestDataDetails data={result.test_data} />
    </details>}
    {input?.message && <div role="status"><p>{input.message}</p>
      {[...new Set(input.blocked_steps?.map(step=>step.reason))].filter(reason=>reason && reason!==input.message).map(reason=><p key={reason}>{reason}</p>)}
      {Boolean(input.required_context?.length) && <ul>{input.required_context?.map(context=><li key={context}>{context}</li>)}</ul>}
      {Boolean(input.required_parameters?.length) && <ul>{input.required_parameters?.map(name=><li key={name}><code>{name}</code></li>)}</ul>}
      {input.review_prior_actions && <p>Review the browser actions and reset the test data before rebuilding.</p>}
    </div>}
    {result.automation_failure && <div role="status"><p>{result.automation_failure.message}</p><WorkflowFailureResolution value={result.automation_failure.resolution}/></div>}
    {draft && <>
      <AutomationVerificationStatus draft={draft}/>
      {draft.verification?.message && <p>{draft.verification.message}</p>}
      {draft.live_validation?.status === 'blocked' && <p>{draft.live_validation.reason || 'Application validation stopped before completing the case.'}</p>}
      {can('automation.code.view') && <WorkflowAutomationSections draft={draft}/>}
      {savedCaseId ? <p role="status">Saved for review · <a href={`/automation?case=${encodeURIComponent(savedCaseId)}`}>Open in Test Automation</a></p>
        : canAccept && draft.validation?.status === 'passed' && can('testcase.view') && can('testcase.create') && can('automation.view') && can('automation.build') && can('automation.code.view') &&
          <button type="button" className="primary-button" disabled={busy} onClick={()=>void save()}>{busy ? 'Saving…' : 'Save automation draft'}</button>}
      {error && <p role="alert">{error}</p>}
    </>}
  </section>;
}

export function WorkflowSprintAutomationResult({ value, projectId }: { value: unknown; projectId: string }) {
  const { can } = useCapabilityAccess(projectId);
  if (!Array.isArray(value)) return null;
  return <>{(value as SprintAutomationRow[]).map((row, index) => <section key={index}>
    {row.title && <h4>{row.title}</h4>}
    {row.automation?.map((draft, draftIndex) => draft && <section key={draftIndex}>
      <AutomationVerificationStatus draft={draft}/>
      {draft.live_validation?.status === 'blocked' && <p>{draft.live_validation.reason || 'Application validation stopped before completing the case.'}</p>}
      {draft.verification?.message && <p>{draft.verification.message}</p>}
      {can('automation.code.view') && <WorkflowAutomationSections draft={draft}/>}
    </section>)}
    {row.automation_input_required?.map((item, itemIndex) => item && <div role="status" key={itemIndex}>
      <p>{item.message}</p>
      {item.blocked_steps?.map((step, stepIndex) => <p key={stepIndex}>{[step.reason, ...(step.required_context || []), ...(step.required_parameters || [])].filter(Boolean).join(' · ')}</p>)}
      {item.review_prior_actions && <p>Review the browser actions and reset the test data before rebuilding.</p>}
    </div>)}
    {row.automation_failures?.map((item, itemIndex) => item && <div role="status" key={itemIndex}>
      <p>{item.message}</p>
      <WorkflowFailureResolution value={item.resolution}/>
    </div>)}
  </section>)}</>;
}
