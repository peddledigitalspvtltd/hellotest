import { useRef, useState } from "react";
import { type RunHookSelection } from "@hellotest/testing/frontend/components/RunHooksBuilder";
import type { TestCase } from "@hellotest/platform/frontend/src/types";
import { type AutomationCaseDraft } from "../../lib/automationWorkspaceSupport";
import type { AutomationCaseScope } from './useAutomationCaseScope';
import type { AutomationCaseSelection } from './useAutomationCaseSelection';
export function useAutomationDataState(scope: AutomationCaseScope, selection: AutomationCaseSelection) {
    const {} = scope;
    const {} = selection;
    const [automationManualLinkDraftIds, setAutomationManualLinkDraftIds] = useState<string[]>([]);
    const [caseRequirementIds, setCaseRequirementIds] = useState<string[]>([]);
    const [caseModuleIds, setCaseModuleIds] = useState<string[]>([]);
    const [caseDataSetId, setCaseDataSetId] = useState("");
    const [overrideSharedSteps, setOverrideSharedSteps] = useState(true);
    const [parameterPreviewRevision, setParameterPreviewRevision] = useState(0);
    const parameterPreviewCache = useRef(new Map<string, string>());
    const [caseDraft, setCaseDraft] = useState<AutomationCaseDraft>({
        automationCaseType: "",
        title: "",
        description: "",
        status: "active",
        priority: "3"
    });
    const lastAutomationCaseDraftSeedRef = useRef<{
        caseKey: string;
        detail: TestCase;
    } | null>(null);
    const [isParameterDialogOpen, setIsParameterDialogOpen] = useState(false);
    const [testCaseParameterValues, setTestCaseParameterValues] = useState<Record<string, string>>({});
    const [privateCaseParameterDraft, setPrivateCaseParameterDraft] = useState<{
        scope: string;
        names: string[];
    }>({ scope: "", names: [] });
    const caseParameterOverrideDraftRef = useRef<{
        scope: string;
        names: Set<string>;
    }>({ scope: "", names: new Set() });
    const [suiteParameterValues, setSuiteParameterValues] = useState<Record<string, string>>({});
    const lastAutomationSuiteParameterSeedRef = useRef<{
        suiteId: string;
        values: Record<string, string>;
    } | null>(null);
    const [selectedParameterSuiteId, setSelectedParameterSuiteId] = useState("");
    const [suiteLinkDraftIds, setSuiteLinkDraftIds] = useState<string[]>([]);
    const [executionHookDraft, setExecutionHookDraft] = useState<RunHookSelection[]>([]);
    const [selectedExecutionEnvironmentId, setSelectedExecutionEnvironmentId] = useState("");
    const [selectedExecutionConfigurationId, setSelectedExecutionConfigurationId] = useState("");
    const [selectedExecutionDataSetId, setSelectedExecutionDataSetId] = useState("");
    return { automationManualLinkDraftIds, setAutomationManualLinkDraftIds, caseRequirementIds, setCaseRequirementIds, caseModuleIds, setCaseModuleIds, caseDataSetId, setCaseDataSetId, overrideSharedSteps, setOverrideSharedSteps, parameterPreviewRevision, setParameterPreviewRevision, parameterPreviewCache, caseDraft, setCaseDraft, lastAutomationCaseDraftSeedRef, isParameterDialogOpen, setIsParameterDialogOpen, testCaseParameterValues, setTestCaseParameterValues, privateCaseParameterDraft, setPrivateCaseParameterDraft, caseParameterOverrideDraftRef, suiteParameterValues, setSuiteParameterValues, lastAutomationSuiteParameterSeedRef, selectedParameterSuiteId, setSelectedParameterSuiteId, suiteLinkDraftIds, setSuiteLinkDraftIds, executionHookDraft, setExecutionHookDraft, selectedExecutionEnvironmentId, setSelectedExecutionEnvironmentId, selectedExecutionConfigurationId, setSelectedExecutionConfigurationId, selectedExecutionDataSetId, setSelectedExecutionDataSetId };
}
export type AutomationDataState = ReturnType<typeof useAutomationDataState>;
