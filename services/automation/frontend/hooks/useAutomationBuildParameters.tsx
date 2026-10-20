import { useEffect, useRef, useState } from "react";
import { api } from "@hellotest/platform/frontend/src/lib/api";
import { AutomationBuildParameterDialog } from "../components/AutomationBuildParameterDialog";
import { automationBuildParameterRequest, type AutomationBuildParameterContext, type AutomationBuildParameterPlan } from "../lib/automationBuildParameters";

type ReviewedBuildParameters = { parameter_values_by_case: Record<string, Record<string, string>>; parameter_plan_keys_by_case: Record<string, string>; test_suite_ids_by_case: Record<string, string | null> };

export function useAutomationBuildParameters(scope: string) {
  const [review, setReview] = useState<{ plan: AutomationBuildParameterPlan; title: string } | null>(null);
  const pending = useRef<{ plan: AutomationBuildParameterPlan; resolve: (value: Record<string, string> | null) => void } | null>(null);
  const active = useRef(false);
  const generation = useRef(0);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  useEffect(() => {
    const current = ++generation.current;
    setReview(null);
    return () => {
      if (current === generation.current) generation.current++;
      pending.current?.resolve(null);pending.current = null;
    };
  }, [scope]);

  const finishReview = (plan: AutomationBuildParameterPlan, values: Record<string, string> | null) => {
    if (pending.current?.plan !== plan) return;
    const { resolve } = pending.current;pending.current = null;setReview(null);resolve(values);
  };
  const reviewBuildParameters = async (caseIds: string[], context: AutomationBuildParameterContext,
    titles: Record<string, string> = {}, { forceReview = false }: { forceReview?: boolean } = {}): Promise<ReviewedBuildParameters | null> => {
    if (active.current) throw new Error("Finish the open test data review before starting another build.");
    active.current = true;
    const epoch = generation.current;
    const reviewScope = scope;
    const isCurrent = () => epoch === generation.current && reviewScope === currentScope.current;
    const result: ReviewedBuildParameters = { parameter_values_by_case: {}, parameter_plan_keys_by_case: {}, test_suite_ids_by_case: {} };
    try {
      for (const caseId of [...new Set(caseIds)]) {
        if (!isCurrent()) return null;
        const request = automationBuildParameterRequest(context, caseId);
        const plan = await api.testCases.automationParameterPlan(caseId, request);
        if (!isCurrent()) return null;
        if (plan.test_case_id !== caseId || !plan.parameter_plan_key) throw new Error("Test data could not be verified for the selected case. Refresh and retry.");
        if (request.test_suite_id && plan.test_suite_id !== request.test_suite_id) throw new Error("The reviewed suite changed. Select the suite and review Test Params again.");
        result.parameter_plan_keys_by_case[caseId] = plan.parameter_plan_key;
        result.test_suite_ids_by_case[caseId] = plan.test_suite_id || null;
        if (!plan.missing_parameter_references.length && !plan.empty_parameter_references?.length && !forceReview) continue;
        const values = await new Promise<Record<string, string> | null>(resolve => {
          pending.current = { plan, resolve };setReview({ plan, title: titles[caseId] || caseId });
        });
        if (!values || !isCurrent()) return null;
        if (Object.keys(values).length) result.parameter_values_by_case[caseId] = values;
      }
      return isCurrent() ? result : null;
    } finally { active.current = false; }
  };
  return { reviewBuildParameters, parameterReviewDialog: review ? <AutomationBuildParameterDialog key={review.plan.test_case_id}
    plan={review.plan} caseTitle={review.title} onClose={() => finishReview(review.plan, null)} onContinue={values => finishReview(review.plan, values)} /> : null };
}
