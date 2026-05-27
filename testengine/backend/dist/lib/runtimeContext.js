const STEP_PARAMETER_PATTERN = /@(?:(t|s|r)\.)?([A-Za-z0-9_]+)/gi;
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
        values: {}
    };
    Object.entries(envelope.suite_parameters || {}).forEach(([key, value]) => {
        const normalizedKey = normalizeKey(key);
        if (!normalizedKey) {
            return;
        }
        context.values[`s.${normalizedKey.replace(/^s\./, "")}`] = String(value ?? "");
    });
    Object.entries(envelope.case_parameters || {}).forEach(([key, value]) => {
        const normalizedKey = normalizeKey(key);
        if (!normalizedKey) {
            return;
        }
        context.values[`t.${normalizedKey.replace(/^t\./, "")}`] = String(value ?? "");
    });
    Object.entries(envelope.manual_spec?.test_data || {}).forEach(([key, value]) => {
        const normalizedKey = normalizeKey(key);
        if (!normalizedKey) {
            return;
        }
        context.values[`t.${normalizedKey.replace(/^t\./, "")}`] = String(value ?? "");
    });
    (envelope.environment?.variables || []).forEach((entry) => {
        const normalizedKey = normalizeKey(entry?.key || null);
        if (!normalizedKey) {
            return;
        }
        context.values[`r.${normalizedKey.replace(/^r\./, "")}`] = stringifyValue(entry.value);
    });
    (envelope.configuration?.variables || []).forEach((entry) => {
        const normalizedKey = normalizeKey(entry?.key || null);
        if (!normalizedKey) {
            return;
        }
        context.values[`r.${normalizedKey.replace(/^r\./, "")}`] = stringifyValue(entry.value);
    });
    if (envelope.data_set?.mode === "key_value") {
        (envelope.data_set.rows || []).forEach((row) => {
            const normalizedKey = normalizeKey(row.key);
            if (!normalizedKey) {
                return;
            }
            context.values[`t.${normalizedKey.replace(/^t\./, "")}`] = stringifyValue(row.value);
        });
    }
    else if (Array.isArray(envelope.data_set?.rows) && envelope.data_set.rows.length) {
        Object.entries(envelope.data_set.rows[0] || {}).forEach(([key, value]) => {
            const normalizedKey = normalizeKey(key);
            if (!normalizedKey) {
                return;
            }
            context.values[`t.${normalizedKey.replace(/^t\./, "")}`] = stringifyValue(value);
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
    if (context.values[normalizedKey] !== undefined) {
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
