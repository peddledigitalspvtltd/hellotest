import { type AutomationRunReviewRequest } from "../../components/AutomationRunReviewDialog";
import { type PendingAutomationRun } from "../../lib/automationRunDispatch";
import { useState } from "react";
import type { AutomationCaseScope } from './useAutomationCaseScope';
import type { AutomationCaseSelection } from './useAutomationCaseSelection';
export function useAutomationRunsState(scope: AutomationCaseScope, selection: AutomationCaseSelection) {
    const {} = scope;
    const {} = selection;
    const [runReviewRequest, setRunReviewRequest] = useState<AutomationRunReviewRequest | null>(null);
    const [pendingRemoteRun, setPendingRemoteRun] = useState<PendingAutomationRun | null>(null);
    const [runReviewError, setRunReviewError] = useState("");
    return { runReviewRequest, setRunReviewRequest, pendingRemoteRun, setPendingRemoteRun, runReviewError, setRunReviewError };
}
export type AutomationRunsState = ReturnType<typeof useAutomationRunsState>;
