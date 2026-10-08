const { aiInstructionBlock } = require('@hellotest/platform/backend/src/utils/aiInstructionBlocks');
const { requireAiAssessment } = require("@hellotest/platform/backend/src/utils/requireAiAssessment");
const crypto = require("crypto");
const aiLlmSelectionService = require("@hellotest/integration/backend/services/aiLlmSelection.service");
const { sanitizeAiText } = require("@hellotest/platform/backend/src/security/aiTextPolicy");
const { fetchLlmWithRetry } = require("@hellotest/platform/backend/src/utils/llmHttpClient");
const { getCompletionContent } = require("@hellotest/platform/backend/src/utils/llmResponse");

const normalizeText = (value, max = 12_000) => String(value || "").trim().slice(0, max);

const deterministicValues = ({ prompt, fieldContext, count }) => {
  const normalized = `${prompt} ${fieldContext || ""}`.toLowerCase();
  const serial = (index, width = 4) => String(index + 1).padStart(width, "0");
  if (/email|mailbox/.test(normalized)) return Array.from({ length: count }, (_, index) => `synthetic.user.${serial(index)}@example.test`);
  if (/phone|mobile|telephone/.test(normalized)) return Array.from({ length: count }, (_, index) => `+1-202-555-${String(1100 + index).padStart(4, "0")}`);
  if (/full name|person|customer name|employee name|\bname\b/.test(normalized)) return ["Avery Stone", "Maya Brooks", "Noah Chen", "Priya Shah", "Liam Rivera", "Zoe Martin", "Ethan Kim", "Leila Adams", "Owen Clarke", "Nina Patel", "Sam Taylor", "Iris Walker"].slice(0, count);
  if (/address|street|postal/.test(normalized)) return Array.from({ length: count }, (_, index) => `${100 + index} HelloTest Test Avenue, Sample City, TS ${10000 + index}`);
  if (/uuid|guid/.test(normalized)) return Array.from({ length: count }, (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
  if (/order|invoice|reference|identifier|\bid\b/.test(normalized)) return Array.from({ length: count }, (_, index) => `QA-${new Date().getUTCFullYear()}-${serial(index, 6)}`);
  if (/amount|price|currency|balance/.test(normalized)) return Array.from({ length: count }, (_, index) => (19.95 + index * 7.5).toFixed(2));
  if (/date|day|time/.test(normalized)) return Array.from({ length: count }, (_, index) => { const value = new Date(); value.setUTCDate(value.getUTCDate() + index); return value.toISOString().slice(0, 10); });
  const label = normalized.replace(/[^a-z0-9]+/g, " ").trim().split(" ").slice(0, 5).join(" ") || "synthetic value";
  return Array.from({ length: count }, (_, index) => `${label} ${serial(index)}`);
};

const extractJson = (value) => {
  const source = String(value || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Synthetic data provider returned invalid JSON.");
  return JSON.parse(source.slice(start, end + 1));
};

const isSafeSyntheticValue = (value) => {
  const text = normalizeText(value, 500);
  if (!text || /(?:AKIA[A-Z0-9]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:api[_ -]?key|access[_ -]?token|password|secret)\s*[:=])/i.test(text)) return false;
  const emails = text.match(/[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/gi) || [];
  if (emails.some((email) => !/@example\.(?:test|com|org)$/i.test(email))) return false;
  const phoneLike = text.match(/(?:\+?\d[\d(). -]{7,}\d)/g) || [];
  if (phoneLike.some((phone) => !/555/.test(phone))) return false;
  return true;
};

const requestValues = async ({ integration, prompt, fieldContext, count, promptInstruction, reviewedContext }) => {
  const baseUrl = String(integration.base_url || "https://api.openai.com/v1").replace(/\/+$/, "");
  const response = await fetchLlmWithRetry(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(integration.api_key ? { Authorization: `Bearer ${integration.api_key}` } : {})
    },
    body: JSON.stringify({
      model: integration.model,

      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            aiInstructionBlock("ai.test_data.synthetic", "aiTestDataGeneration.response.1"),
            aiInstructionBlock("ai.test_data.synthetic", "aiTestDataGeneration.response.2"),
            [aiInstructionBlock("ai.test_data.synthetic", "aiTestDataGeneration.service.js.response.final.1"),String(count),aiInstructionBlock("ai.test_data.synthetic", "aiTestDataGeneration.service.js.response.final.2")].join(''),
            aiInstructionBlock("ai.test_data.synthetic", "aiTestDataGeneration.response.3"),
            aiInstructionBlock("ai.test_data.synthetic", "aiTestDataGeneration.response.4"),
            aiInstructionBlock("ai.test_data.synthetic", "aiTestDataGeneration.response.5")
          ].join(" ")
        },
        {
          role: "user",
          content: JSON.stringify({
            request: prompt,
            field_context: fieldContext || null,
            authoring_guidance: promptInstruction || null,
            reviewed_smart_context: reviewedContext || null,
            value_count: count
          })
        }
      ]
    })
  }, { integration, operation: "test-data.synthetic" });
  if (!response.ok) throw new Error(`Synthetic data provider returned ${response.status}.`);
  return extractJson(getCompletionContent(await response.json()));
};

const buildResponse = ({ prompt, fieldContext, values, summary, integration, fallbackReason, contextSafety }) => {
  const suggestions = values.map((value, index) => ({ id: `candidate-${index + 1}`, value }));
  const generatedAt = new Date().toISOString();
  return {
    prompt,
    field_context: fieldContext || null,
    summary: summary || `Prepared ${suggestions.length} fictional synthetic values for human review.`,
    suggestions,
    randomized_template: `{{oneOf:${Buffer.from(JSON.stringify(values), "utf8").toString("base64url")}}}`,
    randomization_strategy: "reviewed-value-pool",
    runtime_llm_invocation: Boolean(integration && !fallbackReason),
    generation_mode: integration && !fallbackReason ? "llm" : "deterministic",
    integration: integration ? { id: integration.id, name: integration.name, model: integration.model || null } : null,
    fallback_used: Boolean(fallbackReason),
    fallback_reason: fallbackReason || null,
    generated_at: generatedAt,
    requires_human_review: true,
    provenance: {
      input_fingerprint: crypto.createHash("sha256").update(JSON.stringify({ prompt, fieldContext, values })).digest("hex").slice(0, 20),
      smart_context_fingerprint: contextSafety.text ? crypto.createHash("sha256").update(contextSafety.text).digest("hex").slice(0, 20) : null,
      smart_context_risk_flags: contextSafety.risk_flags || [],
      smart_context_redaction_count: contextSafety.redaction_count || 0,
      provider: integration?.name || "HelloTest deterministic generator",
      model: integration?.model || null,
      generated_at: generatedAt
    }
  };
};

exports.preview = async ({ projectId, appTypeId, prompt, fieldContext, sampleCount, promptInstruction, integrationId, additionalContext, userId } = {}) => {
  const normalizedPrompt = normalizeText(prompt, 2_000);
  const normalizedFieldContext = normalizeText(fieldContext, 1_000);
  const count = Math.max(2, Math.min(12, Math.round(Number(sampleCount || 6))));
  const contextSafety = sanitizeAiText(normalizeText(additionalContext, 12_000));
  const instructionSafety = sanitizeAiText(normalizeText(promptInstruction, 4_000));
  const fallbackValues = deterministicValues({ prompt: normalizedPrompt, fieldContext: normalizedFieldContext, count });
  let integration = null;
  try {
    integration = await aiLlmSelectionService.resolveLlmIntegrationForUsage({
      integrationId,
      userId,
      usageKey: "ai.test_data.synthetic",
      projectId,
      fallback: "project-then-global",
      allowMissing: true
    });
    requireAiAssessment({ integration });
    const candidate = await requestValues({ integration, prompt: normalizedPrompt, fieldContext: normalizedFieldContext, count, promptInstruction: instructionSafety.text, reviewedContext: contextSafety.text });
    const values = [...new Set((Array.isArray(candidate?.values) ? candidate.values : []).map((value) => normalizeText(value, 500)).filter(isSafeSyntheticValue))].slice(0, count);
    if (values.length !== count) throw new Error("The model output did not pass synthetic-data safety and count validation.");
    return buildResponse({ prompt: normalizedPrompt, fieldContext: normalizedFieldContext, values, summary: normalizeText(candidate.summary, 500), integration, fallbackReason: null, contextSafety });
  } catch (error) {
    requireAiAssessment({ integration, failed: true });
    throw error;
  }
};

exports._internals = { deterministicValues, isSafeSyntheticValue };
