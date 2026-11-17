import { useAutomationBuildReview } from "./useAutomationBuildReview";
import { type AutomationStepDraft } from "../../lib/automationStepDraft";
import { type AutomationBuildVerificationChoice } from "../../lib/automationBuildPipeline";
import { automationAgentSelection } from "@hellotest/ai/frontend/components/AutomationAgentSetup";
import { type AutomationStepOptions } from "../../lib/automationStepOptions";

import { type AutomationAgentActivityRecord } from "../../components/AutomationAgentActivity";
import { useRef, useState } from "react";
import type { AutomationCaseScope } from './useAutomationCaseScope';
import type { AutomationCaseSelection } from './useAutomationCaseSelection';
export function useAutomationBuildState(scope: AutomationCaseScope, selection: AutomationCaseSelection) {
    const {projectId} = scope;
    const {selectedCaseId, activeAutomationWorkspaceTab} = selection;
    const review = useAutomationBuildReview();
    const [agentMission, setAgentMission] = useState("");
    const [buildAgentSelection, setBuildAgentSelection] = useState(automationAgentSelection);
    const [agentScheduledAt, setAgentScheduledAt] = useState("");
    const [batchBuildTargetIds, setBatchBuildTargetIds] = useState<string[]>([]);
    const automationBuildDraftBaselineRef = useRef<{
        projectId?: string;
        caseId?: string;
        steps: Record<string, AutomationStepDraft>;
        options: Record<string, AutomationStepOptions>;
        code: Record<string, string>;
        evidence: Record<string, string>;
    }>({ steps: {}, options: {}, code: {}, evidence: {} });
    const currentAutomationSelectionRef = useRef({ projectId, selectedCaseId, workspaceTab: activeAutomationWorkspaceTab });
    const [isBatchAgentOpen, setIsBatchAgentOpen] = useState(false);
    const [startUrl, setStartUrl] = useState("");
    const [batchStartUrl, setBatchStartUrl] = useState("");
    const startUrlCaseScopeRef = useRef("");
    const [builderContext, setBuilderContext] = useState("");
    const [allowBrowserActions, setAllowBrowserActions] = useState(true);
    const [buildBrowserLocation, setBuildBrowserLocation] = useState<"local" | "remote">("remote");
    const [buildVerificationMode, setBuildVerificationMode] = useState<AutomationBuildVerificationChoice>("generate_only");
    const latestAgentActivityRef = useRef<AutomationAgentActivityRecord | null>(null);
    const handledAgentActivityRef = useRef(new Set<string>());
    const refreshingAgentActivityRef = useRef(new Set<string>());
    return { ...review, agentMission, setAgentMission, buildAgentSelection, setBuildAgentSelection, agentScheduledAt, setAgentScheduledAt, batchBuildTargetIds, setBatchBuildTargetIds, automationBuildDraftBaselineRef, currentAutomationSelectionRef, isBatchAgentOpen, setIsBatchAgentOpen, startUrl, setStartUrl, batchStartUrl, setBatchStartUrl, startUrlCaseScopeRef, builderContext, setBuilderContext, allowBrowserActions, setAllowBrowserActions, buildBrowserLocation, setBuildBrowserLocation, buildVerificationMode, setBuildVerificationMode, latestAgentActivityRef, handledAgentActivityRef, refreshingAgentActivityRef };
}
export type AutomationBuildState = ReturnType<typeof useAutomationBuildState>;
