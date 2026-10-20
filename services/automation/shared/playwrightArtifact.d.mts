export type PortableStep = { id?: string; step_order?: number; action?: string | null; expected_result?: string | null; step_type?: string | null; automation_code?: string | null; api_request?: unknown; group_name?: string | null };
export type { PortableRepositoryRow, AutomationRepositoryField } from "./automationRepository.mjs";
export { buildAutomationRepositoryFields, preparePlaywrightRepository } from "./automationRepository.mjs";
export function createPlaywrightExecutionOptions(settings?: Record<string, unknown>): Record<string, string | number | boolean>;
export function buildPlaywrightArtifact(input: {
  testCase: { id: string; title: string }; steps: PortableStep[]; rows?: Record<string, string>[]; sectionRows?: Record<string, string>[][];
  objects?: Record<string, string>; repositoryIssues?: Record<string, string>; baseURL?: string; executionOptions?: Record<string, unknown>;
  plainText?: (value?: string | null) => string; formatSource?: (source: string) => string;
}): string;
