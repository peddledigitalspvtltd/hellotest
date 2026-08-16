import { useEffect, useRef } from "react";

const FALLBACK_FOCUSABLE_SELECTOR = [
  "input:not([type='hidden']):not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "button:not([disabled])",
  "[href]",
  "[tabindex]:not([tabindex='-1'])"
].join(", ");

type DialogFocusOptions = {
  active?: boolean;
  closeDisabled?: boolean;
  onClose?: () => void;
};

const openDialogStack: HTMLElement[] = [];
let previousBodyOverflow = "";

/**
 * Gives Custom UI dialogs the keyboard behavior Jira users expect: initial focus,
 * focus containment, Escape-to-close, background scroll locking, and focus return.
 */
export function useDialogFocus<T extends HTMLElement>({
  active = true,
  closeDisabled = false,
  onClose
}: DialogFocusOptions = {}) {
  const ref = useRef<T | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);
  onCloseRef.current = onClose;
  closeDisabledRef.current = closeDisabled;

  useEffect(() => {
    if (!active) {
      return;
    }

    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = ref.current;

    if (!dialog) {
      return;
    }

    if (openDialogStack.length === 0) {
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    const previousDialog = openDialogStack[openDialogStack.length - 1];
    const previousDialogAriaHidden = previousDialog?.getAttribute("aria-hidden") ?? null;
    const previousDialogWasInert = previousDialog?.inert ?? false;
    if (previousDialog) {
      previousDialog.setAttribute("aria-hidden", "true");
      previousDialog.inert = true;
    }
    openDialogStack.push(dialog);

    const frameId = window.requestAnimationFrame(() => {
      const canReceiveFocus = (target: HTMLElement | null) => Boolean(target && !target.closest("[inert], [aria-hidden='true']"));
      const preferredCandidate = dialog.querySelector<HTMLElement>("[data-autofocus='true']");
      const preferredTarget = canReceiveFocus(preferredCandidate) ? preferredCandidate : null;
      const fallbackTarget = Array.from(dialog.querySelectorAll<HTMLElement>(FALLBACK_FOCUSABLE_SELECTOR)).find(canReceiveFocus) || null;

      (preferredTarget || fallbackTarget || dialog).focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (openDialogStack[openDialogStack.length - 1] !== dialog) {
        return;
      }

      if (event.key === "Escape" && onCloseRef.current && !closeDisabledRef.current) {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusableTargets = Array.from(dialog.querySelectorAll<HTMLElement>(FALLBACK_FOCUSABLE_SELECTOR))
        .filter((target) => !target.closest("[inert], [aria-hidden='true']") && target.offsetParent !== null);

      if (!focusableTargets.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const firstTarget = focusableTargets[0];
      const lastTarget = focusableTargets[focusableTargets.length - 1];

      if (event.shiftKey && (document.activeElement === firstTarget || document.activeElement === dialog)) {
        event.preventDefault();
        lastTarget.focus();
      } else if (!event.shiftKey && document.activeElement === lastTarget) {
        event.preventDefault();
        firstTarget.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.cancelAnimationFrame(frameId);
      document.removeEventListener("keydown", handleKeyDown, true);

      const stackIndex = openDialogStack.lastIndexOf(dialog);
      if (stackIndex >= 0) {
        openDialogStack.splice(stackIndex, 1);
      }
      if (openDialogStack.length === 0) {
        document.body.style.overflow = previousBodyOverflow;
      }

      if (previousDialog && document.contains(previousDialog)) {
        if (previousDialogAriaHidden === null) {
          previousDialog.removeAttribute("aria-hidden");
        } else {
          previousDialog.setAttribute("aria-hidden", previousDialogAriaHidden);
        }
        previousDialog.inert = previousDialogWasInert;
      }

      const previouslyFocused = previouslyFocusedRef.current;
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [active]);

  return ref;
}
