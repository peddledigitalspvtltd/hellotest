import { forwardRef, type SelectHTMLAttributes } from "react";
import "./ui-controls.css";

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className = "", ...props }, ref) {
  return <select {...props} ref={ref} className={`ui-select ${className}`.trim()} />;
});
