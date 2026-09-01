import type { ReactNode } from "react";

type PageHeaderMetaItem = {
  label: string;
  value: ReactNode;
};

type PageHeaderTextProps = {
  className?: string;
  description?: ReactNode;
  eyebrow?: string;
  title: ReactNode;
};

/** Canonical title and description text shared by every workspace page. */
export function PageHeaderText({
  className = "",
  description,
  eyebrow,
  title
}: PageHeaderTextProps) {
  return (
    <div className={["page-header-text", className].filter(Boolean).join(" ")}>
      {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
      <div className="page-header-title-row"><h1 className="page-header-title">{title}</h1></div>
      {description ? <div className="page-header-copy">{description}</div> : null}
    </div>
  );
}

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
    <header className={["page-header", actions ? "" : "page-header--no-actions", className].filter(Boolean).join(" ")}>
      <PageHeaderText description={description} eyebrow={eyebrow} title={title} />
      {meta?.length ? (
        <dl className="page-header-meta">
          {meta.map((item) => <div className="page-header-meta-item" key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}
        </dl>
      ) : null}
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}
