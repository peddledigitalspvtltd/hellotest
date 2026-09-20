import type { RequirementIterationHealth } from '../types';

export interface RequirementCatalogFilters {
  include_total?: boolean;
  include_execution?: boolean;
  search?: string;
  status?: string;
  priority?: number;
  sprint_id?: string;
  sprint?: string;
  unassigned?: boolean;
  label?: string;
  fix_version?: string;
  release?: string;
  coverage?: string;
}

export interface RequirementCatalogMetrics {
  total: number;
  mapped: number;
  highPriority: number;
  criticalPriority?: number;
  highOnlyPriority?: number;
  open: number;
  completed: number;
  qaTotal: number;
  devCompleted: number;
  devTotal: number;
  devCompletionPercent: number;
  totalDefects: number;
  completionPercent: number;
  coveragePercent: number;
  defectDensity: number;
  groomed: number;
  notGroomed: number;
  described: number;
  specified: number;
  teamAssigned: number;
  slipped: number;
  onCourse: number;
  sprintCommitted: number;
  releaseScoped: number;
  backlog: number;
  growth?: { scope:'project'; period_start:string; tracking_started_at:string; partial:boolean; added:number; completed:number; removed:number; active:number; departures:number; net:number; opening:number; ratio:number|null; percent:number|null } | null;
}

export interface RequirementCatalogMetricsResponse {
  all: RequirementCatalogMetrics;
  backlog: RequirementCatalogMetrics;
  sprints: RequirementCatalogMetrics;
  sprint_health: RequirementIterationHealth[];
  filter_options: { statuses: string[]; labels: string[]; sprints: string[]; fix_versions: string[]; releases: string[] };
  generated_at: string;
}

export interface RequirementRecordMetrics {
  linked_cases: number;
  automated_cases: number;
  executed_cases: number | null;
  passed_cases: number | null;
  total_bugs: number;
  open_bugs: number;
  closed_bugs: number;
  described: boolean;
  specified: boolean;
  groomed: boolean;
  slipped: boolean;
  completed: boolean;
  execution_complete: boolean;
  automation_complete?: boolean;
  assigned?: boolean;
  release_scoped?: boolean;
  open_priority_bugs?: number;
  readiness?: import('./storyReadiness').StoryReadiness;
}
