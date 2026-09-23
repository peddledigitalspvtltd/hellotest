// Normalize provider content at the boundary. Only visible text belongs in an
// artifact; reasoning, tool calls and refusal blocks are not generated content.
const getCompletionContent = (payload) => {
  const message = payload?.choices?.[0]?.message;
  if (message?.refusal) return '';
  const content = message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === 'string') return part;
      if (!part || typeof part !== 'object') return '';
      if (part.type && !['text', 'output_text'].includes(part.type)) return '';
      if (typeof part.text === 'string') return part.text;
      if (typeof part.text?.value === 'string') return part.text.value;
      return typeof part.content === 'string' ? part.content : '';
    }).join('').trim();
  }
  // A few compatible providers return the structured object directly.
  return content && typeof content === 'object' ? JSON.stringify(content) : '';
};

module.exports = { getCompletionContent };
