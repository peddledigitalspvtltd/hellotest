export const ENGINE_ENVELOPE_VERSION: 'engine-run/1';
export const engineEnvelopeSchema: Readonly<Record<string, unknown>>;
export function engineEnvelopeIssues(value: unknown, options?: {allowLegacy?: boolean}): string[];
export function versionEngineEnvelope<T extends object>(value: T): T & {engine_envelope_version: 'engine-run/1'};
