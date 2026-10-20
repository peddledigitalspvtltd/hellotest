import type { AutomationExportSource } from "../../shared/automationExportSource.mjs";
import { prepareAutomationExportSource as prepare } from "../../shared/automationExportSource.mjs";
export type { AutomationExportSource };

/** Shared with server-issued portable artifacts. */
export function prepareAutomationExportSource(input: string, sectionIndex: number, options: { typescript?: boolean } = {}): AutomationExportSource {
  return prepare(input, sectionIndex, options);
}
