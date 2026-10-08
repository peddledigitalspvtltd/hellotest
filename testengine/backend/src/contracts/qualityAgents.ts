export const QUALITY_AGENT_KINDS = ["web", "security", "performance", "accessibility", "visual"] as const;
export type QualityAgentKind = typeof QUALITY_AGENT_KINDS[number];
export type QualityScope = { project_id: string; app_type_id?: string | null };
export type QualityStep = { action: "click" | "fill" | "assert_text" | "assert_url"; selector?: string; value?: string; text?: string; url?: string };
export type QualityObservation = { sequence:number; url:string; title:string; text:string; elements:Array<{id:string;tag:string;label:string;type:string;sensitive:boolean;href?:string}>; previous_error?:string };
export type QualityDecision = { action:"click"|"fill"|"select"|"press"|"navigate"|"extract"|"complete"|"blocked"|"scroll"|"hover"|"wait"|"back"|"assert_text"; summary:string; element_id?:string; value?:string; key?:string; url?:string; direction?:"up"|"down"; text?:string };
export type QualityOptions = {
  mission?: { goal:string; max_actions:number; allow_form_submission:boolean }; credential_ref?:string;
  viewport?: { width: number; height: number }; wait_until?: "domcontentloaded" | "load";
  budgets?: { navigation_ms?: number; lcp_ms?: number; cls?: number; resource_count?: number; transfer_bytes?: number };
  masks?: string[]; baseline_id?: string; max_diff_ratio?: number; pixel_threshold?: number;
  approved_steps?: QualityStep[];
};
export type QualityRunInput = { client_run_id: string; kind: QualityAgentKind; target_url: string; scope: QualityScope; options?: QualityOptions; limits?: { max_pages?: number; max_duration_ms?: number } };
export type QualityFinding = { id: string; severity: "info" | "low" | "medium" | "high"; category: string; title: string; description: string; evidence: string; selector?: string; recommendation?: string };
export type QualityStage = { id: string; label: string; status: "pending" | "running" | "completed" | "failed"; started_at?: string; completed_at?: string };
export type QualityArtifact = { id: string; name: string; type: "screenshot" | "visual_diff" | "report"; content_type: string; bytes: number; sha256: string };
export type QualityRun = {
  contract_version: "1.0"; id: string; client_run_id: string; kind: QualityAgentKind; target_url: string; scope: QualityScope;
  state: "queued" | "running" | "completed" | "failed" | "cancelled"; outcome: null | "passed" | "findings" | "needs_review" | "error";
  created_at: string; started_at?: string; finished_at?: string; updated_at: string;
  stages: QualityStage[]; findings: QualityFinding[]; metrics: Record<string, number | string | boolean | null>; limitations: string[]; artifacts: QualityArtifact[];
  decision_request?: QualityObservation;
  mission_report?: { status:"running"|"completed"|"blocked"|"limit_reached"|"cancelled"; summary:string; actions:Array<{sequence:number;action:string;summary:string;url:string;status:string}> };
  error?: { code: string; message: string };
};
export type QualityBaseline = { id: string; scope: QualityScope; target_url: string; viewport: { width: number; height: number }; masks: string[]; sha256: string; source_run_id: string; artifact_id: string; reviewed_by: string; created_at: string };
