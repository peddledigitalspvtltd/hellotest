const SIZE_STATUSES = new Set([400, 413, 422]);

const isContextSizeRejection = (status, detail) => SIZE_STATUSES.has(Number(status)) && (
  Number(status) === 413 || /context[_ -]length[_ -]exceeded|maximum context length|context window.{0,40}(?:exceed|limit)|(?:input|prompt|request|body|payload).{0,45}(?:too (?:large|long)|exceed.{0,20}(?:limit|token))|too many (?:input )?tokens|(?:input|prompt) token.{0,30}(?:limit|exceed)/i.test(String(detail || ''))
);

const boundedText = (value, maximum = 6000) => {
  const text = String(value || '');
  if (text.length <= maximum) return text;
  const tail = Math.min(2000, Math.floor(maximum / 3));
  return `${text.slice(0, maximum - tail)}\n[Additional context omitted due to provider size limit. Do not infer omitted facts.]\n${text.slice(-tail)}`;
};

const buildContextFallbackBody = (body, content) => {
  let payload;
  try { payload = JSON.parse(body); } catch { return null; }
  // Replaying a tool conversation with dropped calls/results is unsafe.
  if (!Array.isArray(payload.messages) || payload.messages.some((message) => message.role === 'tool' || message.tool_calls)) return null;
  const users = payload.messages.filter((message) => message.role === 'user');
  if (!users.length) return null;
  const lastUser = users.at(-1);
  const compact = content !== undefined ? String(content) : boundedText(typeof lastUser.content === 'string'
    ? lastUser.content : (Array.isArray(lastUser.content) ? lastUser.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n') : ''));
  const messages = payload.messages.filter((message) => message.role === 'system' || message.role === 'developer')
    .map((message) => ({ ...message }));
  messages.push({ role: 'user', content: compact });
  const next = JSON.stringify({ ...payload, messages });
  return Buffer.byteLength(next) < Buffer.byteLength(body) ? next : null;
};

module.exports = { isContextSizeRejection, buildContextFallbackBody, boundedText };
