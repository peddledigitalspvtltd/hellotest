import type { HTMLAttributes, ReactNode } from "react";
import "./ui-controls.css";

export function Card({ heading, description, actions, className = "", children, ...props }: HTMLAttributes<HTMLElement> & { heading?: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return <section {...props} className={`ui-card ${className}`.trim()}>
    {heading || description || actions ? <div className="ui-card-heading"><div>{heading ? <h2>{heading}</h2> : null}{description ? <p>{description}</p> : null}</div>{actions}</div> : null}
    {children}
  </section>;
}
