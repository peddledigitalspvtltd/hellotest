import {LoadingSpinner} from './LoadingSpinner';
import './LoadingSkeleton.css';

export function LoadingSkeleton({label, count = 3}: {label: string; count?: number}) {
  return <div aria-busy="true" aria-label={label} role="status" className="loading-skeleton-grid">
    <span className="sr-only">{label}</span>
    {Array.from({length: count}, (_, index) => <div aria-hidden="true" className="loading-skeleton-card" key={index}><i /><i /><i /></div>)}
  </div>;
}

export function InlineLoadingState({label}: {label: string}) {
  return <span className="inline-loading-state" role="status" aria-label={label}><LoadingSpinner /><span className="sr-only">{label}</span></span>;
}
