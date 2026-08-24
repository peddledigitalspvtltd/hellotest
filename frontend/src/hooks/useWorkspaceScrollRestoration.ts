import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

const MAX_REMEMBERED_ROUTES = 30;
const routeScrollPositions = new Map<string, number>();

const rememberRoutePosition = (path: string, position: number) => {
  routeScrollPositions.delete(path);
  routeScrollPositions.set(path, position);
  while (routeScrollPositions.size > MAX_REMEMBERED_ROUTES) {
    const oldestPath = routeScrollPositions.keys().next().value;
    if (!oldestPath) break;
    routeScrollPositions.delete(oldestPath);
  }
};

export function useWorkspaceScrollRestoration() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const navigationTypeRef = useRef(navigationType);
  navigationTypeRef.current = navigationType;

  useEffect(() => {
    const previousMode = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    return () => {
      window.history.scrollRestoration = previousMode;
    };
  }, []);

  useLayoutEffect(() => {
    const path = location.pathname;
    const target = navigationTypeRef.current === "POP" ? routeScrollPositions.get(path) || 0 : 0;
    let frame = 0;
    let restorationCancelled = false;
    let resizeObserver: ResizeObserver | undefined;
    const restore = () => {
      if (restorationCancelled) return;
      const maximum = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      window.scrollTo({ top: Math.min(target, maximum), left: 0, behavior: "auto" });
      if (Math.abs(window.scrollY - target) <= 1) resizeObserver?.disconnect();
    };
    const cancelPendingRestoration = () => {
      restorationCancelled = true;
      resizeObserver?.disconnect();
    };

    frame = window.requestAnimationFrame(restore);
    if (target > 0 && typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(restore);
      resizeObserver.observe(document.documentElement);
      window.addEventListener("wheel", cancelPendingRestoration, { passive: true, once: true });
      window.addEventListener("touchstart", cancelPendingRestoration, { passive: true, once: true });
      window.addEventListener("pointerdown", cancelPendingRestoration, { passive: true, once: true });
      window.addEventListener("keydown", cancelPendingRestoration, { once: true });
    }

    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener("wheel", cancelPendingRestoration);
      window.removeEventListener("touchstart", cancelPendingRestoration);
      window.removeEventListener("pointerdown", cancelPendingRestoration);
      window.removeEventListener("keydown", cancelPendingRestoration);
      rememberRoutePosition(path, window.scrollY);
    };
  // Query-string changes drive catalog selection and filters. They must not reset
  // the page position, so restoration is deliberately scoped to pathname changes.
  // navigationType is sampled for that path transition rather than used as a trigger.
  }, [location.pathname]);
}
