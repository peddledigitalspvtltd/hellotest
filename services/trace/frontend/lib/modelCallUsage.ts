import type { LlmTrace } from '../llmTraceTypes';

export type ModelCallUsageFact = { label: string; value: string };
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

/** Display retained provider measurements only. Missing usage is not zero,
 * and a cached-input subset must never be added to the input/total again. */
export function modelCallUsageFacts(trace: Pick<LlmTrace, 'usage' | 'duration_ms'>): ModelCallUsageFact[] {
  const usage = trace.usage;
  const input = count(usage?.prompt_tokens) ?? count(usage?.input_tokens);
  const output = count(usage?.completion_tokens) ?? count(usage?.output_tokens);
  const total = count(usage?.total_tokens);
  const cached = count(usage?.cached_input_tokens) ?? count(usage?.prompt_tokens_details?.cached_tokens)
    ?? count(usage?.input_tokens_details?.cached_tokens);
  const display = (value: number | undefined) => value === undefined ? 'Not reported' : value.toLocaleString();
  const milliseconds = count(trace.duration_ms);
  const duration = milliseconds === undefined ? 'Not recorded' : milliseconds < 1000 ? `${milliseconds.toLocaleString()} ms`
    : `${(milliseconds / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} s`;
  return [
    { label: 'Input tokens', value: display(input) },
    { label: 'Output tokens', value: display(output) },
    { label: 'Total tokens', value: display(total) },
    ...(cached !== undefined && input !== undefined && cached <= input ? [{ label: 'Cached input (included)', value: display(cached) }] : []),
    { label: 'Call duration', value: duration }
  ];
}
