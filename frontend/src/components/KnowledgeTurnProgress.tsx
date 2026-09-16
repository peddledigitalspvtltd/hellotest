import { LoadingState } from "./LoadingState";
import { useEffect, useState } from "react";
import { IconPlayerStop } from "@tabler/icons-react";
import type { KnowledgeRetrievalEvent } from "../types";
import { knowledgeElapsedLabel, knowledgeProgressLabel, knowledgeProgressDescription } from "../lib/knowledgeAssistantStream";

export function KnowledgeTurnProgress({ events, startedAt, opening, onStop }: {
  events: KnowledgeRetrievalEvent[];
  startedAt: number;
  opening?: boolean;
  onStop: () => void;
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
  return <section aria-label="Answer progress" className="grounded-assistant-turn-progress">
    <div className="grounded-assistant-progress-heading">
      <LoadingState label={knowledgeProgressLabel(latest, opening)} />
      <div role="status" aria-live="polite"><span>Working with your project evidence</span><strong>{knowledgeProgressLabel(latest, opening)}</strong></div>
      <time aria-label={`${knowledgeElapsedLabel(now - startedAt)} elapsed`}>{knowledgeElapsedLabel(now - startedAt)}</time>
    </div>
    <p>{knowledgeProgressDescription(latest) || (opening ? "Preparing a conversation for your question." : "The search has been requested. Activity will appear as the service reports it.")}</p>
    {quiet ? <p className="grounded-assistant-progress-wait">No new stage has been reported for {knowledgeElapsedLabel(now - lastUpdateAt)}. You can keep this open or stop and resume this turn later.</p> : null}
    {partial ? <p className="grounded-assistant-progress-partial">Some retrieval work could not complete. Any returned answer will identify the evidence limits.</p> : null}
    <div className="grounded-assistant-progress-actions">
      {events.length ? <details className="grounded-assistant-live-progress"><summary>Search activity · {events.length}</summary><ol>{events.map((item, index) => <li key={`${item.stage}-${index}`}><span>{knowledgeProgressLabel(item)}</span><small>{knowledgeProgressDescription(item) || item.status?.replace(/_/g, " ").toLowerCase()}{Number.isFinite(item.metrics?.elapsed_ms) ? ` · ${knowledgeElapsedLabel(item.metrics!.elapsed_ms)} reported` : ""}</small></li>)}</ol></details> : <span>Your question is preserved</span>}
      <button className="grounded-assistant-stop" onClick={onStop} type="button"><IconPlayerStop size={13} />Stop answer</button>
    </div>
  </section>;
}
