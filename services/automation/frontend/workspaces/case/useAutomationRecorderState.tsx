import { useRef, useCallback, useState } from 'react';
import { useAutomationAuthoring } from '../../hooks/AutomationAuthoringProvider';
import { useRecorderStatus } from '@hellotest/platform/frontend/src/shared/hooks/useRecorderStatus';
import type { RecorderSessionResponse } from '@hellotest/platform/frontend/src/types';
import type { AutomationCaseScope } from './useAutomationCaseScope';
import type { AutomationCaseSelection } from './useAutomationCaseSelection';
export function useAutomationRecorderState(_scope: AutomationCaseScope, selection: AutomationCaseSelection) {
    const authoring = useAutomationAuthoring();
    const active = authoring.activeRecording();
    const recording = active?.caseId === selection.selectedCaseId ? active.recording : null;
    const recordingRestoreRef=useRef('');
 const recordingDraftRestoreRef=useRef('');
 const [recordingTargetStepId, setRecordingTargetStepId] = useState('');
    const recorderSession = recording?.session || null, recorderStartOptions = recording?.options || null;
    const recorderParameterBindings = recording?.parameterBindings || {};
    const receiveRecorderStatus = useCallback((action: RecorderSessionResponse | null | ((current: RecorderSessionResponse | null) => RecorderSessionResponse | null)) => {
        const current = authoring.activeRecording()?.recording;
        if (!current)
            return;
        const next = typeof action === 'function' ? action(current.session) : action;
        if (next && next.id === current.session?.id)
            authoring.recorderSessionUpdated(current.origin.caseId, next);
    }, [authoring]);
    useRecorderStatus(recorderSession, receiveRecorderStatus);
    const bindRecordingParameter = (index: number, reference: string) => {
        const current = authoring.activeRecording()?.recording;
        if (current)
            authoring.recordingParametersChanged(current.origin.caseId, current.operationId, { ...current.parameterBindings, [index]: reference });
    };
    return { recordingRestoreRef, recordingDraftRestoreRef, authoring, recording, recordingTargetStepId, setRecordingTargetStepId, recorderSession, recorderStartOptions, recorderParameterBindings, bindRecordingParameter };
}
export type AutomationRecorderState = ReturnType<typeof useAutomationRecorderState>;
