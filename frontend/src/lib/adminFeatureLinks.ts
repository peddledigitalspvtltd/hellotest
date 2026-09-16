type AdminFeatureLinkOptions = {
  origin?: string;
  configuredBaseUrl?: string;
};

/** Link to the dedicated administration app without carrying workspace state. */
export function getAdminFeatureUrl(featureKey: string, options: AdminFeatureLinkOptions = {}) {
  const origin = options.origin || window.location.origin;
  const runtime = window.__HELLOTEST_CONFIG__ as { ADMIN_BASE_URL?: string } | undefined;
  const configured = options.configuredBaseUrl ?? runtime?.ADMIN_BASE_URL ?? import.meta.env.VITE_ADMIN_BASE_URL;
  let base = new URL("/admin/", origin);
  if (base.port === "5173") base.port = "5174";
  if (base.port === "8080") { base.port = "8081"; base.pathname = "/"; }
  if (configured) {
    try {
      const candidate = new URL(configured, origin);
      if (["http:", "https:"].includes(candidate.protocol) && !candidate.username && !candidate.password) base = candidate;
    } catch { /* Keep the known administration location. */ }
  }
  base.search = "";
  base.hash = "";
  base.searchParams.set("section", "features");
  if (featureKey.trim()) base.searchParams.set("feature", featureKey.trim());
  return base.toString();
}
