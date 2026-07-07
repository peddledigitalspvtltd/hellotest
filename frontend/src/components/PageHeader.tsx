import type { ReactNode } from "react";

type PageHeaderMetaItem = {
  label: string;
  value: ReactNode;
};

export function PageHeader({
  eyebrow: _eyebrow,
  title,
  description,
  actions,
  meta: _meta,
  className = ""
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  meta?: PageHeaderMetaItem[];
  className?: string;
}) {
  return (
    <header className={["page-header", "card", actions ? "" : "page-header--no-actions", className].filter(Boolean).join(" ")}>
      <div className="page-header-text">
        <div className="page-header-copy">
          <div className="page-header-title-row">
            <h1 className="page-header-title">{title}</h1>
          </div>
        </div>
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}
