import { forwardRef, type InputHTMLAttributes } from "react";
import "./ui-controls.css";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className = "", ...props }, ref) {
  return <input {...props} ref={ref} className={`ui-input ${className}`.trim()} />;
});
