import { useEffect, useMemo, useState } from "react";
import { IconArrowUpRight, IconCheck, IconShieldCheck } from "@tabler/icons-react";
import { useAuth } from "../../auth/AuthContext";
import { api } from "../../lib/api";
import { request } from "../../lib/httpClient";
import type { Project } from "../../types";
import "./McpOAuthAuthorizePage.css";

type OAuthRequest = {
  request_id: string;
  client_name: string;
  redirect_uri: string;
  resource: string;
  scopes: string[];
  expires_at: string;
};

type OAuthRequestParams = {
  response_type: string | null;
  client_id: string | null;
  redirect_uri: string | null;
  state: string | null;
  scope: string | null;
  resource: string | null;
  code_challenge: string | null;
  code_challenge_method: string | null;
};

const TOOL_SET_LABELS: Record<string, { title: string; description: string; readOnly: boolean }> = {
  knowledge: { title: "Knowledge", description: "Cited knowledge, graph paths and recorded context", readOnly: true },
  records: { title: "Project records", description: "Read project details, test cases, runs and defects", readOnly: true },
  actions: { title: "Reviewed actions", description: "Prepare changes for a person to approve in HelloTest", readOnly: false },
  automation: { title: "Automation", description: "Prepare automation builds and browser missions for review", readOnly: false }
};

const oauthRequestFromSearch = (search: string): OAuthRequestParams => {
  const query = new URLSearchParams(search);
  return {
    response_type: query.get("response_type"),
    client_id: query.get("client_id"),
    redirect_uri: query.get("redirect_uri"),
    state: query.get("state"),
    scope: query.get("scope"),
    resource: query.get("resource"),
    code_challenge: query.get("code_challenge"),
    code_challenge_method: query.get("code_challenge_method")
  };
};

export function McpOAuthAuthorizePage({ search }: { search: string }) {
  const { session } = useAuth();
  const params = useMemo(() => oauthRequestFromSearch(search), [search]);
  const [authorization, setAuthorization] = useState<OAuthRequest | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setAuthorization(null);
    setProjects([]);
    setProjectId("");
    setSelectedScopes([]);
    setError("");
    if (Object.values(params).some(value => !value)) {
      setError("The MCP host sent an incomplete authorization request. Close this page and reconnect from the host.");
      setLoading(false);
      return () => { active = false; };
    }
    void Promise.all([
      api.projects.list(),
      request<OAuthRequest>("/agentic-workflows/mcp/oauth/authorize-request", {
        method: "POST",
        body: JSON.stringify(params)
      })
    ]).then(([availableProjects, createdRequest]) => {
      if (!active) return;
      const eligibleProjects = availableProjects.filter(project => project.has_access !== false);
      setProjects(eligibleProjects);
      // A host must not inherit an arbitrary first project. Consent is a project boundary,
      // so the person has to choose it deliberately before authorization can be submitted.
      setProjectId("");
      setAuthorization(createdRequest);
      setSelectedScopes(createdRequest.scopes);
    }).catch(failure => {
      if (!active) return;
      setError(failure instanceof Error ? failure.message : "The MCP authorization request could not be loaded.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [params]);

  const toggleScope = (scope: string) => {
    setSelectedScopes(current => {
      if (current.includes(scope)) {
        const removed = new Set([scope]);
        if (scope === "records") {
          removed.add("actions");
          removed.add("automation");
        }
        return current.filter(value => !removed.has(value));
      }
      const next = new Set(current);
      next.add(scope);
      if (scope === "actions" || scope === "automation") next.add("records");
      return authorization?.scopes.filter(value => next.has(value)) || [...next];
    });
  };

  const decide = async (approved: boolean) => {
    if (!authorization || busy) return;
    if (approved && !projectId) {
      setError("Choose the project this host can access.");
      return;
    }
    if (approved && !selectedScopes.length) {
      setError("Select at least one tool set, or deny this request.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await request<{ redirect_to: string }>(
        `/agentic-workflows/mcp/oauth/authorize-request/${encodeURIComponent(authorization.request_id)}/decision`,
        {
          method: "POST",
          body: JSON.stringify({ approved, projectId, scopes: selectedScopes })
        }
      );
      window.location.assign(result.redirect_to);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Your choice could not be saved. Try again.");
      setBusy(false);
    }
  };

  const clientHost = authorization ? (() => {
    try { return new URL(authorization.redirect_uri).host || new URL(authorization.redirect_uri).protocol.slice(0, -1); }
    catch { return authorization.redirect_uri; }
  })() : "";

  return (
    <main className="mcp-oauth-page">
      <section className="mcp-oauth-card" aria-labelledby="mcp-oauth-title">
        <div className="mcp-oauth-brand" aria-label="HelloTest">
          <span className="mcp-oauth-brand-mark">H</span>
          <span>HelloTest</span>
        </div>

        {loading ? (
          <div className="mcp-oauth-loading" role="status">Checking the MCP host request…</div>
        ) : error && !authorization ? (
          <div className="mcp-oauth-error-state" role="alert">
            <div className="mcp-oauth-icon mcp-oauth-icon--error"><IconShieldCheck size={23} /></div>
            <h1 id="mcp-oauth-title">Unable to connect this host</h1>
            <p>{error}</p>
          </div>
        ) : authorization ? (
          <>
            <div className="mcp-oauth-icon"><IconShieldCheck size={23} /></div>
            <p className="mcp-oauth-eyebrow">Secure MCP connection</p>
            <h1 id="mcp-oauth-title">Connect {authorization.client_name}</h1>
            <p className="mcp-oauth-intro">
              This host is requesting access to HelloTest as <strong>{session?.user.email}</strong>.
              It will only see the tool sets and project you approve below.
            </p>

            <label className="mcp-oauth-label" htmlFor="mcp-oauth-project">Project access</label>
            <select id="mcp-oauth-project" value={projectId} onChange={event => setProjectId(event.target.value)} disabled={busy || !projects.length}>
              <option value="" disabled>Choose a project</option>
              {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
            {!projects.length && <p className="mcp-oauth-hint">No project is available to this account.</p>}

            <fieldset className="mcp-oauth-scopes">
              <legend>Tool access</legend>
              {authorization.scopes.map(scope => {
                const details = TOOL_SET_LABELS[scope] || { title: scope, description: "MCP tool access", readOnly: true };
                return (
                  <label className="mcp-oauth-scope" key={scope}>
                    <input type="checkbox" checked={selectedScopes.includes(scope)} onChange={() => toggleScope(scope)} disabled={busy} />
                    <span className="mcp-oauth-scope-copy">
                      <span className="mcp-oauth-scope-title">{details.title}<span className={details.readOnly ? "mcp-oauth-scope-badge" : "mcp-oauth-scope-badge mcp-oauth-scope-badge--review"}>{details.readOnly ? "Read only" : "Human review"}</span></span>
                      <span className="mcp-oauth-scope-description">{details.description}</span>
                    </span>
                  </label>
                );
              })}
            </fieldset>

            {(authorization.scopes.includes("actions") || authorization.scopes.includes("automation")) && (
              <p className="mcp-oauth-review-note"><IconCheck size={16} /> Changes still require your approval in HelloTest. This host cannot approve its own plans.</p>
            )}

            <div className="mcp-oauth-client-destination">
              <span>Returning to</span>
              <span title={authorization.redirect_uri}>{clientHost}<IconArrowUpRight size={14} /></span>
            </div>

            {error && <p className="mcp-oauth-inline-error" role="alert">{error}</p>}

            <div className="mcp-oauth-actions">
              <button type="button" className="mcp-oauth-button mcp-oauth-button--secondary" onClick={() => void decide(false)} disabled={busy}>
                Deny
              </button>
              <button type="button" className="mcp-oauth-button mcp-oauth-button--primary" onClick={() => void decide(true)} disabled={busy || !projectId || !selectedScopes.length}>
                {busy ? "Connecting…" : "Authorize host"}
              </button>
            </div>
          </>
        ) : null}

        <p className="mcp-oauth-footer">Access is project scoped and can be revoked from MCP connections in HelloTest.</p>
      </section>
    </main>
  );
}
