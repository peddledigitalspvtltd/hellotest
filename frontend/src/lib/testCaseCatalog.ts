import type { ExecutionResult, TestCase } from '../types';
import type { deriveModuleHealth } from './hierarchyHealth';

export type TestCaseCatalogFilters = {
  include_total?: boolean;
  search?: string;
  workflow_status?: string;
  priority?: number;
  step_filter?: string;
  run_filter?: string;
  exclude_automated?: boolean;
  include_execution?: boolean;
};
export type TestCaseCatalogRow = TestCase & { recent_results?: ExecutionResult[]; run_count?: number };
export type TestCasePickerFilters = TestCaseCatalogFilters & {
  project_id?: string;
  app_type_id?: string;
  suite_id?: string;
  suite_ids?: string;
  requirement_id?: string;
  module_id?: string;
  unassigned_module?: boolean;
  status?: string;
  ids?: string;
  label?: string;
  shared_step_group_id?: string;
  automated?: "yes" | "no";
  page_size?: number;
  cursor?: string;
};
export type TestCaseCatalogMetrics = {
  coverage: { total: number; covered: number; automated: number; automationKnown: number; withHistory: number; withSuites: number };
  catalog: { total: number; automationPercent: number; blocked: number; failed: number; critical: number; averageExecutionMs: number | null; executionDurationSampleCount: number; finalizedResults: number; passedResults: number; recentPassRate: number | null };
  modules: Record<string, ReturnType<typeof deriveModuleHealth>>;
  unassigned: ReturnType<typeof deriveModuleHealth>;
};
