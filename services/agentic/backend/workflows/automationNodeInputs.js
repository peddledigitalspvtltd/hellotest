const { normalizeAutomationStartUrl } = require('@hellotest/platform/backend/src/utils/automationStartUrl');
const { normalizeParameterLayer } = require('@hellotest/platform/backend/src/utils/stepParameterResolution');
const { referenceKey, referencedParameterNames, parameterReference, createBrowserParameterResolver } = require('@hellotest/automation/backend/lib/automationBrowserParameters');
const { fail } = require('./endpointPolicy');

const SENSITIVE = /password|passwd|secret|token|credential|api.?key|authorization|cookie|session|csrf|xsrf|private.?key|connection.?string|passcode|(?:^|[._ -])pin(?:$|[._ -])|otp|verification.?code|one.?time.?code/i;
function parameterData(value) {
  if (value == null || value === '') return {};
  if (typeof value === 'string') {
    if (Buffer.byteLength(value) > 16384) throw fail('Automation data is limited to 16 KB.', 422);
    try { value = JSON.parse(value); } catch { throw fail('Automation data must be a valid JSON object.', 422); }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 100
    || Buffer.byteLength(JSON.stringify(value)) > 16384) throw fail('Supply an Automation data JSON object with up to 100 parameters and 16 KB.', 422);
  const check = (entry, key = '', depth = 0) => {
    if (depth > 12) throw fail('Automation data supports up to 12 nested levels.',422);
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw fail('Automation data contains a reserved parameter name.', 422);
    if (SENSITIVE.test(key) && entry != null && entry !== '' && !(typeof entry === 'string' && referenceKey(entry))) {
      throw fail('Use the protected Password credential or a parameter reference for sensitive Automation data.', 422);
    }
    if (typeof entry === 'string' && /^\s*[\[{]/.test(entry)) {
      let nested;try { nested=JSON.parse(entry); } catch { /* Literal non-JSON strings stay literal data. */ }
      if (nested && typeof nested === 'object') check(nested,'',depth+1);
    }
    if (entry && typeof entry === 'object') for (const [name, item] of Object.entries(entry)) check(item, name, depth + 1);
  };
  check(value);
  return normalizeParameterLayer(Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    item && typeof item === 'object' ? JSON.stringify(item) : String(item ?? '')])), 't');
}
function validateNodeOptions(data = {}) {
  const browserMode = data.automationBrowserMode ?? (data.inspectBrowser === false ? 'offline' : 'read_only');
  if (!['perform_steps', 'read_only', 'offline'].includes(browserMode)) throw fail('Choose perform steps, read-only inspection or offline generation for Automation Engineer.', 422);
  if (data.automationPassword != null && data.automationPassword !== '') throw fail('Store the Automation password in a protected credential and select it on the node.', 422);
  if (data.automationUsername != null && (typeof data.automationUsername !== 'string' || data.automationUsername.length > 255 || /[\r\n]/.test(data.automationUsername))) throw fail('Supply an Automation username of up to 255 characters without line breaks.', 422);
  if (data.automationCredentialId && (typeof data.automationCredentialId !== 'string' || !/^[\w-]{1,160}$/.test(data.automationCredentialId))) throw fail('Select a protected Automation credential.', 422);
  if (data.testEnvironmentId && (typeof data.testEnvironmentId !== 'string' || !/^[\w-]{1,160}$/.test(data.testEnvironmentId))) throw fail('Select a valid Test Environment.', 422);
  const startUrl = data.automationStartUrl == null || data.automationStartUrl === '' ? null
    : normalizeAutomationStartUrl(data.automationStartUrl, { required: false });
  if (startUrl) {
    const url = new URL(startUrl), names = [...url.searchParams.keys(), ...new URLSearchParams(url.hash.slice(1)).keys()];
    if (names.some(name=>SENSITIVE.test(name)||/^(?:signature|x-amz-signature|x-goog-signature)$/i.test(name))) throw fail('Keep credentials and signed tokens out of the Automation URL. Use a protected credential or parameter.',422);
  }
  return { startUrl, browserMode, values: parameterData(data.automationData), username: data.automationUsername,
    credentialId: data.automationCredentialId || null, testEnvironmentId: data.testEnvironmentId || null };
}

// Credential authority is scoped to the application origin and checked again
// immediately before each case. Only its opaque ID enters a workflow snapshot.
async function selectedEnvironment({ run, node, user, access, options = validateNodeOptions(node.data) }) {
  if (options.testEnvironmentId) {
    await access(user, run.project_id, ['environment.view']);
    let environment;
    try { environment = await require('@hellotest/testing/backend/services/testEnvironment.service').getTestEnvironment(options.testEnvironmentId); }
    catch (error) {
      if (/^Test environment not found$/i.test(error?.message || '')) throw Object.assign(fail('The selected Test Environment is no longer available. Choose another environment.', 404), { code: 'AUTOMATION_ENVIRONMENT_UNAVAILABLE' });
      throw error;
    }
    if (environment.project_id !== run.project_id || environment.app_type_id && environment.app_type_id !== run.app_type_id) {
      throw fail('The selected Test Environment must belong to this workflow project and application.', 403);
    }
    return environment;
  }
  return null;
}
// Environment reads expose secret-presence metadata, never stored secrets.
// Keep the names available for preflight while the native builder owns actual
// protected-value resolution immediately before browser dispatch.
function environmentParameterNames(environment) {
  return Object.keys(normalizeParameterLayer(Object.fromEntries((environment?.variables || [])
    .filter(row => row && (!row.is_secret || row.has_stored_value === true || Boolean(row.value)))
    .map(row => [row.key, ''])), 'r'));
}
function environmentPrivateParameterNames(environment) {
  return Object.keys(normalizeParameterLayer(Object.fromEntries((environment?.variables || [])
    .filter(row => row && (row.is_secret || SENSITIVE.test(row.key)) && (!row.is_secret || row.has_stored_value === true || Boolean(row.value)))
    .map(row => [row.key, ''])), 'r'));
}
async function resolveNodeInputs({ run, node, user, access, startUrlFallback }) {
  const options = validateNodeOptions(node.data);
  const values = options.testEnvironmentId ? {} : { ...options.values }, privateValues = {};
  const environment = await selectedEnvironment({ run, node, user, access, options });
  const configuredStartUrl = Object.hasOwn(node.data || {},'automationStartUrl') ? options.startUrl
    : validateNodeOptions({automationStartUrl:run.input_payload?.automation_start_url}).startUrl;
  const environmentStartUrl = environment?.base_url ? normalizeAutomationStartUrl(environment.base_url, { required: false }) : null;
  const startUrl = environmentStartUrl || configuredStartUrl || startUrlFallback || null;
  if (!options.testEnvironmentId && options.username != null && options.username !== '') values['t.username'] = options.username;
  if (!options.testEnvironmentId && options.credentialId) {
    await access(user, run.project_id, ['automation.build', 'automation.code.view', 'data.view']);
    if (!startUrl) throw fail('Supply the application URL before using a protected Automation credential.', 422);
    const { connection } = await require('./connections').resolve(options.credentialId, run.project_id, startUrl, 'http');
    if (!connection || connection.authType !== 'basic' || connection.enabled === false) throw fail('Choose a protected HTTP Basic credential for the application URL.', 422);
    if (connection.secretEnv && !/^AGENTIC_SECRET_[A-Z0-9_]+$/.test(connection.secretEnv)) throw fail('The protected Automation secret reference is invalid.', 503);
    // Managed Basic credentials use the HTTP contract username:password,
    // including environment references. A colon inside the password is data.
    const credential = connection.secretEnv ? process.env[connection.secretEnv] : require('./connectionSettings').credential(connection);
    const separator = typeof credential === 'string' ? credential.indexOf(':') : -1;
    if (separator < 1 || /[\r\n]/.test(credential)) throw fail('The protected Automation Basic credential must contain username:password. Update it in Settings.', 503);
    const password = credential.slice(separator + 1), credentialUsername = credential.slice(0,separator);
    privateValues['t.password'] = password;
    if (!Object.hasOwn(values, 't.username')) values['t.username'] = credentialUsername;
  }
  return { startUrl, browserMode: options.browserMode, values, privateValues, credentialId: options.testEnvironmentId ? null : options.credentialId, testEnvironmentId: options.testEnvironmentId,
    environmentParameterNames: environmentParameterNames(environment), environmentPrivateParameterNames: environmentPrivateParameterNames(environment) };
}

function storyStartUrl(story) {
  const source = [story?.title, story?.description, story?.acceptance_criteria, story?.acceptanceCriteria]
    .filter(value => typeof value === 'string').join('\n').replace(/<[^>]*>/g, ' ').replace(/&amp;/gi, '&');
  const candidates = [...source.matchAll(/https?:\/\/[^\s<>"']+/gi)].map(match => match[0]
    .replace(/[),.;!?\]}]+$/g, '')).filter(Boolean);
  const urls = new Map();
  for (const candidate of candidates) {
    try {
      const normalized = normalizeAutomationStartUrl(candidate, { required: false });
      if (normalized) urls.set(normalized, normalized);
    } catch { /* Invalid or credential-bearing Story links are not execution targets. */ }
  }
  return urls.size === 1 ? urls.values().next().value : null;
}

async function resolveCaseNodeInputs({ run, node, user, access, story }) {
  return resolveNodeInputs({ run, node, user, access, startUrlFallback: storyStartUrl(story) });
}

// Remap authored reference lexemes once. Parameter values stay literal at run
// time; storing "@r.password" as the value of t.password would type that text.
function bindDraftParameters(draft, steps, bindings = {}) {
  const rewrite = value => {
    if (typeof value === 'string') return value.replace(/\bparams\s*\[\s*(["'])(?:\\.|[^\\\r\n])*?\1\s*\]|(?<![A-Za-z0-9_])@(?:(t|s|r)\.)?(\[(?:\\.|[^\\\]\r\n])+\]|[A-Za-z][A-Za-z0-9_-]*)/gi,
      match => { const target = bindings[referenceKey(match)]; return target ? match.startsWith('@') ? parameterReference(target) : `params[${JSON.stringify(target)}]` : match; });
    if (Array.isArray(value)) return value.map(rewrite);
    return value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewrite(item)])) : value;
  };
  const parameterValues = Object.fromEntries(Object.entries(draft.parameter_values || {}).filter(([name]) => !Object.hasOwn(bindings, Object.keys(normalizeParameterLayer({ [name]: '' }, 't'))[0])));
  const mappedSteps = steps.map(step => ({ ...step, action: rewrite(step.action), expected_result: rewrite(step.expected_result),
    ...(step.api_request ? { api_request: rewrite(step.api_request) } : {}) }));
  return { ...draft, parameter_values: parameterValues, steps: mappedSteps,
    ...(draft.gherkin_document ? { gherkin_document: rewrite(draft.gherkin_document) } : {}),
    test_data_options: { ...(draft.test_data_options || {}), private_parameter_names: [...new Set((draft.test_data_options?.private_parameter_names || []).map(name => bindings[name] || name))] } };
}

function caseInputs(draft, steps, inputs) {
  let parameterValues = { ...(draft.parameter_values || {}), ...inputs.values };
  const normalizedValues = normalizeParameterLayer(parameterValues, 't');
  const environmentNames = new Set(inputs.environmentParameterNames || []);
  const environmentPrivateNames = new Set(inputs.environmentPrivateParameterNames || [...environmentNames].filter(name => SENSITIVE.test(name)));
  const bindings = {};
  const missingMarker = value => typeof value === 'string' && /^\[\s*(?:missing|required)\s*:[^\]\r\n]*\]$/i.test(value.trim());
  for (const key of new Set([...Object.keys(normalizedValues), ...referencedParameterNames(steps)])) {
    if (!key.startsWith('t.') || Object.hasOwn(normalizedValues, key) && !missingMarker(normalizedValues[key])) continue;
    const environmentKey = `r.${key.slice(2)}`;
    if (environmentNames.has(environmentKey)) bindings[key] = environmentKey;
  }
  const boundDraft = bindDraftParameters({ ...draft, parameter_values: parameterValues }, steps, bindings);
  parameterValues = boundDraft.parameter_values;
  steps = boundDraft.steps;
  const runtimeValues = { ...parameterValues, ...inputs.privateValues };
  const privateNames = [...new Set([...(boundDraft.test_data_options?.private_parameter_names || []), ...Object.keys(inputs.privateValues), ...environmentPrivateNames])];
  const environmentMetadata = { variables: [...environmentNames].map(key => ({ key, value: '', is_secret: environmentPrivateNames.has(key) })) };
  const resolver = createBrowserParameterResolver({ testCase: boundDraft, caseValues: runtimeValues, environment: environmentMetadata, privateParameterNames: privateNames, steps, materialize: false });
  const normalizedBoundValues = normalizeParameterLayer(parameterValues, 't');
  const publicParameterValues = Object.fromEntries(Object.entries(resolver.publicParameterValues).filter(([key]) => Object.hasOwn(normalizedBoundValues, key)));
  return { draft: { ...boundDraft, parameter_values: parameterValues, test_data_options: { ...(boundDraft.test_data_options || {}), private_parameter_names: privateNames,
    ...(inputs.testEnvironmentId ? { test_environment_id: inputs.testEnvironmentId } : {}) },
    automation_start_url: inputs.startUrl || draft.automation_start_url || undefined, steps,
    ...(inputs.testEnvironmentId ? { test_environment_id: inputs.testEnvironmentId } : {}) },
    runtimeValues: inputs.privateValues,
    // The source classifier sees actual protected availability without copying
    // those values into the durable draft or its lineage fingerprint.
    inputDraft: { ...boundDraft, parameter_values: runtimeValues, steps },
    availableParameterNames: [...environmentNames],
    project: value => typeof value === 'string' ? resolver.projectPrivateText(value, { preserveReferences: true }) : JSON.parse(resolver.projectPrivateText(JSON.stringify(value), { preserveReferences: true })),
    redactError: error => {
      resolver.redactError(error);
      for (const key of ['publicMessage','blocked_steps','validation_feedback']) if (error[key] != null) {
        error[key] = typeof error[key] === 'string' ? resolver.projectPrivateText(error[key])
          : JSON.parse(resolver.projectPrivateText(JSON.stringify(error[key])));
      }
      return error;
    },
    publicInputs: { parameter_values: publicParameterValues,
      private_parameter_references: privateNames,
      ...(Object.keys(bindings).length ? { test_environment_parameter_bindings: bindings } : {}),
      ...(inputs.credentialId ? { credential_id: inputs.credentialId, credential_origin: new URL(inputs.startUrl).origin } : {}) }
  };
}
module.exports = { validateNodeOptions, resolveNodeInputs, resolveCaseNodeInputs, selectedEnvironment, environmentParameterNames, storyStartUrl, caseInputs, bindDraftParameters, parameterData };
