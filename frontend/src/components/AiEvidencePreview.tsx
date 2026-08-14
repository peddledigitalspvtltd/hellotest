import { useState } from "react";
import { useMutation } from "@tanstack/react-query";

type PreviewRecord = Record<string, unknown>;

const labelize = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());

function valueText(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function PreviewSection({ title, value }: { title: string; value: unknown }) {
  if (Array.isArray(value)) {
    return (
      <section className="ai-evidence-section">
        <h3>{labelize(title)}</h3>
        {value.length ? (
          <div className="ai-evidence-list">
            {value.map((item, index) => (
              <article key={`${title}-${index}`}>
                {typeof item === "object" && item !== null
                  ? Object.entries(item as PreviewRecord).slice(0, 7).map(([key, entry]) => <p key={key}><strong>{labelize(key)}:</strong> {valueText(entry)}</p>)
                  : <p>{valueText(item)}</p>}
              </article>
            ))}
          </div>
        ) : <div className="empty-state compact">No records in this signal.</div>}
      </section>
    );
  }

  if (typeof value === "object" && value !== null) {
    return (
      <section className="ai-evidence-section">
        <h3>{labelize(title)}</h3>
        <dl className="ai-evidence-facts">
          {Object.entries(value as PreviewRecord).map(([key, entry]) => (
            <div key={key}><dt>{labelize(key)}</dt><dd>{valueText(entry)}</dd></div>
          ))}
        </dl>
      </section>
    );
  }

  return <section className="ai-evidence-section"><h3>{labelize(title)}</h3><p>{valueText(value)}</p></section>;
}

export function AiEvidencePreview({ label, title, load }: { label: string; title: string; load: () => Promise<unknown> }) {
  const [isOpen, setIsOpen] = useState(false);
  const preview = useMutation({ mutationFn: load });
  const response = (preview.data || {}) as PreviewRecord;
  const excluded = new Set(["integration", "provenance", "generation_mode", "generated_at", "request_id", "input_fingerprint", "confidence", "fallback_used", "fallback_reason", "requires_human_review", "preview_only"]);
  const content = Object.entries(response).filter(([key]) => !excluded.has(key));
  const provenance = response.provenance as PreviewRecord | undefined;

  const open = () => {
    setIsOpen(true);
    preview.mutate();
  };

  return (
    <>
      <button className="ghost-button" onClick={open} type="button"><span aria-hidden="true">✦</span>{label}</button>
      {isOpen ? (
        <div className="modal-backdrop" onClick={() => setIsOpen(false)}>
          <div aria-modal="true" className="modal-card ai-evidence-dialog" onClick={(event) => event.stopPropagation()} role="dialog">
            <div className="modal-header">
              <div><span className="eyebrow">Explainable preview</span><h2>{title}</h2><p>Read-only evidence analysis. Review the source records before making a decision.</p></div>
              <button aria-label="Close preview" className="ghost-button compact" onClick={() => setIsOpen(false)} type="button">Close</button>
            </div>
            <div className="ai-evidence-body">
              {preview.isPending ? <div className="entity-evidence-loading">Analyzing current HelloTest evidence…</div> : null}
              {preview.error ? <div className="inline-error">{preview.error instanceof Error ? preview.error.message : "Unable to produce the preview."}</div> : null}
              {preview.data ? (
                <>
                  <div className="ai-assurance-strip">
                    <span><strong>{Math.round(Number(response.confidence || provenance?.confidence || 0) * 100)}%</strong> confidence</span>
                    <span><strong>{String(response.generation_mode || provenance?.generation_mode || "deterministic")}</strong> mode</span>
                    <span><strong>Human review</strong> required</span>
                    <span><strong>No mutation</strong> preview only</span>
                  </div>
                  {content.map(([key, value]) => <PreviewSection key={key} title={key} value={value} />)}
                  {provenance ? <PreviewSection title="Provenance" value={provenance} /> : null}
                </>
              ) : null}
            </div>
            <div className="modal-actions"><button className="primary-button" onClick={() => setIsOpen(false)} type="button">Done</button></div>
          </div>
        </div>
      ) : null}
    </>
  );
}
