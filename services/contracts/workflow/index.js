// Portable node descriptors. No service imports, transport, I/O or executable
// expressions belong in this package.
const NODE_DESCRIPTOR_VERSION = 1;
const EXECUTOR_FAMILIES = Object.freeze(['trigger','specialist','repository','merge','output','operation','flow']);
function assertNodeRegistry(registry) {
  if (registry?.version !== NODE_DESCRIPTOR_VERSION || !registry.kinds || typeof registry.kinds !== 'object') throw new Error('Unsupported workflow node registry version.');
  for (const [kind, descriptor] of Object.entries(registry.kinds)) {
    if (descriptor.kind !== kind || !EXECUTOR_FAMILIES.includes(descriptor.executor) || typeof descriptor.executable !== 'boolean'
      || typeof descriptor.label !== 'string' || !descriptor.label || descriptor.schema?.type !== 'object'
      || descriptor.schema?.properties?.kind?.const !== kind || !['always','http_write','never'].includes(descriptor.exclusive)
      || !Array.isArray(descriptor.handles) || !descriptor.ui || !descriptor.defaults) throw new Error(`Invalid workflow node descriptor: ${kind}.`);
  }
  return registry;
}
function validateNodeEnvelope(descriptor, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return ['Node configuration must be an object.'];
  if (data.kind && data.kind !== descriptor.kind) return ['Node configuration does not match its registered kind.'];
  return [];
}
module.exports = { NODE_DESCRIPTOR_VERSION, EXECUTOR_FAMILIES, assertNodeRegistry, validateNodeEnvelope };
