import { useEffect, useState } from "react";
import { IconAlertTriangle, IconCheck, IconClock, IconChevronDown } from "@tabler/icons-react";
import type { KnowledgeRetrievalEvent } from "@hellotest/platform/frontend/src/types";
import { knowledgeElapsedLabel, knowledgeProgressLabel, knowledgeProgressDescription } from "../lib/knowledgeAssistantStream";

export function KnowledgeTurnProgress({ events, startedAt, opening }: {
  events: KnowledgeRetrievalEvent[];
  startedAt: number;
  opening?: boolean;
}) {
  const [now, setNow] = useState(Date.now);
  const [lastUpdateAt, setLastUpdateAt] = useState(startedAt);
  useEffect(() => { setLastUpdateAt(Date.now()); }, [events]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const latest = events[events.length - 1];
  const quiet = now - lastUpdateAt >= 20_000;
  const partial = events.some((event) => ["PARTIAL", "DEGRADED", "TIMEOUT"].includes(String(event.status).toUpperCase()));
  const visibleEvents = events.slice(-10);
  const statusIcon = (status?: string, size = 14) => {
    const normalized = String(status || "IN_PROGRESS").toUpperCase();
    if (["FAILED", "UNAVAILABLE", "PARTIAL", "DEGRADED", "TIMEOUT"].includes(normalized)) return <IconAlertTriangle aria-hidden="true" size={size} />;
    if (["COMPLETE", "COMPLETED", "DONE"].includes(normalized)) return <IconCheck aria-hidden="true" size={size} />;
    return <IconClock aria-hidden="true" size={size} />;
  };
  return <section aria-label="Answer progress" className="grounded-assistant-turn-progress">
    <div className="grounded-assistant-progress-heading">
      <span className="grounded-assistant-progress-state-icon">{statusIcon(latest?.status, 17)}</span>
      <div role="status" aria-live="polite"><strong>{knowledgeProgressLabel(latest, opening)}</strong></div>
      <time aria-label={`${knowledgeElapsedLabel(now - startedAt)} elapsed`}>{knowledgeElapsedLabel(now - startedAt)}</time>
    </div>
    <p>{knowledgeProgressDescription(latest) || (opening ? "Preparing a conversation for your question." : "The search has been requested. Activity will appear as the service reports it.")}</p>
    {quiet ? <p className="grounded-assistant-progress-wait">No new stage has been reported for {knowledgeElapsedLabel(now - lastUpdateAt)}. You can keep this open or stop and resume this turn later.</p> : null}
    {partial ? <p className="grounded-assistant-progress-partial">Some retrieval work could not complete. Any returned answer will identify the evidence limits.</p> : null}
    {visibleEvents.length ? <details className="grounded-assistant-progress-details"><summary>View activity · {events.length}<IconChevronDown size={13} /></summary><ol aria-label="Retrieval activity" className="grounded-assistant-progress-timeline">{visibleEvents.map((item, index) => <li data-status={String(item.status || "IN_PROGRESS").toLowerCase()} key={`${item.stage}-${item.sequence ?? index}-${item.metrics?.model_attempt ?? 0}`}><span className="grounded-assistant-progress-step-icon">{statusIcon(item.status)}</span><span><strong>{knowledgeProgressLabel(item)}</strong><small>{knowledgeProgressDescription(item) || item.status?.replace(/_/g, " ").toLowerCase()}{Number.isFinite(item.metrics?.elapsed_ms) ? ` · ${knowledgeElapsedLabel(item.metrics!.elapsed_ms)} elapsed` : ""}</small></span></li>)}</ol></details> : null}
  </section>;
}
