import { useAuth } from "@hellotest/platform/frontend/src/auth/AuthContext";
import { useFeatureFlags } from "@hellotest/platform/frontend/src/platform/hooks/useFeatureFlags";
import { canEditAutomationCode as resolveCanEditAutomationCode, canGenerateAutomationCode as resolveCanGenerateAutomationCode, canRecordAutomationCode as resolveCanRecordAutomationCode, canViewAutomationCode as resolveCanViewAutomationCode } from "../../lib/automationAccess";
import { areFeatureFlagsEnabled } from "@hellotest/platform/frontend/src/platform/lib/featureFlags";
import { hasPermission } from "@hellotest/platform/frontend/src/platform/lib/permissions";

export function useAutomationCasesAccess(projectId:string){
const { session } = useAuth();
const featureFlagsQuery = useFeatureFlags(Boolean(session));
const isAutomationWorkspaceEnabled = areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.automation.workspace"]);
const canViewAutomationCode = resolveCanViewAutomationCode(session, featureFlagsQuery.data, projectId);
const canEditAutomationCode = resolveCanEditAutomationCode(session, featureFlagsQuery.data, projectId);
const canUseAutomationBuilder = canEditAutomationCode;
const canCreateAutomationDraft = canUseAutomationBuilder && hasPermission(session, "testcase.create", projectId);
const canUseAutomationAi = resolveCanGenerateAutomationCode(session, featureFlagsQuery.data, projectId);
const canUseRecorder = resolveCanRecordAutomationCode(session, featureFlagsQuery.data, projectId);
const canInspectRepository = hasPermission(session, "automation.repository.manage", projectId)
    && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.automation.workspace", "hellotest.automation.object_repository"]);
const canUseMobileAppium = hasPermission(session, "mobile.manage", projectId)
    && isAutomationWorkspaceEnabled
    && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.mobile.appium"]);
const canRunLocalAutomation = hasPermission(session, "automation.run.local", projectId)
    && isAutomationWorkspaceEnabled
    && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.automation.local_execution"]);
const canRunRemoteAutomation = hasPermission(session, "automation.run.remote", projectId)
    && isAutomationWorkspaceEnabled
    && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.automation.remote_execution"]);
return {session,featureFlagsQuery,isAutomationWorkspaceEnabled,canViewAutomationCode,canEditAutomationCode,canUseAutomationBuilder,canCreateAutomationDraft,canUseAutomationAi,canUseRecorder,canInspectRepository,canUseMobileAppium,canRunLocalAutomation,canRunRemoteAutomation};
}
export type AutomationCasesAccess=ReturnType<typeof useAutomationCasesAccess>;
