import { WorkflowCodeView } from './WorkflowCodeView';
import { WorkflowDataView } from './WorkflowDataView';
import type { SprintAutomation } from './sprintDraftResults';

const evidenceLabels = {
  blocked: 'Live grounding blocked',
  preview_only: 'Entry page inspected during generation',
  no_authored_expected_result: 'No expected result authored for this section',
  native_check_observed: 'Browser check observed during generation',
  source_assertions_pending_execution: 'Generated assertions await execution'
};

export function WorkflowAutomationSections({ draft }: { draft: SprintAutomation }) {
  const sections = draft.steps?.length ? draft.steps : draft.instructions || [];
  const apiOnly = sections.length > 0 && sections.every(step => (step.step_type || step.runtime) === 'api');
  const evidence = new Map(draft.browser_checks?.map(check => [check.step_id, evidenceLabels[check.expected_result_evidence]]));
  return <>
    {sections.map((step, index) => {
      const api = (step.step_type || step.runtime) === 'api' ? step.api_request : undefined;
      const instructions = step.automation_instructions?.instructions;
      const check = step.id ? evidence.get(step.id) : undefined;
      if (!api && !instructions?.length && !step.action && !step.expected_result && !check) return null;
      return <section key={step.id ?? step.step_order ?? index} aria-label={`Automation section ${step.step_order ?? index + 1}`}>
        {step.action && <h4>{step.action}</h4>}
        {step.expected_result && <p><strong>Expected result</strong> {step.expected_result}</p>}
        {check && <p className="studio-caption">{check}</p>}
        {api && <details open>
          <summary><code>{api.method || 'GET'} {api.url}</code></summary>
          <WorkflowDataView value={api} defaultMode="json" jsonLabel="Native API request and assertions" copyJsonLabel="Copy native API request" />
        </details>}
        {Boolean(instructions?.length) && <ol aria-label="HelloTest instructions">
          {instructions?.map(instruction => <li key={instruction.operation_id}>
            <strong>{instruction.label}</strong>{instruction.args.length > 0 && <> <code>{instruction.args.join(' ')}</code></>}
            {instruction.detail && <p>{instruction.detail}</p>}
          </li>)}
        </ol>}
      </section>;
    })}
    {draft.executable?.code && (!apiOnly || draft.executable.framework === 'playwright') &&
      <WorkflowCodeView code={draft.executable.code} filename={draft.executable.filename} />}
  </>;
}
