export type JiraCreateFieldMetadata = {
  id: string;
  key?: string;
  name: string;
  required: boolean;
  has_default_value: boolean;
  schema?: {
    type?: string;
    items?: string;
    custom?: string;
    customId?: number;
  };
  operations?: string[];
  allowed_values?: Array<{
    id?: string;
    key?: string;
    name?: string;
    value?: string;
    accountId?: string;
    displayName?: string;
    label?: string;
  }>;
};

export type JiraIssueCreateMetadata = {
  mode?: "create" | "edit";
  project_id: string;
  project_key: string;
  issue_type_id: string;
  issue_type_name: string;
  hellotest_core_field_ids: string[];
  required_fields: JiraCreateFieldMetadata[];
  core_fields: JiraCreateFieldMetadata[];
  fields: JiraCreateFieldMetadata[];
  current_values?: Record<string, unknown>;
  current_status?: JiraWorkflowStatus | null;
  workflow_statuses?: JiraWorkflowStatusCatalog;
  strategy?: {
    requirements_source: string;
    bugs_source: string;
    synced_fields: string[];
    note: string;
  };
};

export type JiraWorkflowStatus = {
  id?: string | null;
  value: string;
  label: string;
  description?: string;
  category_key?: string | null;
  category_name?: string | null;
  category_color?: string | null;
  current?: boolean;
  can_transition?: boolean;
  transition_id?: string | null;
};

export type JiraWorkflowStatusCatalog = {
  source: "jira-project-workflow" | "jira-issue-transitions" | "jira-current-status" | "compatibility-fallback" | string;
  issue_type_id?: string | null;
  issue_type_name?: string | null;
  default_status?: string | null;
  current_status?: JiraWorkflowStatus | null;
  transition_lookup_unavailable?: boolean;
  statuses: JiraWorkflowStatus[];
};

export type JiraBugCreateMetadata = JiraIssueCreateMetadata;

