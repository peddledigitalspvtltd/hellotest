import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../auth/AuthContext";
import { SaveIcon } from "../../components/AppIcons";
import { Panel } from "../../components/Panel";
import { hasPermission } from "../../lib/permissions";
import { useFeatureAvailability } from "./useFeatureAvailability";

type FeatureAvailabilitySectionProps = {
  isExpanded?: boolean;
  onError: (error: unknown, fallback: string) => void;
  onSuccess: (message: string) => void;
  onToggle?: () => void;
};

export function FeatureAvailabilitySection({ isExpanded = true, onError, onSuccess, onToggle }: FeatureAvailabilitySectionProps) {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const canManageFeatureFlags = hasPermission(session, "feature_flag.manage");
  const {
    drafts,
    featureFlags,
    isLoading,
    isSaving,
    save,
    setFeatureEnabled
  } = useFeatureAvailability(Boolean(session));

  const handleSave = async () => {
    try {
      await save();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["permissions"] }),
        queryClient.invalidateQueries({ queryKey: ["domain-metadata"] })
      ]);
      onSuccess("Feature availability updated.");
    } catch (error) {
      onError(error, "Unable to update feature availability.");
    }
  };

  return (
    <section className={isExpanded ? "settings-section is-expanded" : "settings-section is-collapsed"}>
      <div className="settings-section-heading settings-section-heading--with-action">
        <button
          aria-expanded={isExpanded}
          className="settings-section-toggle"
          onClick={onToggle}
          type="button"
        >
          <span>
            <span className="eyebrow">Features</span>
            <strong>Feature availability</strong>
          </span>
          <span aria-hidden="true" className="settings-section-toggle-icon">{isExpanded ? "-" : "+"}</span>
        </button>
        <div className="settings-section-actions">
          <button
            className="primary-button"
            disabled={!canManageFeatureFlags || isSaving || isLoading}
            onClick={() => void handleSave()}
            type="button"
          >
            <SaveIcon />
            <span>{isSaving ? "Saving..." : "Save features"}</span>
          </button>
        </div>
      </div>
      {isExpanded ? <Panel title="Workspace feature flags" subtitle="Enable or pause capability groups without changing role permissions.">
        <div className="feature-flag-provider-card">
          <div>
            <strong>Local controls</strong>
            <span>Stored in workspace settings</span>
          </div>
        </div>
        {isLoading ? <div className="empty-state compact">Loading feature flags...</div> : null}
        <div className="feature-flag-group-grid">
          {(featureFlags?.groups || []).map((group) => (
            <article className="feature-flag-group-card" key={group.key}>
              <div className="feature-flag-group-head">
                <strong>{group.label}</strong>
                <span>{group.description}</span>
              </div>
              <div className="feature-flag-list">
                {group.features.map((feature) => (
                  <label className="feature-flag-toggle" key={feature.key}>
                    <input
                      checked={drafts[feature.key] !== false}
                      disabled={!canManageFeatureFlags || isSaving}
                      onChange={(event) => setFeatureEnabled(feature.key, event.target.checked)}
                      type="checkbox"
                    />
                    <span>
                      <strong>{feature.label}</strong>
                      <small>{feature.key}</small>
                      {feature.permissions?.length ? (
                        <small>{feature.permissions.length} permission{feature.permissions.length === 1 ? "" : "s"}: {feature.permissions.slice(0, 4).join(", ")}{feature.permissions.length > 4 ? "..." : ""}</small>
                      ) : null}
                    </span>
                  </label>
                ))}
              </div>
            </article>
          ))}
        </div>
      </Panel> : null}
    </section>
  );
}
