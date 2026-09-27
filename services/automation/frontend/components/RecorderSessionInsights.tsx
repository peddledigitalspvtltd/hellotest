import type { RecorderSessionResponse } from "@hellotest/platform/frontend/src/types";
import { InfoTooltip } from "@hellotest/platform/frontend/src/shared/components/InfoTooltip";

type RecorderSessionInsightsProps = {
  session: RecorderSessionResponse | null;
};

function formatUrl(value?: string | null) {
  if (!value) {
    return "Current page";
  }

  try {
    const parsed = new URL(value);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return value;
  }
}

function maskCapturedValue(value?: string | null) {
  if (!value) {
    return "";
  }

  if (value.length > 48) {
    return `${value.slice(0, 45)}...`;
  }

  return value;
}

export function RecorderSessionInsights({ session }: RecorderSessionInsightsProps) {
  if (!session) {
    return null;
  }

  const recentActions = [...(session.actions || [])].sort((left, right) => left.index - right.index);
  const recentNetwork = [...(session.network || [])].sort((left, right) => left.index - right.index);

  if (!recentActions.length && !recentNetwork.length) {
    return (
      <div className="recorder-insights-grid">
        <div className="empty-state compact">Recorder is waiting for actions. A connected browser or device is required.</div>
      </div>
    );
  }

  return (
    <div className="recorder-insights-grid">
      <section className="recorder-insight-panel">
        <div className="execution-context-summary-head">
          <div className="execution-context-summary-copy">
            <div className="execution-context-summary-title-row">
              <strong>Captured steps</strong>
              <InfoTooltip
                content="Recorded actions in playback order, with their locators."
                label="Captured steps information"
              />
            </div>
          </div>
          <span className="count-pill">{session.action_count || recentActions.length} actions</span>
        </div>
        {(session.action_count || 0) > recentActions.length ? <p className="muted" role="status">Showing {recentActions.length} of {session.action_count} captured actions. Split long recordings into smaller reusable groups before building.</p> : null}
        {recentActions.length ? (
          <div className="stack-list recorder-insight-list">
            {recentActions.map((action) => (
              <div className="stack-item" key={`${action.index}-${action.timestamp || ""}`}>
                <div>
                  <strong>{action.index}. {action.type}</strong>
                  <span>{formatUrl(action.url)}{action.value || action.text ? ` · ${maskCapturedValue(action.value || action.text)}` : ""}</span>
                </div>
                {action.locator ? <code className="execution-operation-json">{action.locator}</code> : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state compact">No actions have been captured yet.</div>
        )}
      </section>

      <section className="recorder-insight-panel">
        <div className="execution-context-summary-head">
          <div className="execution-context-summary-copy">
            <div className="execution-context-summary-title-row">
              <strong>API candidates</strong>
              <InfoTooltip
                content="Fetch/XHR calls collected during the web recording for linked API case creation."
                label="API candidates information"
              />
            </div>
          </div>
          <span className="count-pill">{session.network_count || recentNetwork.length} calls</span>
        </div>
        {recentNetwork.length ? (
          <div className="stack-list recorder-insight-list">
            {recentNetwork.map((entry) => (
              <div className="stack-item" key={`${entry.index}-${entry.timestamp || ""}`}>
                <div>
                  <strong>{entry.method} {entry.status || "pending"}</strong>
                  <span>{formatUrl(entry.url)} · {entry.resource_type || "api"}</span>
                </div>
                <code className="execution-operation-json">{entry.content_type || "unknown content type"}</code>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state compact">No business API traffic has been captured yet.</div>
        )}
      </section>
    </div>
  );
}
