import type { ReactNode } from "react";

export function Panel({
  actions,
  className = "",
  children
}: {
  title: string;
  titleVariant?: "heading" | "eyebrow";
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`panel card ${className}`.trim()}>
      {actions ? (
        <div className="panel-head">
          <div className="panel-head-actions">{actions}</div>
        </div>
      ) : null}
      {children}
    </section>
  );
}
