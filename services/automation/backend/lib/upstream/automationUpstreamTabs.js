const denied = message => Object.assign(new Error(message), { code: 'AUTOMATION_UPSTREAM_TOOL_INVALID', statusCode: 422, nonRetryable: true });
const text = result => (result?.content || []).filter(block => block.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n');
const TAB_IDENTITY_SCHEMA = 'hellotest.tab-identity.v1';

/** v1 keeps unknown query keys and SPA routes. Only recognized marketing keys
 * and Amazon navigation tracking are non-identifying; qid elsewhere is data.
 * The independently packaged runner/export implement this versioned contract. */
function canonicalAutomationTabUrl(value) {
  if (typeof value !== 'string' || value.length > 16384) return;
  let url; try { url = new URL(value); } catch { return; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return;
  const amazon = /(?:^|\.)amazon\.(?:com|ca|in|de|fr|it|es|nl|se|pl|sg|ae|sa|ie|co\.uk|co\.jp|com\.au|com\.br|com\.mx|com\.tr|com\.be|co\.za)$/.test(url.hostname);
  const marketing = new Set(['gclid', 'dclid', 'fbclid', 'msclkid', 'mc_cid', 'mc_eid', '_ga', '_gl']);
  const amazonTracking = new Set(['qid', 'ref', 'ref_', 'sr', 'sprefix', 'crid', 'dib', 'dib_tag', 'tag', 'linkcode', 'linkid', 'camp', 'creative', 'creativeasin', 'ascsubtag']);
  const normalize = query => {
    for (const key of new Set(query.keys())) {
      const normalized = key.toLowerCase();
      if (normalized.startsWith('utm_') || marketing.has(normalized) || amazon && (amazonTracking.has(normalized) || /^(?:pd|pf)_rd_/.test(normalized))) query.delete(key);
    }
    query.sort(); return query.toString();
  };
  url.search = normalize(url.searchParams);
  const hashQuery = url.hash.indexOf('?');
  if (/^#!?\//.test(url.hash) && hashQuery >= 0) {
    const query = normalize(new URLSearchParams(url.hash.slice(hashQuery + 1)));
    url.hash = url.hash.slice(0, hashQuery) + (query ? '?' + query : '');
  }
  return url.href;
}

/** Native tab headers are the authority for selecting an existing owned tab.
 * Tab selection has no upstream code snippet, so retain an explicit portable
 * host receipt instead of pretending the provider emitted executable source. */
function createUpstreamTabTracker(startUrl) {
  const origin = new URL(startUrl).origin;
  let observed = new Map();
  const observe = (result, tool) => {
    if (result?.isError) return;
    const body = text(result);
    const header = body.match(tool === 'browser_tabs'
      ? /(?:^|\n)### Result\s*\n([\s\S]*?)(?=\n### |$)/
      : /(?:^|\n)### Open tabs\s*\n([\s\S]*?)(?=\n### |$)/)?.[1];
    if (!header) return;
    const tabs = new Map();
    for (const line of header.split('\n')) {
      const row = line.match(/^- (\d+):\s*(\(current\)\s*)?\[[^\r\n]*\]\((https?:\/\/[^\r\n]*)\)(?:\s*\[[^\r\n]*\])*\s*$/);
      if (!row) continue;
      try { const url = new URL(row[3]); tabs.set(Number(row[1]), { index: Number(row[1]), current: Boolean(row[2]), url }); } catch {}
    }
    observed = tabs;
  };
  const target = args => {
    if (!Number.isSafeInteger(args.index) || args.index < 0 || args.index > 100 || !observed.has(args.index)) {
      throw denied('Portable runtime tab selection requires the exact index from a current native tab listing. No tab action was dispatched.');
    }
    const tab = observed.get(args.index);
    if (tab.url.origin !== origin || tab.url.username || tab.url.password) throw denied('Select only an observed existing tab within the reviewed application origin. No tab action was dispatched.');
    const identityUrl = canonicalAutomationTabUrl(tab.url.href);
    if (!identityUrl || [...observed.values()].filter(value => canonicalAutomationTabUrl(value.url.href) === identityUrl).length !== 1) {
      throw denied('The observed tab has no unique semantic URL identity. Inspect a uniquely identified application tab before selecting it. No tab action was dispatched.');
    }
    return tab;
  };
  return {
    observe,
    assert: target,
    receipt(args, result) {
      const before = target(args);
      observe(result, 'browser_tabs');
      const selected = target(args);
      const url = canonicalAutomationTabUrl(selected.url.href);
      if (!selected.current || url !== canonicalAutomationTabUrl(before.url.href)) throw denied('The native response did not confirm selection of the reviewed tab identity. Inspect its current state before continuing.');
      const identity = { schema: TAB_IDENTITY_SCHEMA, url };
      return { code: `await web.switchTab(${JSON.stringify({ index: selected.index, identity })});`,
        receipt: { provider: 'hellotest.native_tab_selection', index: selected.index, url, identity, upstream_tool: 'browser_tabs', confirmed: true } };
    }
  };
}

module.exports = { createUpstreamTabTracker, canonicalAutomationTabUrl, TAB_IDENTITY_SCHEMA };
