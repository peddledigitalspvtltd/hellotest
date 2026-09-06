import { excludeSensitiveStepParameterValues, mapStepParameterSegments } from "../lib/stepParameters";

export function StepParameterizedText({
  text,
  values,
  sensitiveNames = [],
  fallback = "—",
  className = ""
}: {
  text?: string | null;
  values?: Record<string, string>;
  sensitiveNames?: string[];
  fallback?: string;
  className?: string;
}) {
  const segments = mapStepParameterSegments(text, excludeSensitiveStepParameterValues(values, sensitiveNames));

  if (!segments.length) {
    return <span className={className}>{fallback}</span>;
  }

  return (
    <span className={className}>
      {segments.map((segment, index) => {
        if (segment.type === "text") {
          return <span className="step-parameter-text-segment" key={`text-${index}`}>{segment.value}</span>;
        }

        return (
          <span
            className={segment.resolvedValue !== null ? "step-parameter-token is-resolved" : "step-parameter-token is-unresolved"}
            key={`${segment.name}-${index}`}
            title={segment.resolvedValue !== null ? `${segment.token} → ${segment.resolvedValue || "Empty value"}` : `${segment.token} is unresolved`}
          >
            {segment.resolvedValue !== null ? segment.resolvedValue || "Empty value" : segment.token}
          </span>
        );
      })}
    </span>
  );
}
