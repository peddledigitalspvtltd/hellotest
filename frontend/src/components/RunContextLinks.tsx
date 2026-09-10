import { IconExternalLink } from "@tabler/icons-react";
import type { Execution, ExecutionDataSetSnapshot } from "../types";
import type { RunConfigurationResource } from "./RunConfigurationDialog";

/** Shared run and case context links always open the original resource forms. */
export function RunContextLinks({ execution, dataSet, dataSetName, onOpen, appTypeKind, showTarget = false }: {
  execution: Execution;
  dataSet?: ExecutionDataSetSnapshot | null;
  dataSetName?: string | null;
  onOpen: (resource: RunConfigurationResource) => void;
  appTypeKind?: string | null;
  showTarget?: boolean;
}) {
  const environment = execution.test_environment;
  const configuration = execution.test_configuration;
  const data = dataSet || execution.test_data_set?.snapshot;
  const targets = configuration?.snapshot?.targets || [];
  const mobile = appTypeKind === "android" || appTypeKind === "ios";
  const target = mobile
    ? targets.find(item => item.mobile_os?.toLowerCase() === appTypeKind) || targets.find(item => item.mobile_os?.trim()) || targets[0]
    : targets.find(item => item.browser?.trim()) || targets[0];
  const isManual = execution.run_mode === "manual" || (!execution.run_mode && execution.trigger === "manual");
  return <><div className="execution-run-config-links">
    <button disabled={!environment?.snapshot && !environment?.id} onClick={() => onOpen("environment")} type="button"><span>Environment</span><strong>{environment?.snapshot?.name || environment?.name || "Not attached"}</strong><IconExternalLink size={15} /></button>
    <button disabled={!data && !execution.test_data_set?.id} onClick={() => onOpen("data")} type="button"><span>Test data</span><strong>{dataSetName || data?.name || execution.test_data_set?.name || "Not attached"}</strong><IconExternalLink size={15} /></button>
    <button disabled={!configuration?.snapshot && !configuration?.id} onClick={() => onOpen("configuration")} type="button"><span>Configuration</span><strong>{configuration?.snapshot?.name || configuration?.name || "Not attached"}</strong><IconExternalLink size={15} /></button>
  </div>{showTarget && target ? <small className="execution-case-configuration-target">
    {isManual ? "Manual configuration reference" : "Configured automation target"}: row {targets.indexOf(target) + 1} of {targets.length} · {[target.os, target.browser, target.mobile_os, target.version].filter(Boolean).join(" · ")}
  </small> : null}</>;
}
