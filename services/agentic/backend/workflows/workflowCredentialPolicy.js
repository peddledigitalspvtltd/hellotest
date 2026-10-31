// Workflow graphs keep managed connection references. Credential material is
// stored only by connectionSettings and resolved immediately before transport.
const object = value => value && typeof value === "object" && !Array.isArray(value);
const privateField = /^(?:secretPreview|secret|password|passwd|token|value|api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret)$/i;
const metadataFields = new Set(["id", "name", "agentId", "authType", "location", "keyName", "secretReference", "description", "connectionId"]);
const nonempty = value => value !== undefined && value !== null && value !== "";
const fail = () => Object.assign(new Error("Store credentials in a managed HTTP or MCP connection and select its connection reference; inline workflow credentials are not supported."), { statusCode: 400, code: "WORKFLOW_INLINE_CREDENTIAL", publicMessage: "Store credentials in a managed HTTP or MCP connection and select its connection reference; inline workflow credentials are not supported." });

function credentialMetadata(value, reject) {
  if (!object(value)) return {};
  if (reject && Object.entries(value).some(([key, item]) => privateField.test(key) && nonempty(item))) throw fail();
  return Object.fromEntries(Object.entries(value).filter(([key, item]) => metadataFields.has(key) && typeof item === "string"));
}
function safeNode(node, reject) {
  if (!object(node)) return node;
  const key = object(node.data) ? "data" : object(node.parameters) ? "parameters" : null;
  if (!key) return { ...node };
  const data = { ...node[key] };
  for (const field of ["apiAuth", "credential", "credentials"]) {
    if (reject && nonempty(data[field]) && !(object(data[field]) && !Object.keys(data[field]).length)) throw fail();
    delete data[field];
  }
  return { ...node, [key]: data };
}
function definition(value, { reject = false } = {}) {
  if (!object(value)) return value;
  const result = { ...value };
  if (object(value.settings)) {
    result.settings = { ...value.settings };
    if (Array.isArray(value.settings.agenticCredentials)) result.settings.agenticCredentials = value.settings.agenticCredentials.map(item => credentialMetadata(item, reject));
    else if (value.settings.agenticCredentials !== undefined) delete result.settings.agenticCredentials;
  }
  if (Array.isArray(value.nodes)) result.nodes = value.nodes.map(node => safeNode(node, reject));
  if (object(value.n8n_payload)) result.n8n_payload = definition(value.n8n_payload, { reject });
  return result;
}
const safeDefinition = value => definition(value);
const assertDefinition = value => { definition(value, { reject: true }); };
module.exports = { safeDefinition, assertDefinition };
