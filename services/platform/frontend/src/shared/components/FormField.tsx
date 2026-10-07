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
  const control = !composite && Children.count(children) === 1 && isValidElement(children)
    ? children as ReactElement<Record<string, unknown>>
    : null;
  const id = (control?.props.id as string | undefined) || inputId || `field-${label.toLowerCase().replace(/\s+/g, "-")}-${generatedId}`;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = mergeAriaDescribedBy(error ? errorId : undefined, hint ? hintId : undefined);

  const fieldControl =
    !composite && Children.count(children) === 1 && isValidElement(children)
      ? cloneElement(children as ReactElement<Record<string, unknown>>, {
          id: (children as ReactElement<Record<string, unknown>>).props.id || id,
          "aria-describedby": mergeAriaDescribedBy(
            (children as ReactElement<Record<string, unknown>>).props["aria-describedby"] as string | undefined,
            describedBy
          ),
          "aria-invalid":
            (children as ReactElement<Record<string, unknown>>).props["aria-invalid"] ||
            Boolean(error) ||
            undefined,
          "aria-required":
            (children as ReactElement<Record<string, unknown>>).props["aria-required"] ||
            required ||
            undefined
        })
      : children;

  return (
    <div className={["form-field", className].filter(Boolean).join(" ")}>
      <label className="form-field-label" htmlFor={id}>
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
