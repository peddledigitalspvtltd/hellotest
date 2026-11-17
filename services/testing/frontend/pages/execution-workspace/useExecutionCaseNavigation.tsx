import { type ExecutionCaseInstanceView } from "../../components/ExecutionRunListCard";
import { ExecutionCaseView } from "./executionWorkspaceModel";
import { type Dispatch, type SetStateAction, type MutableRefObject } from "react";

export interface ExecutionCaseNavigationSelection {
  selectedExecutionId: string;
  dismissedExecutionRouteRef: MutableRefObject<string>;
  dismissedCaseRouteRef: MutableRefObject<string>;
  setFocusedSuiteId: Dispatch<SetStateAction<string>>;
  setSelectedExecutionId: Dispatch<SetStateAction<string>>;
  setSelectedTestCaseId: Dispatch<SetStateAction<string>>;
  setSelectedCaseInstanceKey: Dispatch<SetStateAction<string>>;
  selectedExecutionCaseInstance: ExecutionCaseInstanceView;
}

export interface ExecutionCaseNavigationScope {
  executionCaseOrder: ExecutionCaseView[];
  filteredExecutionCaseOrder: ExecutionCaseView[];
}

export interface ExecutionCaseNavigationNavigation {
  syncExecutionSearchParams: (executionId: string, testCaseId?: string | null | undefined, caseInstanceKey?: string | null | undefined) => void;
  pendingStepNoteSavesRef: MutableRefObject<Set<Promise<boolean>>>;
}

export interface ExecutionCaseNavigationOptions {
  selection: ExecutionCaseNavigationSelection;
  scope: ExecutionCaseNavigationScope;
  navigation: ExecutionCaseNavigationNavigation;
}

export function useExecutionCaseNavigation({ selection, scope, navigation }: ExecutionCaseNavigationOptions) {
  const { selectedExecutionId, dismissedExecutionRouteRef, dismissedCaseRouteRef, setFocusedSuiteId, setSelectedExecutionId, setSelectedTestCaseId, setSelectedCaseInstanceKey, selectedExecutionCaseInstance } = selection;
  const { executionCaseOrder, filteredExecutionCaseOrder } = scope;
  const { syncExecutionSearchParams, pendingStepNoteSavesRef } = navigation;
const focusExecutionCase = (
    testCaseId: string,
    executionId = selectedExecutionId,
    caseInstanceKey?: string | null
  ) => {
    dismissedExecutionRouteRef.current = "";
    dismissedCaseRouteRef.current = "";
    const scopedCase = executionCaseOrder.find((testCase) => testCase.id === testCaseId);
    const nextInstanceKey = caseInstanceKey
      || scopedCase?.data_set_instances[0]?.instance_key
      || "";

    if (scopedCase?.suite_id) {
      setFocusedSuiteId(scopedCase.suite_id);
    }

    if (executionId && executionId !== selectedExecutionId) {
      setSelectedExecutionId(executionId);
    }

    setSelectedTestCaseId(testCaseId);
    setSelectedCaseInstanceKey(nextInstanceKey);

    if (executionId) {
      syncExecutionSearchParams(executionId, testCaseId, nextInstanceKey);
    }
  };

const executionCaseInstanceOrder = filteredExecutionCaseOrder.flatMap((testCase) =>
    testCase.data_set_instances.map((instance) => ({ testCase, instance }))
  );

const selectedExecutionCaseInstanceIndex = selectedExecutionCaseInstance
    ? executionCaseInstanceOrder.findIndex(({ instance }) => instance.instance_key === selectedExecutionCaseInstance.instance_key)
    : -1;

const previousExecutionCaseInstance = selectedExecutionCaseInstanceIndex > 0
    ? executionCaseInstanceOrder[selectedExecutionCaseInstanceIndex - 1]
    : null;

const nextExecutionCaseInstance = selectedExecutionCaseInstanceIndex >= 0 && selectedExecutionCaseInstanceIndex < executionCaseInstanceOrder.length - 1
    ? executionCaseInstanceOrder[selectedExecutionCaseInstanceIndex + 1]
    : null;

const focusNeighborExecutionCase = async (entry: typeof executionCaseInstanceOrder[number] | null) => {
    if (!entry) return;
    const saved = await Promise.all([...pendingStepNoteSavesRef.current]);
    if (saved.some(ok => !ok)) return;
    if (entry.testCase.suite_id) setFocusedSuiteId(entry.testCase.suite_id);
    focusExecutionCase(entry.testCase.id, selectedExecutionId, entry.instance.instance_key);
  };
  return { focusExecutionCase, executionCaseInstanceOrder, selectedExecutionCaseInstanceIndex, previousExecutionCaseInstance, nextExecutionCaseInstance, focusNeighborExecutionCase };
}
