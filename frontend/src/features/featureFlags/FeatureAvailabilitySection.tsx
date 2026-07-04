import { Panel } from "../../components/Panel";
import type { FeatureFlagSnapshot } from "../../types";

type FeatureAvailabilitySectionProps = {
  canManageFeatureFlags: boolean;
  drafts: Record<string, boolean>;
  featureFlags?: FeatureFlagSnapshot | null;
  isExpanded?: boolean;
  isLoading?: boolean;
  isSaving?: boolean;
  onFeatureChange: (featureKey: string, isEnabled: boolean) => void;
  onToggle?: () => void;
};

export function FeatureAvailabilitySection({
  canManageFeatureFlags,
  drafts,
  featureFlags,
  isExpanded = true,
  isLoading = false,
  isSaving = false,
  onFeatureChange,
  onToggle
}: FeatureAvailabilitySectionProps) {
  return (
    <section className={isExpanded ? "settings-section is-expanded" : "settings-section is-collapsed"}>
      <div className="settings-section-heading">
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
	                      onChange={(event) => onFeatureChange(feature.key, event.target.checked)}
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
