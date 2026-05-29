import type { ReactNode } from "react";
import { InfoTooltip } from "./InfoTooltip";

type PageHeaderMetaItem = {
  label: string;
  value: ReactNode;
};

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  meta,
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
          {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
          <div className="page-header-title-row">
            <h1 className="page-header-title">{title}</h1>
            {description ? <InfoTooltip className="page-description-info" content={description} label="Page information" /> : null}
          </div>
        </div>
        {meta?.length ? (
          <div className="page-header-meta">
            {meta.map((item) => (
              <div className="page-header-meta-item" key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}
