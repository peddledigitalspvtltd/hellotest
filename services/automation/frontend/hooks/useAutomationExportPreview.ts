import { useEffect, useMemo, useState } from "react";
import { createAutomationOptionalModule } from "../lib/automationOptionalModule";

type ExportModule = typeof import("../lib/playwrightExport");
type ExportInput = Parameters<ExportModule["buildPlaywrightExport"]>[0];
const exporter = createAutomationOptionalModule(() => import("../lib/playwrightExport"));

/** The page owns drafts; this hook owns optional compiler loading and source rendering. */
export function useAutomationExportPreview({ enabled, ready, input }: {
  enabled: boolean;
  ready: boolean;
  input: ExportInput;
}) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ module?: ExportModule; error?: unknown }>({});
  useEffect(() => {
    if (!enabled) return;
    const cached = exporter.current();
    if (cached) {
      setState({ module: cached });
      return;
    }
    let active = true;
    setState({});
    void exporter.load().then(module => {
      if (active) setState({ module });
    }, error => {
      if (active) setState({ error });
    });
    return () => { active = false; };
  }, [enabled, attempt]);
  const rendered = useMemo(() => {
    if (!enabled || !ready || !state.module) return { code: "", error: undefined };
    try { return { code: state.module.buildPlaywrightExport(input), error: undefined }; }
    catch (error) { return { code: "", error }; }
  }, [enabled, ready, state.module, input, attempt]);
  return {
    code: rendered.code,
    loading: enabled && !state.module && !state.error,
    error: enabled ? state.error || rendered.error : undefined,
    retry: () => setAttempt(value => value + 1)
  };
}
