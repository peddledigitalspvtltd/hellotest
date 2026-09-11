/** Bracket quoting lets a reference retain the actual data-set column name. */
export const STEP_PARAMETER_PATTERN = /(?<![A-Za-z0-9_])@(?:(t|s|r)\.)?(\[(?:\\.|[^\]\\\r\n])+\]|[A-Za-z][A-Za-z0-9_-]*)/gi;
export const decodeParameterColumnName = (name) => name.replace(/\\([\\\]])/g, "$1");
export const normalizeParameterReferenceKey = (key) => key.trim().replace(/^@+/, "")
    .replace(/^([tsr])\.\[((?:\\.|[^\]\\])+)\]$/i, (_match, scope, name) => `${scope}.${decodeParameterColumnName(name)}`)
    .toLowerCase();
export const normalizeScopedParameterKey = (key, scope = "r") => {
    const normalized = normalizeParameterReferenceKey(key);
    return normalized ? normalizeParameterReferenceKey(/^[tsr]\./.test(normalized) ? normalized : `${scope}.${normalized}`) : "";
};
