import { Children, cloneElement, isValidElement, useId } from "react";
import type { ReactElement, ReactNode } from "react";

function mergeAriaDescribedBy(...values: Array<string | undefined>) {
  return values.filter(Boolean).join(" ") || undefined;
}

export function FormField({
  label,
  labelIcon,
  children,
  composite = false,
  className = "",
  error,
  hint,
  hintVisible = false,
  inputId,
  required
}: {
  label: string;
  labelIcon?: ReactNode;
  children: ReactNode;
  composite?: boolean;
  className?: string;
  error?: string;
  hint?: string;
  hintVisible?: boolean;
  inputId?: string;
  required?: boolean;
}) {
  const generatedId = useId().replace(/:/g, "");
  // An existing control id is authoritative: clicking its label must focus it.
  const controls = Children.toArray(children);
  const control = !composite && controls.length === 1 && isValidElement(controls[0])
    ? controls[0] as ReactElement<Record<string, unknown>>
    : null;
  const id = (control?.props.id as string | undefined) || inputId || `field-${label.toLowerCase().replace(/\s+/g, "-")}-${generatedId}`;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = mergeAriaDescribedBy(error ? errorId : undefined, hint ? hintId : undefined);

  const fieldControl =
    control
      ? cloneElement(control, {
          id: control.props.id || id,
          "aria-labelledby": control.props["aria-labelledby"] || (control.props["aria-label"] ? undefined : `${id}-label`),
          "aria-describedby": mergeAriaDescribedBy(
            control.props["aria-describedby"] as string | undefined,
            describedBy
          ),
          "aria-invalid":
            control.props["aria-invalid"] ||
            Boolean(error) ||
            undefined,
          "aria-required":
            control.props["aria-required"] ||
            required ||
            undefined
        })
      : children;

  return (
    <div className={["form-field", className].filter(Boolean).join(" ")}>
      <label className="form-field-label" htmlFor={id} id={`${id}-label`} onClick={() => document.getElementById(id)?.focus()}>
        {labelIcon ? <span aria-hidden="true" className="form-field-label-icon">{labelIcon}</span> : null}
        <span>{label}</span>
        {required ? <span aria-hidden="true" className="form-field-required-marker"> *</span> : null}
      </label>
      {fieldControl}
      {hint ? <p className={hintVisible ? "form-field-hint" : "form-field-hint sr-only"} id={hintId}>{hint}</p> : null}
      {error ? <span className="form-field-error" id={errorId} role="alert">{error}</span> : null}
    </div>
  );
}
