export type WorkspaceScrollPort = {
  position: () => number;
  maximum: () => number;
  restore: (position: number) => void;
  observe: Element[];
};

/** Resolve the real scroll owner once; normal pages and focused editors differ. */
export function createWorkspaceScrollPort(document: Document, window: Window): WorkspaceScrollPort {
  const main = document.querySelector<HTMLElement>('.workspace-main');
  if (main && main.clientHeight > 0 && /^(auto|scroll)$/.test(window.getComputedStyle(main).overflowY)) {
    return {
      position: () => main.scrollTop,
      maximum: () => Math.max(0, main.scrollHeight - main.clientHeight),
      restore: top => main.scrollTo({top, left: 0, behavior: 'auto'}),
      observe: [main, ...(main.firstElementChild ? [main.firstElementChild] : [])]
    };
  }
  return {
    position: () => window.scrollY,
    maximum: () => Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
    restore: top => window.scrollTo({top, left: 0, behavior: 'auto'}),
    observe: [document.documentElement]
  };
}
