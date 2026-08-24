import "./WorkspacePageSkeleton.css";

export function WorkspacePageSkeleton({ label }: { label: string }) {
  return (
    <div aria-label={label} aria-live="polite" aria-busy="true" className="workspace-page-skeleton" role="status">
      <span className="sr-only">{label}</span>
      <section className="workspace-page-skeleton-header" aria-hidden="true">
        <span className="workspace-page-skeleton-line is-short" />
        <span className="workspace-page-skeleton-line is-title" />
        <span className="workspace-page-skeleton-line is-description" />
      </section>
      <section className="workspace-page-skeleton-metrics" aria-hidden="true">
        {Array.from({ length: 4 }, (_value, index) => <span key={index} />)}
      </section>
      <section className="workspace-page-skeleton-panel" aria-hidden="true">
        <span className="workspace-page-skeleton-line is-toolbar" />
        {Array.from({ length: 5 }, (_value, index) => <span className="workspace-page-skeleton-row" key={index} />)}
      </section>
    </div>
  );
}
