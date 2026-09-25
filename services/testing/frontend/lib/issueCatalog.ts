import type { Issue } from "@hellotest/platform/frontend/src/types";

export type IssueCatalogFilters = {
  project_id?: string;
  user_id?: string;
  status?: string;
  priority?: string;
  assignee_id?: string;
  q?: string;
};

export type IssueCatalogPage = {
  items: Issue[];
  next_cursor: string | null;
  is_last: boolean;
};

export type IssueCatalogMetrics = {
  total: number;
  open: number;
  priority_risks: number;
  unassigned: number;
  converted: number;
  statuses: Record<string, number>;
};
