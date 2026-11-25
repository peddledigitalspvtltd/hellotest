import type { AutomationCasesActionPorts as ActionPorts } from './automationCasesTypes';

import { useMemo } from "react";

import { type DataTableColumn } from "@hellotest/platform/frontend/src/shared/components/DataTable";
import { DisplayIdBadge } from "@hellotest/platform/frontend/src/shared/components/DisplayIdBadge";
import { richTextToPlainText } from "@hellotest/platform/frontend/src/platform/components/RichTextEditor";
import { StatusBadge } from "@hellotest/platform/frontend/src/shared/components/StatusBadge";
import type { TestCase } from "@hellotest/platform/frontend/src/types";
import { automationCatalogEvidence } from "../../lib/automationCatalogEvidence";

export function useAutomationCaseColumns(ports:ActionPorts){
const {
    areAllFilteredAutomationCasesSelected,
    setSelectedAutomationCaseIds,
    filteredAutomationCases,
    selectedAutomationCaseIds,
    automationDisplayIdByCaseId,
    canViewExecutionMetrics,
} = ports;
const automationCaseListColumns = useMemo<Array<DataTableColumn<TestCase>>>(() => [
    {
        key: "select",
        label: "",
        canToggle: false,
        canReorder: false,
        canResize: false,
        width: 56,
        headerRender: () => (<label className="data-table-header-checkbox" onClick={(event) => event.stopPropagation()}>
          <input aria-label="Select loaded automation cases" checked={areAllFilteredAutomationCasesSelected} onChange={(event) => setSelectedAutomationCaseIds((current) => event.target.checked
                ? [...new Set([...current, ...filteredAutomationCases.map((testCase) => testCase.id)])]
                : current.filter((testCaseId) => !filteredAutomationCases.some((testCase) => testCase.id === testCaseId)))} type="checkbox"/>
        </label>),
        render: (testCase) => (<div onClick={(event) => event.stopPropagation()}>
          <input aria-label={`Select ${testCase.title}`} checked={selectedAutomationCaseIds.includes(testCase.id)} onChange={(event) => setSelectedAutomationCaseIds((current) => event.target.checked
                ? [...new Set([...current, testCase.id])]
                : current.filter((testCaseId) => testCaseId !== testCase.id))} type="checkbox"/>
        </div>)
    },
    {
        key: "id",
        label: "ID",
        width: 120,
        minWidth: 96,
        sortValue: (testCase) => automationDisplayIdByCaseId[testCase.id] || testCase.display_id || testCase.id,
        render: (testCase) => <DisplayIdBadge value={automationDisplayIdByCaseId[testCase.id] || testCase.display_id || testCase.id}/>
    },
    {
        key: "title",
        label: "Automation case",
        canToggle: false,
        width: 300,
        minWidth: 180,
        sortValue: (testCase) => testCase.title,
        render: (testCase) => (<div className="automation-list-primary-cell">
          <strong>{testCase.title}</strong>
          {testCase.description && <span>{richTextToPlainText(testCase.description)}</span>}
        </div>)
    },
    {
        key: "state",
        label: "Plan",
        width: 160,
        minWidth: 128,
        sortValue: (testCase) => testCase.automation_status === "ready" ? "Ready" : "Incomplete",
        render: (testCase) => (<div className="automation-list-status-cell">
          <StatusBadge value={testCase.automation_status === "ready" ? "Plan ready" : "Incomplete plan"}/>
        </div>)
    },
    ...(canViewExecutionMetrics ? [{
        key: "latestOutcome",
        label: "Latest outcome",
        width: 142,
        minWidth: 118,
        sortValue: (testCase) => automationCatalogEvidence(testCase).outcomeLabel || "",
        render: (testCase) => automationCatalogEvidence(testCase).outcomeLabel || "—"
    }, {
        key: "runs",
        label: "Runs",
        width: 92,
        minWidth: 78,
        sortValue: (testCase) => automationCatalogEvidence(testCase).runCount,
        render: (testCase) => automationCatalogEvidence(testCase).runCount
    },
    {
        key: "passRate",
        label: "Recent pass rate",
        width: 124,
        minWidth: 100,
        sortValue: (testCase) => automationCatalogEvidence(testCase).passRate ?? -1,
        render: (testCase) => {
            const {passRate} = automationCatalogEvidence(testCase);
            return passRate === null ? "—" : `${passRate}%`;
        }
    }] satisfies Array<DataTableColumn<TestCase>> : []),
    {
        key: "priority",
        label: "Priority",
        width: 104,
        minWidth: 88,
        sortValue: (testCase) => testCase.priority || 3,
        render: (testCase) => `P${testCase.priority || 3}`
    },
    {
        key: "description",
        label: "Description",
        defaultVisible: false,
        width: 320,
        minWidth: 180,
        render: (testCase) => richTextToPlainText(testCase.description) || "No automation description yet."
    }
], [
    areAllFilteredAutomationCasesSelected,
    automationDisplayIdByCaseId,
    filteredAutomationCases,
    canViewExecutionMetrics,
    selectedAutomationCaseIds
]);
return {automationCaseListColumns};
}

