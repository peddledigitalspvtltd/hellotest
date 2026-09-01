const crypto = require("crypto");
const path = require("path");

const DEFAULT_CHUNK_MAX_CHARS = 1_600;
const DEFAULT_CHUNK_OVERLAP_CHARS = 220;
const MAX_CHUNK_MAX_CHARS = 4_000;
const MAX_EXTRACTED_TEXT_CHARS = Math.max(
  50_000,
  Math.min(5_000_000, Number.parseInt(process.env.KNOWLEDGE_MAX_EXTRACTED_TEXT_CHARS || "2000000", 10) || 2_000_000)
);
const LOCAL_EMBEDDING_DIMENSIONS = 256;

const NATIVE_TEXT_MIME_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/tab-separated-values",
  "text/html",
  "text/xml",
  "text/yaml",
  "application/json",
  "application/ld+json",
  "application/xml",
  "application/yaml",
  "application/x-yaml",
  "application/rtf"
]);

const TIKA_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation"
]);
const OOXML_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation"
]);
const MAX_ZIP_DIRECTORY_SCAN_BYTES = 8 * 1024 * 1024;

const MEDIA_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/tiff",
  "image/heic",
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "audio/ogg",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/mpeg"
]);

const SUPPORTED_UPLOAD_MIME_TYPES = new Set([
  ...NATIVE_TEXT_MIME_TYPES,
  ...TIKA_MIME_TYPES,
  ...MEDIA_MIME_TYPES
]);

const MIME_EXTENSIONS = {
  "text/plain": [".txt", ".log"],
  "text/markdown": [".md", ".markdown"],
  "text/csv": [".csv"],
  "text/tab-separated-values": [".tsv"],
  "text/html": [".html", ".htm"],
  "text/xml": [".xml"],
  "text/yaml": [".yaml", ".yml"],
  "application/json": [".json"],
  "application/ld+json": [".json", ".jsonld"],
  "application/xml": [".xml"],
  "application/yaml": [".yaml", ".yml"],
  "application/x-yaml": [".yaml", ".yml"],
  "application/rtf": [".rtf"],
  "application/pdf": [".pdf"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": [".pptx"],
  "application/vnd.oasis.opendocument.text": [".odt"],
  "application/vnd.oasis.opendocument.spreadsheet": [".ods"],
  "application/vnd.oasis.opendocument.presentation": [".odp"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
  "image/gif": [".gif"],
  "image/tiff": [".tif", ".tiff"],
  "image/heic": [".heic", ".heif"],
  "audio/mpeg": [".mp3"],
  "audio/mp4": [".m4a"],
  "audio/wav": [".wav"],
  "audio/ogg": [".ogg", ".oga"],
  "video/mp4": [".mp4", ".m4v"],
  "video/webm": [".webm"],
  "video/quicktime": [".mov"],
  "video/mpeg": [".mpeg", ".mpg"]
};

const startsWithBytes = (buffer, bytes, offset = 0) => bytes.every((byte, index) => buffer[offset + index] === byte);

const readBoundedZipDirectory = (buffer) => {
  const minimumOffset = Math.max(0, buffer.length - 65_557);
  let endOffset = -1;
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (startsWithBytes(buffer, [0x50, 0x4b, 0x05, 0x06], offset)) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new Error("ZIP-based knowledge files require a valid central directory.");
  const directorySize = buffer.readUInt32LE(endOffset + 12);
  const directoryOffset = buffer.readUInt32LE(endOffset + 16);
  if (directorySize === 0xffffffff || directoryOffset === 0xffffffff || directorySize > MAX_ZIP_DIRECTORY_SCAN_BYTES) {
    throw new Error("ZIP central directory is unsupported or exceeds the safe inspection limit.");
  }
  if (directoryOffset + directorySize > buffer.length || directoryOffset > endOffset) {
    throw new Error("ZIP central directory bounds are invalid.");
  }
  return buffer.subarray(directoryOffset, directoryOffset + directorySize).toString("latin1").toLowerCase();
};

const validateUploadSignature = (buffer, fileName, mimeType) => {
  const normalizedMime = String(mimeType || "").toLowerCase().split(";")[0].trim();
  if (!SUPPORTED_UPLOAD_MIME_TYPES.has(normalizedMime)) throw new Error(`Unsupported knowledge file type: ${normalizedMime || "unknown"}.`);
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error("Knowledge file must be non-empty.");
  const normalizedName = path.basename(String(fileName || "")).toLowerCase();
  const extension = path.extname(normalizedName);
  const knownExtensions = MIME_EXTENSIONS[normalizedMime] || [];
  if (!extension || !knownExtensions.includes(extension)) {
    throw new Error(`File extension ${extension || "(missing)"} does not match ${normalizedMime}.`);
  }
  if (/\.(?:exe|dll|sh|bat|cmd|com|msi|jar|js|ps1|vbs|docm|xlsm|pptm)\.[^.]+$/i.test(normalizedName)
    || /\.(?:exe|dll|sh|bat|cmd|com|msi|jar|ps1|vbs|docm|xlsm|pptm)$/i.test(normalizedName)) {
    throw new Error("Executable, script, macro-enabled, and deceptive double-extension files are not accepted as knowledge sources.");
  }

  let valid = true;
  if (normalizedMime === "application/pdf") valid = buffer.subarray(0, 5).toString("ascii") === "%PDF-";
  else if (normalizedMime === "image/png") valid = startsWithBytes(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  else if (normalizedMime === "image/jpeg") valid = startsWithBytes(buffer, [0xff, 0xd8, 0xff]);
  else if (normalizedMime === "image/gif") valid = ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii"));
  else if (normalizedMime === "image/webp") valid = buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  else if (normalizedMime === "image/tiff") valid = startsWithBytes(buffer, [0x49, 0x49, 0x2a, 0x00]) || startsWithBytes(buffer, [0x4d, 0x4d, 0x00, 0x2a]);
  else if (normalizedMime === "image/heic") valid = buffer.subarray(4, 8).toString("ascii") === "ftyp" && /(?:heic|heix|hevc|hevx|mif1)/.test(buffer.subarray(8, 16).toString("ascii"));
  else if (TIKA_MIME_TYPES.has(normalizedMime) && normalizedMime !== "application/pdf") {
    valid = startsWithBytes(buffer, [0x50, 0x4b, 0x03, 0x04]);
    if (valid) {
      const directory = readBoundedZipDirectory(buffer);
      if (OOXML_MIME_TYPES.has(normalizedMime)
        && /(?:vbaproject\.bin|vbadata\.xml|macroenabled|\/activex\/|\/embeddings\/|vnd\.ms-office\.vba)/i.test(directory)) {
        throw new Error("Macro, ActiveX, and embedded-object Office packages are not accepted as knowledge sources.");
      }
    }
  }
  else if (normalizedMime === "audio/mpeg") valid = buffer.subarray(0, 3).toString("ascii") === "ID3" || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0);
  else if (normalizedMime === "audio/wav") valid = buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WAVE";
  else if (normalizedMime === "audio/ogg") valid = buffer.subarray(0, 4).toString("ascii") === "OggS";
  else if (["audio/mp4", "video/mp4", "video/quicktime"].includes(normalizedMime)) valid = buffer.subarray(4, 8).toString("ascii") === "ftyp";
  else if (normalizedMime === "video/webm") valid = startsWithBytes(buffer, [0x1a, 0x45, 0xdf, 0xa3]);
  else if (normalizedMime === "video/mpeg") valid = startsWithBytes(buffer, [0x00, 0x00, 0x01, 0xba]) || startsWithBytes(buffer, [0x00, 0x00, 0x01, 0xb3]);
  else if (NATIVE_TEXT_MIME_TYPES.has(normalizedMime)) valid = !buffer.subarray(0, Math.min(buffer.length, 8_192)).includes(0x00);

  if (!valid) throw new Error(`File signature does not match declared type ${normalizedMime}.`);
  return { extension, mime_type: normalizedMime };
};

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

const sanitizeKnowledgeText = (value) => {
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

const stripMarkup = (value, mimeType) => {
  const text = normalizeText(value);
  if (mimeType === "text/html") {
    return text
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">");
  }
  return text;
};

const decodeNativeText = (buffer, mimeType) => {
  if (!NATIVE_TEXT_MIME_TYPES.has(String(mimeType || "").toLowerCase())) return null;
  const decoded = Buffer.isBuffer(buffer) ? buffer.toString("utf8") : String(buffer || "");
  return stripMarkup(decoded, String(mimeType || "").toLowerCase());
};

const normalizeChunkingOptions = (value = {}) => {
  const requestedStrategyRaw = String(value.strategy || "structure_aware").trim().toLowerCase();
  const requestedStrategy = requestedStrategyRaw === "semantic" ? "structure_aware" : requestedStrategyRaw;
  const strategy = ["fixed", "recursive", "markdown", "gherkin", "structure_aware"].includes(requestedStrategy)
    ? requestedStrategy
    : "structure_aware";
  const requestedMaxChars = value.max_chars !== undefined
    ? Number.parseInt(value.max_chars, 10)
    : Number.parseInt(value.chunk_size, 10) * 4;
  const maxChars = Math.max(
    400,
    Math.min(MAX_CHUNK_MAX_CHARS, Number.isFinite(requestedMaxChars) && requestedMaxChars > 0 ? requestedMaxChars : DEFAULT_CHUNK_MAX_CHARS)
  );
  const requestedOverlapChars = value.overlap_chars !== undefined
    ? Number.parseInt(value.overlap_chars, 10)
    : Number.parseInt(value.chunk_overlap, 10) * 4;
  const overlapChars = Math.max(
    0,
    Math.min(
      Math.floor(maxChars / 3),
      Number.isFinite(requestedOverlapChars) && requestedOverlapChars >= 0 ? requestedOverlapChars : DEFAULT_CHUNK_OVERLAP_CHARS
    )
  );
  return {
    strategy,
    chunk_size: Math.ceil(maxChars / 4),
    chunk_overlap: Math.ceil(overlapChars / 4),
    max_chars: maxChars,
    overlap_chars: overlapChars
  };
};

const findPreferredBreak = (text, start, idealEnd, minimumEnd) => {
  const structuralWindow = text.slice(minimumEnd, idealEnd);
  const structuralBoundaries = [...structuralWindow.matchAll(/\n(?=#{1,6}\s|(?:Feature|Background|Scenario(?: Outline)?|Examples|Rule):\s|```|\|)/g)];
  if (structuralBoundaries.length) {
    return minimumEnd + structuralBoundaries.at(-1).index + 1;
  }
  const markers = ["\n\n", "\n", ". ", "; ", ", ", " "];
  for (const marker of markers) {
    const index = text.lastIndexOf(marker, idealEnd);
    if (index >= minimumEnd && index > start) return index + marker.length;
  }
  return idealEnd;
};

const inferHeading = (content) => {
  const heading = String(content || "").split("\n").find((line) => /^#{1,6}\s+\S/.test(line.trim()));
  return heading ? heading.replace(/^#{1,6}\s+/, "").slice(0, 240) : null;
};

const chunkText = (value, inputOptions = {}) => {
  const text = normalizeText(value);
  if (!text) return [];
  const options = normalizeChunkingOptions(inputOptions);
  const chunks = [];
  let start = 0;

  while (start < text.length && chunks.length < 5_000) {
    let idealEnd = Math.min(text.length, start + options.max_chars);
    if (options.strategy !== "fixed") {
      const fencedPrefix = text.slice(start, idealEnd);
      if ((fencedPrefix.match(/```/g) || []).length % 2 === 1) {
        const closingFence = text.indexOf("```", idealEnd);
        if (closingFence > idealEnd && closingFence + 3 - start <= options.max_chars + 800) idealEnd = closingFence + 3;
      }
    }
    const minimumEnd = Math.min(idealEnd, start + Math.floor(options.max_chars * 0.55));
    const end = idealEnd === text.length || options.strategy === "fixed"
      ? idealEnd
      : findPreferredBreak(text, start, idealEnd, minimumEnd);
    const content = text.slice(start, end).trim();
    if (content) {
      chunks.push({
        index: chunks.length,
        content,
        heading: inferHeading(content),
        char_start: start,
        char_end: end,
        token_count: Math.max(1, Math.ceil(content.length / 4))
      });
    }
    if (end >= text.length) break;
    const nextStart = Math.max(start + 1, end - options.overlap_chars);
    start = nextStart;
  }

  return chunks;
};

const tokenize = (value) => normalizeText(value, 100_000)
  .toLowerCase()
  .match(/[a-z0-9][a-z0-9_.-]{1,48}/g) || [];

const localEmbedding = (value) => {
  const vector = new Array(LOCAL_EMBEDDING_DIMENSIONS).fill(0);
  for (const token of tokenize(value)) {
    const digest = crypto.createHash("sha256").update(token).digest();
    const index = digest.readUInt16BE(0) % LOCAL_EMBEDDING_DIMENSIONS;
    const sign = digest[2] % 2 === 0 ? 1 : -1;
    vector[index] += sign * (1 + Math.min(3, token.length / 12));
  }
  const magnitude = Math.sqrt(vector.reduce((sum, item) => sum + item * item, 0));
  return magnitude ? vector.map((item) => Number((item / magnitude).toFixed(8))) : vector;
};

const cosineSimilarity = (left, right) => {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || !left.length) return 0;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = Number(left[index]);
    const b = Number(right[index]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
    dot += a * b;
    leftMagnitude += a * a;
    rightMagnitude += b * b;
  }
  return leftMagnitude && rightMagnitude ? dot / Math.sqrt(leftMagnitude * rightMagnitude) : 0;
};

const hasHelloTestScopeSignal = (value) => {
  const text = normalizeText(value, 8_000).toLowerCase();
  if (!text) return false;
  return /\b(?:hellotest|project|application|app|story|requirement|test|case|suite|run|execution|bug|defect|release|sprint|quality|automation|api|browser|mobile|dataset|knowledge|module|gherkin|spec kit|configuration|failure|failed|passed|blocked|coverage|readiness|workspace|integration|agent|chatbot)\b/i.test(text);
};

const isClearlyOutOfScope = (value) => {
  const text = normalizeText(value, 8_000).toLowerCase();
  if (!text) return true;
  const disallowed = /\b(?:weather forecast|sports score|stock price|crypto price|investment advice|medical diagnosis|write malware|phishing email|celebrity gossip|recipe for|dating advice)\b/i.test(text);
  return disallowed || !hasHelloTestScopeSignal(text);
};

module.exports = {
  DEFAULT_CHUNK_MAX_CHARS,
  DEFAULT_CHUNK_OVERLAP_CHARS,
  LOCAL_EMBEDDING_DIMENSIONS,
  MAX_EXTRACTED_TEXT_CHARS,
  MEDIA_MIME_TYPES,
  NATIVE_TEXT_MIME_TYPES,
  SUPPORTED_UPLOAD_MIME_TYPES,
  TIKA_MIME_TYPES,
  chunkText,
  cosineSimilarity,
  decodeNativeText,
  fingerprint,
  hasHelloTestScopeSignal,
  isClearlyOutOfScope,
  localEmbedding,
  neutralizePromptInjection,
  normalizeChunkingOptions,
  normalizeText,
  redactSensitiveData,
  sanitizeKnowledgeText,
  validateUploadSignature
};
