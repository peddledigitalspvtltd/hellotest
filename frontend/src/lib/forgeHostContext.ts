export type HelloTestForgeHostContext = {
  moduleKey: string;
  moduleType: string;
  projectId: string;
  projectKey: string;
  isProjectActivationConfig: boolean;
};

const EMPTY_HOST_CONTEXT: HelloTestForgeHostContext = {
  moduleKey: "",
  moduleType: "",
  projectId: "",
  projectKey: "",
  isProjectActivationConfig: false
};

let hostContext = EMPTY_HOST_CONTEXT;

const record = (value: unknown) => value && typeof value === "object"
  ? value as Record<string, unknown>
  : {};

const text = (...values: unknown[]) => values
  .map((value) => String(value || "").trim())
  .find(Boolean) || "";

export function rememberHelloTestForgeHostContext(value: unknown) {
  const context = record(value);
  const extension = record(context.extension);
  const platformContext = record(context.platformContext);
  const project = record(extension.project || platformContext.project);
  const issue = record(extension.issue || platformContext.issue);
  const issueFields = record(issue.fields);
  const issueProject = record(issueFields.project);
  const moduleKey = text(
    extension.moduleKey,
    extension.key,
    context.moduleKey,
    context.localId
  );
  const moduleType = text(extension.type, context.moduleType, context.extensionType);
  const combinedModuleIdentity = [
    moduleKey,
    moduleType,
    extension.moduleKey,
    extension.key,
    context.moduleKey,
    context.localId
  ].map((value) => String(value || "")).join(" ").toLowerCase();
  const explicitPreviewMode = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("hellotestHost")
    : "";

  hostContext = {
    moduleKey,
    moduleType,
    projectId: text(project.id, extension.projectId, platformContext.projectId, issueProject.id),
    projectKey: text(project.key, extension.projectKey, platformContext.projectKey, issueProject.key),
    isProjectActivationConfig: moduleKey === "hellotest-project-activation-config"
      || combinedModuleIdentity.includes("hellotest-project-activation-config")
      || combinedModuleIdentity.includes("jira:adminpage")
      || combinedModuleIdentity.includes("admin-page")
      || explicitPreviewMode === "admin"
  };

  return hostContext;
}

export function readHelloTestForgeHostContext() {
  return hostContext;
}
