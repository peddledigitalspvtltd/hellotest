export const TAB_IDENTITY_SCHEMA = "hellotest.tab-identity.v1";
export type AutomationTabIdentity = { schema: typeof TAB_IDENTITY_SCHEMA; url: string };

/** v1 retains unknown query data and SPA routes. Keep this independently
 * packaged implementation aligned with the native receipt/export contract. */
export function canonicalAutomationTabUrl(value: string): string | undefined {
  if (typeof value !== "string" || value.length > 16384) return;
  let url: URL; try { url = new URL(value); } catch { return; }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return;
  const amazon = /(?:^|\.)amazon\.(?:com|ca|in|de|fr|it|es|nl|se|pl|sg|ae|sa|ie|co\.uk|co\.jp|com\.au|com\.br|com\.mx|com\.tr|com\.be|co\.za)$/.test(url.hostname);
  const marketing = new Set(["gclid", "dclid", "fbclid", "msclkid", "mc_cid", "mc_eid", "_ga", "_gl"]);
  const amazonTracking = new Set(["qid", "ref", "ref_", "sr", "sprefix", "crid", "dib", "dib_tag", "tag", "linkcode", "linkid", "camp", "creative", "creativeasin", "ascsubtag"]);
  const normalize = (query: URLSearchParams) => {
    for (const key of new Set(query.keys())) {
      const normalized = key.toLowerCase();
      if (normalized.startsWith("utm_") || marketing.has(normalized) || amazon && (amazonTracking.has(normalized) || /^(?:pd|pf)_rd_/.test(normalized))) query.delete(key);
    }
    query.sort(); return query.toString();
  };
  url.search = normalize(url.searchParams);
  const hashQuery = url.hash.indexOf("?");
  if (/^#!?\//.test(url.hash) && hashQuery >= 0) {
    const query = normalize(new URLSearchParams(url.hash.slice(hashQuery + 1)));
    url.hash = url.hash.slice(0, hashQuery) + (query ? "?" + query : "");
  }
  return url.href;
}

export function automationTabIdentityUrl(identity: AutomationTabIdentity): string {
  const url = identity && identity.schema === TAB_IDENTITY_SCHEMA && canonicalAutomationTabUrl(identity.url);
  if (!url) throw new Error("Unsupported or invalid browser tab identity. No tab selection was performed.");
  return url;
}
