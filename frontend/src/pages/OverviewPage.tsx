import { useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { CustomQualityDashboard } from "../components/CustomQualityDashboard";
import { ReleaseReadinessDashboard } from "../components/ReleaseReadinessDashboard";
import { QualityAnalyticsDashboard } from "../components/QualityAnalyticsDashboard";
import { useCurrentProject } from "../hooks/useCurrentProject";
import { useFeatureFlags } from "../hooks/useFeatureFlags";
import { areFeatureFlagsEnabled } from "../lib/featureFlags";
import { hasPermission } from "../lib/permissions";

export function OverviewPage() {
  const { session } = useAuth();
  const featureFlagsQuery = useFeatureFlags(Boolean(session));
  const [projectId] = useCurrentProject();
  const [searchParams] = useSearchParams();
  const requestedView = searchParams.get("view");
  const dashboardView =
    requestedView === "custom" || requestedView === "readiness"
      ? requestedView
      : "analytics";

  if (dashboardView === "readiness") {
    return <ReleaseReadinessDashboard />;
  }

  if (dashboardView === "custom") {
    return (
      <div className="page-content page-content--overview overview-layout">
        {projectId ? (
          <CustomQualityDashboard
            canManage={hasPermission(session, "dashboard.manage", projectId)}
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
