// Application spending limits, not claims about a provider's context window.
// Feature services assemble bounded evidence; never slice serialized JSON here.
const OUTPUT_LIMITS = {
  'requirement.generate': 6144,
  'requirement.optimize': 6144,
  'requirement.grooming': 6144,
  'requirement-design.generate': 8192,
  'case-authoring.generate': 6144,
  'case-authoring.step-rephrase': 1024,
  'quality-assurance.story': 4096,
  'quality-assurance.test-case': 4096,
  'bug-draft.generate': 4096,
  'bug-triage.refine-category': 2048,
  'automation.generate': 8192,
  'execution-analysis.generate': 4096,
  'execution-report.generate': 4096,
  'requirement-release.notes': 4096,
  'execution-planning.generate': 4096,
  'quality-dashboard.generate': 3072,
  'test-data.synthetic': 2048,
  'rich-text.rephrase': 4096
};

const policyError = (message, code, statusCode = 502) => Object.assign(new Error(message), {
  code, statusCode, publicMessage: message
});
const positiveInteger = (value) => Number.isFinite(Number(value)) && Number(value) > 0 ? Math.floor(Number(value)) : null;
const isReasoningModel = (model) => /^(?:gpt-[5-9](?:[.\-]|$)|o[1-9](?:[.\-]|$))/i.test(String(model || '').split('/').at(-1));

const prepareChatRequest = (init, options = {}) => {
  let payload;
  try { payload = JSON.parse(init.body); } catch { return { init }; }
  if (!payload || !Array.isArray(payload.messages)) return { init };
  const maximum = Math.min(16_384, positiveInteger(options.maxOutputTokens) || OUTPUT_LIMITS[options.operation] || 4096);
  const requested = positiveInteger(payload.max_completion_tokens) || positiveInteger(payload.max_tokens) || maximum;
  const field = payload.max_completion_tokens !== undefined || isReasoningModel(payload.model) ? 'max_completion_tokens' : 'max_tokens';
  delete payload.max_tokens;
  delete payload.max_completion_tokens;
  payload[field] = Math.min(requested, maximum);
  // These models reject sampling controls; do not spend a failed round trip.
  if (isReasoningModel(payload.model)) {
    delete payload.temperature;
    delete payload.top_p;
  }
  const textPayload = JSON.stringify({ ...payload, messages: payload.messages.map(message => ({
    ...message,
    content: Array.isArray(message.content) ? message.content.filter(part => part.type !== 'image_url' && part.type !== 'input_audio') : message.content
  })) });
  const maxInputBytes = Math.min(256_000, positiveInteger(options.maxInputBytes) || 96_000);
  if (Buffer.byteLength(textPayload, 'utf8') > maxInputBytes) {
    throw policyError('AI context exceeds this feature’s input budget. Select fewer records or shorten the supporting context and try again.', 'AI_INPUT_BUDGET_EXCEEDED', 422);
  }
  return { init: { ...init, body: JSON.stringify(payload) }, payload };
};

// Only adapt requests the provider explicitly rejected before generation.
const compatibleChatRequest = (init, status, detail) => {
  if (![400, 422].includes(status)) return null;
  let payload;
  try { payload = JSON.parse(init.body); } catch { return null; }
  if (!payload || !Array.isArray(payload.messages)) return null;
  const text = String(detail || '');
  if (/max_tokens/i.test(text) && /max_completion_tokens/i.test(text)
      && /unsupported|not supported|does not support|unknown|unrecognized|not permitted|must use|use.{0,60}instead|replace/i.test(text)) {
    const current = payload.max_completion_tokens !== undefined ? 'max_completion_tokens' : 'max_tokens';
    const next = current === 'max_tokens' ? 'max_completion_tokens' : 'max_tokens';
    payload[next] = payload[current];
    delete payload[current];
  } else if (/temperature|top_p/i.test(text) && /unsupported|not supported|does not support|only.{0,20}default/i.test(text)
      && (payload.temperature !== undefined || payload.top_p !== undefined)) {
    delete payload.temperature;
    delete payload.top_p;
  } else if (/response_format|json_object/i.test(text) && /unsupported|not supported|does not support/i.test(text)
      && payload.response_format?.type === 'json_object') {
    // Keep the feature's schema instructions and local response validation.
    delete payload.response_format;
  } else return null;
  return { ...init, body: JSON.stringify(payload) };
};

const validateChatResponse = async (response, payload) => {
  if (!response.ok || !payload || payload.stream) return false;
  let result;
  try { result = await response.clone().json(); } catch {
    throw policyError('The LLM returned an unreadable response. Check the selected integration and try again.', 'AI_INVALID_RESPONSE');
  }
  const choice = result?.choices?.[0];
  if (choice?.finish_reason === 'length') {
    throw policyError('The LLM reached the output limit before finishing. Request fewer items or a smaller scope and try again.', 'AI_OUTPUT_TRUNCATED');
  }
  if (choice?.finish_reason === 'content_filter' || choice?.message?.refusal) {
    throw policyError('The LLM declined this request. Revise the supplied content or choose another configured model.', 'AI_PROVIDER_REFUSAL');
  }
  if (choice?.message?.tool_calls?.length) return true;
  const rawContent = choice?.message?.content;
  const content = Array.isArray(rawContent) ? rawContent.map(part => typeof part === 'string' ? part : part?.text || part?.content || '').join('')
    : rawContent && typeof rawContent === 'object' ? JSON.stringify(rawContent) : rawContent;
  if (typeof content !== 'string' || !content.trim()) {
    throw policyError('The LLM returned no usable content. Check the selected model and try again.', 'AI_EMPTY_RESPONSE');
  }
  if (payload.response_format?.type === 'json_object' || payload.response_format?.type === 'json_schema') {
    try {
      const parsed = JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object required');
    } catch {
      throw policyError('The LLM did not return the required JSON object. Try again with a model that supports structured output.', 'AI_INVALID_JSON');
    }
  }
  return true;
};

module.exports = { OUTPUT_LIMITS, prepareChatRequest, compatibleChatRequest, validateChatResponse };
