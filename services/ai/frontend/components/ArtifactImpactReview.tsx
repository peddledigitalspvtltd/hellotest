import type { AiArtifactAssuranceReview } from "@hellotest/platform/frontend/src/types";

/** Keep model interpretation visible beside the server-owned dependency graph. */
export function ArtifactImpactReview({ review }: { review?: AiArtifactAssuranceReview | null }) {
  if (!review) return null;
  return <section className="story-impact-recommendations" aria-label="AI change review">
    <h3>AI change review</h3>
    {review.summary ? <p>{review.summary}</p> : null}
    {review.insights?.length ? <ol>{review.insights.map(item => <li key={item.id}>
      <strong>{item.title}</strong> <span>· {item.priority}</span>
      <p>{item.explanation}</p>
      <p><b>Review:</b> {item.recommendation}</p>
      <small>{[...(item.affected_fields || []), ...(item.step_refs || []), ...item.evidence].join(" · ")}</small>
    </li>)}</ol> : <p>No supported material change findings were returned for the supplied evidence.</p>}
  </section>;
}
