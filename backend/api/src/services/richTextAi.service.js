const crypto = require("crypto");
const aiLlmSelectionService = require("./aiLlmSelection.service");
const { fetchLlmWithRetry } = require("../utils/llmHttpClient");

const ALLOWED_TAGS = new Set(["p", "ul", "ol", "li", "strong", "em", "code", "blockquote", "br"]);
const VOID_TAGS = new Set(["br"]);
const AI_TIMEOUT_MS = Math.max(
  5_000,
  Number.parseInt(process.env.AI_RICH_TEXT_TIMEOUT_MS || process.env.AI_AUTHORING_TIMEOUT_MS || "45000", 10) || 45_000
);

const normalizeText = (value, maxLength) => String(value || "").trim().slice(0, maxLength);

const escapeHtml = (value) => String(value || "")
  .replace(/&(?!(?:#\d+|#x[\da-f]+|[a-z][\da-z]+);)/gi, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

const plainTextHtml = (value) => normalizeText(value, 20_000)
  .split(/\n{2,}/)
  .map((paragraph) => paragraph.trim())
  .filter(Boolean)
  .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
  .join("");

const stripCodeFence = (value) => String(value || "")
  .trim()
  .replace(/^```(?:html)?\s*/i, "")
  .replace(/\s*```$/, "")
  .trim();

const sanitizeAllowedHtml = (value) => {
  const source = stripCodeFence(value)
    .slice(0, 50_000)
    .replace(/<!--([\s\S]*?)-->/g, "")
    .replace(/<(script|style|iframe|object|embed|template|svg|math)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");

  if (!/<\/?[a-z][\s\S]*>/i.test(source)) {
    return plainTextHtml(source);
  }

  const output = [];
  const stack = [];
  const tokenPattern = /<[^>]*>/g;
  let cursor = 0;
  let match;

  while ((match = tokenPattern.exec(source))) {
    output.push(escapeHtml(source.slice(cursor, match.index)));
    cursor = match.index + match[0].length;

    const tokenMatch = match[0].match(/^<\s*(\/)?\s*([a-z0-9-]+)/i);
    if (!tokenMatch) continue;
    const closing = Boolean(tokenMatch[1]);
    const tag = tokenMatch[2].toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) continue;

    if (!closing) {
      output.push(`<${tag}>`);
      if (!VOID_TAGS.has(tag)) stack.push(tag);
      continue;
    }

    const stackIndex = stack.lastIndexOf(tag);
    if (stackIndex === -1) continue;
    while (stack.length > stackIndex) {
      output.push(`</${stack.pop()}>`);
    }
  }

  output.push(escapeHtml(source.slice(cursor)));
  while (stack.length) output.push(`</${stack.pop()}>`);
  return output.join("").trim();
};

const resolveChatCompletionsUrl = (baseUrl) => {
  const normalized = normalizeText(baseUrl, 2_000) || "https://api.openai.com/v1";
  return /\/chat\/completions\/?$/i.test(normalized)
    ? normalized.replace(/\/+$/, "")
    : `${normalized.replace(/\/+$/, "")}/chat/completions`;
};

const requestRephrase = async ({ integration, input }) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  const headers = { "Content-Type": "application/json" };
  if (normalizeText(integration.api_key, 10_000)) {
    headers.Authorization = `Bearer ${integration.api_key}`;
  }

  try {
    const response = await fetchLlmWithRetry(resolveChatCompletionsUrl(integration.base_url), {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: integration.model,
        temperature: 0.15,
        messages: [
          {
            role: "system",
            content: [
              "You are a senior QA authoring assistant.",
              "Rephrase the supplied content into concise, professional, semantically faithful HTML.",
              "Preserve all facts, identifiers, outcomes, constraints, and testability.",
              "Never invent records, results, evidence, links, or approvals.",
              "Return HTML only using p, ul, ol, li, strong, em, code, blockquote, and br tags; do not include attributes."
            ].join(" ")
          },
          {
            role: "user",
            content: JSON.stringify({
              entity_type: input.entityType,
              entity_title: input.entityTitle,
              field_label: input.fieldLabel,
              aria_label: input.ariaLabel,
              plain_text: input.content,
              current_html: input.contentHtml
            }, null, 2)
          }
        ]
      })
    }, { timeoutMs: AI_TIMEOUT_MS, operation: "rich-text.rephrase" });

    if (!response.ok) {
      const detail = normalizeText(await response.text(), 240);
      throw new Error(`LLM provider returned ${response.status}${detail ? `: ${detail}` : ""}`);
    }

    const payload = await response.json();
    const generated = payload?.choices?.[0]?.message?.content;
    if (!normalizeText(generated, 50_000)) {
      throw new Error("LLM provider returned an empty rephrase");
    }
    return generated;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Rich-text rephrase timed out after ${AI_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

exports.sanitizeAllowedHtml = sanitizeAllowedHtml;

exports.rephrase = async ({ user, projectId, content, contentHtml, entityType, entityTitle, fieldLabel, ariaLabel } = {}) => {
  const normalizedContent = normalizeText(content, 20_000);
  if (!normalizeText(projectId, 255) || !normalizedContent) {
    const error = new Error("project_id and content are required");
    error.statusCode = 400;
    throw error;
  }

  const input = {
    content: normalizedContent,
    contentHtml: normalizeText(contentHtml, 40_000),
    entityType: normalizeText(entityType, 160) || "rich-text authoring field",
    entityTitle: normalizeText(entityTitle, 500),
    fieldLabel: normalizeText(fieldLabel, 160),
    ariaLabel: normalizeText(ariaLabel, 160)
  };
  const safeOriginal = sanitizeAllowedHtml(input.contentHtml || plainTextHtml(input.content));
  let integration = null;
  let generated = safeOriginal;
  let fallbackReason = null;

  try {
    integration = await aiLlmSelectionService.resolveLlmIntegrationForUsage({
      userId: user?.id,
      usageKey: "ai.content.rephrase",
      projectId,
      fallback: "project-then-global",
      allowMissing: true
    });

    if (integration) {
      generated = sanitizeAllowedHtml(await requestRephrase({ integration, input })) || safeOriginal;
    } else {
      fallbackReason = "No active LLM integration is configured.";
    }
  } catch (error) {
    fallbackReason = error instanceof Error ? error.message : "Rich-text rephrase failed.";
    generated = safeOriginal;
  }

  return {
    content: generated,
    integration: integration ? {
      id: integration.id,
      name: integration.name,
      type: integration.type,
      model: integration.model || null
    } : {
      id: "qaira-safe-fallback",
      name: "HelloTest safe fallback",
      type: "local",
      model: null
    },
    provenance: {
      capability: "rich-text-authoring-rephrase",
      generation_mode: integration && !fallbackReason ? "llm" : "safe-original",
      provider: integration?.name || null,
      model: integration?.model || null,
      input_fingerprint: crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 20),
      generated_at: new Date().toISOString(),
      confidence: integration && !fallbackReason ? 0.74 : 1,
      fallback_used: Boolean(fallbackReason),
      fallback_reason: fallbackReason,
      requires_human_review: true
    }
  };
};
