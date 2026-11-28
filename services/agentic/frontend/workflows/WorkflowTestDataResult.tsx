import { isPreparedCaseData, type SprintTestData } from './sprintDraftResults';
import { WorkflowDataView } from './WorkflowDataView';

const sourceLabels: Record<string, string> = {
  case: 'Authored case value', case_template: 'Authored runtime generator', prior_step_capture: 'Captured by an earlier step',
  automation_node: 'Configured automation input', test_data_set: 'Selected Test Data Set', llm: 'Synthetic sample',
  deterministic_fallback: 'Deterministic sample', case_instruction: 'Explicit blank in the authored action'
};
const missingLabels: Record<string, string> = {
  dataset_binding_missing: 'The selected Test Data Set has no matching binding.',
  ai_data_generation_required: 'Use the test data utility to generate and review the authored AI data request.',
  reviewed_fixture_required: 'Supply a reviewed fixture or protected value.',
  reviewed_input_required: 'Supply the case value or a reviewed Test Data Set binding.',
  reviewed_expectation_required: 'Supply the authored value that the assertion should check.',
  synthetic_input_requires_review: 'Review the authored case before assigning a value.',
  synthetic_input_unavailable: 'Supply a case value or select a Test Data Set.'
};
const sectionLabel = (orders?: number[]) => orders?.length ? ` · ${orders.length === 1 ? 'Section' : 'Sections'} ${orders.join(', ')}` : '';

export function WorkflowTestDataDetails({data}: {data: SprintTestData}) {
  const sources = Object.entries(data.parameter_sources || {});
  return <>
    {(data.failure?.message || data.message) && <p>{data.failure?.message || data.message}</p>}
    {!data.message && !sources.length && Number(data.existing_parameter_count) > 0 && data.model_calls_attempted === 0
      && <p>Using {data.existing_parameter_count} existing case parameters.</p>}
    {data.dataset_selection && <p>{data.dataset_selection === 'manual_case' ? 'Selected by the Test Case' : 'Selected on this workflow node'}
      {typeof data.dataset_row_count === 'number' && ` · ${data.dataset_row_count} ${data.dataset_row_count === 1 ? 'row' : 'rows'}`}</p>}
    {data.referenced_parameter_count === 0 && <p>The case has no scoped parameter references.</p>}
    {sources.length > 0 && <ul aria-label="Parameter sources">{sources.map(([name, entry]) => <li key={name}>
      <code>{name}</code> · {sourceLabels[entry.source] || entry.source}{sectionLabel(data.parameter_step_orders?.[name])}
    </li>)}</ul>}
    {data.missing_parameter_details?.length ? <ul aria-label="Data required">{data.missing_parameter_details.map(item => <li key={item.parameter}>
      <code>{item.parameter}</code> · {missingLabels[item.reason] || 'Review this required parameter.'}{sectionLabel(item.step_orders)}
    </li>)}</ul> : data.missing_parameters?.length ? <p>Needs input · {data.missing_parameters.join(', ')}</p> : null}
    {data.deferred_runtime_parameters?.length ? <p>Deferred to execution settings · {data.deferred_runtime_parameters.join(', ')}</p> : null}
    {data.deterministic_fallbacks?.map(item => <p key={item.parameter}>{item.parameter} · {item.reason}</p>)}
    {data.parameter_values && Object.keys(data.parameter_values).length > 0 && <WorkflowDataView value={data.parameter_values} defaultMode="json"
      jsonLabel="Prepared case data JSON" copyJsonLabel="Copy prepared data JSON" />}
  </>;
}

export function WorkflowTestDataResult({value}: {value: unknown}) {
  if (!Array.isArray(value)) return null;
  return <>{value.flatMap((row, rowIndex) => {
    const result = row?.test_data;
    const entries = isPreparedCaseData(result) ? [[row.client_id || 'case', result] as const]
      : result && typeof result === 'object' ? Object.entries(result).filter((entry): entry is [string, SprintTestData] => isPreparedCaseData(entry[1])) : [];
    return entries.map(([key, data], index) => <section key={`${rowIndex}:${key}`}>
      <h4>{row.title || (entries.length === 1 && row.story?.title) || `Test Case ${index + 1}`}</h4>
      <p role="status">{data.status === 'ready' ? 'Data prepared' : 'Data needs input'} · {data.source === 'dataset' ? data.test_data_set_name || 'Selected Test Data Set' : data.source === 'manual_case' ? 'Authored case inputs' : 'Case data and synthetic samples'}</p>
      <WorkflowTestDataDetails data={data} />
    </section>);
  })}</>;
}
