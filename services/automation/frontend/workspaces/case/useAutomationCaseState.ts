import { useAutomationCaseSelection } from './useAutomationCaseSelection';
import type { AutomationCaseScope } from './useAutomationCaseScope';
import { useAutomationPlanState } from './useAutomationPlanState';
import { useAutomationDataState } from './useAutomationDataState';
import { useAutomationBuildState } from './useAutomationBuildState';
import { useAutomationRecorderState } from './useAutomationRecorderState';
import { useAutomationRunsState } from './useAutomationRunsState';
import { useAutomationNoticeState } from './useAutomationNoticeState';
export function useAutomationCaseState(scope: AutomationCaseScope) {
    const selection = useAutomationCaseSelection(scope);
    const plan = useAutomationPlanState(scope, selection);
    const dataState = useAutomationDataState(scope, selection);
    const buildState = useAutomationBuildState(scope, selection);
    const recorderState = useAutomationRecorderState(scope, selection);
    const runsState = useAutomationRunsState(scope, selection);
    const noticeState = useAutomationNoticeState(scope, selection);
    return { ...selection, ...plan, ...dataState, ...buildState, ...recorderState, ...runsState, ...noticeState };
}
export type AutomationCaseState = ReturnType<typeof useAutomationCaseState>;
