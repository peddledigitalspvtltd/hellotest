import { useState } from "react";
import type { RecorderSessionResponse } from "@hellotest/platform/frontend/src/types";
import { InfoTooltip } from "@hellotest/platform/frontend/src/shared/components/InfoTooltip";
import type { StepParameterDefinition } from "@hellotest/platform/frontend/src/shared/lib/stepParameters";
import { createRecorderDisplayPrivacy } from '../lib/recorderDisplayPrivacy';
import "./RecorderSessionInsights.css";

type RecorderSessionInsightsProps = {
  session: RecorderSessionResponse | null;
  parameters?: StepParameterDefinition[];
  parameterBindings?: Record<number, string>;
  onParameterBindingChange?: (actionIndex: number, reference: string) => void;
  onCreateParameter?: (actionIndex: number, reference: string, value: string) => string | null;
  disabled?: boolean;
  privateValues?: string[];
};

function maskCapturedValue(value?: string | null) {
  if (!value) {
    return "";
  }

  if (value.length > 48) {
    return `${value.slice(0, 45)}...`;
  }

  return value;
}

export function RecorderSessionInsights({ session, parameters = [], parameterBindings = {}, onParameterBindingChange, onCreateParameter, disabled, privateValues = [] }: RecorderSessionInsightsProps) {
  const [newParameterAction, setNewParameterAction] = useState<number | null>(null);
  const [newParameterReference, setNewParameterReference] = useState("");
  const [newParameterValue, setNewParameterValue] = useState("");
  const [newParameterError, setNewParameterError] = useState("");
  if (!session) {
    return null;
  }

  const recentActions = [...(session.actions || [])].sort((left, right) => left.index - right.index);
  const recentNetwork = [...(session.network || [])].sort((left, right) => left.index - right.index);
  const sensitiveReferences = new Set(parameters.filter(parameter => parameter.sensitive).map(parameter => parameter.token.toLowerCase()));
  const privacy = createRecorderDisplayPrivacy(recentActions, privateValues,
    new Set(Object.entries(parameterBindings).filter(([, reference]) => sensitiveReferences.has(reference.toLowerCase())).map(([index]) => Number(index))));

  if (!recentActions.length && !recentNetwork.length) {
    return (
      <div className="recorder-insights-grid recorder-session-insights">
        <div className="empty-state compact">Recorder is waiting for actions. A connected browser or device is required.</div>
      </div>
    );
  }

  return (
    <div className="recorder-insights-grid recorder-session-insights">
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
              <div className="stack-item recorder-insight-action" key={`${action.index}-${action.timestamp || ""}`}>
                <div className="recorder-insight-copy">
                  <strong>{action.index}. {action.type}</strong>
                  <span>{privacy.url(action.url)}{action.text || action.value ? ` · ${maskCapturedValue(privacy.actionText(action))}` : ""}</span>
                </div>
                {action.locator ? <code className="execution-operation-json">{privacy.text(action.locator)}</code> : null}
                {onParameterBindingChange && ["navigation", "fill", "change", "select", "press", "upload"].includes(action.type) ? (
                  <div className="recorder-insight-binding">
                  <label className="form-field">
                    <span>Step {action.index} input parameter</span>
                    <select aria-label={`Step ${action.index} input parameter`} disabled={disabled} value={parameterBindings[action.index] || ""} onChange={event => onParameterBindingChange(action.index, event.target.value)}>
                      <option value="">Use captured input or existing step binding</option>
                      {parameters.map(parameter => <option key={parameter.name} value={parameter.token}>{parameter.token}{parameter.sensitive ? " · Private" : ""}</option>)}
                    </select>
                  </label>
                  {onCreateParameter ? <button className="ghost-button compact" disabled={disabled} onClick={() => { setNewParameterAction(action.index); setNewParameterReference(""); setNewParameterValue(""); setNewParameterError(""); }} type="button">New parameter for step {action.index}</button> : null}
                  {newParameterAction === action.index && onCreateParameter ? <div className="recorder-binding-create">
                    <label className="form-field"><span>Parameter reference</span><input aria-label={`New parameter reference for step ${action.index}`} disabled={disabled} placeholder="@t.password, @r.username or @s.account" value={newParameterReference} onChange={event => setNewParameterReference(event.target.value)} /></label>
                    <label className="form-field"><span>Parameter value</span><input aria-label={`New parameter value for step ${action.index}`} autoComplete="new-password" disabled={disabled} type="password" value={newParameterValue} onChange={event => setNewParameterValue(event.target.value)} /></label>
                    {newParameterError ? <p role="alert">{newParameterError}</p> : null}
                    <div className="automation-plan-actions"><button className="ghost-button compact" disabled={disabled} onClick={() => {
                      const error = onCreateParameter(action.index, newParameterReference.trim(), newParameterValue);
                      if (error) { setNewParameterError(error); return; }
                      setNewParameterAction(null); setNewParameterValue(""); setNewParameterError("");
                    }} type="button">Use new parameter</button><button className="ghost-button compact" disabled={disabled} onClick={() => { setNewParameterAction(null); setNewParameterValue(""); }} type="button">Cancel parameter</button></div>
                  </div> : null}
                  </div>
                ) : null}
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
                content="Fetch/XHR evidence collected during recording. Saving a Web recording does not create API steps."
                label="API candidates information"
              />
            </div>
          </div>
          <span className="count-pill">{session.network_count || recentNetwork.length} calls</span>
        </div>
        {recentNetwork.length ? (
          <div className="stack-list recorder-insight-list">
            {recentNetwork.map((entry) => (
              <div className="stack-item recorder-insight-action" key={`${entry.index}-${entry.timestamp || ""}`}>
                <div className="recorder-insight-copy">
                  <strong>{entry.method} {entry.status || "pending"}</strong>
                  <span>{privacy.url(entry.url)} · {entry.resource_type || "api"}</span>
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
