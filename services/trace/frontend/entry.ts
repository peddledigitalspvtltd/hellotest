// Public, lazily loaded UI entry points owned by this capability.
export const views = {
  ActivityModelCalls: () => import("./components/ModelCallDetails"),
  SessionModelCalls: () => import("./components/ModelCallDetails"),
  ModelCallDetails: () => import("./components/ModelCallDetails"),
  EngineerModelPayload: () => import("./components/ModelCallDetails"),
  OpsMonitoringWorkspace: () => import("./components/OpsMonitoringWorkspace"),
};
