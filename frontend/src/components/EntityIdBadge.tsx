import type { ReactNode } from "react";
import { DisplayIdBadge } from "./DisplayIdBadge";

export function EntityIdBadge({
  icon,
  value,
  href,
  title,
  className = ""
}: {
  icon: ReactNode;
  value: string;
  href?: string | null;
  title?: string;
  className?: string;
}) {
  return (
    <span className={["entity-id-badge", className].filter(Boolean).join(" ")}>
      {icon}
      <DisplayIdBadge href={href} title={title} value={value} />
    </span>
  );
}
