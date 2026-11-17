import { StepIconShell } from "./CaseStepCards";

export function StepExpandAllIcon() {
  return (
    <StepIconShell>
      <path d="M12 12V4" />
      <path d="m8.5 7.5 3.5-3.5 3.5 3.5" />
      <path d="M12 12v8" />
      <path d="m8.5 16.5 3.5 3.5 3.5-3.5" />
    </StepIconShell>
  );
}

export function StepCollapseAllIcon() {
  return (
    <StepIconShell>
      <path d="M12 4v8" />
      <path d="m8.5 8.5 3.5 3.5 3.5-3.5" />
      <path d="M12 20v-8" />
      <path d="m8.5 15.5 3.5-3.5 3.5 3.5" />
    </StepIconShell>
  );
}

export function StepInsertIcon() {
  return (
    <StepIconShell>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
      <path d="M7 5h10" />
      <path d="M7 19h10" />
    </StepIconShell>
  );
}

export function StepPasteIcon() {
  return (
    <StepIconShell>
      <path d="M8 5.5A2.5 2.5 0 0 1 10.5 3h3A2.5 2.5 0 0 1 16 5.5V7H8z" />
      <path d="M7 7h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z" />
      <path d="M12 10v6" />
      <path d="m9.5 13.5 2.5 2.5 2.5-2.5" />
    </StepIconShell>
  );
}

export function StepParameterIcon() {
  return (
    <StepIconShell>
      <path d="M5 7h14" />
      <path d="M5 12h14" />
      <path d="M5 17h14" />
      <circle cx="10" cy="7" r="2.1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="2.1" fill="currentColor" stroke="none" />
      <circle cx="11.5" cy="17" r="2.1" fill="currentColor" stroke="none" />
      <path d="M4 11.5a3.7 3.7 0 0 0 0 1" />
      <path d="M3.1 9.4 4.3 10" />
      <path d="M4.3 14 3.1 14.6" />
      <path d="M2.5 12h1.2" />
    </StepIconShell>
  );
}

export function ExecutionStepsIcon() {
  return (
    <StepIconShell>
      <path d="M8 7h10" />
      <path d="M8 12h10" />
      <path d="M8 17h10" />
      <circle cx="5" cy="7" r="1" fill="currentColor" stroke="none" />
      <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="5" cy="17" r="1" fill="currentColor" stroke="none" />
    </StepIconShell>
  );
}
