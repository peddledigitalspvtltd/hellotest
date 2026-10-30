export interface LlmTrace {
  id: string; project_id: string; operation: string; feature: string | null;
  integration_name: string | null; requested_model: string | null; effective_model: string | null;
  status: string; started_at: string; duration_ms: number | null; http_status: number | null;
  request_id: string | null; trace_id: string | null; run_id: string | null; node_id: string | null; session_id: string | null;
  attempt: number; correction_of: string | null; error_code: string | null; provider_request_id: string | null;
  usage: { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number; input_tokens?: number; output_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number }; input_tokens_details?: { cached_tokens?: number }; cached_input_tokens?: number } | null;
  capture: { request_truncated?: boolean; response_truncated?: boolean; redacted?: boolean; body_available?: boolean; request_stage?: string; configuration_source?: 'published' | 'legacy_override' | 'inherited' | 'instance_default' | null; configuration_version?: number | null; configuration_hash?: string | null; test_case_id?: string; completion_attempt?: number; section_attempt?: number; generation_scope?: 'case_attempt' | 'section_attempt' | 'section_semantic_review' | 'case_metadata' | 'flow_plan'; generation_section_ids?: string[]; generation_section_count?: number; generation_section_ids_truncated?: boolean };
  content_access?: boolean; request_payload?: unknown; response_payload?: unknown; request_hash?: string;
}
export interface LlmTracePage {
  items: LlmTrace[]; next_cursor: string | null; retention_days: number;
  summary: { calls: number; failures: number; average_ms: number | null; p95_ms: number | null; total_tokens: string; usage_unknown: number };
}
