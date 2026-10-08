// Public, lazily loaded UI entry points owned by this capability.
export const views = {
  SessionModelCalls: () => import("./components/ModelCallDetails"),
  ModelCallDetails: () => import("./components/ModelCallDetails"),
  OpsMonitoringWorkspace: () => import("./components/OpsMonitoringWorkspace"),
};
