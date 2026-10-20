const { browserReceipt, isBrowserActionTool } = require('./automationInteractiveEvidence');
const { browserCurrentSnapshotObservation } = require('./automationBrowserContext');
const { recordedSectionRequests } = require('./automationBrowserRecording');
const { referenceKey, parameterReference } = require('./automationBrowserParameters');

const URL_LIMIT = 2000, DISCLOSURE_LIMIT = 12, DISCLOSURE_CHARS = 4000;
const privacyMask = /\[(?:private parameter (?:value|reference)|redacted(?:_[a-z]+)?)\]/i;
function normalizedUrl(value, base) {
  if (typeof value !== 'string' || !value || value.length > URL_LIMIT || value !== value.trim() || privacyMask.test(value)) return null;
  try {
    const url = base ? new URL(value, base) : new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && url.href.length <= URL_LIMIT ? url.href : null;
  } catch { return null; }
}
function trimLiteral(value) {
  let text = value.replace(/[.,;!]+$/, '');
  for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']]) {
    while (text.endsWith(close) && text.split(close).length > text.split(open).length) text = text.slice(0, -1);
  }
  return text;
}
function sourceLiteral(text, match) {
  const delimiter = text[match.index - 1];
  return ['"', "'", '`'].includes(delimiter) && text[match.index + match[0].length] === delimiter ? match[0] : trimLiteral(match[0]);
}
function authoredUrlLiterals(execution) {
  const absolute = new Set(), relative = new Set();
  const rows = [execution, ...(Array.isArray(execution?.obligations) ? execution.obligations : [])];
  for (const row of rows) for (const value of [row?.action, row?.expected_result]) {
    if (typeof value !== 'string') continue;
    for (const match of value.matchAll(/https?:\/\/[^\s<>"'`]+/gi)) {
      const url = normalizedUrl(sourceLiteral(value, match));if (url) absolute.add(url);
    }
    // A slash-prefixed literal is explicit route syntax. Ordinary page labels,
    // headings and words never become route candidates.
    // Query/fragment path strings inside an absolute URL are not independently
    // authored routes (for example ?return=/admin).
    // Saved manual steps may be rich text. Closing tags such as </p> and
    // markup attributes are formatting, never authored relative destinations.
    // Keep offsets stable for quoted-literal handling and leave exact absolute
    // URL handling above independent of this relative-path scan.
    const relativeText = value.replace(/<!--(?:[\s\S]*?-->|[\s\S]*$)|<[^>]*>/g, match => ' '.repeat(match.length))
      .replace(/https?:\/\/[^\s<>"'`]+/gi, match => ' '.repeat(match.length));
    for (const match of relativeText.matchAll(/(?<![A-Za-z0-9:/])(?:\.\.\/|\.\/|\/)[^\s<>"'`]+/g)) {
      const path = sourceLiteral(value, match);if (path.length <= URL_LIMIT && !privacyMask.test(path)) relative.add(path);
    }
  }
  return { absolute, relative };
}

/** Navigation authority comes from the host's current specification and real
 * browser evidence. A model-proposed path is never its own URL provenance. */
function createAutomationNavigationGrounding({ startUrl, execution, projectText = value => value, projectPrivateText = value => value } = {}) {
  const configured = normalizedUrl(startUrl), authored = authoredUrlLiterals(execution);
  const parameterUrls = new Map();
  // These names come from ORIGINAL pinned source, before parameter projection.
  // Do not rescan projected prose: inserted public literals can contain @tokens.
  for (const name of Array.isArray(execution?.navigation_parameter_references) ? execution.navigation_parameter_references : []) {
    const key = referenceKey(name) || referenceKey(parameterReference(name));
    if (!key || parameterUrls.has(key)) continue;
    try {
      const url = normalizedUrl(projectText(parameterReference(key)));
      if (url) parameterUrls.set(key, url);
    } catch { /* An unavailable binding grants no navigation authority. */ }
  }
  const grounds = observations => {
    const urls = new Map();
    const add = (value, source, base) => { const url = normalizedUrl(value, base);if (url && !urls.has(url)) urls.set(url, source); };
    add(configured, 'configured_start');
    for (const url of authored.absolute) add(url, 'current_requirement');
    for (const url of parameterUrls.values()) add(url, 'current_requirement');
    for (const observation of observations) {
      if (observation?.mcp_call === false || !observation?.tool?.startsWith('browser_')) continue;
      const receipt = browserReceipt(observation);if (!receipt) continue;
      if (isBrowserActionTool(observation.tool) && receipt.action_outcome === 'completed' && !receipt.url_truncated) add(receipt.url, 'observed_history');
      // Preserve the actual requested entry URL when the application redirects
      // it. Serialized/model-authored arguments cannot manufacture this record.
      const operation = recordedSectionRequests([observation], observation.execution_step_id)[0];
      if (operation?.name === 'browser_navigate') add(operation.arguments.url, 'observed_history');
    }
    const snapshot = browserCurrentSnapshotObservation(observations), page = snapshot && browserReceipt(snapshot);
    const currentUrl = page?.url_truncated ? null : normalizedUrl(page?.url);
    if (currentUrl) urls.set(currentUrl, 'current_page');
    const base = page?.url_truncated ? null : currentUrl || configured;
    for (const path of authored.relative) if (base) add(path, 'current_requirement', base);
    for (const element of Array.isArray(page?.elements) ? page.elements : []) {
      if (!element || element.locators_validated !== true || !element.locator_candidates?.some(value => typeof value === 'string' && value)
        || element.displayed === false || !['a', 'area'].includes(element.tag) && !['link'].includes(element.accessible_role || element.role)
        || element.href_truncated || element.truncated_attributes?.includes('href')) continue;
      const href = element.attributes?.href;
      if (typeof href === 'string') add(href, 'observed_link', base || undefined);
    }
    return urls;
  };
  const disclose = urls => {
    const rows = [];let chars = 0;
    for (const [url, source] of urls) {
      let projected;try { projected = projectPrivateText(url); } catch { continue; }
      // A redacted URL is useful neither as a navigation argument nor as a
      // public hint. Keep its authority local without copying private values.
      if (projected !== url || rows.length >= DISCLOSURE_LIMIT || chars + url.length > DISCLOSURE_CHARS) continue;
      rows.push({ url, source });chars += url.length;
    }
    return { grounded_urls: rows, grounded_urls_truncated: rows.length < urls.size };
  };
  const context = (observations = []) => ({ grounding_required: true, ...disclose(grounds(observations)),
    invented_routes_allowed: false, observed_link_guidance: 'Use a current observed link target through browser_click when its exact href is unavailable. A page label, form heading or document title does not authorize an inferred URL.' });
  const inspect = ({ url, observations = [] } = {}) => {
    const urls = grounds(observations), key = referenceKey(url);
    // Bind once from the original source-name provenance. Unscoped/arbitrary
    // references and tokens inside a URL literal cannot grant another route.
    const target = key ? parameterUrls.get(key) : normalizedUrl(url);
    if (target && urls.has(target)) return { allowed: true, url: target };
    return { allowed: false, feedback: { code: 'AUTOMATION_NAVIGATION_URL_NOT_GROUNDED', step_id: execution?.step_id,
      action_outcome: 'not_attempted', retry_safe: true, ...disclose(urls),
      message: 'This URL is not present in the current manual requirements, configured entry URL or observed browser evidence. No navigation was attempted; the current page and completed work remain available. Use an exact grounded URL or click a current observed link, then complete only unfinished work.' } };
  };
  return { context, inspect };
}

module.exports = { createAutomationNavigationGrounding };
