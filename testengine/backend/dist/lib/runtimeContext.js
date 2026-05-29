const STEP_PARAMETER_PATTERN = /(?<![A-Za-z0-9_])@(?:(t|s|r)\.)?([A-Za-z][A-Za-z0-9_-]*)/gi;
const GENERATOR_TOKEN_PATTERN = /\{\{\s*(randomNumber|randomString|aiData|yopmail|date)(?::([^}]+))?\s*\}\}/gi;
const GENERATOR_ALIAS_PATTERN = /(?<![A-Za-z0-9_])@(?:t\.)?(random|string|randomString|randomNumber|yopmail|today|timestamp)\b/gi;
const GENERATED_CONTEXT_ALIASES = {
    "t.random": "{{randomString:3}}",
    random: "{{randomString:3}}",
    "t.randomstring": "{{randomString:8}}",
    randomstring: "{{randomString:8}}",
    "t.randomnumber": "{{randomNumber:6}}",
    randomnumber: "{{randomNumber:6}}",
    "t.yopmail": "{{yopmail}}",
    yopmail: "{{yopmail}}",
    "t.today": "{{date:YYYY-MM-DD}}",
    today: "{{date:YYYY-MM-DD}}",
    "t.timestamp": "{{date:ISO}}",
    timestamp: "{{date:ISO}}"
};
const GENERATOR_ALIAS_TEMPLATES = {
    random: "{{randomString:3}}",
    string: "{{randomString:8}}",
    randomstring: "{{randomString:8}}",
    randomnumber: "{{randomNumber:6}}",
    yopmail: "{{yopmail}}",
    today: "{{date:YYYY-MM-DD}}",
    timestamp: "{{date:ISO}}"
};
export const normalizeText = (value) => {
    const normalized = String(value || "").trim();
    return normalized || null;
};
export const stringifyValue = (value) => {
    if (value === null || value === undefined) {
        return "";
    }
    if (typeof value === "string") {
        return value;
    }
    if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }
    try {
        return JSON.stringify(value);
    }
    catch {
        return String(value);
    }
};
const randomCharacters = (length, alphabet) => Array.from({ length }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
const resolveDate = (rawOption, now) => {
    const [rawFormat, rawOffset] = String(rawOption || "YYYY-MM-DD").split("|").map((entry) => entry.trim());
    const format = rawFormat || "YYYY-MM-DD";
    const date = new Date(now.getTime());
    const offsetMatch = rawOffset?.match(/^([+-]\d+)\s*([dwmy])$/i);
    if (offsetMatch) {
        const amount = Number.parseInt(offsetMatch[1], 10);
        const unit = offsetMatch[2].toLowerCase();
        if (unit === "d")
            date.setUTCDate(date.getUTCDate() + amount);
        if (unit === "w")
            date.setUTCDate(date.getUTCDate() + amount * 7);
        if (unit === "m")
            date.setUTCMonth(date.getUTCMonth() + amount);
        if (unit === "y")
            date.setUTCFullYear(date.getUTCFullYear() + amount);
    }
    if (format.toLowerCase() === "iso") {
        return date.toISOString();
    }
    const values = {
        YYYY: String(date.getUTCFullYear()),
        MM: String(date.getUTCMonth() + 1).padStart(2, "0"),
        DD: String(date.getUTCDate()).padStart(2, "0"),
        HH: String(date.getUTCHours()).padStart(2, "0"),
        mm: String(date.getUTCMinutes()).padStart(2, "0"),
        ss: String(date.getUTCSeconds()).padStart(2, "0")
    };
    return format.replace(/YYYY|MM|DD|HH|mm|ss/g, (token) => values[token]);
};
export const materializeTemplateValue = (value, now = new Date()) => {
    GENERATOR_TOKEN_PATTERN.lastIndex = 0;
    GENERATOR_ALIAS_PATTERN.lastIndex = 0;
    const evaluateToken = (_match, rawKind, rawOption) => {
        const kind = rawKind.toLowerCase();
        const option = String(rawOption || "").trim();
        if (kind === "randomnumber")
            return randomCharacters(Math.max(1, Math.min(12, Number.parseInt(option, 10) || 6)), "0123456789");
        if (kind === "randomstring")
            return randomCharacters(Math.max(1, Math.min(32, Number.parseInt(option, 10) || 8)), "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789");
        if (kind === "yopmail")
            return `qaira-${resolveDate("YYYYMMDDHHmmss", now)}-${randomCharacters(6, "abcdefghijklmnopqrstuvwxyz0123456789")}@yopmail.com`;
        if (kind === "aidata")
            return option.toLowerCase().includes("email") ? `ai-${resolveDate("YYYYMMDDHHmmss", now)}-${randomCharacters(6, "abcdefghijklmnopqrstuvwxyz0123456789")}@yopmail.com` : `ai-${randomCharacters(6, "abcdefghijklmnopqrstuvwxyz0123456789")}`;
        return resolveDate(option || "YYYY-MM-DD", now);
    };
    return String(value ?? "")
        .replace(GENERATOR_TOKEN_PATTERN, evaluateToken)
        .replace(GENERATOR_ALIAS_PATTERN, (match, rawAlias) => materializeTemplateValue(GENERATOR_ALIAS_TEMPLATES[String(rawAlias || "").toLowerCase()] || match, now));
};
export const normalizeKey = (value) => {
    const normalized = normalizeText(value)?.replace(/^@+/, "").toLowerCase() || null;
    return normalized;
};
export const registerContextValue = (context, key, value) => {
    const normalizedKey = normalizeKey(key);
    if (!normalizedKey) {
        return;
    }
    const normalizedValue = stringifyValue(value);
    context.values[normalizedKey] = normalizedValue;
    if (!normalizedKey.includes(".")) {
        context.values[`t.${normalizedKey}`] = normalizedValue;
    }
};
export const buildInitialContext = (envelope, capturedValues = {}) => {
    const context = {
        values: Object.entries(GENERATED_CONTEXT_ALIASES).reduce((values, [key, template]) => {
            values[key] = materializeTemplateValue(template);
            return values;
        }, {})
    };
    Object.entries(envelope.suite_parameters || {}).forEach(([key, value]) => {
        const normalizedKey = normalizeKey(key);
        if (!normalizedKey) {
            return;
        }
        context.values[`s.${normalizedKey.replace(/^s\./, "")}`] = materializeTemplateValue(value);
    });
    Object.entries(envelope.case_parameters || {}).forEach(([key, value]) => {
        const normalizedKey = normalizeKey(key);
        if (!normalizedKey) {
            return;
        }
        context.values[`t.${normalizedKey.replace(/^t\./, "")}`] = materializeTemplateValue(value);
    });
    Object.entries(envelope.manual_spec?.test_data || {}).forEach(([key, value]) => {
        const normalizedKey = normalizeKey(key);
        if (!normalizedKey) {
            return;
        }
        context.values[`t.${normalizedKey.replace(/^t\./, "")}`] = materializeTemplateValue(value);
    });
    (envelope.environment?.variables || []).forEach((entry) => {
        const normalizedKey = normalizeKey(entry?.key || null);
        if (!normalizedKey) {
            return;
        }
        context.values[`r.${normalizedKey.replace(/^r\./, "")}`] = materializeTemplateValue(entry.value);
    });
    (envelope.configuration?.variables || []).forEach((entry) => {
        const normalizedKey = normalizeKey(entry?.key || null);
        if (!normalizedKey) {
            return;
        }
        context.values[`r.${normalizedKey.replace(/^r\./, "")}`] = materializeTemplateValue(entry.value);
    });
    const dataSetRows = Array.isArray(envelope.data_set?.rows)
        ? envelope.data_set?.rows
        : envelope.data_set?.template_rows || [];
    if (envelope.data_set?.mode === "key_value") {
        dataSetRows.forEach((row) => {
            const normalizedKey = normalizeKey(row.key);
            if (!normalizedKey) {
                return;
            }
            context.values[`t.${normalizedKey.replace(/^t\./, "")}`] = materializeTemplateValue(row.value);
        });
    }
    else if (Array.isArray(dataSetRows) && dataSetRows.length) {
        Object.entries(dataSetRows[0] || {}).forEach(([key, value]) => {
            const normalizedKey = normalizeKey(key);
            if (!normalizedKey) {
                return;
            }
            context.values[`t.${normalizedKey.replace(/^t\./, "")}`] = materializeTemplateValue(value);
        });
    }
    Object.entries(capturedValues).forEach(([key, value]) => {
        registerContextValue(context, key, value);
    });
    return context;
};
export const resolveContextValue = (context, scopedKey, fallbackScope = "t") => {
    const normalizedKey = normalizeKey(scopedKey);
    if (!normalizedKey) {
        return "";
    }
    if (context.values[normalizedKey] !== undefined && !(GENERATED_CONTEXT_ALIASES[normalizedKey] && context.values[normalizedKey] === "")) {
        return context.values[normalizedKey];
    }
    if (!normalizedKey.includes(".")) {
        const direct = context.values[`${fallbackScope}.${normalizedKey}`];
        if (direct !== undefined) {
            return direct;
        }
        const suite = context.values[`s.${normalizedKey}`];
        if (suite !== undefined) {
            return suite;
        }
        const run = context.values[`r.${normalizedKey}`];
        if (run !== undefined) {
            return run;
        }
    }
    if (GENERATED_CONTEXT_ALIASES[normalizedKey]) {
        return materializeTemplateValue(GENERATED_CONTEXT_ALIASES[normalizedKey]);
    }
    return "";
};
export const interpolateText = (value, context) => String(value || "").replace(STEP_PARAMETER_PATTERN, (_match, scope, rawName) => {
    const normalizedKey = scope
        ? `${String(scope).toLowerCase()}.${String(rawName).toLowerCase()}`
        : String(rawName).toLowerCase();
    return resolveContextValue(context, normalizedKey, scope ? String(scope).toLowerCase() : "t");
});
export const interpolateHeaders = (headers, context) => (headers || []).reduce((accumulator, header) => {
    const key = interpolateText(header?.key || "", context).trim();
    if (!key) {
        return accumulator;
    }
    accumulator[key] = interpolateText(header?.value || "", context);
    return accumulator;
}, {});
export const toParameterValuesRecord = (context) => ({ ...context.values });
