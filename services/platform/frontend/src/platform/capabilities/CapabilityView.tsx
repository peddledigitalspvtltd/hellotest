import { Component, useEffect, useState, type ComponentType, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { HelloTestService } from "../../services/shared";
import { DialogCloseButton } from "../../shared/components/DialogCloseButton";
import { useDialogFocus } from "../../shared/hooks/useDialogFocus";
import { AppErrorState } from "../components/AppErrorBoundary";
import { loadCapabilityView } from "./loadCapability";

function CapabilityFeedback({ children, label, onClose }: { children: ReactNode; label: string; onClose?: () => void }) {
  const ref = useDialogFocus<HTMLDivElement>({ active: Boolean(onClose), onClose });
  if (!onClose) return <>{children}</>;
  return createPortal(<div className="workspace-dialog-backdrop">
    <div className="workspace-dialog" role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} ref={ref}>
      <header><h2>{label}</h2><DialogCloseButton onClick={onClose} /></header>
      {children}
    </div>
  </div>, document.body);
}

class FeatureErrorBoundary extends Component<{ children: ReactNode; retry: () => void; label: string; onClose?: () => void }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    return this.state.error
      ? <CapabilityFeedback label={this.props.label} onClose={this.props.onClose}><AppErrorState compact title="This feature could not be displayed" error={this.state.error} onRetry={this.props.retry} /></CapabilityFeedback>
      : this.props.children;
  }
}

// The host page retains placement and draft state; the owning capability
// supplies the screen/panel only when it is actually mounted.
export function capabilityView<P extends object>(owner: HelloTestService, view: string,
  local: () => Promise<Record<string, unknown>>, label = "feature"): ComponentType<P> {
  return function CapabilityView(props: P) {
    const open = !("open" in props) || props.open !== false;
    const onClose = "onClose" in props && typeof props.onClose === "function" ? props.onClose as () => void : undefined;
    const [attempt, setAttempt] = useState(0);
    const [loaded, setLoaded] = useState<{ view?: ComponentType<P>; error?: unknown }>({});
    useEffect(() => {
      if (!open) return;
      let active = true;
      setLoaded({});
      void loadCapabilityView<P>(owner, view, local).then(component => {
        if (active) setLoaded({ view: component });
      }, error => { if (active) setLoaded({ error }); });
      return () => { active = false; };
    }, [attempt, open]);
    const retry = () => setAttempt(value => value + 1);
    if (!open) return null;
    if (loaded.error) return <CapabilityFeedback label={label} onClose={onClose}><AppErrorState compact title={`Unable to load ${label}`} error={loaded.error} onRetry={retry} /></CapabilityFeedback>;
    if (!loaded.view) return <CapabilityFeedback label={label} onClose={onClose}><div className="empty-state compact" role="status" aria-live="polite">Loading {label}…</div></CapabilityFeedback>;
    const View = loaded.view;
    return <FeatureErrorBoundary key={attempt} retry={retry} label={label} onClose={onClose}><View {...props} /></FeatureErrorBoundary>;
  };
}
