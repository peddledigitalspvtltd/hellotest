import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { ActivityIcon, LayersIcon, PlugIcon, UsersIcon } from "../components/AppIcons";
import { PageHeader } from "../components/PageHeader";
import { SubnavTabs } from "../components/SubnavTabs";
import { useFeatureFlags } from "../hooks/useFeatureFlags";
import { api } from "../lib/api";
import { areFeatureFlagsEnabled } from "../lib/featureFlags";
import { queryKeys } from "../lib/queryKeys";
import { IntegrationsPage } from "./IntegrationsPage";
import { PeoplePage } from "./PeoplePage";
import { SettingsPage } from "./SettingsPage";

type AdminSpaceSection = "users" | "roles" | "integrations" | "settings";

const ADMIN_SECTIONS: AdminSpaceSection[] = ["users", "roles", "integrations", "settings"];
const ADMIN_SECTION_FEATURES: Record<AdminSpaceSection, string[]> = {
  users: ["qaira.ops.admin"],
  roles: ["qaira.ops.admin"],
  integrations: ["qaira.api.integrations"],
  settings: []
};

const normalizeSection = (value: string | null): AdminSpaceSection | null =>
  ADMIN_SECTIONS.includes(value as AdminSpaceSection) ? (value as AdminSpaceSection) : null;

export function AdminSpacePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const usersQuery = useQuery({ queryKey: queryKeys.users(), queryFn: api.users.list });
  const rolesQuery = useQuery({ queryKey: queryKeys.roles(), queryFn: api.roles.list });
  const integrationsQuery = useQuery({ queryKey: queryKeys.integrations.scoped("admin-space"), queryFn: () => api.integrations.list() });
  const featureFlagsQuery = useFeatureFlags();

  const requestedSection = normalizeSection(searchParams.get("section")) || (searchParams.get("view") === "roles" ? "roles" : "users");
  const visibleSections = ADMIN_SECTIONS.filter((section) =>
    areFeatureFlagsEnabled(featureFlagsQuery.data, ADMIN_SECTION_FEATURES[section])
  );
  const activeSection = visibleSections.includes(requestedSection) ? requestedSection : "settings";
  const users = usersQuery.data || [];
  const roles = rolesQuery.data || [];
  const integrations = integrationsQuery.data || [];
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
          eyebrow: "Workspace defaults",
          description: "Set workspace preferences, sidebar behavior, theme defaults, and localization controls.",
          detail: "Theme, sidebar, exports, localization"
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
      detail: "Preferences",
      icon: <ActivityIcon />
    }
  ].filter((item) => visibleSections.includes(item.section));
  const adminTabItems: Array<{ value: AdminSpaceSection; label: string; meta: string; icon: ReactNode }> = [
    { value: "users", label: "Users", meta: `${users.length} records`, icon: <UsersIcon /> },
    { value: "roles", label: "Roles", meta: `${roles.length} records`, icon: <LayersIcon /> },
    { value: "integrations", label: "Integrations", meta: `${integrations.length} configured`, icon: <PlugIcon /> },
    { value: "settings", label: "Settings", meta: "Workspace", icon: <ActivityIcon /> }
  ];
  const visibleAdminTabItems = adminTabItems.filter((item) => visibleSections.includes(item.value));

  const handleSectionChange = (section: AdminSpaceSection) => {
    const nextParams = new URLSearchParams();
    nextParams.set("section", section);
    setSearchParams(nextParams, { replace: false });
  };

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
        <div className="admin-space-metrics" aria-label="Administration sections">
          {overviewItems.map((item) => (
            <button
              className={activeSection === item.section ? "admin-space-metric is-active" : "admin-space-metric"}
              key={item.section}
              onClick={() => handleSectionChange(item.section)}
              type="button"
            >
              <span className="admin-space-metric-icon" aria-hidden="true">{item.icon}</span>
              <span>{item.label}</span>
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
