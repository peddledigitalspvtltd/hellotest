import { WorkflowCodeView } from './WorkflowCodeView';
import { WorkflowDataView } from './WorkflowDataView';
import type { SprintAutomation } from './sprintDraftResults';

export function WorkflowAutomationSections({ draft }: { draft: SprintAutomation }) {
  const sections = draft.steps?.length ? draft.steps : draft.instructions || [];
  const apiOnly = sections.length > 0 && sections.every(step => (step.step_type || step.runtime) === 'api');
  return <>
    {sections.map((step, index) => {
      const api = (step.step_type || step.runtime) === 'api' ? step.api_request : undefined;
      const instructions = step.automation_instructions?.instructions;
      if (!api && !instructions?.length) return null;
      return <section key={step.step_order ?? index} aria-label={`Automation section ${step.step_order ?? index + 1}`}>
        {step.action && <h4>{step.action}</h4>}
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
