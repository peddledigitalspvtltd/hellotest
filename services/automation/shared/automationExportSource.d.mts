export type AutomationExportSource = { code: string; imports: string[]; dependencies: string[]; issue?: string };
export function prepareAutomationExportSource(input: string, sectionIndex: number, options?: { typescript?: boolean }): AutomationExportSource;
