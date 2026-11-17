import { useAutomationDraftStore } from "../../hooks/useAutomationDraftStore";

import { type SectionGroupReview } from "../../components/AutomationSectionGroupDialog";
import { useState } from "react";
import type { TestStep } from "@hellotest/platform/frontend/src/types";
import { type AutomationStepView } from "../../lib/automationWorkspaceSupport";
import type { AutomationCaseScope } from './useAutomationCaseScope';
import type { AutomationCaseSelection } from './useAutomationCaseSelection';
export function useAutomationPlanState(scope: AutomationCaseScope, selection: AutomationCaseSelection) {
    const {projectId, appTypeId} = scope;
    const {selectedCaseId} = selection;
    const [isAutomationCodePreviewOpen, setIsAutomationCodePreviewOpen] = useState(false);
    const [automationGroupName, setAutomationGroupName] = useState("");
    const [sectionGroupDialog, setSectionGroupDialog] = useState<SectionGroupReview | null>(null);
    const [saveAutomationGroupAsShared, setSaveAutomationGroupAsShared] = useState(false);
    const [isSharedGroupLibraryOpen, setIsSharedGroupLibraryOpen] = useState(false);
    const [sectionClipboard, setSectionClipboard] = useState<{
        projectId: string;
        caseId: string;
        appTypeId: string;
        ids: string[];
        standalone: boolean;
    } | null>(null);
    const [automationStepView, setAutomationStepView] = useState<AutomationStepView>("keyword");
    const [automationStudioStep, setAutomationStudioStep] = useState<TestStep | null>(null);
    const { store: automationDraftStore, setStepDrafts, setStepOptionDrafts, setStepCodeDrafts, setApiSourceDrafts } = useAutomationDraftStore(`${projectId}:${appTypeId}:${selectedCaseId}`);
    const [inputBindingStep, setInputBindingStep] = useState<TestStep | null>(null);
    return { isAutomationCodePreviewOpen, setIsAutomationCodePreviewOpen, automationGroupName, setAutomationGroupName, sectionGroupDialog, setSectionGroupDialog, saveAutomationGroupAsShared, setSaveAutomationGroupAsShared, isSharedGroupLibraryOpen, setIsSharedGroupLibraryOpen, sectionClipboard, setSectionClipboard, automationStepView, setAutomationStepView, automationStudioStep, setAutomationStudioStep, automationDraftStore, setStepDrafts, setStepOptionDrafts, setStepCodeDrafts, setApiSourceDrafts, inputBindingStep, setInputBindingStep };
}
export type AutomationPlanState = ReturnType<typeof useAutomationPlanState>;
