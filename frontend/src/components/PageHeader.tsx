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
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}
