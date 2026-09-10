import { useLayoutEffect, useRef, useState } from "react";
import { IconCheck, IconAlertTriangle, IconPlugConnected, IconX } from "@tabler/icons-react";
import { api } from "../lib/api";
import { integrationConnectionHint, type IntegrationConnectionInput, type IntegrationConnectionResult } from "../lib/integrationConnection";
import "./IntegrationConnectionTest.css";

const labels = { passed: "Passed", warning: "Limited check", failed: "Failed" };
export function IntegrationConnectionTest({ input, scopeKey, name, saved = false, disabled = false }: {
  input: IntegrationConnectionInput; scopeKey: string; name?: string; saved?: boolean; disabled?: boolean;
}) {
  const identity = JSON.stringify([scopeKey, input, disabled]);
  const active = useRef<AbortController | null>(null);
  const [state, setState] = useState<{ identity: string; pending?: boolean; result?: IntegrationConnectionResult; error?: string } | null>(null);
  useLayoutEffect(() => {
    active.current = null;
    return () => { active.current?.abort(); active.current = null; };
  }, [identity]);
  const visible = state?.identity === identity ? state : null;
  const testConnection = async () => {
    if (disabled || active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setState({ identity, pending: true });
    const current = () => active.current === controller && !controller.signal.aborted;
    try {
      const result = await api.integrations.testConnection(input, { signal: controller.signal });
      if (!current()) return;
      if (!result || !["passed", "warning", "failed"].includes(result.status) || !Array.isArray(result.checks)) throw new Error("The service returned an incomplete connection check. Refresh and try again.");
      setState({ identity, result });
    } catch (error) {
      if (current()) setState({ identity, error: error instanceof Error ? error.message : "The connection check could not complete. Review the settings and retry." });
    } finally { if (current()) active.current = null; }
  };
  const result = visible?.result;
  return <section className="integration-connection-test" aria-label={name ? `Connection check for ${name}` : "Integration connection check"}>
    <div className="integration-connection-test-header">
      <div><strong>{name ? `Check ${name}` : "Check this connection"}</strong><p>{integrationConnectionHint[input.type]}</p><small>{saved ? "Uses the saved profile and stored credentials." : "Tests these draft settings without saving. Stored credentials are used when unchanged."}</small></div>
      <button className="ghost-button" type="button" disabled={disabled || Boolean(visible?.pending)} onClick={() => void testConnection()}><IconPlugConnected size={16} aria-hidden="true" />{visible?.pending ? "Testing connection…" : result || visible?.error ? "Test again" : "Test connection"}</button>
    </div>
    {visible?.pending ? <p className="integration-connection-pending" role="status">Checking provider access and capabilities… You can continue editing.</p> : null}
    {visible?.error ? <div className="integration-connection-outcome is-failed" role="alert"><strong><IconX size={17} aria-hidden="true" />Could not complete the check</strong><p>{visible.error}</p><small>Review the connection settings, then test again.</small></div> : null}
    {result ? <div className={`integration-connection-outcome is-${result.status}`} role={result.status === "failed" ? "alert" : "status"}>
      <div className="integration-connection-result-heading"><strong>{result.status === "passed" ? <IconCheck size={17} aria-hidden="true" /> : result.status === "failed" ? <IconX size={17} aria-hidden="true" /> : <IconAlertTriangle size={17} aria-hidden="true" />}{labels[result.status]}</strong><small>{Number.isFinite(result.latency_ms) ? `${Math.round(result.latency_ms)} ms` : ""}{result.checked_at && Number.isFinite(Date.parse(result.checked_at)) ? ` · ${new Date(result.checked_at).toLocaleTimeString()}` : ""}</small></div>
      <p>{result.summary}</p>
      <ul>{result.checks.map((check) => <li key={check.id}><div><strong>{check.label}</strong><span className={`integration-connection-check-status is-${check.status}`}>{labels[check.status]}</span></div><p>{check.detail}</p></li>)}</ul>
      {result.next_step ? <p className="integration-connection-next"><strong>Next step</strong>{result.next_step}</p> : null}
    </div> : null}
  </section>;
}
