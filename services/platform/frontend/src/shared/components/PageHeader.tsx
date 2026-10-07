import type { ReactNode } from "react";
import { InfoTooltip } from "./InfoTooltip";

type PageHeaderMetaItem = {
  label: string;
  value: ReactNode;
};

type PageHeaderTextProps = {
  className?: string;
  description?: ReactNode;
  eyebrow?: string;
  title: ReactNode;
  textAside?: ReactNode;
};

/** Canonical title and description text shared by every workspace page. */
export function PageHeaderText({
  className = "",
  description,
  eyebrow,
  title,
  textAside
}: PageHeaderTextProps) {
  return (
    <div className={["page-header-text", className].filter(Boolean).join(" ")}>
      {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
      <div className="page-header-title-row">
        <h1 className="page-header-title">{title}</h1>
        {description ? <InfoTooltip content={description} label="About this page" className="page-header-help" /> : null}
      </div>
      {textAside ? <div className="page-header-text-aside">{textAside}</div> : null}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  meta,
  textAside,
  className = ""
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  meta?: PageHeaderMetaItem[];
  textAside?: ReactNode;
  className?: string;
}) {
  return (
    <header className={["page-header", actions ? "" : "page-header--no-actions", className].filter(Boolean).join(" ")}>
      <PageHeaderText description={description} eyebrow={eyebrow} title={title} textAside={textAside} />
      {meta?.length ? (
        <dl className="page-header-meta">
          {meta.map((item) => <div className="page-header-meta-item" key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}
        </dl>
      ) : null}
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}
