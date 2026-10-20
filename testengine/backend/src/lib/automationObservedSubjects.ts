import { createHash } from 'node:crypto';
import type { ElementHandle, Locator, Page } from 'playwright';
import { resolveRepositoryLocator } from './repositoryLocator.js';

// Browser-side, read-only identity. Values, validity and selection state are
// deliberately excluded: entering data does not change the observed subject.
function readSubject(node: Element, expected: Node | null = null) {
  let complete = true, choiceChars = 0;
  const normalize = (value: string | null) => (value || '').replace(/\s+/g, ' ').trim();
  const bounded = (value: string, limit: number) => value.length <= limit ? value
    : value.slice(0, limit / 2) + `[length:${value.length}]` + value.slice(-limit / 2);
  const attrs = (element: Element, names: string[]) => names.map(name => {
    const value = element.getAttribute(name);
    let identity = value;
    if (name === 'href' && value !== null) try { identity = new URL(value, element.baseURI).href; } catch { /* Keep malformed identity literal. */ }
    if (identity && identity.length > 2_048) { complete = false; identity = identity.slice(0, 2_048); }
    return [name, identity];
  });
  const text = normalize(node.textContent);
  const row = node.closest('tr,[role="row"],li,[role="listitem"],[role="option"]');
  const rowText = row instanceof HTMLElement ? normalize(row.innerText) : '';
  const attributes = attrs(node, ['id', 'name', 'role', 'type', 'data-testid', 'aria-label', 'aria-labelledby', 'placeholder', 'title', 'alt', 'href']);
  const nativeLabels = Array.from((node as HTMLInputElement).labels || []);
  const referenceIds = (node.getAttribute('aria-labelledby') || '').trim().split(/\s+/).filter(Boolean);
  if (nativeLabels.length > 16 || referenceIds.length > 16) complete = false;
  const root = node.getRootNode() as Document | ShadowRoot;
  const references = referenceIds.slice(0, 16).map(id => {
    const matches = root.querySelectorAll(`[id=${JSON.stringify(id)}]`);
    return [id.slice(0, 2_048), matches.length, ...Array.from(matches).slice(0, 2).map(label => normalize(label.textContent))];
  });
  const labelTexts = nativeLabels.slice(0, 16).map(label => normalize(label.textContent));
  if (labelTexts.some(label => label.length > 2_048) || references.some(reference => reference.some(value => typeof value === 'string' && value.length > 2_048))) complete = false;
  const labelChars = labelTexts.reduce<number>((sum, label) => sum + label.length, 0) + references.reduce<number>((sum, reference) => sum + reference.reduce<number>((size, value) => size + (typeof value === 'string' ? value.length : 0), 0), 0);
  if (labelChars > 8_192) complete = false;
  const labels = labelChars > 8_192 ? { incomplete: true } : { native: labelTexts.map(label => label.slice(0, 2_048)), references: references.map(reference => reference.map(value => typeof value === 'string' ? value.slice(0, 2_048) : value)) };
  const context = row ? { tag: row.tagName.toLowerCase(), attributes: attrs(row, ['id', 'role', 'aria-label', 'aria-rowindex', 'data-id', 'data-key', 'data-row-id', 'data-testid']), text: bounded(rowText, 4_096) } : null;
  const choices = node instanceof HTMLSelectElement ? Array.from({ length: Math.min(node.options.length, 256) }, (_, index) => {
    const option = node.options[index], label = normalize(option.label);
    choiceChars += option.value.length + label.length;
    if (choiceChars > 16_384 || option.value.length > 2_048 || label.length > 2_048) { complete = false; return null; }
    return [option.value, label, option.disabled];
  }) : undefined;
  return {
    attached: node.isConnected, same_node: !expected || node === expected, complete: complete && text.length <= 2_048 && rowText.length <= 4_096 && (!(node instanceof HTMLSelectElement) || node.options.length <= 256), tag: node.tagName.toLowerCase(),
    attributes,
    labels,
    text: bounded(text, 2_048), text_excerpt: text.slice(0, 180), text_truncated: text.length > 180,
    ...(node instanceof HTMLSelectElement ? { choices, choice_count: node.options.length } : {}),
    context,
    context_text: rowText.slice(0, 180), context_text_truncated: rowText.length > 180
  };
}

type Subject = { handle: ElementHandle; identity: string; url: string };
async function disposeHandles(handles: ElementHandle[]) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([Promise.all(handles.map(handle => handle.dispose().catch(() => undefined))),
      new Promise<void>(resolve => { timer = setTimeout(resolve, 250); })]);
  } finally { if (timer) clearTimeout(timer); }
}
const fingerprint = (value: Awaited<ReturnType<typeof readSubject>>) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const stale = (code = 'BROWSER_OBSERVED_SUBJECT_CHANGED') => Object.assign(new Error(
  'The observed element or its enclosing record changed before this action. No interaction was dispatched. Inspect a fresh snapshot and select the intended current subject; do not repeat completed actions.'
), { code });

/** Native session-local subjects, never serialized into model context or source.
 * A locator remains a locator; this ledger prevents it silently selecting a new
 * node or a recycled record between observation and a browser mutation. */
export class AutomationObservedSubjects {
  private aliases = new Map<string, Subject>();
  private subjects = new Set<Subject>();
  private enabled = false;

  async clear() {
    const subjects = [...this.subjects];
    this.aliases.clear(); this.subjects.clear();
    await disposeHandles(subjects.map(subject => subject.handle));
  }

  async beginSnapshot() { await this.clear(); this.enabled = true; }

  async observe(target: Locator, element: any, page: Page, deadline: number) {
    let handle: ElementHandle | null = null;
    try {
      if (Date.now() >= deadline) return false;
      handle = await target.elementHandle({ timeout: Math.max(1, Math.min(750, deadline - Date.now())) });
      if (!handle) return false;
      const identity = await target.evaluate(readSubject, handle, { timeout: Math.max(1, Math.min(750, deadline - Date.now())) });
      const originalAttrs = element.attributes || {};
      if (!identity.attached || !identity.same_node || !identity.complete || identity.tag !== element.tag || identity.text_excerpt !== element.text
        || identity.text_truncated !== Boolean(element.text_truncated)
        || identity.attributes.some(([name, value]) => Object.hasOwn(originalAttrs, name!)
          && !element.truncated_attributes?.includes(name) && originalAttrs[name!] !== value)) return false;
      if (identity.context_text) {
        element.context_text = identity.context_text;
        if (identity.context_text_truncated) element.context_text_truncated = true;
      }
      const subject: Subject = { handle, identity: fingerprint(identity), url: page.url() };
      this.subjects.add(subject);
      for (const candidate of element.locator_candidates) this.aliases.set(candidate.trim(), subject);
      handle = null;
      return true;
    } catch { return false; }
    finally { if (handle) await disposeHandles([handle]); }
  }

  async resolve(page: Page, candidate: string, deadline: number) {
    if (!this.enabled) return null; // Existing direct clients without a snapshot retain their locator contract.
    let subject = this.aliases.get(candidate.trim());
    // Formatting or equivalent CSS may differ from the advertised aliases.
    // Accept it only when it resolves to one of the same captured native nodes.
    if (!subject && Date.now() < deadline) {
      const subjects = [...this.subjects];
      try {
        const locator = resolveRepositoryLocator(page, candidate);
        if (await locator.count() === 1) {
          const index = await locator.evaluate((node, handles) => handles.findIndex(handle => node === handle), subjects.map(item => item.handle), { timeout: Math.max(1, Math.min(750, deadline - Date.now())) });
          if (index >= 0) subject = subjects[index];
        }
      } catch { /* An unobserved or invalid target receives no execution grant. */ }
    }
    if (!subject || page.url() !== subject.url) throw stale('BROWSER_OBSERVED_SUBJECT_REQUIRED');
    try {
      const locator = resolveRepositoryLocator(page, candidate);
      if (Date.now() >= deadline || await locator.count() !== 1) throw stale();
      const identity = await locator.evaluate(readSubject, subject.handle, { timeout: Math.max(1, Math.min(750, deadline - Date.now())) });
      if (!identity.same_node || !identity.complete || fingerprint(identity) !== subject.identity) throw stale();
      return subject.handle;
    } catch (error) {
      if (error instanceof Error && 'code' in error && String(error.code).startsWith('BROWSER_OBSERVED_SUBJECT_')) throw error;
      throw stale();
    }
  }
}
