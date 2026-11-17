import { useReducer } from 'react';
import type { AutomationBuildChange } from '../../components/AutomationBuildEvidence';
export type BuildReviewTracking = {
    transactionId: string;
    projectId: string;
    caseIds: string[];
    scheduledAt: string | null;
    startedAt: number;
};
type ReviewStatus = 'idle' | 'queued' | 'running' | 'completed' | 'failed' | 'paused' | 'cancelled';
type Review = {
    tracking: BuildReviewTracking | null;
    status: ReviewStatus;
    receipt: string;
    changes: AutomationBuildChange[];
    retryIds: string[];
    outputIds: string[];
    refreshError: string;
};
type Action = {
    type: 'reset';
} | {
    type: 'queued';
    tracking: BuildReviewTracking;
} | {
    type: 'activity';
    tracking: BuildReviewTracking;
    status: ReviewStatus;
    receipt: string;
    retryIds: string[];
    outputIds: string[];
} | {
    type: 'source';
    changes?: AutomationBuildChange[];
    error?: string;
} | {
    type: 'cancelled';
    transactionId: string;
} | {
    type: 'notice';
    message: string;
};
const initial: Review = { tracking: null, status: 'idle', receipt: '', changes: [], retryIds: [], outputIds: [], refreshError: '' };
function reducer(state: Review, action: Action): Review {
    if (action.type === 'reset')
        return initial;
    if (action.type === 'queued')
        return { ...initial, tracking: action.tracking, status: 'queued', receipt: `${action.tracking.scheduledAt ? 'Build scheduled' : 'Build queued'} · ${action.tracking.transactionId}` };
    if (action.type === 'notice')
        return { ...state, receipt: action.message };
    if (action.type === 'source')
        return { ...state, ...(action.changes ? { changes: action.changes } : {}), refreshError: action.error || '' };
    if (action.type === 'cancelled')
        return state.tracking?.transactionId === action.transactionId ? { ...state, status: 'cancelled', receipt: `Build cancelled · ${action.transactionId.slice(0, 8)}`, retryIds: [] } : state;
    return { ...state, tracking: action.tracking, status: action.status, receipt: action.receipt, retryIds: action.retryIds, outputIds: action.outputIds };
}
export function useAutomationBuildReview() { const [state, dispatch] = useReducer(reducer, initial); return { agentBuildTracking: state.tracking, agentBuildStatus: state.status, agentBuildReceipt: state.receipt, agentBuildChanges: state.changes, agentBuildRetryIds: state.retryIds, agentBuildOutputIds: state.outputIds, agentPlanRefreshError: state.refreshError, resetBuildReview: () => dispatch({ type: 'reset' }), reviewBuildAccepted: (tracking: BuildReviewTracking) => dispatch({ type: 'queued', tracking }), reviewBuildActivity: (activity: Omit<Extract<Action, {
        type: 'activity';
    }>, 'type'>) => dispatch({ type: 'activity', ...activity }), reviewBuildSource: (source: {
        changes?: AutomationBuildChange[];
        error?: string;
    }) => dispatch({ type: 'source', ...source }), reviewBuildCancelled: (transactionId: string) => dispatch({ type: 'cancelled', transactionId }), reviewBuildNotice: (message: string) => dispatch({ type: 'notice', message }) }; }
