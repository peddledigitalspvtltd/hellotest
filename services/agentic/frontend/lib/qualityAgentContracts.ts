import type { NodeAiConfiguration } from '../workflows/NodeAiConfiguration';
export type QualityAgentKind = "web" | "security" | "performance" | "accessibility" | "visual";
export type QualityAgentStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
export type QualityJourneyStep = { id?: string; label?: string; action: "click" | "fill" | "assert_text" | "assert_url"; selector?: string; value?: string; text?: string; url?: string };
export type QualityAgentOptions = {
  mission?: {max_actions:number;allow_form_submission:boolean}; credential_ref?:string;
  timeout_ms?: number; max_pages?: number; viewport?: { width: number; height: number };
  wait_until?: "domcontentloaded" | "load"; masks?: string[];
  budgets?: { navigation_ms?: number; lcp_ms?: number; cls?: number; resource_count?: number; transfer_bytes?: number };
  max_diff_ratio?: number; pixel_threshold?: number;
};
export type QualityAgentContext = { execution_mode?: 'agent' | 'checks'; ai_configuration?:NodeAiConfiguration; instructions?:string; guardrails?:string; review_criteria?:string; llm_integration_id?: string | null; context_scopes?: string[]; evidence_scope?: Record<string,string>; smart_context?: { query?: string; source_ids?: string[]; source_kinds?: string[]; reviewed_context?: string }; };
export type QualityAgentPlan = QualityAgentContext & {
  kind: QualityAgentKind; target_url: string; goal: string; steps: QualityJourneyStep[];
  options: QualityAgentOptions; generation_mode: "llm" | "deterministic"; source: "model" | "preset";
  limitations: string[]; review_required: true;
  grounding?: Array<{source:"object_repository";id:string;name:string;screen:string;selector:string}>;
};
export type QualityAgentLaunch = QualityAgentContext & {
  project_id: string; app_type_id?: string; integration_id?: string; kind: QualityAgentKind; target_url: string;
  options?: QualityAgentOptions; goal?: string; baseline_id?: string;
  reviewed_plan?: { reviewed: true; goal: string; steps: QualityJourneyStep[] }; idempotency_key?: string;
};
export type QualityAgentStartInput = QualityAgentLaunch;
export type QualityAgentPlanInput = Omit<QualityAgentLaunch,"reviewed_plan"|"idempotency_key"|"baseline_id"> & { llm_integration_id?: string; steps?: QualityJourneyStep[] };
export type QualityAgentFinding = { id: string; title: string; severity: "critical" | "high" | "medium" | "low" | "info"; category: string; description: string; evidence: string; selector?: string; recommendation?: string };
export type QualityAgentArtifact = { id: string; name: string; type: "screenshot" | "visual_diff" | "report"; content_type: string; bytes: number; sha256: string; download_path: string };
export type QualityAgentStage = { id: string; label: string; status: "pending" | "running" | "completed" | "failed"; started_at?: string; completed_at?: string };
export type QualityAgentRun = QualityAgentContext & {
  agent_assessment?: { title: string; summary: string; conclusion: string; observations: Array<{finding_id:string;analysis:string;recommendation:string;artifact_ids:string[]}>; metric_notes:Array<{metric:string;interpretation:string}>; limitations:string[];next_steps:string[];skill_reference_ids:string[] };
  task_brief?: {agent_id:string;name:string;intent:string;goal:string;checks:string[];limitations:string[];target_url:string;skill_profile?:{id:string;version:string};execution_scope:{max_pages:number;max_duration_ms:number;max_actions?:number;allow_form_submission?:boolean}};
  mission_progress?: {phase:string;message:string;sequence?:number;revision?:number;updated_at:string};
  mission_outcome?: { title:string;summary:string;columns:string[];rows:Array<{cells:string[];evidence:{sequence:number;quote:string;url:string}}> };
  id: string; transaction_id: string; project_id: string; app_type_id: string | null; kind: QualityAgentKind;
  target_url: string; goal: string; options: QualityAgentOptions; reviewed_plan?: QualityAgentLaunch["reviewed_plan"];
  status: QualityAgentStatus; outcome: null | "passed" | "findings" | "needs_review" | "error"; plan?: QualityAgentLaunch["reviewed_plan"];
  created_at: string; updated_at: string; started_at?: string | null; completed_at?: string | null;
  stages: QualityAgentStage[]; findings: QualityAgentFinding[]; metrics: Record<string, number | string | boolean | null>;
  mission_report?: {status:"running"|"completed"|"blocked"|"limit_reached"|"cancelled";summary:string;actions:Array<{sequence:number;action:string;summary:string;url:string;status:string}>};
  artifacts: QualityAgentArtifact[]; limitations: string[]; error?: { code: string; message: string } | null;
  cancellation_requested?: boolean; baseline_id?: string | null;
};
export type QualityAgentBaseline = { id: string; source_run_id: string; artifact_id: string; project_id: string; app_type_id: string | null; target_url: string; label: string; viewport: { width: number; height: number }; masks: string[]; sha256: string; created_at: string; reviewed_by: string; download_path: string };
export type QualityAgentPreset = { id: QualityAgentKind; kind: QualityAgentKind; available: boolean; name: string; description: string; checks: string[]; limitations: string[]; goal_support: "reviewed_journey" | "bounded_checks";
  default_goal?: string;
  skill_profile?: {id:string;version:string;reviewed_at:string;default_goal:string;references:Array<{id:string;name:string;url:string;guide_url?:string;use:string;methodology_only:true}>};
};
export type QualityAgentCatalog = { agents: QualityAgentPreset[]; limits: { max_pages: number; max_duration_ms: number; max_steps: number; max_artifact_bytes: number }; runtime: { missions?:{supported:boolean}; configured: boolean; available: boolean; reason?: string; integration_name?: string | null; detail: string; checks?: Record<string,string>; limitations?: string[] } };
