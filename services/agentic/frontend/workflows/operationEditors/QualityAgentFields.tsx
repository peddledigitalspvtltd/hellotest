import { useQuery } from '@tanstack/react-query';
import { agenticApi } from '../../api.client';
import { QUALITY_AGENT_EXPERIENCES, QUALITY_AGENT_KINDS } from '../../lib/qualityAgentExperience';
import type { WorkflowOperationEditorProps } from './operationEditorTypes';

export function QualityAgentFields({ data, projectId, appTypeId, onChange }: WorkflowOperationEditorProps) {
  const environments = useQuery({
    queryKey: ['workflow-test-environments', projectId, appTypeId],
    queryFn: ({ signal }) => agenticApi.workflowTestEnvironments.list({ project_id: projectId, ...(appTypeId ? { app_type_id: appTypeId } : {}) }, { signal }),
    enabled: Boolean(projectId && appTypeId),
    staleTime: 30_000,
    retry: false
  });
  return <>
    <label><span>Browser Quality Agent</span><select value={String(data.qualityAgentKind || 'web')} onChange={event => onChange({ qualityAgentKind: event.target.value })}>
      {QUALITY_AGENT_KINDS.map(kind => <option key={kind} value={kind}>{QUALITY_AGENT_EXPERIENCES[kind].name}</option>)}
    </select></label>
    <label><span>Test Environment</span><select value={String(data.testEnvironmentId || '')} onChange={event => onChange({ testEnvironmentId: event.target.value })}>
      <option value="">Select a Test Environment</option>
      {environments.data?.filter(environment => environment.base_url).map(environment => <option value={environment.id} key={environment.id}>{environment.name}</option>)}
    </select></label>
    {environments.isError && <p role="alert">Test Environments could not be loaded. <button className="ghost-button compact" type="button" onClick={() => void environments.refetch()}>Retry</button></p>}
    <label><span>Page path (optional)</span><input value={String(data.qualityTargetPath || '')} onChange={event => onChange({ qualityTargetPath: event.target.value })} placeholder="/catalog or $input.page_path" /></label>
    <label><span>Review goal (optional)</span><textarea rows={3} maxLength={1500} value={String(data.qualityGoal || '')} onChange={event => onChange({ qualityGoal: event.target.value })} />
      <small>Workflow reviews observe the selected page. Browser input actions require an interactive run.</small>
    </label>
  </>;
}
