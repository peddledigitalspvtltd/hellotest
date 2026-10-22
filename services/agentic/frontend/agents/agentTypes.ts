export type RepositoryAgentType = "object_repository" | "api_tests" | "repository_knowledge" | "component_tests";

export type RepositoryAgentDefinition = {
  id: RepositoryAgentType;
  name: string;
  description: string;
  outcome: string;
};

export type RepositoryAgentCatalog = {
  agents: RepositoryAgentDefinition[];
  limits: { max_archive_bytes: number; max_files: number };
  runtime: { available: boolean; detail: string };
};

export type RepositoryAgentEvidence = { path: string; line?: number; excerpt?: string };
export type RepositoryAgentFinding = {
  id: string;
  title?: string;
  name?: string;
  description?: string;
  confidence?: number;
  evidence?: RepositoryAgentEvidence[];
  review_required?: boolean;
  [key: string]: unknown;
};

export type RepositoryAgentStage = {
  id: string;
  label: string;
  status: string;
  detail?: string;
  duration_ms?: number;
};

export type RepositoryAgentPublishedItem = {
  finding_id: string;
  target_type: string;
  target_id: string;
  url?: string;
};

export type RepositoryAgentRun = {
  id: string;
  project_id: string;
  app_type_id?: string | null;
  agent_type: RepositoryAgentType;
  status: "queued" | "running" | "completed" | "partial" | "failed" | "cancelled";
  source: { type: string; name: string; repository_url?: string; ref?: string; commit_sha?: string; file_count?: number };
  progress: number;
  cached_from?: string | null;
  stages: RepositoryAgentStage[];
  summary: Record<string, unknown>;
  warnings: Array<{ code: string; message: string }>;
  error: string | null;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  published?: { items: RepositoryAgentPublishedItem[]; [key: string]: unknown };
  result?: {
    llm_reviews?: Array<{ session_id: string; batch: number; finding_ids: string[]; response: string; model_execution?: { effective_model: string; model_calls: number } }>;
    llm_review?: { session_id: string; response: string; model_execution?: { effective_model: string; model_calls: number } };
    schema_version: number;
    agent_type: RepositoryAgentType;
    summary: Record<string, unknown>;
    warnings: Array<{ code: string; message: string }>;
    findings: {
      objects: RepositoryAgentFinding[];
      test_cases: RepositoryAgentFinding[];
      knowledge: RepositoryAgentFinding[];
      components: RepositoryAgentFinding[];
    };
    stages: RepositoryAgentStage[];
    artifacts: Array<{ name: string; mime_type: string; size_bytes?: number }>;
  };
};

export type RepositoryAgentRunPage = { items: RepositoryAgentRun[]; total: number; has_more: boolean };
export type RepositoryAgentRunInput = import("../lib/qualityAgentContracts").QualityAgentContext & {
  goal?: string;
  project_id: string;
  app_type_id?: string;
  agent_type: RepositoryAgentType;
  source: { type: "github"; repository_url: string; ref?: string; integration_id?: string };
};
export type RepositoryAgentPublishResult = {
  items: RepositoryAgentPublishedItem[];
  skipped: number;
  skipped_items?: Array<{ finding_id: string; reason: string }>;
  indexing?: string;
  knowledge_graph?: string;
  context_graph?: string;
  message?: string;
};

export type RepositoryAgentPublicationStatus = {
  items: Array<{ finding_id:string; target_id:string; source_id?:string; document_id?:string; indexing:'queued'|'processing'|'ready'|'failed'|'archived'|'pending'; knowledge_graph:'pending'|'ready'; context_graph:'pending'|'ready'; error?:string }>;
  ready:number;
  pending:number;
  failed:number;
};
