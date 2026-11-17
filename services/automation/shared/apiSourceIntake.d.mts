export type ApiSourceFormat = 'auto' | 'postman' | 'har' | 'curl' | 'openapi';
export type ApiSourceRequest = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
  url: string;
  headers: Array<{ key: string; value: string }>;
  body_mode: 'none' | 'json' | 'text' | 'xml' | 'form';
  body: string | null;
  validations: Array<{kind: 'status'; expected: string; target?: string}>;
  captures: Array<{path: string; parameter: string}>;
  timeout_ms: number;
  follow_redirects: boolean;
};
export type ApiSourceDraftStep = {
  step_order: number;
  step_type: 'api';
  action: string;
  expected_result: string;
  api_request: ApiSourceRequest;
};
export type ApiAutomationSourceResult = {
  title: string;
  description: string;
  source_format: Exclude<ApiSourceFormat, 'auto'>;
  steps: ApiSourceDraftStep[];
  parameter_values: Record<string,string>;
  private_parameter_names: string[];
  warnings: string[];
};
export const API_SOURCE_LIMITS: Readonly<{maxBytes: number; maxRequests: number; maxDepth: number}>;
export function parseApiSourceIntake(source: string, options?: {format?: ApiSourceFormat}): ApiAutomationSourceResult;
