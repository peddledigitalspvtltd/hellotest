import { useEffect, useState } from "react";
import { useAiLlmDefault } from "@hellotest/integration/frontend/hooks/useAiLlmDefault";
import { useAiPromptRegistry } from "@hellotest/integration/frontend/hooks/useAiPromptRegistry";
import { replaceSmartContextPack, stripSmartContextPack } from "../lib/aiDesignStudio";
import { AI_REVIEW_CONTEXT_PROFILES, buildSmartContextQuery, SMART_CONTEXT_SOURCE_KINDS } from "../lib/smartContext";
import type { AiLlmOption } from "@hellotest/integration/frontend/lib/aiLlmDefault";
import { AiLlmSelect } from "./AiLlmSelect";
import { SmartContextWorkbench } from "./SmartContextWorkbench";
import "./AiReviewControls.css";

export type AiReviewControlsProps = {
  usageKey: string;
  projectId?: string;
  appTypeId?: string;
  integrations: readonly AiLlmOption[];
  integrationId: string;
  onIntegrationIdChange: (value: string) => void;
  promptGuidance?: string;
  promptMaxLength?: number;
  contextMaxLength?: number;
  onPromptGuidanceChange: (value: string) => void;
  additionalContext: string;
  onAdditionalContextChange: (value: string) => void;
  artifactContext: string;
  artifactIds?: string[];
  sourceKinds?: string[];
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
};

export function AiReviewControls({ usageKey, projectId, appTypeId, integrations, integrationId, onIntegrationIdChange,
  promptGuidance, promptMaxLength, contextMaxLength, onPromptGuidanceChange, additionalContext, onAdditionalContextChange, artifactContext,
  artifactIds, sourceKinds, disabled = false, onBusyChange
}: AiReviewControlsProps) {
  const { getPrompt, query } = useAiPromptRegistry();
  const defaultPrompt = getPrompt(usageKey);
  const defaultIntegrationId = useAiLlmDefault({ usageKey, projectId, integrations });
  const [contextBusy, setContextBusy] = useState(false);
  useEffect(() => {
    if (promptGuidance === undefined && !query.isFetching) onPromptGuidanceChange(defaultPrompt);
  }, [defaultPrompt, onPromptGuidanceChange, promptGuidance, query.isFetching]);
  useEffect(() => {
    onBusyChange?.(contextBusy);
    return () => onBusyChange?.(false);
  }, [contextBusy, onBusyChange]);
  const busy = disabled || contextBusy;
  const contextLimit = Math.max(0, Math.min(12_000, contextMaxLength ?? 12_000));
  const promptLimit = Math.max(0, Math.min(4_000, promptMaxLength ?? Infinity));
  const profile = AI_REVIEW_CONTEXT_PROFILES[usageKey];

  return (
    <div className="ai-review-controls">
      <AiLlmSelect defaultIntegrationId={defaultIntegrationId} disabled={busy} integrations={integrations} onChange={onIntegrationIdChange} scopeKey={`${projectId}:${usageKey}`} value={integrationId} />
      <details className="ai-review-controls__details">
        <summary>Prompt and Smart Context</summary>
        <div className="ai-review-controls__body">
          <label>
            <span>Review guidance</span>
            <textarea aria-label="AI review prompt" disabled={busy} maxLength={promptLimit} onChange={(event) => onPromptGuidanceChange(event.target.value)} rows={5} value={promptGuidance ?? defaultPrompt} />
          </label>
          <button className="ghost-button compact" disabled={busy} onClick={() => onPromptGuidanceChange(defaultPrompt)} type="button">Reset feature prompt</button>
          <SmartContextWorkbench
            appTypeId={appTypeId}
            contextLimit={Math.max(0, contextLimit - stripSmartContextPack(additionalContext).length - 7)}
            disabled={busy}
            excludedSourceRefIds={artifactIds}
            initialQuery={buildSmartContextQuery(artifactContext, stripSmartContextPack(additionalContext), profile?.purpose)}
            onApply={(selection) => {
              const context = replaceSmartContextPack(additionalContext, selection.contextText);
              if (context.length > contextLimit) throw new Error("Shorten the additional context before applying the reviewed pack.");
              onAdditionalContextChange(context);
            }}
            onBusyChange={setContextBusy}
            preferredSourceKinds={sourceKinds || profile?.sourceKinds || SMART_CONTEXT_SOURCE_KINDS.test_case_steps}
            projectId={projectId}
          />
          <label>
            <span>Additional review context</span>
            <textarea aria-label="Additional AI review context" disabled={busy} maxLength={contextLimit} onChange={(event) => onAdditionalContextChange(event.target.value)} placeholder="Add constraints or review and apply relevant project evidence with Smart Context." rows={4} value={additionalContext} />
          </label>
        </div>
      </details>
    </div>
  );
}
