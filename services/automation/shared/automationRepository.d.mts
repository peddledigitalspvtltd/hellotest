export type PortableRepositoryRow = {
  id?: string;
  page_key?: string | null;
  locator_intent?: string | null;
  locator?: string | null;
  metadata?: Record<string, unknown> | null;
  locator_kind?: string | null;
  page_url?: string | null;
};

export type AutomationRepositoryField = {
  id: string;
  reference: string;
  aliases: string[];
  locator: string;
  screenName: string;
  objectName: string;
  htmlTag: string;
  pageUrl: string;
};

export function buildAutomationRepositoryFields(rows: PortableRepositoryRow[]): AutomationRepositoryField[];
export function preparePlaywrightRepository(rows?: PortableRepositoryRow[]): {
  objects: Record<string, string>;
  repositoryIssues: Record<string, string>;
};
