import { useState } from "react";
import { RichTextContent } from "@hellotest/platform/frontend/src/platform/components/RichTextEditor";

/** Strings go through the application's sanitized rich-text renderer; JSON is escaped by React. */
export function WorkflowDataView({
  value,
  empty = "No data yet. Execute this step to inspect its result.",
}: {
  value: unknown;
  empty?: string;
}) {
  const [mode, setMode] = useState<"readable" | "json">("readable");
  if (value == null) return <p className="studio-empty">{empty}</p>;
  const object =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)
      : null;
  const response = object?.response || object?.summary;
  const reviews = Array.isArray(object?.reviews)
    ? (object.reviews as Record<string, unknown>[])
    : [];
  const hasReadable =
    typeof value === "string" ||
    typeof response === "string" ||
    reviews.length > 0;
  return (
    <div className="studio-data">
      {hasReadable && (
        <div className="studio-data-tabs" role="group" aria-label="Data format">
          <button
            type="button"
            aria-pressed={mode === "readable"}
            onClick={() => setMode("readable")}
          >
            Readable
          </button>
          <button
            type="button"
            aria-pressed={mode === "json"}
            onClick={() => setMode("json")}
          >
            JSON
          </button>
        </div>
      )}
      {hasReadable && mode === "readable" ? (
        <div className="studio-data-prose">
          {typeof value === "string" || typeof response === "string" ? (
            <RichTextContent value={String(response || value)} />
          ) : (
            reviews.map((review, index) => (
              <article key={String(review.node_id || index)}>
                <strong>
                  {String(review.node_id || `Review ${index + 1}`)}
                </strong>
                <RichTextContent value={String(review.response || "")} />
              </article>
            ))
          )}
          {Array.isArray(object?.citation_ids) &&
            object.citation_ids.length > 0 && (
              <p className="studio-caption">
                Sources: {object.citation_ids.map(String).join(", ")}. Open the
                saved review to inspect evidence.
              </p>
            )}
        </div>
      ) : (
        <pre>{JSON.stringify(value, null, 2)}</pre>
      )}
    </div>
  );
}
