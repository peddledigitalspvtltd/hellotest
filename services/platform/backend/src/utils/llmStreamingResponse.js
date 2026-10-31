// Assemble an OpenAI-compatible chat stream while forwarding only public text
// deltas. Reasoning blocks and incomplete tool JSON never cross this boundary.
const failure = (message, code = 'AI_STREAM_INVALID') => Object.assign(new Error(message), {
  publicMessage: message, code, statusCode: 502, retryable: false, nonRetryable: true, generation_received: true
});
async function consumeChatStream(response, { onTextDelta, signal, maxBytes = 2 * 1024 * 1024 } = {}) {
  if (!response.ok || !/text\/event-stream/i.test(response.headers.get('content-type') || '')) return response;
  if (!response.body?.getReader) throw failure('The model returned an unreadable stream.');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let pending = '', dataLines = [], eventName = '', bytes = 0, frames = 0, doneMarker = false, finishReason = null;
  let id, model, created, usage, content = '', refusal = '';
  const tools = new Map();
  const max = Math.min(8 * 1024 * 1024, Math.max(1024, Number(maxBytes) || 2 * 1024 * 1024));
  const frame = async () => {
    const raw = dataLines.join('\n'), name = eventName;
    dataLines = []; eventName = '';
    if (!raw) return;
    if (++frames > 32768) throw failure('The model stream exceeded its event budget.', 'AI_STREAM_LIMIT');
    if (raw === '[DONE]') { doneMarker = true; return; }
    if (doneMarker) throw failure('The model sent data after completing its stream.');
    let value;
    try { value = JSON.parse(raw); } catch { throw failure('The model sent a malformed stream event.'); }
    if (name === 'error' || value.error) throw failure('The model reported an error during generation.', 'AI_STREAM_PROVIDER_ERROR');
    if (typeof value.id === 'string') { if (id && value.id !== id) throw failure('The model changed response identity during streaming.'); id = value.id; }
    if (typeof value.model === 'string') model = value.model;
    if (Number.isFinite(value.created)) created = value.created;
    if (value.usage && typeof value.usage === 'object') usage = value.usage;
    if (!Array.isArray(value.choices)) return;
    const choice = value.choices.find(item => item.index === 0) || (value.choices.length === 1 && value.choices[0].index == null ? value.choices[0] : null);
    if (!choice) return;
    const delta = choice.delta || {};
    if (typeof delta.content === 'string') {
      if (finishReason) throw failure('The model continued content after its terminal event.');
      content += delta.content;
      if (typeof onTextDelta === 'function' && delta.content) await onTextDelta(delta.content, { response_id: id, model, choice_index: 0 });
    }
    if (typeof delta.refusal === 'string') refusal += delta.refusal;
    if (Array.isArray(delta.tool_calls)) for (const part of delta.tool_calls) {
      if (!Number.isInteger(part.index) || part.index < 0 || part.index >= 16 || finishReason) throw failure('The model returned an invalid tool stream.');
      const call = tools.get(part.index) || { id: '', type: 'function', function: { name: '', arguments: '' } };
      if (part.type && part.type !== 'function') throw failure('The model returned an unsupported tool type.');
      if (typeof part.id === 'string') call.id += part.id;
      if (typeof part.function?.name === 'string') call.function.name += part.function.name;
      if (typeof part.function?.arguments === 'string') call.function.arguments += part.function.arguments;
      if (call.id.length > 255 || call.function.name.length > 255 || call.function.arguments.length > 65536) throw failure('The model tool call exceeded its budget.', 'AI_STREAM_LIMIT');
      tools.set(part.index, call);
    }
    if (choice.finish_reason != null) {
      if (finishReason && finishReason !== choice.finish_reason) throw failure('The model sent conflicting terminal events.');
      finishReason = choice.finish_reason;
    }
  };
  const line = async value => {
    if (value === '') return frame();
    if (value.startsWith(':')) return;
    const split = value.indexOf(':'), key = split < 0 ? value : value.slice(0, split);
    let item = split < 0 ? '' : value.slice(split + 1);
    if (item.startsWith(' ')) item = item.slice(1);
    if (key === 'data') dataLines.push(item);
    if (key === 'event') eventName = item;
  };
  const lines = async (final = false) => {
    while (true) {
      const match = /\r\n|\r|\n/.exec(pending);
      if (!match || (!final && match[0] === '\r' && match.index === pending.length - 1)) break;
      const value = pending.slice(0, match.index); pending = pending.slice(match.index + match[0].length);
      await line(value);
    }
    if (final && pending) { await line(pending); pending = ''; }
  };
  const abort = () => { void reader.cancel(signal?.reason).catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      if (signal?.aborted) throw signal.reason || new DOMException('Cancelled', 'AbortError');
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > max) throw failure('The model stream exceeded its response budget.', 'AI_STREAM_LIMIT');
      pending += decoder.decode(chunk.value, { stream: true });
      await lines();
      if (pending.length > 256 * 1024) throw failure('The model stream event exceeded its frame budget.', 'AI_STREAM_LIMIT');
    }
    if (signal?.aborted) throw signal.reason || new DOMException('Cancelled', 'AbortError');
    pending += decoder.decode(); await lines(true);
    // An SSE event is dispatched only after its blank line, never a network EOF.
    if (dataLines.length || !finishReason) throw failure('The model stream ended before a complete response was recorded.', 'AI_STREAM_INCOMPLETE');
    if (!['stop', 'tool_calls', 'length', 'content_filter'].includes(finishReason)) throw failure('The model returned an unsupported completion reason.', 'AI_STREAM_STOP_REASON');
    const calls = [...tools.entries()].sort(([a], [b]) => a - b).map(([, value]) => value);
    if (finishReason === 'tool_calls' && !calls.length || calls.some(call => !call.id || !call.function.name)) throw failure('The model returned incomplete tool calls.', 'AI_INVALID_TOOL_ARGUMENTS');
    const headers = new Headers(response.headers);
    headers.set('content-type', 'application/json'); headers.delete('content-length'); headers.delete('content-encoding');
    headers.set('x-hellotest-stream-assembled', 'true');
    return new Response(JSON.stringify({ id, object: 'chat.completion', model, created, ...(usage ? { usage } : {}),
      choices: [{ index: 0, finish_reason: finishReason, message: { role: 'assistant', content: content || null,
        ...(refusal ? { refusal } : {}), ...(calls.length ? { tool_calls: calls } : {}) } }] }), { status: response.status, statusText: response.statusText, headers });
  } catch (error) {
    await reader.cancel().catch(() => {});
    error.retryable = false; error.nonRetryable = true; error.generation_received = true;
    throw error;
  } finally { signal?.removeEventListener('abort', abort); reader.releaseLock(); }
}
module.exports = { consumeChatStream };
