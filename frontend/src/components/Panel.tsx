import type { ReactNode } from "react";
import { InfoTooltip } from "./InfoTooltip";

export function Panel({
  title,
  titleVariant = "heading",
  subtitle,
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
      <div className="panel-head">
        <div>
          <div className="panel-title-row">
            <p className={titleVariant === "eyebrow" ? "eyebrow" : "panel-heading"}>{title}</p>
            {subtitle ? <InfoTooltip content={subtitle} label={`${title} information`} /> : null}
          </div>
        </div>
        {actions ? <div className="panel-head-actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
