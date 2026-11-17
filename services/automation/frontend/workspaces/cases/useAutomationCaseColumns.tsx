import type { AutomationCasesActionPorts as ActionPorts } from './automationCasesTypes';

import { useMemo } from "react";

import { type DataTableColumn } from "@hellotest/platform/frontend/src/shared/components/DataTable";
import { DisplayIdBadge } from "@hellotest/platform/frontend/src/shared/components/DisplayIdBadge";
import { richTextToPlainText } from "@hellotest/platform/frontend/src/platform/components/RichTextEditor";
import { StatusBadge } from "@hellotest/platform/frontend/src/shared/components/StatusBadge";
import type { TestCase } from "@hellotest/platform/frontend/src/types";

export function useAutomationCaseColumns(ports:ActionPorts){
const {
    areAllFilteredAutomationCasesSelected,
    setSelectedAutomationCaseIds,
    filteredAutomationCases,
    selectedAutomationCaseIds,
    automationDisplayIdByCaseId,
    historyByCaseId,
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
          <input aria-label="Select all filtered automation cases" checked={areAllFilteredAutomationCasesSelected} onChange={(event) => setSelectedAutomationCaseIds((current) => event.target.checked
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
          <span>{richTextToPlainText(testCase.description) || "Automation is mapped to the original manual case definition."}</span>
        </div>)
    },
    {
        key: "state",
        label: "State",
        width: 160,
        minWidth: 128,
        sortValue: (testCase) => testCase.automation_status || "ready",
        render: (testCase) => (<div className="automation-list-status-cell">
          <StatusBadge value="automated"/>
          <StatusBadge value={testCase.automation_status || "ready"}/>
        </div>)
    },
    {
        key: "runs",
        label: "Runs",
        width: 92,
        minWidth: 78,
        sortValue: (testCase) => (historyByCaseId[testCase.id] || []).length,
        render: (testCase) => (historyByCaseId[testCase.id] || []).length
    },
    {
        key: "passRate",
        label: "Pass rate",
        width: 124,
        minWidth: 100,
        sortValue: (testCase) => {
            const history = historyByCaseId[testCase.id] || [];
            const passedRuns = history.filter((result) => result.status === "passed").length;
            return history.length ? Math.round((passedRuns / history.length) * 100) : 0;
        },
        render: (testCase) => {
            const history = historyByCaseId[testCase.id] || [];
            const passedRuns = history.filter((result) => result.status === "passed").length;
            return history.length ? `${Math.round((passedRuns / history.length) * 100)}%` : "No runs";
        }
    },
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
    historyByCaseId,
    selectedAutomationCaseIds
]);
return {automationCaseListColumns};
}

