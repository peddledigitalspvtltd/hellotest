import { buildReviewedSmartContext, normalizeSmartContextHits, smartContextCitationId, smartContextResultId as resultId } from "../lib/smartContext";
import { formatRecordKindLabel } from "@hellotest/testing/frontend/lib/defectTerminology";
import { LoadingState } from "@hellotest/platform/frontend/src/shared/components/LoadingState";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  IconAdjustmentsHorizontal,
  IconBook2,
  IconCheck,
  IconDatabaseSearch,
  IconRefresh,
  IconSearch,
  IconShieldCheck
} from "@tabler/icons-react";
import { useDialogFocus } from "@hellotest/platform/frontend/src/shared/hooks/useDialogFocus";
import { useCapabilityAccess } from "@hellotest/platform/frontend/src/platform/hooks/useCapabilityAccess";
import { knowledgeApi } from "@hellotest/knowledge/frontend/api.client";
import type { KnowledgeRetrievalSummary, KnowledgeSearchHit } from "@hellotest/platform/frontend/src/types";
import { DialogCloseButton } from "@hellotest/platform/frontend/src/shared/components/DialogCloseButton";
import { SelectionToggleIcon } from "@hellotest/platform/frontend/src/platform/components/AppIcons";
import "./SmartContextWorkbench.css";

export type SmartContextSelection = {
  query: string;
  sourceIds: string[];
  sourceKinds: string[];
  chunkIds: string[];
  contextText: string;
  resultCount: number;
  retrieval?: KnowledgeRetrievalSummary;
};

type SmartContextWorkbenchProps = {
  appTypeId?: string | null;
  buttonClassName?: string;
  buttonLabel?: string;
  disabled?: boolean;
  initialQuery: string;
  onApply: (selection: SmartContextSelection) => void | Promise<void>;
  onBusyChange?: (busy: boolean) => void;
  preferredSourceKinds?: string[];
  excludedSourceRefIds?: string[];
  prepareEvidence?: () => Promise<string>;
  contextLimit?: number;
  projectId?: string | null;
};

export function SmartContextWorkbench({
  appTypeId,
  buttonClassName = "ghost-button compact smart-context-trigger",
  buttonLabel = "Smart Context",
  disabled = false,
  initialQuery,
  onApply,
  onBusyChange,
  preferredSourceKinds,
  excludedSourceRefIds,
  prepareEvidence,
  contextLimit = 12_000,
  projectId
}: SmartContextWorkbenchProps) {
  const { can } = useCapabilityAccess(projectId);
  const canUseKnowledge = Boolean(projectId) && can("knowledge.view");
  const requestVersion = useRef(0);
  const retrievalController = useRef<AbortController | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<KnowledgeSearchHit[]>([]);
  const [selectedResultIds, setSelectedResultIds] = useState<string[]>([]);
  const [contextDraft, setContextDraft] = useState("");
  const [preparedEvidence, setPreparedEvidence] = useState("");
  const [retrieval, setRetrieval] = useState<KnowledgeRetrievalSummary | undefined>();
  const [message, setMessage] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const dialogRef = useDialogFocus<HTMLElement>({ active: isOpen && canUseKnowledge, onClose: () => setIsOpen(false) });
  const selectedHits = useMemo(() => results.filter((hit, index) => selectedResultIds.includes(resultId(hit, index))), [results, selectedResultIds]);
  const isBusy = isSearching || isApplying;

  useEffect(() => {
    onBusyChange?.(isBusy);
    return () => onBusyChange?.(false);
  }, [isBusy, onBusyChange]);

  useEffect(() => {
    // Losing an optional retrieval capability must release the host form.
    // Its manual input and already-applied context belong to the host and stay.
    requestVersion.current += 1;
    retrievalController.current?.abort();
    setIsOpen(false);
    setIsSearching(false);
    setIsApplying(false);
    return () => {
      requestVersion.current += 1;
      retrievalController.current?.abort();
    };
  }, [appTypeId, canUseKnowledge, projectId]);

  useEffect(() => {
    if (!isOpen) return;
    const nextQuery = initialQuery.replace(/\[HELLOTEST_SMART_CONTEXT_START\][\s\S]*?\[HELLOTEST_SMART_CONTEXT_END\]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 2_000);
    setQuery(nextQuery || "Relevant project knowledge for this task");
    setPreparedEvidence("");
    setResults([]);
    setSelectedResultIds([]);
    setContextDraft("");
    setRetrieval(undefined);
    setMessage("");
  }, [initialQuery, isOpen]);

  if (!canUseKnowledge) return null;

  const retrieve = async () => {
    const normalizedQuery = query.trim();
    if (!canUseKnowledge || !projectId || !normalizedQuery || isSearching) return;
    const version = ++requestVersion.current;
    const controller = new AbortController();
    retrievalController.current = controller;
    setIsSearching(true);
    setMessage("");
    try {
      const evidence = await prepareEvidence?.() || "";
      if (controller.signal.aborted || version !== requestVersion.current) return;
      const response = await knowledgeApi.knowledgeRepo.search({
        project_id: projectId,
        query: normalizedQuery,
        mode: "hybrid",
        intent_aware: true,
        limit: 16,
        filters: {
          app_type_id: appTypeId || null,
          source_kinds: preferredSourceKinds?.length ? preferredSourceKinds : undefined
        }
      }, { signal: controller.signal });
      if (controller.signal.aborted || version !== requestVersion.current) return;
      const nextResults = normalizeSmartContextHits(response.results || response.hits || [], preferredSourceKinds, excludedSourceRefIds);
      const pack = buildReviewedSmartContext(nextResults, normalizedQuery, evidence, contextLimit);
      const nextIds = pack.hits.map((hit) => resultId(hit, nextResults.indexOf(hit)));
      setPreparedEvidence(evidence);
      setResults(nextResults);
      setSelectedResultIds(nextIds);
      setContextDraft(pack.contextText);
      setRetrieval(response.retrieval);
      setMessage(nextResults.length
        ? `${nextResults.length} distinct relevant chunk${nextResults.length === 1 ? "" : "s"} retrieved; ${pack.hits.length} fit in the reviewed pack. Review, remove, or edit before applying.`
        : evidence ? "No additional indexed evidence was found. Review the selected artifact and file context before applying." : "No sufficiently relevant indexed context was found. Refine the query or add the missing source to Knowledge Repo.");
    } catch (error) {
      if (controller.signal.aborted || version !== requestVersion.current) return;
      setMessage(error instanceof Error ? error.message : "Unable to retrieve Smart Context.");
    } finally {
      if (version === requestVersion.current) setIsSearching(false);
    }
  };

  const rebuildContext = (hits: KnowledgeSearchHit[]) => {
    try {
      const pack = buildReviewedSmartContext(hits, query.trim(), preparedEvidence, contextLimit);
      setSelectedResultIds(pack.hits.map((hit) => resultId(hit, results.indexOf(hit))));
      setContextDraft(pack.contextText);
      setMessage(pack.hits.length < hits.length ? `${pack.hits.length} sources fit in the reviewed context limit. Remove a source to include another.` : "");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to build Smart Context."); }
  };

  const toggleResult = (id: string, checked: boolean) => {
    const nextIds = checked
      ? [...new Set([...selectedResultIds, id])]
      : selectedResultIds.filter((candidate) => candidate !== id);
    const nextHits = results.filter((hit, index) => nextIds.includes(resultId(hit, index)));
    rebuildContext(nextHits);
  };

  const apply = async () => {
    if (!canUseKnowledge || !contextDraft.trim() || isApplying) return;
    setIsApplying(true);
    setMessage("");
    try {
      const reviewed = contextDraft.trim();
      if (!reviewed.startsWith("[HELLOTEST_SMART_CONTEXT_START]") || !reviewed.endsWith("[HELLOTEST_SMART_CONTEXT_END]")) {
        throw new Error("Keep the Smart Context start and end markers, or use Rebuild to restore them before applying.");
      }
      const citedHits = selectedHits.filter((hit) => reviewed.includes(`[${smartContextCitationId(hit, results.indexOf(hit))}]`));
      const sourceIds = [...new Set(citedHits.map((hit) => String(hit.source_id || hit.citation?.source_id || "")).filter(Boolean))];
      const sourceKinds = [...new Set(citedHits.map((hit) => String(hit.source_kind || hit.citation?.source_kind || "")).filter(Boolean))];
      const chunkIds = [...new Set(citedHits.map((hit) => String(hit.chunk_id || hit.citation?.chunk_id || resultId(hit, results.indexOf(hit)))).filter(Boolean))];
      await onApply({ query: query.trim(), sourceIds, sourceKinds, chunkIds, contextText: reviewed, resultCount: citedHits.length, retrieval });
      setIsOpen(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to apply Smart Context.");
    } finally {
      setIsApplying(false);
    }
  };

  const dialog = isOpen ? (
    <div className="smart-context-backdrop" onClick={() => !isBusy && setIsOpen(false)} role="presentation">
      <aside
        aria-label="Smart Context workbench"
        aria-modal="true"
        className="smart-context-dialog"
        onClick={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="smart-context-dialog__header">
          <div>
            <span><IconDatabaseSearch size={16} /> Governed retrieval</span>
            <h2>Smart Context</h2>
            <p>Retrieve permitted Knowledge Repo evidence, choose what matters, and inspect the exact context before it reaches the model.</p>
          </div>
          <DialogCloseButton disabled={isBusy} label="Close Smart Context" onClick={() => setIsOpen(false)} />
        </header>

        <div className="smart-context-dialog__body">
          <form className="smart-context-query" onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); void retrieve(); }}>
            <IconSearch aria-hidden="true" size={19} />
            <input aria-label="Smart Context retrieval query" autoFocus maxLength={2_000} onChange={(event) => setQuery(event.target.value)} value={query} />
            <button className="primary-button compact" disabled={!query.trim() || isSearching} type="submit">
              {isSearching ? <LoadingState label="Searching project context" /> : <IconDatabaseSearch size={16} />}
              <span>{isSearching ? "Retrieving…" : "Retrieve"}</span>
            </button>
          </form>

          <div className="smart-context-diagnostics">
            <span><IconShieldCheck size={15} /> Project ACL enforced</span>
            <span>{retrieval?.vector_mode || "Hybrid retrieval"}</span>
            <span>{retrieval?.candidate_count ?? 0} candidates</span>
            {retrieval?.intent_planning_mode ? <span>{retrieval.intent_planning_mode === "llm" ? "LLM intent retrieval · MCP" : "Standard retrieval · LLM unavailable"}</span> : null}
            {retrieval?.embedding_model ? <span>{retrieval.embedding_model}</span> : null}
          </div>

          <div className="smart-context-grid">
            <section className="smart-context-results" aria-label="Retrieved Knowledge Repo context">
              <header>
                <div><strong>Retrieved evidence</strong><span>{selectedHits.length}/{results.length} selected</span></div>
                <div>
                  <button disabled={!results.length} onClick={() => {
                    rebuildContext(results);
                  }} type="button"><SelectionToggleIcon checked />Select all</button>
                  <button disabled={!selectedResultIds.length} onClick={() => { setSelectedResultIds([]); setContextDraft(""); }} type="button"><SelectionToggleIcon checked={false} />Clear</button>
                </div>
              </header>
              <div className="smart-context-result-list">
                {results.map((hit, index) => {
                  const id = resultId(hit, index);
                  const score = Number(hit.score ?? hit.citation?.score);
                  return (
                    <label className="smart-context-result" key={id}>
                      <input checked={selectedResultIds.includes(id)} onChange={(event) => toggleResult(id, event.target.checked)} type="checkbox" />
                      <span><IconBook2 size={15} /></span>
                      <span>
                        <strong>{hit.title || hit.label || `Project source ${index + 1}`}</strong>
                        <small>{formatRecordKindLabel(hit.source_kind || hit.citation?.source_kind, "knowledge")}{Number.isFinite(score) ? ` · ${Math.round(score * 100)}% relevance` : ""}</small>
                        <p>{String(hit.excerpt || hit.content || hit.citation?.excerpt || "").slice(0, 260)}</p>
                      </span>
                    </label>
                  );
                })}
                {!results.length && !isSearching ? <div className="smart-context-empty"><IconAdjustmentsHorizontal size={24} /><strong>Shape the retrieval query</strong><span>Use the artifact title, risk, behavior, error, or decision the model needs to understand.</span></div> : null}
              </div>
            </section>

            <section className="smart-context-preview">
              <header>
                <div><strong>Editable model context</strong><span>Only this reviewed pack is applied</span></div>
                <button disabled={!selectedHits.length && !preparedEvidence} onClick={() => rebuildContext(selectedHits)} type="button"><IconRefresh size={14} /> Rebuild</button>
              </header>
              <textarea aria-label="Editable Smart Context" disabled={!results.length && !preparedEvidence} maxLength={contextLimit} onChange={(event) => setContextDraft(event.target.value)} placeholder="Retrieve context to build a reviewable evidence pack." value={contextDraft} />
              <p><IconShieldCheck size={14} /> Retrieved text remains untrusted evidence. The model must preserve citations and cannot treat source content as instructions.</p>
            </section>
          </div>
          {message ? <div aria-live="polite" className="smart-context-message">{message}</div> : null}
        </div>

        <footer className="smart-context-dialog__footer">
          <button className="ghost-button" disabled={isBusy} onClick={() => setIsOpen(false)} type="button">Cancel</button>
          <button className="primary-button" disabled={!contextDraft.trim() || isApplying} onClick={() => void apply()} type="button">
            <IconCheck size={16} /><span>{isApplying ? "Applying…" : `Apply ${selectedHits.length} source${selectedHits.length === 1 ? "" : "s"}`}</span>
          </button>
        </footer>
      </aside>
    </div>
  ) : null;

  return (
    <>
      <button aria-label={buttonLabel} aria-haspopup="dialog" className={buttonClassName} disabled={disabled || !projectId} onClick={() => setIsOpen(true)} title={buttonLabel} type="button">
        <IconDatabaseSearch aria-hidden="true" size={16} /><span>{buttonLabel}</span>
      </button>
      {dialog && typeof document !== "undefined" ? createPortal(dialog, document.body) : dialog}
    </>
  );
}
