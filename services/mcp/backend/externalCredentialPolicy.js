"use strict";

// Project-bound manual credentials remain available only for local development.
// Production requires the first-party OAuth authorization-code flow with PKCE.
const oauthEnabled = (env = process.env) => {
  if (env.HELLOTEST_MCP_OAUTH_ENABLED !== "true") return false;
  if (env.NODE_ENV !== "production") return true;
  try {
    const url = new URL(env.HELLOTEST_MCP_PUBLIC_URL || "");
    return url.protocol === "https:" && url.pathname.endsWith("/mcp") && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
};
const externalCredentialsEnabled = (env = process.env) => env.NODE_ENV !== "production" || oauthEnabled(env);
const manualCredentialIssuanceEnabled = (env = process.env) => env.NODE_ENV !== "production";

const unavailable = () => Object.assign(
  new Error("External MCP credentials are disabled until OAuth is configured for this deployment."),
  { statusCode: 503, code: "MCP_OAUTH_REQUIRED", publicMessage: "External MCP credentials are disabled until OAuth is configured for this deployment." }
);

module.exports = { externalCredentialsEnabled, manualCredentialIssuanceEnabled, oauthEnabled, unavailable };
