const normalizeRichText = (value) => {
    const normalized = String(value || "").replace(/\r\n/g, "\n");
    return normalized.trim() ? normalized : "";
};
function quoteJsString(value) {
    return JSON.stringify(value);
}
export function apiAssertionParameterExpression(value) {
    const match = /^@([tsr])\.(?:([A-Za-z][A-Za-z0-9_-]*)|\[((?:\\.|[^\]\\\r\n])+)\])$/i.exec(String(value || '').trim());
    if (!match) return null;
    const name = (match[2] || match[3].replace(/\\([\\\]])/g, '$1')).trim().toLowerCase();
    return `params[${quoteJsString(match[1].toLowerCase() + '.' + name)}]`;
}
function normalizeValidationKind(value) {
    const normalized = String(value || "").trim().toLowerCase();
    if (["header", "header_present", "body_contains", "body_not_contains", "json_path", "json_schema", "response_time"].includes(normalized)) {
        return normalized;
    }
    return "status";
}
function toJsAssertionLiteral(value) {
    const normalized = normalizeRichText(value);
    if (!normalized) {
        return quoteJsString("");
    }
    if (normalized === "true" || normalized === "false" || normalized === "null") {
        return normalized;
    }
    if (/^-?\d+(\.\d+)?$/.test(normalized)) {
        return normalized;
    }
    if (/^[\[{"]/.test(normalized)) {
        try {
            return JSON.stringify(JSON.parse(normalized));
        }
        catch {
            return quoteJsString(normalized);
        }
    }
    return quoteJsString(normalized);
}
export function buildApiValidationAssertionCode(validation, responseVar) {
    const target = normalizeRichText(validation.target);
    const expected = normalizeRichText(validation.expected);
    const expectedExpression = apiAssertionParameterExpression(expected) || quoteJsString(expected);
    switch (normalizeValidationKind(validation.kind)) {
        case "header_present":
            return `expect(${responseVar}.headers[${quoteJsString(target || "content-type")}]).toBeDefined();`;
        case "header":
            return `expect(${responseVar}.headers[${quoteJsString(target || "content-type")}]).toBe(${quoteJsString(expected || "")});`;
        case "body_not_contains":
            return `expect(String(${responseVar}.body)).not.toContain(${quoteJsString(expected || "")});`;
        case "body_contains":
            return `expect(String(${responseVar}.body)).toContain(${quoteJsString(expected || "")});`;
        case "json_schema":
            return `expect(validateJsonSchema(${responseVar}.body, JSON.parse(${apiAssertionParameterExpression(expected || target) || quoteJsString(expected || target)}))).toEqual({ valid: true });`;
        case "response_time":
            return `expect(Number(${expectedExpression}) > 0 && Number.isFinite(Number(${expectedExpression}))).toBe(true); expect(${responseVar}.durationMs).toBeLessThanOrEqual(${/^\d+(?:\.\d+)?$/.test(expected) ? Number(expected) : `Number(${expectedExpression})`});`;
        case "json_path":
            return `expect(readJsonPath(${responseVar}.body, ${quoteJsString(target || "$")})).toEqual(${toJsAssertionLiteral(expected)});`;
        case "status":
        default:
            return /^\d{3}$/.test(expected) ? `expect(${responseVar}.status).toBe(${Number(expected)});`
                : `expect(/^\\d{3}$/.test(String(${expectedExpression}))).toBe(true); expect(${responseVar}.status).toBe(Number(${expectedExpression}));`;
    }
}
