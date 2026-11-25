import { useQuery } from '@tanstack/react-query';
import { AgentEvidenceScope } from '../components/AgentEvidenceScope';
import { agenticApi } from '../api.client';
import { agentInputFields, type AgentDefinition } from './agentDefinitions';

export function AgentTaskInputs({ definition, projectId, appTypeId, values, onChange, disabled, includeEvidenceScope }: {
  definition: AgentDefinition; projectId: string; appTypeId?: string;
  values: Record<string, unknown>; onChange: (key: string, value: string) => void;
  disabled?: boolean; includeEvidenceScope?: boolean;
}) {
  const fields = agentInputFields(definition);
  const environments = useQuery({
    queryKey: ['agent-task-environments', projectId, appTypeId],
    queryFn: ({ signal }) => agenticApi.workflowTestEnvironments.list({ project_id: projectId, app_type_id: appTypeId || undefined }, { signal }),
    enabled: Boolean(projectId && fields.some(field => field.type === 'environment'))
  });
  const records = fields.filter(field => field.type !== 'text' && field.type !== 'environment');
  const inputValue = (field: typeof fields[number]) => String(values[field.name] ?? field.default ?? '');
  const selected = { ...Object.fromEntries(fields.map(field => [field.name, inputValue(field)])), ...values };
  return <>
    {(includeEvidenceScope || records.length > 0) && <AgentEvidenceScope projectId={projectId} appTypeId={appTypeId}
      scopes={definition.context_scopes} onlyFields={!includeEvidenceScope ? records.map(field => field.name) : undefined}
      values={selected} onChange={onChange} disabled={disabled} />}
    {records.length > 0 && <ul aria-label="Selected task records">{records.map(field => <li key={field.name}>
      {field.label}{field.required ? ' *' : ''} · {inputValue(field) || 'Choose in Evidence scope'}
    </li>)}</ul>}
    {fields.filter(field => field.type === 'text' || field.type === 'environment').map(field => <label key={field.name}>
      <span>{field.label}{field.required ? ' *' : ''}</span>
      {field.type === 'environment' ? <>
        <select value={inputValue(field)} disabled={disabled || environments.isLoading} required={field.required} onChange={event => onChange(field.name, event.target.value)}>
          <option value="">Choose a Test Environment</option>
          {environments.data?.map(environment => <option key={environment.id} value={environment.id}>{environment.name}</option>)}
        </select>
        {environments.error && <small role="alert">{environments.error.message}</small>}
      </> : <input disabled={disabled} required={field.required} value={inputValue(field)} maxLength={255} onChange={event => onChange(field.name, event.target.value)} />}
    </label>)}
  </>;
}
