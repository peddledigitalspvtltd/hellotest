import { capabilityView } from "../src/platform/capabilities/CapabilityView";
const IntegrationsPage = capabilityView<import("react").ComponentProps<typeof import("@hellotest/integration/frontend/pages/IntegrationsPage")["IntegrationsPage"]> & {}>("integration", "IntegrationsPage", () => import("@hellotest/integration/frontend/pages/IntegrationsPage"), "integration");
import { metricTitle } from "../src/shared/lib/metricTitle";
import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate, useSearchParams } from "react-router-dom";
import { ActivityIcon, LayersIcon, PlugIcon, UsersIcon } from "../src/platform/components/AppIcons";
import { useAuth } from "../src/auth/AuthContext";
import { AppErrorState } from "../src/platform/components/AppErrorBoundary";
import { PageHeader } from "../src/shared/components/PageHeader";
import { SubnavTabs } from "../src/shared/components/SubnavTabs";
import { useFeatureFlags } from "../src/platform/hooks/useFeatureFlags";
import { api } from "../src/lib/api";
import { asArray } from "../src/shared/lib/collectionGuards";
import { areFeatureFlagsEnabled } from "../src/platform/lib/featureFlags";
import { hasPermission } from "../src/platform/lib/permissions";
import { queryKeys } from "../src/platform/lib/queryKeys";

import { PeoplePage } from "./PeoplePage";
import { SettingsPage } from "./SettingsPage";

type AdminSpaceSection = "users" | "roles" | "integrations" | "settings";

const ADMIN_SECTIONS: AdminSpaceSection[] = ["users", "roles", "integrations", "settings"];
const ADMIN_SECTION_FEATURES: Record<AdminSpaceSection, string[]> = {
  users: ["hellotest.ops.admin"],
  roles: ["hellotest.ops.admin"],
  integrations: ["hellotest.api.integrations"],
  settings: ["hellotest.ops.settings"]
};

const normalizeSection = (value: string | null): AdminSpaceSection | null =>
  ADMIN_SECTIONS.includes(value as AdminSpaceSection) ? (value as AdminSpaceSection) : null;

export function AdminSpacePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { session } = useAuth();
  const featureFlagsQuery = useFeatureFlags();
  const sectionAccess: Record<AdminSpaceSection, boolean> = {
    users: hasPermission(session, "user.view"),
    roles: hasPermission(session, "role.view"),
    integrations: hasPermission(session, "integration.view"),
    settings: hasPermission(session, "settings.view")
  };
  const isSectionEnabled = (section: AdminSpaceSection) => sectionAccess[section]
    && areFeatureFlagsEnabled(featureFlagsQuery.data, ADMIN_SECTION_FEATURES[section]);
  const usersQuery = useQuery({ queryKey: queryKeys.users(), queryFn: api.users.list, enabled: isSectionEnabled("users") });
  const rolesQuery = useQuery({ queryKey: queryKeys.roles(), queryFn: api.roles.list, enabled: isSectionEnabled("roles") });
  const integrationsQuery = useQuery({
    queryKey: queryKeys.integrations.scoped("admin-space"),
    queryFn: () => api.integrations.list(),
    enabled: isSectionEnabled("integrations")
  });


  const requestedSection = normalizeSection(searchParams.get("section")) || (searchParams.get("view") === "roles" ? "roles" : "users");
  const visibleSections = ADMIN_SECTIONS.filter(isSectionEnabled);
  const activeSection = visibleSections.includes(requestedSection) ? requestedSection : (visibleSections[0] || "settings");
  const users = asArray(usersQuery.data);
  const roles = asArray(rolesQuery.data);
  const integrations = asArray(integrationsQuery.data);
  const activeIntegrations = integrations.filter((integration) => integration.is_active).length;
  const adminUsers = users.filter((user) => user.role === "admin").length;


  const sectionMeta = useMemo(() => {
    switch (activeSection) {
      case "roles":
        return {
          title: "Roles",
          eyebrow: "Access model",
          description: "Tune role definitions and permission bundles without leaving the administration workspace.",
          detail: `${roles.length} role${roles.length === 1 ? "" : "s"} available`
        };
      case "integrations":
        return {
          title: "Integrations",
          eyebrow: "Connected systems",
          description: "Manage external systems, engines, AI providers, authentication, and delivery connections.",
          detail: `${activeIntegrations}/${integrations.length} active`
        };
      case "settings":
        return {
          title: "Settings",
          eyebrow: "Workspace governance",
          description: "Set workspace defaults, AI prompt policy, metric criteria, provider routing, exports, and localization controls.",
          detail: "AI governance, metrics, workspace defaults"
        };
      case "users":
      default:
        return {
          title: "Users",
          eyebrow: "Directory",
          description: "Manage workspace users, access assignments, connected systems, and workspace settings from one place.",
          detail: `${adminUsers} admin${adminUsers === 1 ? "" : "s"}`
        };
    }
  }, [activeIntegrations, activeSection, adminUsers, integrations.length, roles.length]);

  const overviewItems = [
    {
      section: "users" as const,
      label: "Users",
      value: users.length,
      detail: `${adminUsers} admin${adminUsers === 1 ? "" : "s"}`,
      icon: <UsersIcon />
    },
    {
      section: "roles" as const,
      label: "Roles",
      value: roles.length,
      detail: "Permission bundles",
      icon: <LayersIcon />
    },
    {
      section: "integrations" as const,
      label: "Integrations",
      value: integrations.length,
      detail: `${activeIntegrations} active`,
      icon: <PlugIcon />
    },
    {
      section: "settings" as const,
      label: "Settings",
      value: "Workspace",
      detail: "AI governance & preferences",
      icon: <ActivityIcon />
    }
  ].filter((item) => visibleSections.includes(item.section));
  const adminTabItems: Array<{ value: AdminSpaceSection; label: string; meta: string; icon: ReactNode }> = [
    { value: "users", label: "Users", meta: `${users.length} records`, icon: <UsersIcon /> },
    { value: "roles", label: "Roles", meta: `${roles.length} records`, icon: <LayersIcon /> },
    { value: "integrations", label: "Integrations", meta: `${integrations.length} configured`, icon: <PlugIcon /> },
    { value: "settings", label: "Settings", meta: "AI & workspace governance", icon: <ActivityIcon /> }
  ];
  const visibleAdminTabItems = adminTabItems.filter((item) => visibleSections.includes(item.value));

  const handleSectionChange = (section: AdminSpaceSection) => {
    const nextParams = new URLSearchParams();
    nextParams.set("section", section);
    setSearchParams(nextParams, { replace: false });
  };

  if (searchParams.get("section") === "health") return <Navigate to="/ops-telemetry?monitoring=health" replace />;

  if (!visibleSections.length) {
    return (
      <div className="page-content admin-space-page">
        <PageHeader
          eyebrow="Administration"
          title="Admin Space"
          description="Manage users, access roles, connected systems, and workspace preferences from one administration surface."
        />
        <AppErrorState
          fallbackMessage="No enabled administration section is available for your workspace permissions."
          title="Administration access unavailable"
        />
      </div>
    );
  }

  return (
    <div className="page-content admin-space-page">
      <PageHeader
        eyebrow="Administration"
        title="Admin Space"
        description="Manage users, access roles, connected systems, and workspace preferences from one administration surface."
      />

      <section className="admin-space-overview" aria-label="Admin Space overview">
        <div className="admin-space-overview-copy">
          <p className="eyebrow">{sectionMeta.eyebrow}</p>
          <strong>{sectionMeta.title}</strong>
          <span>{sectionMeta.detail}</span>
          <p>{sectionMeta.description}</p>
        </div>
        <div className="admin-space-metrics metric-strip page-metric-strip" aria-label="Administration sections" role="group">
          {overviewItems.map((item) => (
            <button
              className={activeSection === item.section ? "admin-space-metric is-active" : "admin-space-metric"}
              key={item.section}
              onClick={() => handleSectionChange(item.section)}
              type="button"
            >
              <span className="admin-space-metric-icon" aria-hidden="true">{item.icon}</span>
              <span>{metricTitle(item.label)}</span>
              <strong>{item.value}</strong>
              <small>{item.detail}</small>
            </button>
          ))}
        </div>
      </section>

      <SubnavTabs
        ariaLabel="Admin Space sections"
        className="admin-space-tabs"
        items={visibleAdminTabItems}
        onChange={handleSectionChange}
        showIndicator={false}
        value={activeSection}
      />

      <section className="admin-space-section" aria-label={`${activeSection} section`}>
        {activeSection === "users" ? <PeoplePage embedded forcedView="users" /> : null}
        {activeSection === "roles" ? <PeoplePage embedded forcedView="roles" /> : null}
        {activeSection === "integrations" ? <IntegrationsPage embedded /> : null}
        {activeSection === "settings" ? <SettingsPage embedded /> : null}
      </section>
    </div>
  );
}
