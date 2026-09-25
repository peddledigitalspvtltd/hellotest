// Shared text preparation for model inputs. No document, provider or database dependencies.
const crypto = require("node:crypto");

const MAX_EXTRACTED_TEXT_CHARS = Math.max(
  50_000,
  Math.min(5_000_000, Number.parseInt(process.env.KNOWLEDGE_MAX_EXTRACTED_TEXT_CHARS || "2000000", 10) || 2_000_000)
);

const normalizeText = (value, max = MAX_EXTRACTED_TEXT_CHARS) => String(value || "")
  .replace(/\u0000/g, "")
  .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, "")
  .replace(/\r\n?/g, "\n")
  .trim()
  .slice(0, max);

const fingerprint = (value) => crypto.createHash("sha256").update(String(value || "")).digest("hex");

const countMatches = (text, expression) => (String(text || "").match(expression) || []).length;
const PHONE_PATTERN = /(?<![A-Za-z0-9])(?<![A-Fa-f0-9]-)(?!(?:\d{4}-\d{2}-\d{2})(?:\b|T))(?:\+?\d[\d .()-]{7,}\d)(?![A-Za-z0-9])/g;

const redactSensitiveData = (value) => {
  let text = normalizeText(value);
  const privateKeyPattern = /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)? PRIVATE KEY-----/gi;
  const jwtPattern = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
  const cloudKeyPattern = /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g;
  const labeledNamePattern = /\b(?:(?:full|customer|employee|account holder|contact|author|owner|reviewer|assignee|reporter|user|person)\s+name|(?:author|owner|reviewer|assignee|reporter))\s*[:=]\s*[^\n,;]{2,120}/gi;
  const usernamePattern = /\b(?:user\s*name|username|login id)\s*[:=]\s*[^\s,;]{2,120}/gi;
  const addressPattern = /\b(?:home|mailing|residential|customer|employee)?\s*address\s*[:=]\s*[^\n]{5,240}/gi;
  const dobPattern = /\b(?:date of birth|birth date|dob)\s*[:=]\s*(?:\d{1,2}[\/.-]){2}\d{2,4}\b/gi;
  const networkIdPattern = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
  const nationalIdPattern = /\b(?:passport|aadhaar|aadhar|national id|tax id|pan)\s*(?:number|no\.?|id)?\s*[:=]\s*[A-Z0-9 -]{5,24}\b/gi;
  const redactions = {
    email: countMatches(text, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi),
    bearer_token: countMatches(text, /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi),
    secret_assignment: countMatches(text, /\b(?:api[_-]?key|access[_-]?token|secret|password|passwd)\s*[:=]\s*["']?[^\s,"';]{6,}/gi),
    card_number: countMatches(text, /\b(?:\d[ -]*?){13,19}\b/g),
    phone: countMatches(text, PHONE_PATTERN),
    government_id: countMatches(text, /\b\d{3}-\d{2}-\d{4}\b/g),
    private_key: countMatches(text, privateKeyPattern),
    jwt: countMatches(text, jwtPattern),
    cloud_access_key: countMatches(text, cloudKeyPattern),
    labeled_name: countMatches(text, labeledNamePattern),
    username: countMatches(text, usernamePattern),
    address: countMatches(text, addressPattern),
    date_of_birth: countMatches(text, dobPattern),
    network_identifier: countMatches(text, networkIdPattern),
    national_identifier: countMatches(text, nationalIdPattern)
  };

  text = text
    .replace(privateKeyPattern, "[REDACTED_PRIVATE_KEY]")
    .replace(jwtPattern, "[REDACTED_JWT]")
    .replace(cloudKeyPattern, "[REDACTED_CLOUD_KEY]")
    .replace(labeledNamePattern, "[REDACTED_PERSON_NAME]")
    .replace(usernamePattern, "[REDACTED_USERNAME]")
    .replace(addressPattern, "[REDACTED_ADDRESS]")
    .replace(dobPattern, "[REDACTED_DOB]")
    .replace(nationalIdPattern, "[REDACTED_ID]")
    .replace(networkIdPattern, "[REDACTED_NETWORK_ID]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED_TOKEN]")
    .replace(/\b(api[_-]?key|access[_-]?token|secret|password|passwd)\s*[:=]\s*["']?[^\s,"';]{6,}/gi, "$1=[REDACTED_SECRET]")
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, "[REDACTED_NUMBER]")
    .replace(PHONE_PATTERN, "[REDACTED_PHONE]")
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[REDACTED_ID]");

  return {
    text,
    redactions,
    redaction_count: Object.values(redactions).reduce((sum, count) => sum + count, 0)
  };
};

const PROMPT_INJECTION_PATTERNS = [
  { code: "ignore_instructions", expression: /\b(?:ignore|disregard|forget)\s+(?:all\s+)?(?:(?:previous|prior|earlier|preceding|above)\s+)?(?:(?:system|developer)\s+)?(?:instructions?|messages?)/gi },
  { code: "system_prompt_request", expression: /\b(?:reveal|show|print|repeat|expose)\s+(?:the\s+)?(?:hidden\s+)?(?:system|developer)\s+(?:prompt|message|instructions?)\b/gi },
  { code: "role_override", expression: /^\s*(?:system|developer)\s*:\s*|\b(?:jailbreak|developer mode|do anything now)\b/gim },
  { code: "tool_override", expression: /\b(?:call|invoke|execute)\s+(?:an?\s+)?(?:hidden\s+)?tool\b|\bexfiltrat(?:e|ion)\b/gi }
];

const neutralizePromptInjection = (value) => {
  let text = normalizeText(value);
  const riskFlags = [];

  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    pattern.expression.lastIndex = 0;
    if (pattern.expression.test(text)) {
      riskFlags.push(pattern.code);
      pattern.expression.lastIndex = 0;
      text = text.replace(pattern.expression, "[POTENTIAL_PROMPT_INJECTION_REMOVED]");
    }
  }

  return { text, risk_flags: [...new Set(riskFlags)] };
};

const sanitizeAiText = (value) => {
  const controlCharacterCount = (String(value || "").match(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g) || []).length;
  const redacted = redactSensitiveData(value);
  const neutralized = neutralizePromptInjection(redacted.text);
  return {
    text: neutralized.text,
    redactions: redacted.redactions,
    redaction_count: redacted.redaction_count,
    risk_flags: [...new Set([...neutralized.risk_flags, ...(controlCharacterCount ? ["hidden_unicode_controls_removed"] : [])])],
    control_character_count: controlCharacterCount
  };
};

module.exports = { MAX_EXTRACTED_TEXT_CHARS, normalizeText, fingerprint, redactSensitiveData, neutralizePromptInjection, sanitizeAiText };
