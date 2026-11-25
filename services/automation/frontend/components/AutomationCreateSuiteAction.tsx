import { useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "@hellotest/platform/frontend/src/lib/api";
import { useCapabilityAccess } from "@hellotest/platform/frontend/src/platform/hooks/useCapabilityAccess";
import { useFeatureFlags } from "@hellotest/platform/frontend/src/platform/hooks/useFeatureFlags";
import { areFeatureFlagsEnabled } from "@hellotest/platform/frontend/src/platform/lib/featureFlags";
import { TileCardSuiteIcon } from "@hellotest/platform/frontend/src/shared/components/TileCardPrimitives";
import type { TestCase } from "@hellotest/platform/frontend/src/types";
import { SuiteCreateModal, type SuiteCreateInput } from "@hellotest/testing/frontend/components/SuiteCreateModal";

export function AutomationCreateSuiteAction({ appTypeId, projectId, cases, selectedIds }: {
  appTypeId: string;
  projectId: string;
  cases: TestCase[];
  selectedIds: string[];
}) {
  const { can } = useCapabilityAccess(projectId);
  const { data: flags } = useFeatureFlags(Boolean(projectId));
  const canUseData = can("data.view") && areFeatureFlagsEnabled(flags, ["hellotest.manual.test_data"]);
  const canConfigureParallel = can("automation.run.parallel") && areFeatureFlagsEnabled(flags, ["hellotest.automation.parallel_execution"]);
  const [selection, setSelection] = useState<string[] | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: (input: SuiteCreateInput) => api.testSuites.create({
      app_type_id: appTypeId,
      name: input.name,
      description: input.description,
      labels: input.labels,
      test_case_ids: input.selectedIds,
      module_ids: input.module_ids,
      module_membership: input.module_membership,
      ...(canUseData ? { test_data_set_id: input.test_data_set_id || undefined, test_data_options: input.test_data_options } : {}),
      ...(canConfigureParallel ? { parallel_enabled: input.parallel_enabled, parallel_count: input.parallel_count } : {})
    }),
    onSuccess: ({ id }) => {
      setSelection(null);
      for (const key of ["design-suites", "test-case-suites", "test-suites", "execution-suites", "test-cases"]) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
      navigate(`/design?suite=${encodeURIComponent(id)}`);
    }
  });

  if (!can("suite.create") || !can("suite.view") || !areFeatureFlagsEnabled(flags, ["hellotest.manual.suites"])) return null;
  return <>
    <button type="button" className="ghost-button" disabled={!selectedIds.length} onClick={() => {
      create.reset();
      setSelection([...selectedIds]);
    }}><TileCardSuiteIcon /><span>Create suite</span></button>
    {selection ? createPortal(<SuiteCreateModal
      mode="create"
      projectId={projectId}
      appTypeId={appTypeId}
      suite={null}
      childSuites={[]}
      appTypeCases={cases}
      availableLabels={[...new Set(cases.flatMap(item => item.labels || []))]}
      canConfigureParallelAutomation={canConfigureParallel}
      selectedCaseIds={selection}
      onClose={() => setSelection(null)}
      onSubmit={input => create.mutate(input)}
      isSaving={create.isPending}
      submitError={create.error?.message}
    />, document.body) : null}
  </>;
}
