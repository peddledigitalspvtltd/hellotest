import { forwardRef, type ButtonHTMLAttributes } from "react";
import "./ui-controls.css";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "plain"; busy?: boolean };
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = "secondary", busy = false, className = "", disabled, type = "button", ...props }, ref) {
  return <button {...props} ref={ref} type={type} disabled={disabled || busy} aria-busy={busy || props["aria-busy"] || undefined} className={`ui-button ui-button--${variant} ${className}`.trim()} />;
});
