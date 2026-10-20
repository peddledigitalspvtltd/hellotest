import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LoadingState } from '@hellotest/platform/frontend/src/shared/components/LoadingState';
import { agenticApi } from '../api.client';
import { AgenticOutcomePanel } from '../components/AgenticExperience';

/** Reopen the actual review so current source access is checked before display. */
export function RepositorySourceReview({ sessionId, batch, scopeKey }: { sessionId: string; batch: number; scopeKey: string }) {
  const [open, setOpen] = useState(batch === 1);
  const review = useQuery({
    queryKey: ['repository-source-review', scopeKey, sessionId],
    queryFn: ({ signal }) => agenticApi.agenticWorkflows.getSession(sessionId, { signal }),
    enabled: open,
    retry: false
  });
  return <details open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Review batch {batch}</summary>
    {open && <div aria-label={`Source review batch ${batch}`} className="repository-agent-model-output" role="region">
      {review.isPending || review.isFetching ? <LoadingState label="Loading the evidence-backed source review" /> : review.isError ? <p role="alert">{review.error instanceof Error ? review.error.message : 'The source review is unavailable in this scope.'} <button className="ghost-button compact" type="button" onClick={() => void review.refetch()}>Retry review</button></p>
        : review.data?.result && review.data.session_state === 'completed' ? <AgenticOutcomePanel sessionId={sessionId} result={review.data.result} citations={review.data.citations} guardrails={review.data.guardrails} provenance={review.data.provenance} />
          : <p>{review.data?.message || 'This source review has no completed outcome yet.'}</p>}
    </div>}
  </details>;
}
