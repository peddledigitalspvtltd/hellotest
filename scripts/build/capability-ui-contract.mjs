import { createHash } from 'node:crypto';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
export function assetPath(value) {
  return typeof value === 'string' && value.length < 512 && /^[A-Za-z0-9_./-]+$/.test(value)
    && value.split('/').every(part => part && !part.startsWith('.'));
}

export function hostRequirements(output) {
  const modules = {};
  for (const chunk of output.filter(row => row.type === 'chunk')) for (const [id, value] of Object.entries(chunk.modules || {})) {
    if (!id.startsWith('\0hellotest-host:')) continue;
    const key = id.slice('\0hellotest-host:'.length);
    modules[key] ||= new Set();
    for (const name of value.renderedExports || []) if (name !== 'default') modules[key].add(name);
  }
  return { protocol: 1, modules: Object.fromEntries(Object.keys(modules).sort().map(key => [key, [...modules[key]].sort()])) };
}

export function hostCompatibility(requirements, host) {
  if (requirements?.protocol !== 1 || host?.protocol !== 1 || !requirements.modules || !host.modules) return ['Host protocol 1 is required.'];
  const missing = [];
  for (const [key, names] of Object.entries(requirements.modules)) {
    if (!host.modules[key]) missing.push(`${key}:module`);
    else for (const name of names) if (!(name in host.modules[key]) || host.modules[key][name] === undefined) missing.push(`${key}:${name}`);
  }
  return missing;
}

export function artifactInventory(output, read) {
  return Object.fromEntries(output.map(file => {
    if (!assetPath(file.fileName)) throw new Error('The capability build emitted an unsafe artifact path.');
    const data = read(file.fileName);
    return [file.fileName, { sha256: sha256(data), bytes: data.length, imports: file.type === 'chunk' ? [...new Set([...file.imports, ...file.dynamicImports])].sort() : [] }];
  }).sort(([left], [right]) => left.localeCompare(right)));
}

export function namespaceArtifacts(inventory) {
  const prefix = 'releases/' + sha256(JSON.stringify(inventory));
  return { prefix, artifacts: Object.fromEntries(Object.entries(inventory).map(([file, value]) => [prefix + '/' + file, { ...value, imports: value.imports.map(imported => prefix + '/' + imported) }])) };
}
export function deploymentEnvironment(receipt, { rollback = false } = {}) {
  if (receipt?.protocol !== 1 || receipt.owner !== 'automation' || receipt.status !== 'validated') throw new Error('A validated Automation release receipt is required.');
  if (!rollback && receipt.host_compatibility?.status !== 'verified') throw new Error('Verify the actual deployed host module contract before enabling the release.');
  return {
    HELLOTEST_AUTOMATION_UI_API_IMAGE: rollback ? receipt.base.api.reference : receipt.release.reference,
    HELLOTEST_AUTOMATION_UI_FRONTEND_IMAGE: receipt.base.frontend.reference,
    HELLOTEST_AUTOMATION_UI_MAP: JSON.stringify(rollback ? receipt.original_ui_map : receipt.ui_map)
  };
}

export function validateRelease(manifest, inventory, owner = 'automation') {
  if (manifest?.protocol !== 1 || manifest.capability !== owner || typeof manifest.version !== 'string' || !manifest.version) throw new Error('The capability manifest identity is incompatible.');
  if (manifest.host?.protocol !== 1 || !manifest.host.modules || !Object.keys(manifest.host.modules).length) throw new Error('The release must declare its actual host module/export requirements.');
  for (const [name, exports] of Object.entries(manifest.host.modules)) if (!name || !Array.isArray(exports) || exports.some(value => typeof value !== 'string')) throw new Error('The host requirement contract is invalid.');
  if (!manifest.artifacts || !Object.keys(manifest.artifacts).length || !Array.isArray(manifest.styles)) throw new Error('The release must declare its artifact inventory.');
  for (const path of [manifest.entry, ...manifest.styles]) if (!assetPath(path) || !manifest.artifacts[path]) throw new Error('A release entry or stylesheet is outside its artifact inventory.');
  for (const [path, expected] of Object.entries(manifest.artifacts)) {
    if (!assetPath(path) || !/^[a-f0-9]{64}$/.test(expected.sha256) || !Number.isSafeInteger(expected.bytes) || expected.bytes < 0 || expected.bytes > 32 * 1024 * 1024 || !Array.isArray(expected.imports)) throw new Error('The artifact inventory has an invalid path, digest or size.');
    const actual = inventory[path];
    if (!actual || actual.sha256 !== expected.sha256 || actual.bytes !== expected.bytes) throw new Error(`The capability artifact does not match its manifest: ${path}`);
    for (const imported of expected.imports) if (!assetPath(imported) || !manifest.artifacts[imported]) throw new Error('A capability chunk imports an undeclared or external artifact.');
  }
  for (const path of Object.keys(inventory)) if (path !== 'manifest.json' && !manifest.artifacts[path]) throw new Error('The new release contains an undeclared artifact.');
  return true;
}

export function verifyOverlay(baseImage, releaseImage, before, after) {
  if (JSON.stringify(releaseImage.RootFS.Layers.slice(0, baseImage.RootFS.Layers.length)) !== JSON.stringify(baseImage.RootFS.Layers)) throw new Error('The release does not preserve the validated base filesystem layers.');
  for (const field of ['Cmd', 'Entrypoint', 'User', 'WorkingDir', 'Env', 'ExposedPorts', 'Healthcheck', 'StopSignal']) if (JSON.stringify(baseImage.Config[field]) !== JSON.stringify(releaseImage.Config[field])) throw new Error(`The UI overlay changed runtime configuration: ${field}`);
  for (const [path, expected] of Object.entries(before)) if (path !== 'automation/manifest.json' && after[path]?.sha256 !== expected.sha256) throw new Error(`The UI overlay changed or removed a retained asset: ${path}`);
  for (const path of Object.keys(after)) if (!before[path] && !path.startsWith('automation/')) throw new Error('The UI overlay added an asset outside Automation.');
  return true;
}
