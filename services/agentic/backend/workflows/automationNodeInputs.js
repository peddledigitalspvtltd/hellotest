const { normalizeAutomationStartUrl } = require('@hellotest/platform/backend/src/utils/automationStartUrl');
const { normalizeParameterLayer } = require('@hellotest/platform/backend/src/utils/stepParameterResolution');
const { referenceKey, createBrowserParameterResolver } = require('@hellotest/automation/backend/lib/automationBrowserParameters');
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
  if (data.automationPassword != null && data.automationPassword !== '') throw fail('Store the Automation password in a protected credential and select it on the node.', 422);
  if (data.automationUsername != null && (typeof data.automationUsername !== 'string' || data.automationUsername.length > 255 || /[\r\n]/.test(data.automationUsername))) throw fail('Supply an Automation username of up to 255 characters without line breaks.', 422);
  if (data.automationCredentialId && (typeof data.automationCredentialId !== 'string' || !/^[\w-]{1,160}$/.test(data.automationCredentialId))) throw fail('Select a protected Automation credential.', 422);
  const startUrl = data.automationStartUrl == null || data.automationStartUrl === '' ? null
    : normalizeAutomationStartUrl(data.automationStartUrl, { required: false });
  if (startUrl) {
    const url = new URL(startUrl), names = [...url.searchParams.keys(), ...new URLSearchParams(url.hash.slice(1)).keys()];
    if (names.some(name=>SENSITIVE.test(name)||/^(?:signature|x-amz-signature|x-goog-signature)$/i.test(name))) throw fail('Keep credentials and signed tokens out of the Automation URL. Use a protected credential or parameter.',422);
  }
  return { startUrl, values: parameterData(data.automationData), username: data.automationUsername, credentialId: data.automationCredentialId || null };
}

// Credential authority is scoped to the application origin and checked again
// immediately before each case. Only its opaque ID enters a workflow snapshot.
async function resolveNodeInputs({ run, node, user, access }) {
  const options = validateNodeOptions(node.data);
  const values = { ...options.values }, privateValues = {};
  const startUrl = Object.hasOwn(node.data || {},'automationStartUrl') ? options.startUrl
    : validateNodeOptions({automationStartUrl:run.input_payload?.automation_start_url}).startUrl;
  if (options.username != null && options.username !== '') values['t.username'] = options.username;
  if (options.credentialId) {
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
  return { startUrl, values, privateValues, credentialId: options.credentialId };
}

function caseInputs(draft, steps, inputs) {
  const parameterValues = { ...(draft.parameter_values || {}), ...inputs.values };
  const runtimeValues = { ...parameterValues, ...inputs.privateValues };
  const privateNames = [...new Set([...(draft.test_data_options?.private_parameter_names || []), ...Object.keys(inputs.privateValues)])];
  const resolver = createBrowserParameterResolver({ testCase: draft, caseValues: runtimeValues, privateParameterNames: privateNames, steps, materialize: false });
  return { draft: { ...draft, parameter_values: parameterValues, test_data_options: { ...(draft.test_data_options || {}), private_parameter_names: privateNames },
    automation_start_url: inputs.startUrl || draft.automation_start_url || undefined, steps },
    runtimeValues: inputs.privateValues,
    // The source classifier sees actual protected availability without copying
    // those values into the durable draft or its lineage fingerprint.
    inputDraft: { ...draft, parameter_values: runtimeValues, steps },
    project: value => typeof value === 'string' ? resolver.projectPrivateText(value, { preserveReferences: true }) : JSON.parse(resolver.projectPrivateText(JSON.stringify(value), { preserveReferences: true })),
    redactError: error => {
      resolver.redactError(error);
      for (const key of ['publicMessage','blocked_steps','validation_feedback']) if (error[key] != null) {
        error[key] = typeof error[key] === 'string' ? resolver.projectPrivateText(error[key])
          : JSON.parse(resolver.projectPrivateText(JSON.stringify(error[key])));
      }
      return error;
    },
    publicInputs: { parameter_values: resolver.publicParameterValues,
      private_parameter_references: Object.keys(inputs.privateValues),
      ...(inputs.credentialId ? { credential_id: inputs.credentialId, credential_origin: new URL(inputs.startUrl).origin } : {}) }
  };
}
module.exports = { validateNodeOptions, resolveNodeInputs, caseInputs, parameterData };
