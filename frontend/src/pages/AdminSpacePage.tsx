import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { SubnavTabs } from "../components/SubnavTabs";
import { api } from "../lib/api";
import { IntegrationsPage } from "./IntegrationsPage";
import { PeoplePage } from "./PeoplePage";
import { SettingsPage } from "./SettingsPage";

type AdminSpaceSection = "users" | "roles" | "integrations" | "settings";

const ADMIN_SECTIONS: AdminSpaceSection[] = ["users", "roles", "integrations", "settings"];

const normalizeSection = (value: string | null): AdminSpaceSection | null =>
  ADMIN_SECTIONS.includes(value as AdminSpaceSection) ? (value as AdminSpaceSection) : null;

export function AdminSpacePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const usersQuery = useQuery({ queryKey: ["users"], queryFn: api.users.list });
  const rolesQuery = useQuery({ queryKey: ["roles"], queryFn: api.roles.list });
  const integrationsQuery = useQuery({ queryKey: ["integrations", "admin-space"], queryFn: () => api.integrations.list() });

  const activeSection = normalizeSection(searchParams.get("section")) || (searchParams.get("view") === "roles" ? "roles" : "users");
  const users = usersQuery.data || [];
  const roles = rolesQuery.data || [];
  const integrations = integrationsQuery.data || [];
  const activeIntegrations = integrations.filter((integration) => integration.is_active).length;

  const sectionDescription = useMemo(() => {
    switch (activeSection) {
      case "roles":
        return "Tune role definitions and permission bundles without leaving the administration workspace.";
      case "integrations":
        return "Manage external systems, engines, AI providers, authentication, and delivery connections.";
      case "settings":
        return "Set workspace preferences, sidebar behavior, theme defaults, and localization controls.";
      case "users":
      default:
        return "Manage workspace users, access assignments, connected systems, and workspace settings from one place.";
    }
  }, [activeSection]);

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
        description={sectionDescription}
        meta={[
          { label: "Users", value: users.length },
          { label: "Roles", value: roles.length },
          { label: "Active integrations", value: activeIntegrations }
        ]}
      />

      <SubnavTabs
        ariaLabel="Admin Space sections"
        className="admin-space-tabs"
        items={[
          { value: "users", label: "Users", meta: `${users.length} records` },
          { value: "roles", label: "Roles", meta: `${roles.length} records` },
          { value: "integrations", label: "Integrations", meta: `${integrations.length} configured` },
          { value: "settings", label: "Settings", meta: "Workspace" }
        ]}
        onChange={handleSectionChange}
        value={activeSection}
      />

      <section className="admin-space-section" aria-label={`${activeSection} section`}>
        {activeSection === "users" ? <PeoplePage embedded forcedView="users" /> : null}
        {activeSection === "roles" ? <PeoplePage embedded forcedView="roles" /> : null}
        {activeSection === "integrations" ? <IntegrationsPage /> : null}
        {activeSection === "settings" ? <SettingsPage /> : null}
      </section>
    </div>
  );
}
