import { useAuth } from "../../auth/AuthContext";
import { SaveIcon } from "../../components/AppIcons";
import { Panel } from "../../components/Panel";
import { hasPermission } from "../../lib/permissions";
import { useFeatureAvailability } from "./useFeatureAvailability";

type FeatureAvailabilitySectionProps = {
  onError: (error: unknown, fallback: string) => void;
  onSuccess: (message: string) => void;
};

export function FeatureAvailabilitySection({ onError, onSuccess }: FeatureAvailabilitySectionProps) {
  const { session } = useAuth();
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
      onSuccess("Feature availability updated.");
    } catch (error) {
      onError(error, "Unable to update feature availability.");
    }
  };

  return (
    <section className="settings-section">
      <div className="settings-section-heading settings-section-heading--with-action">
        <div>
          <p className="eyebrow">Features</p>
          <h3>Feature availability</h3>
        </div>
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
      <Panel title="Workspace feature flags" subtitle="Enable or pause capability groups without changing role permissions.">
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
                    </span>
                  </label>
                ))}
              </div>
            </article>
          ))}
        </div>
      </Panel>
    </section>
  );
}
