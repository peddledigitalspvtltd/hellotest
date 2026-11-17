import type { AgenticProcessingSnapshot } from "@hellotest/ai/agent-experience";
import { useEffect, useMemo, useState } from "react";
import { resolveAiFailurePresentation } from "../../shared/generationFailure.mjs";

export type AiGenerationFailure = { code?: string; message?: string; retry_after_seconds?: number; retry_at?: string | null; stage_id?: string; support_reference?: string };

export const getAiFailureProcessing = (value: unknown) => value && typeof value === "object" ? (value as { processing?: AgenticProcessingSnapshot }).processing : undefined;

export function useAiFailureCooldown(source: unknown) {
  const deadline = useMemo(() => Date.now() + resolveAiFailurePresentation(source).remainingSeconds * 1000, [source]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { setNow(Date.now()); const interval = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(interval); }, [deadline]);
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

export function AiFailureNotice({ failure, error, onRetry }: { failure?: AiGenerationFailure | null; error?: unknown; onRetry?: () => void }) {
  const original = failure || error;
  const source = (original && typeof original === "object" && "failure" in original ? (original as { failure?: AiGenerationFailure }).failure : null) || original;
  const details = source as AiGenerationFailure | undefined;
  const remaining = useAiFailureCooldown(source);
  if (!source) return null;
  const presentation = resolveAiFailurePresentation(source);
  return <div className="inline-message error-message" role="alert" data-error-code={presentation.code}>
    <strong>{presentation.title}</strong><p>{presentation.action}</p>
    {details?.stage_id ? <small>Stopped during: {details.stage_id}</small> : null}
    {presentation.message ? <p>{presentation.message}</p> : null}
    {details?.support_reference ? <small>Support reference: {details.support_reference}</small> : null}
    {remaining ? <p role="status">Retry available in {remaining}s.</p> : null}
    {onRetry ? <button disabled={remaining > 0} onClick={onRetry} type="button">{remaining ? `Retry in ${remaining}s` : "Try again"}</button> : null}
  </div>;
}
