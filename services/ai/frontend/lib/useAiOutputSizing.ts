import { useLayoutEffect, useRef } from "react";

/** Size prose editors to their rendered text, including after viewport changes. */
export function useAiOutputSizing<T extends HTMLElement>(content: unknown, selector = "textarea[data-ai-auto-size]") {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    let active = true;
    const resize = () => {
      if (!active) return;
      root.querySelectorAll<HTMLTextAreaElement>(selector).forEach(field => {
        field.style.overflowY = "hidden";
        field.style.maxHeight = "none";
        field.style.height = "auto";
        const style = getComputedStyle(field);
        const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
        field.style.height = `${field.scrollHeight + border}px`;
      });
    };
    resize();
    document.fonts.ready.then(resize);
    document.fonts.addEventListener("loadingdone", resize);
    let width = root.clientWidth;
    const observer = new ResizeObserver(() => {
      if (root.clientWidth !== width) { width = root.clientWidth; resize(); }
    });
    observer.observe(root);
    return () => { active = false; observer.disconnect(); document.fonts.removeEventListener("loadingdone", resize); };
  }, [content, selector]);
  return ref;
}
