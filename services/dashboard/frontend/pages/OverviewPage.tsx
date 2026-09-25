import { useLocalization } from "@hellotest/platform/frontend/src/context/LocalizationContext";
import { hasCapability } from "@hellotest/platform/frontend/src/platform/lib/capabilityAccess";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@hellotest/platform/frontend/src/auth/AuthContext";
import { CustomQualityDashboard } from "../components/CustomQualityDashboard";
import { ReleaseReadinessDashboard } from "../components/ReleaseReadinessDashboard";
import { QualityAnalyticsDashboard } from "../components/QualityAnalyticsDashboard";
import { useCurrentProject } from "@hellotest/platform/frontend/src/platform/hooks/useCurrentProject";
import { useFeatureFlags } from "@hellotest/platform/frontend/src/platform/hooks/useFeatureFlags";
import { areFeatureFlagsEnabled } from "@hellotest/platform/frontend/src/platform/lib/featureFlags";
import { hasPermission } from "@hellotest/platform/frontend/src/platform/lib/permissions";

export function OverviewPage() {
  const { session } = useAuth();
  const { t } = useLocalization();
  const featureFlagsQuery = useFeatureFlags(Boolean(session));
  const [projectId] = useCurrentProject();
  const [searchParams] = useSearchParams();
  const requestedView = searchParams.get("view");
  const dashboardView =
    requestedView === "custom" || requestedView === "readiness"
      ? requestedView
      : "analytics";

  if (dashboardView === "analytics") return <QualityAnalyticsDashboard />;

  if (!hasCapability(session, featureFlagsQuery.data, "dashboard.view", projectId)) {
    const granted = hasPermission(session, "dashboard.view", projectId);
    return <main className="quality-analytics"><div className="qa-empty" role="status">{featureFlagsQuery.isPending ? "Loading dashboard access…" : <><h1>{t(granted ? "access.disabledTitle" : "access.deniedTitle")}</h1><p>{t(granted ? "access.disabledHelp" : "access.deniedHelp")}</p></>}</div></main>;
  }

  if (dashboardView === "readiness") {
    return <ReleaseReadinessDashboard />;
  }

  if (dashboardView === "custom") {
    return (
      <div className="page-content page-content--overview overview-layout">
        {projectId ? (
          <CustomQualityDashboard
            canManage={hasCapability(session, featureFlagsQuery.data, "dashboard.manage", projectId)}
            canUseAutomation={
              hasPermission(session, "automation.analytics.view", projectId) &&
              hasPermission(session, "dashboard.view", projectId) &&
              areFeatureFlagsEnabled(featureFlagsQuery.data, [
                "hellotest.automation.workspace",
                "hellotest.automation.analytics",
              ])
            }
            canUseAi={
              hasPermission(session, "quality_insight.view", projectId) &&
              areFeatureFlagsEnabled(featureFlagsQuery.data, [
                "hellotest.ai.quality_insights",
              ])
            }
            projectId={String(projectId)}
          />
        ) : (
          <div className="empty-state compact">
            Select a project to build a dashboard.
          </div>
        )}
      </div>
    );
  }

  return <QualityAnalyticsDashboard />;
}
