import { SharedGroupLevelIcon, StandardStepIcon } from "@hellotest/automation/frontend/components/StepAutomationEditor";

export function StepKindIconBadge({
  label,
  tone
}: {
  label: string;
  tone: "default" | "shared" | "local";
}) {
  const className = tone === "shared" ? "step-kind-badge is-shared" : tone === "local" ? "step-kind-badge is-local" : "step-kind-badge is-standard";

  return (
    <span
      aria-label={label}
      className={className}
      title={label}
    >
      {tone === "shared" ? <SharedGroupLevelIcon kind="reusable" /> : tone === "local" ? <SharedGroupLevelIcon kind="local" /> : <StandardStepIcon />}
    </span>
  );
}
