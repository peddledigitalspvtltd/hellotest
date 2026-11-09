import type { Page, Frame, ElementHandle, JSHandle } from 'playwright';
import {randomUUID} from 'node:crypto';

export const AUTOMATION_FRAME_DEPTH = 3;
const FRAME_LIMIT = 12;
export const validAutomationFramePath = (path: unknown): path is string[] => Array.isArray(path)
  && path.length > 0 && path.length <= AUTOMATION_FRAME_DEPTH
  && path.every(selector => typeof selector === 'string' && selector.trim().length > 0 && selector.length <= 2_000);
type FrameRow = { path: string[]; url: string; title: string; frame_document_id: string };
type ObservedFrame = FrameRow & { frame: Frame; owner: ElementHandle; document: JSHandle; parent: Page | Frame };
const invalid = (stale = false) => Object.assign(new Error(stale
  ? 'The observed embedded document changed or detached. Inspect a fresh top-level snapshot and its frame inventory before continuing; do not repeat completed actions.'
  : 'Frame scope must match a unique visible same-origin frame path from a recent top-level snapshot. Inspect the frame inventory before selecting an embedded document.'),
{ code: stale ? 'BROWSER_FRAME_STALE' : 'BROWSER_FRAME_NOT_OBSERVED' });

/** Host-owned document identities. A selector alone never grants a new frame scope. */
export class AutomationFrameInventory {
  private entries = new Map<string, ObservedFrame>();
  private epochs = new Map<Frame, {document: JSHandle; id: string}>();
  private topDocument?: JSHandle;
  async clear() {
    const entries = [...this.entries.values()]; this.entries.clear();
    await Promise.all([...entries.map(row => row.owner), ...[...this.epochs.values()].map(epoch => epoch.document), ...(this.topDocument ? [this.topDocument] : [])]
      .map(handle => handle.dispose().catch(() => undefined)));
    this.epochs.clear();
    this.topDocument = undefined;
  }
  rows(): FrameRow[] { return [...this.entries.values()].map(({path,url,title,frame_document_id}) => ({path:[...path],url,title,frame_document_id})); }
  metadata(path: string[]) {
    const row = this.entries.get(JSON.stringify(path));
    return row ? {frame_path:[...row.path],frame_url:row.url,frame_document_id:row.frame_document_id} : {};
  }
  async refresh(page: Page, origin: string, deadline: number) {
    await Promise.all([...this.entries.values()].map(row => row.owner.dispose().catch(() => undefined)));
    this.entries.clear();
    await this.topDocument?.dispose().catch(() => undefined);
    this.topDocument = await page.evaluateHandle(() => document);
    const scan = async (parent: Page | Frame, prefix: string[]) => {
      if (prefix.length >= AUTOMATION_FRAME_DEPTH || this.entries.size >= FRAME_LIMIT || Date.now() >= deadline) return;
      const frames = parent.locator('iframe,frame');
      for (let index = 0, count = Math.min(await frames.count(), 30); index < count && this.entries.size < FRAME_LIMIT && Date.now() < deadline; index++) {
        const target = frames.nth(index); let owner: ElementHandle | null = null, documentHandle: JSHandle | undefined;
        try {
          if (!await target.isVisible()) continue;
          const selector = await target.evaluate(element => {
            const unique = (value: string) => element.ownerDocument.querySelectorAll(value).length === 1;
            for (const name of ['id','data-testid','name']) {
              const value = element.getAttribute(name);
              if (!value || value.length > 500) continue;
              const selector = name === 'id' ? '#' + CSS.escape(value) : element.tagName.toLowerCase() + '[' + name + '=' + JSON.stringify(value) + ']';
              if (unique(selector)) return selector;
            }
            const chain: string[] = [];
            for (let node: Element | null = element; node && chain.length < 12; node = node.parentElement) {
              const siblings = node.parentElement ? Array.from(node.parentElement.children).filter(sibling => sibling.tagName === node!.tagName) : [node];
              chain.unshift(node.tagName.toLowerCase() + (siblings.length > 1 ? ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')' : ''));
              if (unique(chain.join(' > '))) return chain.join(' > ');
            }
            return '';
          }, undefined, {timeout: Math.max(1, Math.min(750, deadline-Date.now()))});
          if (!selector || selector.length > 2_000 || await parent.locator(selector).count() !== 1) continue;
          owner = await target.elementHandle({timeout: Math.max(1, Math.min(750, deadline-Date.now()))});
          const frame = await owner?.contentFrame();
          if (!frame || frame.isDetached()) continue;
          const metadata = await frame.evaluate(() => ({origin:self.origin,url:location.href,title:document.title}));
          if (metadata.origin !== origin || new URL(metadata.url).origin !== origin || metadata.url.length > 2_000) continue;
          const path = [...prefix, selector];
          if (Buffer.byteLength(JSON.stringify([...this.rows(),{path,url:metadata.url,title:metadata.title.slice(0,200),frame_document_id:'x'.repeat(36)}])) > 12_000) continue;
          documentHandle = await frame.evaluateHandle(() => document);
          const previous = this.epochs.get(frame);
          const sameDocument = previous && await frame.evaluate(previousDocument => previousDocument === document, previous.document).catch(() => false);
          const frame_document_id = sameDocument ? previous.id : randomUUID();
          this.epochs.set(frame,{document:documentHandle,id:frame_document_id});
          await previous?.document.dispose().catch(() => undefined);
          this.entries.set(JSON.stringify(path), {path,url:metadata.url,title:metadata.title.slice(0,200),frame_document_id,frame,owner:owner!,document:documentHandle,parent});
          owner = null; documentHandle = undefined;
          await scan(frame, path);
        } catch { /* Loading, hidden, detached, opaque and cross-origin frames grant no scope. */ }
        finally { await owner?.dispose().catch(() => undefined); await documentHandle?.dispose().catch(() => undefined); }
      }
    };
    await scan(page, []);
    const observed = new Set([...this.entries.values()].map(entry => entry.frame));
    for (const [frame,epoch] of this.epochs) if (!observed.has(frame)) { this.epochs.delete(frame); await epoch.document.dispose().catch(() => undefined); }
    return this.rows();
  }
  async resolve(page: Page, path: string[], origin: string, deadline: number): Promise<Frame> {
    if (!validAutomationFramePath(path) || !this.entries.has(JSON.stringify(path))) throw invalid();
    try {
      if (!this.topDocument || !await page.evaluate(documentHandle => documentHandle === document, this.topDocument)) throw invalid(true);
      let frame: Frame | undefined;
      for (let depth = 1; depth <= path.length; depth++) {
        const entry = this.entries.get(JSON.stringify(path.slice(0,depth)));
        if (!entry || Date.now() >= deadline || entry.frame.isDetached()) throw invalid(true);
        const target = entry.parent.locator(path[depth-1]);
        if (await target.count() !== 1 || !await target.isVisible()
          || !await target.evaluate((element, owner) => element === owner, entry.owner, {timeout:Math.max(1,Math.min(750,deadline-Date.now()))})
          || !await entry.frame.evaluate(documentHandle => documentHandle === document, entry.document)
          || await entry.frame.evaluate(() => self.origin) !== origin || entry.frame.url() !== entry.url) throw invalid(true);
        frame = entry.frame;
      }
      return frame!;
    } catch { throw invalid(true); }
  }
}
