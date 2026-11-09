import type { Locator, Page, Frame } from 'playwright';
import { resolveRepositoryLocator } from './repositoryLocator.js';

/** DOM label text is not an accessible name (for example aria-hidden required
 * markers). Obtain names from Playwright and retain only candidates that resolve
 * uniquely to the actual captured node. No page attributes are changed. */
export async function groundSnapshotLocators(page: Page | Frame, elements: any[], deadline: number,
  observeSubject?: (target: Locator, element: any, deadline: number) => Promise<boolean>) {
  let cursor = 0, incomplete = false;
  // An anchor without a native/explicit role may be an application icon
  // control. Prioritize its observed node without assigning an ARIA role.
  const priority = (element: any) => (element.in_viewport ? 0 : element.displayed ? 10 : 20)
    + (['input','textarea','select','button'].includes(element.tag) || element.tag === 'a' && !element.snapshot_role ? 0 : ['button','link','textbox','combobox','checkbox','radio','tab'].includes(element.snapshot_role) ? 1 : ['heading','alert','status','dialog'].includes(element.snapshot_role) ? 2 : 3);
  const queue = elements.map((element, index) => ({element,index})).sort((left,right) => priority(left.element)-priority(right.element)||left.index-right.index);
  const bounded = async<T>(task:()=>Promise<T>, until=deadline):Promise<T> => {
    const remaining=until-Date.now();if(remaining<=0)throw new Error('Snapshot grounding deadline reached');
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{return await Promise.race([Promise.resolve().then(()=>{if(Date.now()>=until)throw new Error('Snapshot grounding deadline reached');return task();}),
      new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error('Snapshot grounding probe timed out')),remaining);})]);}
    finally{if(timer)clearTimeout(timer);}
  };
  const counts = new Map<string, Promise<number>>();
  const count = (candidate: string) => {
    let value = counts.get(candidate);
    if (!value) { value = bounded(()=>resolveRepositoryLocator(page, candidate).count(),Math.min(deadline,Date.now()+750)); counts.set(candidate, value); }
    return value;
  };
  await Promise.all(Array.from({ length: Math.min(4, elements.length) }, async () => {
    while (cursor < queue.length) {
      const element = queue[cursor++].element, selector = element.snapshot_selector;
      delete element.snapshot_selector;
      delete element.record_scoped_locator;
      if (!selector) continue; // Older/fallback DOM providers make no validation claim.
      element.locator_candidates = [];
      element.locators_validated = true;
      if (Date.now() >= deadline) { incomplete = true; continue; }
      const timeout = () => Math.max(1, Math.min(750, deadline - Date.now()));
      try {
        const target = page.locator(selector);
        if (await count(selector) !== 1) { incomplete = true; continue; }
        const candidates: string[] = element.snapshot_candidates || [];
        if (element.displayed) {
          try {
            const aria = await bounded(()=>target.ariaSnapshot({ timeout: timeout(), depth: 1 }),Math.min(deadline,Date.now()+750));
            const root = /^- ([a-z][a-z0-9]*)(?: ("(?:\\.|[^"\\])*"))?(?=[:\s]|$)/.exec(aria);
            if (root && root[1] === element.snapshot_role) {
              element.accessible_role = root[1];
              const name = root[2] ? JSON.parse(root[2]) : '';
              element.accessible_name = name.slice(0, 180);
              element.accessible_name_truncated = name.length > 180;
              if (name && !element.accessible_name_truncated) {
                if (element.label) { element.label = name; element.label_truncated = false; }
                candidates.unshift(`getByRole(${JSON.stringify(root[1])}, { name: ${JSON.stringify(name)}, exact: true })`);
                if (element.label) candidates.unshift(`getByLabel(${JSON.stringify(name)}, { exact: true })`);
              }
            }
          } catch { /* Unavailable name evidence never justifies a guessed locator. */ }
        }
        const valid: string[] = [];
        for (const candidate of [...new Set([...candidates, selector])]) {
          if (Date.now() >= deadline) { incomplete = true; break; }
          try {
            if (await count(candidate) !== 1) continue;
            const sameNode = await bounded(()=>resolveRepositoryLocator(page, candidate).evaluate((node, identity) => node === document.querySelector(identity), selector, { timeout: timeout() }),Math.min(deadline,Date.now()+750));
            if (sameNode) valid.push(candidate);
          } catch { /* A stale, ambiguous or unsupported candidate is not advertised. */ }
        }
        // Preserve a proven record scope and the original structural fallback
        // within the existing four-candidate budget. Semantic names can remain
        // global while the record's app-owned key must survive into playback.
        const scoped = typeof element.snapshot_record_locator === 'string' && element.snapshot_record_locator.length <= 2_000
          && valid.includes(element.snapshot_record_locator) ? element.snapshot_record_locator : null;
        const fallback = valid.includes(selector) ? selector : null;
        const reserved = [...new Set([scoped, fallback].filter((value): value is string => Boolean(value)))];
        element.locator_candidates = [...(scoped ? [scoped] : []), ...valid.filter(value => !reserved.includes(value)).slice(0, 4 - reserved.length),
          ...(fallback && fallback !== scoped ? [fallback] : [])];
        if (scoped) element.record_scoped_locator = scoped;
        if (element.locator_candidates.length && observeSubject) {
          const subjectDeadline=Math.min(deadline,Date.now()+750);
          if(!await bounded(()=>observeSubject(target,element,subjectDeadline),subjectDeadline)) {
            element.locator_candidates = [];
            delete element.record_scoped_locator;
            incomplete = true;
          }
        }
      } catch { element.locator_candidates=[];delete element.record_scoped_locator;incomplete = true; }
      finally { delete element.snapshot_candidates; delete element.snapshot_record_locator; }
    }
  }));
  // Strip internal identities even when a deadline interrupts enrichment.
  for (const element of elements) { delete element.snapshot_selector; delete element.snapshot_candidates; delete element.snapshot_role; delete element.snapshot_record_locator; }
  return { incomplete };
}
