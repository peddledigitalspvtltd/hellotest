const { randomUUID, createHash } = require('node:crypto');
const context = require('./llmTraceContext');
const { redactSensitiveData } = require('../security/aiTextPolicy');

const MAX_CHARS = 96_000;
const SECRET = /^(?:authorization|cookie|set-cookie|password|passwd|secret|client_secret|secret_key|private_key|credential|connection_string|token|api[_-]?key|access[_-]?token|refresh[_-]?token|reasoning_content|reasoning|thinking)$/i;
const SENSITIVE_QUERY=/([?&](?:token|key|api[_-]?key|access[_-]?token|refresh[_-]?token|signature|x-amz-signature|x-amz-credential|x-goog-signature)=)[^&#\s"'<>]+/gi;
function sanitize(value) {
  let remaining = MAX_CHARS, entries = 3000, truncated = false, redacted = false;
  function visit(item, depth = 0) {
    if (remaining <= 0 || --entries <= 0 || depth > 18) { truncated = true; return '[CAPTURE_LIMIT]'; }
    if (typeof item === 'string') {
      if (/^data:[^;,]+;base64,/i.test(item)) { redacted = true; return '[BINARY_INPUT_OMITTED]'; }
      // JSON-encoded tool arguments can themselves contain credential fields.
      if (/^\s*[\[{]/.test(item)) { try { return JSON.stringify(visit(JSON.parse(item), depth + 1)); } catch { /* ordinary text */ } }
      const safe = redactSensitiveData(item).text
        .replace(/(["']?(?:password|passwd|secret|client_secret|api[_-]?key|access[_-]?token)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}\]]+)/gi, '$1[REDACTED]')
        .replace(/\b(https?|postgres(?:ql)?):\/\/[^\s/@]+:[^\s/@]+@/gi, '$1://[REDACTED]@')
        .replace(/\bsk-[A-Za-z0-9_-]{12,}/g, '[REDACTED_KEY]');
      const safeUrl=safe.replace(SENSITIVE_QUERY,'$1[REDACTED]');
      redacted ||= safeUrl !== item;
      const result = safeUrl.slice(0, remaining); truncated ||= result.length < safeUrl.length; remaining -= result.length;
      return result;
    }
    if (Array.isArray(item)) {
      const output = [];
      for (const entry of item.slice(0,200)) {
        if (remaining <= 0 || entries <= 0) { truncated = true; break; }
        output.push(visit(entry,depth+1));
      }
      truncated ||= output.length < item.length;
      return output;
    }
    if (item && typeof item === 'object') {
      const output = [], input = Object.entries(item);
      const privateEntry=item.is_secret===true||SECRET.test(String(item.key||item.name||'').replace(/^x[-_]/i,''));
      for (const [key,val] of input.slice(0,200)) {
        if (remaining <= 0 || entries <= 0) { truncated = true; break; }
        const boundedKey = key.slice(0,Math.min(255,remaining)); remaining -= boundedKey.length;
        truncated ||= boundedKey !== key;
        if (SECRET.test(key)||(privateEntry&&key==='value')) { redacted = true; output.push([boundedKey,'[REDACTED]']); }
        else output.push([boundedKey,visit(val,depth+1)]);
      }
      truncated ||= output.length < input.length;
      return Object.fromEntries(output);
    }
    remaining -= String(item).length;
    return item;
  }
  return { payload: visit(value), truncated, redacted };
}
const parse = value => { try { return JSON.parse(value); } catch { return { text: String(value || '') }; } };
const origin = url => { try { return new URL(url).origin; } catch { return null; } };
function generationCorrelation(scope) {
  const bounded = value => typeof value === 'string' && value.length > 0 && value.length <= 200 ? value : null;
  const result = {};
  if (bounded(scope.test_case_id)) result.test_case_id = scope.test_case_id;
  if (Number.isSafeInteger(scope.completion_attempt) && scope.completion_attempt > 0 && scope.completion_attempt <= 100) result.completion_attempt = scope.completion_attempt;
  if (['case_attempt','section_attempt','section_semantic_review','section_prerequisite_review','case_metadata','flow_plan'].includes(scope.generation_scope) && result.test_case_id) {
    result.generation_scope = scope.generation_scope;
    if (['section_attempt','section_semantic_review','section_prerequisite_review'].includes(scope.generation_scope) && Number.isSafeInteger(scope.section_attempt) && scope.section_attempt > 0 && scope.section_attempt <= 3) result.section_attempt = scope.section_attempt;
    const sections = [...new Set((Array.isArray(scope.generation_section_ids) ? scope.generation_section_ids : []).filter(bounded))];
    result.generation_section_ids = sections.slice(0, 500);
    result.generation_section_count = sections.length;
    result.generation_section_ids_truncated = sections.length > 500;
  }
  return result;
}
async function notify(trace,record){
 if(typeof trace.scope.on_llm_trace!=='function')return;
 let timer;
 try{await Promise.race([Promise.resolve().then(()=>trace.scope.on_llm_trace({trace_id:trace.id,call_id:trace.id,feature:trace.scope.feature,model:trace.model,stage:trace.profileCapture.request_stage,dispatched:trace.profileCapture.request_stage==='provider_dispatch',...generationCorrelation(trace.scope),...record})),new Promise(resolve=>{timer=setTimeout(resolve,500);})]);}catch{/* Activity logging cannot replay or discard a generation. */}finally{clearTimeout(timer);}
}
let failures = 0;
const write = async (text, values) => {
  // Bounded database calls; tracing must never replay or discard a generation.
  try {
    const db = require('../obsDb');
    await db.pool.query({ text, values, query_timeout: 1500 });
    return true;
  } catch {
    failures += 1;
    if (failures === 1 || failures % 100 === 0) console.warn(JSON.stringify({ event: 'llm.trace_storage_unavailable', failed_writes: failures }));
    return false;
  }
};

async function begin({ url, init, options, correctionOf }) {
  const scope = { ...context.current(options.integration), ...options.traceContext };
  scope.feature ||= options.featureKey || null;
  if (!scope.project_id && !scope.actor_id) return null;
  const raw = typeof init.body === 'string' ? init.body : '';
  const parsed = parse(raw);
  const request = sanitize(parsed);
  const profileCapture = { scope: scope.project_id ? "project" : "instance", request_stage:options.traceStage||'provider_dispatch',request_utf8_bytes:Buffer.byteLength(raw,'utf8'),configuration_source: scope.configuration_source || null, configuration_owner:scope.configuration_owner || null, configuration_scope:scope.configuration_scope ? {id:String(scope.configuration_scope.id || '').slice(0,200),revision:String(scope.configuration_scope.revision ?? '').slice(0,200),feature_id:String(scope.configuration_scope.feature_id || '').slice(0,128)} : null, configuration_version: scope.configuration_version ?? null, configuration_hash: scope.configuration_hash || null, feature_group: scope.feature_group || null, instruction_versions:scope.instruction_versions||null,metric_versions:scope.metric_versions||null, mcp_context: scope.mcp_context || options.mcpContextStatus || null, ...generationCorrelation(scope) };
  profileCapture.request_structure=require('./aiPromptEnvelope').requestMetrics(parsed,raw);
  const trace = { profileCapture, id: randomUUID(), started: Date.now(), request, scope,model:parsed.model||options.integration?.model||null };
  trace.saved = await write(`INSERT INTO llm_request_traces
    (id, project_id, actor_id, request_id, trace_id, run_id, node_id, session_id, operation, feature,
     integration_id, integration_name, provider_origin, requested_model, status, started_at, request_payload, request_hash, capture, correction_of)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'running',$15,$16,$17,$18,$19)`,
  [trace.id, scope.project_id, scope.actor_id, scope.request_id, scope.trace_id, scope.run_id || null, scope.node_id || null, scope.session_id || null,
    options.operation || 'llm.request', scope.feature, options.integration?.id || null, options.integration?.name || null, origin(url), parsed.model || null,
    new Date(trace.started), request.payload, createHash('sha256').update(raw).digest('hex'), { ...profileCapture, request_truncated: request.truncated, redacted: request.redacted }, correctionOf || null]);
  trace.dispatched = Date.now();
  await notify(trace,{status:'running',attempt:1,trace_capture:trace.saved?'recorded':'unavailable'});
  return trace;
}

// Called synchronously at the actual fetch boundary. Trace storage and activity
// logging can consume the deadline without ever dispatching a provider request.
function dispatch(trace,attempt=1) {
  if(!trace)return;
  trace.profileCapture.request_stage='provider_dispatch';
  trace.dispatched=Date.now();
  void notify(trace,{status:'running',attempt,trace_capture:trace.saved?'recorded':'unavailable'});
}

async function finish(trace, { response, error, invalid = false, attempts = 1 } = {}) {
  if (!trace) return;
  let raw = null;
  // LLM transport buffers its bounded body before this point. Cloning preserves
  // the caller's response. Hidden provider reasoning is never exposed in logs.
  if (response) { try { raw = parse(await response.clone().text()); } catch { /* failed body */ } }
  const result = sanitize(raw);
  const code = error?.code || error?.name || (response && !response.ok ? `HTTP_${response.status}` : null);
  const status = invalid ? 'invalid' : error ? (/ABORT|CANCEL/i.test(code) ? 'cancelled' : 'failed') : response?.ok ? 'succeeded' : 'failed';
  let usage = raw?.usage && typeof raw.usage === 'object' ? Object.fromEntries(['prompt_tokens', 'completion_tokens', 'total_tokens', 'input_tokens', 'output_tokens'].filter(key => Number.isSafeInteger(raw.usage[key]) && raw.usage[key]>=0).map(key => [key, raw.usage[key]])) : null;
  if(usage){
    const input=usage.prompt_tokens??usage.input_tokens;
    const cached=raw.usage.cached_input_tokens??raw.usage.prompt_tokens_details?.cached_tokens??raw.usage.input_tokens_details?.cached_tokens;
    // Cached input is a reported subset, never an extra contribution to total.
    if(Number.isSafeInteger(input)&&Number.isSafeInteger(cached)&&cached>=0&&cached<=input)usage.cached_input_tokens=cached;
  }
  if (usage && usage.total_tokens == null) {
    const input = usage.prompt_tokens ?? usage.input_tokens, output = usage.completion_tokens ?? usage.output_tokens;
    if (input != null && output != null && Number.isSafeInteger(input+output)) usage.total_tokens=input+output;
  }
  if (usage && !Object.keys(usage).length) usage=null;
  const saved = await write(`UPDATE llm_request_traces SET status=$2, completed_at=CURRENT_TIMESTAMP, duration_ms=$3,
    http_status=$4, effective_model=$5, provider_request_id=$6, usage=$7, response_payload=$8, capture=$9, error_code=$10, attempt=$11 WHERE id=$1`,
  [trace.id, status, Math.max(0, (trace.received || Date.now()) - (trace.dispatched || trace.started)), response?.status || null, typeof raw?.model === 'string' ? raw.model.slice(0, 255) : null,
    response?.headers?.get('x-request-id')?.slice(0, 255) || (typeof raw?.id === 'string' ? raw.id.slice(0, 255) : null), usage, result.payload,
    { ...trace.profileCapture, request_truncated: trace.request.truncated, response_truncated: result.truncated, redacted: result.redacted || trace.request.redacted, body_available: raw !== null }, code?.slice(0, 100) || null, attempts]);
  if (response?.headers?.set) {
    response.headers.set('x-hellotest-llm-trace-id', trace.id);
    response.headers.set('x-hellotest-llm-trace-status', trace.saved && saved ? 'recorded' : 'unavailable');
  }
  await notify(trace,{status,attempt:attempts,http_status:response?.status||null,duration_ms:Math.max(0,(trace.received||Date.now())-(trace.dispatched||trace.started)),usage,error_code:code?.slice(0,100)||null,trace_capture:trace.saved&&saved?'recorded':'unavailable'});
}
module.exports = { begin, dispatch, finish, sanitize, diagnostics: () => ({ failed_writes: failures }) };
