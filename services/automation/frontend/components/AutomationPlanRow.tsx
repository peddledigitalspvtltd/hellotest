import { memo, useSyncExternalStore, type ReactNode } from "react";
import type { TestStep } from "@hellotest/platform/frontend/src/types";
import type { AutomationDraftStore } from "../lib/automationDraftStore";

export type AutomationPlanGroup = { id: string; title: string; subtitle: string; steps: TestStep[]; isStandalone: boolean };
export type AutomationPlanRowInput = { step: TestStep; group: AutomationPlanGroup; precondition: boolean };
type Props = AutomationPlanRowInput & {
  store: AutomationDraftStore;
  render: (input: AutomationPlanRowInput) => ReactNode;
  expanded: boolean;
  instructionsVisible: boolean;
  selected: boolean;
  presentationKey: string;
};

/** The store notification for another row retains this row's snapshot identity. */
export const AutomationPlanRow = memo(function AutomationPlanRow({ store, render, step, group, precondition }: Props) {
  useSyncExternalStore(store.subscribe, () => store.row(step.id), () => store.row(step.id));
  return render({ step, group, precondition });
});
