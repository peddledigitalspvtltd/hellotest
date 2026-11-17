import { useQuery } from "@tanstack/react-query";
import { testingApi } from "../api.client";
import type { TestCase } from "@hellotest/platform/frontend/src/types";
import { mergeModuleCaseOrder } from "../lib/caseLibrarySignals";

/** Resolve all module pages before changing selection; partial loads never become a snapshot. */
export function SuiteModulePicker({ projectId, appTypeId, selectedModuleIds, selectedCaseIds, resolvedCaseCount, membership, disabled, onMembershipChange, onChange, onValidityChange }: {
  projectId: string; appTypeId: string; selectedModuleIds: string[]; selectedCaseIds: string[];
  resolvedCaseCount: number; membership: "snapshot" | "live"; disabled: boolean;
  onMembershipChange: (value: "snapshot" | "live") => void;
  onChange: (moduleIds: string[], caseIds: string[], cases: TestCase[]) => void;
  onValidityChange: (valid: boolean) => void;
}) {
  const modules = useQuery({ queryKey: ["suite-module-options", projectId, appTypeId], queryFn: () => testingApi.testCaseModules.list({ project_id: projectId, app_type_id: appTypeId, projection: "summary" }), enabled: Boolean(projectId && appTypeId) });
  const resolve = async (ids: string[]) => {
    onValidityChange(false);
    try {
      const cases: TestCase[] = [];
      for (const id of ids) {
        let cursor: string | undefined; const seen = new Set<string>();
        do {
          const page = await testingApi.testCaseModules.listCases(id, { projection: "summary", page_size: 100, cursor });
          cases.push(...page.items);
          if (page.is_last) break;
          if (!page.next_cursor || seen.has(page.next_cursor)) throw new Error("Module membership could not be completely resolved. Retry this selection.");
          cursor = page.next_cursor; seen.add(cursor);
        } while (cursor);
      }
      onChange(ids, mergeModuleCaseOrder(selectedCaseIds, [cases.map(item => item.id)]), cases);
      onValidityChange(true);
    } catch (error) {
      // Keep the previous selection intact; expose an actionable status in the picker.
      setError(error instanceof Error ? error.message : "Module membership could not be resolved.");
    } finally { setResolving(false); }
  };
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState("");
  return <fieldset disabled={disabled || resolving} className="suite-module-picker">
    <legend>Include modules</legend>
    <p>Resolved cases are deduplicated and appended after the current case order.</p>
    <label>Membership <select aria-label="Module membership" value={membership} onChange={event => onMembershipChange(event.target.value as "snapshot" | "live")}><option value="snapshot">Snapshot at save (default)</option><option value="live">Live membership for future runs</option></select></label>
    <p>{membership === "snapshot" ? "Future module edits do not change this suite's saved case list." : "Future runs resolve current module members. Existing runs keep their frozen scope."}</p>
    {modules.data?.map(module => <label key={module.id}><input type="checkbox" checked={selectedModuleIds.includes(module.id)} onChange={event => { setResolving(true); setError(""); void resolve(event.target.checked ? [...selectedModuleIds, module.id] : selectedModuleIds.filter(id => id !== module.id)); }} />{module.name} · {module.test_case_count ?? module.test_case_ids?.length ?? "Unknown"} cases</label>)}
    {modules.isPending ? <p role="status">Loading modules…</p> : null}
    {modules.isError ? <p role="alert">Modules could not be loaded. <button type="button" onClick={() => void modules.refetch()}>Retry</button></p> : null}
    {resolving ? <p role="status">Resolving complete module membership…</p> : null}
    {error ? <p role="alert">{error} <button type="button" onClick={() => { setResolving(true); void resolve(selectedModuleIds); }}>Retry</button></p> : null}
    <output aria-live="polite">{resolvedCaseCount} resolved unique cases</output>
  </fieldset>;
}
import { useState } from "react";
