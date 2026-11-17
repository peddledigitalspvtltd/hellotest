import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useDeleteConfirmation } from "@hellotest/platform/frontend/src/shared/components/DeleteConfirmationDialog";
import { useAuth } from "@hellotest/platform/frontend/src/auth/AuthContext";
import { useCurrentAppType, useCurrentProject } from "@hellotest/platform/frontend/src/platform/hooks/useCurrentProject";
import { useFeatureFlags } from "@hellotest/platform/frontend/src/platform/hooks/useFeatureFlags";
import { canEditAutomationCode as resolveCanEditAutomationCode, canGenerateAutomationCode as resolveCanGenerateAutomationCode, canRecordAutomationCode as resolveCanRecordAutomationCode, canViewAutomationCode as resolveCanViewAutomationCode } from "../../lib/automationAccess";
import { areFeatureFlagsEnabled } from "@hellotest/platform/frontend/src/platform/lib/featureFlags";
import { hasPermission } from "@hellotest/platform/frontend/src/platform/lib/permissions";
export function useAutomationCaseScope() {
    const {session} = useAuth();
    const { confirmDelete, confirmationDialog } = useDeleteConfirmation();
    const [projectId] = useCurrentProject();
    const [appTypeId, setAppTypeId] = useCurrentAppType(projectId);
    const featureFlagsQuery = useFeatureFlags(Boolean(session));
    const isAutomationWorkspaceEnabled = areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.automation.workspace"]);
    const canViewAutomationCode = resolveCanViewAutomationCode(session, featureFlagsQuery.data, projectId);
    const canEditAutomationCode = resolveCanEditAutomationCode(session, featureFlagsQuery.data, projectId);
    const canUseAutomationBuilder = canEditAutomationCode;
    const canUpdateAutomationCase = canUseAutomationBuilder && hasPermission(session, "testcase.update", projectId);
    const canEditAutomationSuiteLinks = canUpdateAutomationCase && hasPermission(session, "suite.update", projectId) && hasPermission(session, "suite.view", projectId) && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.manual.suites"]);
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
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const queryClient = useQueryClient();
    const canViewExecutionMetrics = hasPermission(session, "run.view", projectId) && hasPermission(session, "result.view", projectId);
    const canViewTestData = hasPermission(session, "data.view", projectId) && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.manual.test_data"]);
    const canDeleteAutomationCases = isAutomationWorkspaceEnabled
        && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.automation.builder"])
        && hasPermission(session, "testcase.delete", projectId);
    const canViewObjectRepository = hasPermission(session, "automation.view", projectId)
        && isAutomationWorkspaceEnabled
        && areFeatureFlagsEnabled(featureFlagsQuery.data, ["hellotest.automation.object_repository"]);
    return { session, confirmDelete, confirmationDialog, projectId, appTypeId, setAppTypeId, featureFlagsQuery, isAutomationWorkspaceEnabled, canViewAutomationCode, canEditAutomationCode, canUseAutomationBuilder, canUpdateAutomationCase, canEditAutomationSuiteLinks, canUseAutomationAi, canUseRecorder, canInspectRepository, canUseMobileAppium, canRunLocalAutomation, canRunRemoteAutomation, navigate, searchParams, setSearchParams, queryClient, canViewExecutionMetrics, canViewTestData, canDeleteAutomationCases, canViewObjectRepository };
}
export type AutomationCaseScope = ReturnType<typeof useAutomationCaseScope>;
