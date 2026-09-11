import type { ExecutionDataSetSnapshot, TestDataSet, TestStep } from "../types";

export type StepParameterScope = "t" | "s" | "r";

export type StepParameterDefinition = {
  name: string;
  rawName: string;
  label: string;
  token: string;
  scope: StepParameterScope;
  scopeLabel: string;
  stepIds: string[];
  occurrenceCount: number;
  source?: "authoring" | "data_set";
  sourceLabel?: string;
  sensitive?: boolean;
};

export type StepParameterSegment =
  | {
      type: "text";
      value: string;
    }
  | {
      type: "token";
      token: string;
      name: string;
      label: string;
      resolvedValue: string | null;
    };

export type StepParameterSource = Pick<TestStep, "id" | "action" | "expected_result" | "automation_code" | "api_request">;
type StepApiLike = NonNullable<TestStep["api_request"]>;
type StepParameterDataSet = Pick<ExecutionDataSetSnapshot | TestDataSet, "columns" | "mode" | "rows">;

const STEP_PARAMETER_PATTERN = /(?<![A-Za-z0-9_])@(?:(t|s|r)\.)?(\[(?:\\.|[^\]\\\r\n])+\]|[A-Za-z][A-Za-z0-9_-]*)/gi;
const STEP_PARAMETER_SCOPE_LABELS: Record<StepParameterScope, string> = {
  t: "Test case",
  s: "Suite",
  r: "Run"
};

export function normalizeStepParameterScope(value?: string | null, fallback: StepParameterScope = "r"): StepParameterScope {
  const normalized = String(value || "").trim().toLowerCase();

  if (normalized === "t" || normalized === "test" || normalized === "test_case") {
    return "t";
  }

  if (normalized === "s" || normalized === "suite") {
    return "s";
  }

  if (normalized === "r" || normalized === "run") {
    return "r";
  }

  return fallback;
}

export function normalizeStepParameterName(value?: string | null, fallbackScope: StepParameterScope = "r") {
  const trimmed = String(value || "").trim().replace(/^@+/, "");

  if (!trimmed) {
    return "";
  }

  const scopedMatch = trimmed.match(/^([tsr])\.(.+)$/i);
  const scope = normalizeStepParameterScope(scopedMatch?.[1], fallbackScope);
  const rawName = decodeStepParameterRawName(String(scopedMatch?.[2] || trimmed)).trim().toLowerCase();

  if (!rawName) {
    return "";
  }

  return `${scope}.${rawName}`;
}

export function decodeStepParameterRawName(value: string) {
  const quoted = value.trim().match(/^\[((?:\\.|[^\]\\\r\n])+)\]$/);
  return quoted ? quoted[1].replace(/\\([\\\]])/g, "$1") : value;
}

export function formatStepParameterToken(scope: StepParameterScope, rawName: string) {
  const quotedName = /^[A-Za-z][A-Za-z0-9_-]*$/.test(rawName)
    ? rawName
    : `[${rawName.replace(/\\/g, "\\\\").replace(/\]/g, "\\]")}]`;
  return `@${scope}.${quotedName}`;
}

export function getStepParameterScopeLabel(scope: StepParameterScope) {
  return STEP_PARAMETER_SCOPE_LABELS[scope];
}

export function parseStepParameterName(value?: string | null, fallbackScope: StepParameterScope = "r") {
  const normalized = normalizeStepParameterName(value, fallbackScope);

  if (!normalized) {
    return null;
  }

  const separatorIndex = normalized.indexOf(".");
  const scope = normalizeStepParameterScope(normalized.slice(0, separatorIndex), fallbackScope);
  const rawName = normalized.slice(separatorIndex + 1);

  return {
    key: normalized,
    name: normalized,
    rawName,
    scope,
    scopeLabel: getStepParameterScopeLabel(scope),
    token: formatStepParameterToken(scope, rawName)
  };
}

export function normalizeStepParameterValues(
  values: Record<string, string> = {},
  fallbackScope: StepParameterScope = "r"
) {
  return Object.entries(values).reduce<Record<string, string>>((next, [key, value]) => {
    const normalizedKey = normalizeStepParameterName(key, fallbackScope);

    if (!normalizedKey) {
      return next;
    }

    next[normalizedKey] = value;
    return next;
  }, {});
}

export function combineStepParameterValues(...valueMaps: Array<Record<string, string> | undefined | null>) {
  return valueMaps.reduce<Record<string, string>>((next, valueMap) => {
    Object.assign(next, valueMap || {});
    return next;
  }, {});
}

export function filterStepParameterValuesByScope(values: Record<string, string>, scope: StepParameterScope) {
  return Object.entries(values).reduce<Record<string, string>>((next, [key, value]) => {
    const parsed = parseStepParameterName(key, scope);

    if (!parsed || parsed.scope !== scope) {
      return next;
    }

    next[parsed.name] = value;
    return next;
  }, {});
}

export function extractStepParameterMatches(text?: string | null) {
  const source = String(text || "");

  if (!source) {
    return [];
  }

  return [...source.matchAll(STEP_PARAMETER_PATTERN)]
    .filter((match) => !(!match[1] && /^[tsr]$/i.test(match[2]) && source[(match.index || 0) + match[0].length] === "."))
    .map((match) => ({
    token: match[0],
    label: decodeStepParameterRawName(match[2]),
    rawName: decodeStepParameterRawName(String(match[2] || "")).trim(),
    scope: normalizeStepParameterScope(match[1], "r"),
    name: normalizeStepParameterName(`${match[1] || "r"}.${match[2]}`),
    index: match.index || 0
  }));
}

export function collectStepParameters(steps: StepParameterSource[]): StepParameterDefinition[] {
  const parameterMap = new Map<string, StepParameterDefinition>();

  const registerParsedParameter = (stepId: string, value?: string | null) => {
    const parsed = parseStepParameterName(value);

    if (!parsed) {
      return;
    }

    const current =
      parameterMap.get(parsed.name) || {
        name: parsed.name,
        rawName: parsed.rawName,
        label: parsed.rawName,
        token: parsed.token,
        scope: parsed.scope,
        scopeLabel: parsed.scopeLabel,
        stepIds: [],
        occurrenceCount: 0
      };

    current.occurrenceCount += 1;

    if (!current.stepIds.includes(stepId)) {
      current.stepIds.push(stepId);
    }

    parameterMap.set(parsed.name, current);
  };

  const registerValue = (stepId: string, value?: string | null) => {
    extractStepParameterMatches(value).forEach((match) => {
      const current =
        parameterMap.get(match.name) || {
          name: match.name,
          rawName: match.rawName.toLowerCase(),
          label: match.label,
          token: formatStepParameterToken(match.scope, match.rawName),
          scope: match.scope,
          scopeLabel: getStepParameterScopeLabel(match.scope),
          stepIds: [],
          occurrenceCount: 0
        };

      current.occurrenceCount += 1;

      if (!current.stepIds.includes(stepId)) {
        current.stepIds.push(stepId);
      }

      parameterMap.set(match.name, current);
    });
  };

  const registerApiRequest = (stepId: string, apiRequest?: StepApiLike | null) => {
    if (!apiRequest) {
      return;
    }

    registerValue(stepId, apiRequest.url);
    registerValue(stepId, apiRequest.body);

    (apiRequest.headers || []).forEach((header) => {
      registerValue(stepId, header.key);
      registerValue(stepId, header.value);
    });

    (apiRequest.validations || []).forEach((validation) => {
      registerValue(stepId, validation.target);
      registerValue(stepId, validation.expected);
    });

    (apiRequest.captures || []).forEach((capture) => {
      registerParsedParameter(stepId, capture.parameter);
    });
  };

  steps.forEach((step) => {
    [step.action, step.expected_result, step.automation_code].forEach((value) => registerValue(step.id, value));
    registerApiRequest(step.id, step.api_request);
  });

  return [...parameterMap.values()].sort((left, right) => left.label.localeCompare(right.label));
}

export function filterStepParameterValues(
  values: Record<string, string>,
  parameters: Array<Pick<StepParameterDefinition, "name">>
) {
  const allowed = new Set(parameters.map((parameter) => parameter.name));
  const normalizedValues = normalizeStepParameterValues(values);

  return Object.entries(normalizedValues).reduce<Record<string, string>>((next, [key, value]) => {
    if (!allowed.has(key)) {
      return next;
    }

    next[key] = value;
    return next;
  }, {});
}

export function buildDataSetParameterValues(dataSet?: StepParameterDataSet | null) {
  const values: Record<string, string> = {};

  if (!dataSet) {
    return values;
  }

  if (dataSet.mode === "key_value") {
    const sensitiveNames = new Set(collectSensitiveDataSetParameterNames(dataSet));
    (dataSet.rows || []).forEach((row) => {
      const key = normalizeStepParameterName(String(row.key ?? ""), "r");

      if (!key || sensitiveNames.has(key)) {
        return;
      }

      values[key] = String(row.value ?? "");
    });

    return values;
  }

  const firstRow = (dataSet.rows || []).find((row) => row && typeof row === "object") || {};
  Object.keys(firstRow).forEach((column) => {
    const key = normalizeStepParameterName(column, "r");

    if (!key) {
      return;
    }

    values[key] = String(firstRow[column] ?? "");
  });

  return values;
}

export function isSensitiveDataSetRow(row?: Record<string, unknown> | null) {
  const value = row?.is_secret;
  return value === true || ["true", "1", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

export function collectSensitiveDataSetParameterNames(dataSet?: StepParameterDataSet | null) {
  if (!dataSet || dataSet.mode !== "key_value") {
    return [];
  }

  return (dataSet.rows || []).flatMap((row) => {
    if (!isSensitiveDataSetRow(row)) return [];
    const name = normalizeStepParameterName(String(row.key ?? ""), "r");
    return name ? [name] : [];
  });
}

export function excludeSensitiveStepParameterValues(
  values: Record<string, string> = {},
  sensitiveNames: Iterable<string> = []
) {
  const excluded = new Set(Array.from(sensitiveNames, (name) => normalizeStepParameterName(name)).filter(Boolean));

  return Object.entries(normalizeStepParameterValues(values)).reduce<Record<string, string>>((next, [name, value]) => {
    if (!excluded.has(name)) next[name] = value;
    return next;
  }, {});
}

export function buildDataSetParameterDefinitions(
  dataSet?: StepParameterDataSet | null,
  sourceLabel?: string
): StepParameterDefinition[] {
  const dataSetNames = !dataSet
    ? []
    : dataSet.mode === "key_value"
      ? (dataSet.rows || []).map((row) => normalizeStepParameterName(String(row.key ?? ""), "r"))
      : [...(dataSet.columns || []), ...(dataSet.rows || []).flatMap((row) => Object.keys(row || {}))]
        .map((column) => normalizeStepParameterName(column, "r"));
  const sensitiveNames = new Set(collectSensitiveDataSetParameterNames(dataSet));

  return [...new Set(dataSetNames.filter(Boolean))].flatMap((name) => {
    const parsed = parseStepParameterName(name, "r");

    if (!parsed) {
      return [];
    }

    return [{
      name: parsed.name,
      rawName: parsed.rawName,
      label: parsed.rawName,
      token: parsed.token,
      scope: parsed.scope,
      scopeLabel: parsed.scopeLabel,
      stepIds: [],
      occurrenceCount: 0,
      source: "data_set" as const,
      sourceLabel,
      sensitive: sensitiveNames.has(parsed.name)
    }];
  });
}

/** Include saved defaults even when no step has referenced the parameter yet. */
export function buildStepParameterDefinitionsFromValues(values: Record<string, string> = {}): StepParameterDefinition[] {
  return Object.keys(normalizeStepParameterValues(values)).flatMap((name) => {
    const parsed = parseStepParameterName(name);
    return parsed ? [{ ...parsed, label: parsed.rawName, stepIds: [], occurrenceCount: 0 }] : [];
  });
}

export type StepParameterQuery = {
  start: number;
  end: number;
  scope: StepParameterScope;
  query: string;
};

/** Only a scoped reference at a collapsed caret opens the completion menu. */
export function getStepParameterQuery(text: string, selectionStart: number, selectionEnd = selectionStart): StepParameterQuery | null {
  if (selectionStart !== selectionEnd || selectionStart < 0 || selectionStart > text.length) return null;
  const quotedMatch = text.slice(0, selectionStart).match(/(?:^|[^A-Za-z0-9_@])@([tsr])\.\[((?:\\.|[^\]\\\r\n])*)$/i);
  if (quotedMatch) {
    const suffix = text.slice(selectionStart).match(/^(?:\\.|[^\]\\\r\n])*\]/)?.[0] || "";
    return {
      start: selectionStart - quotedMatch[2].length - 4,
      end: selectionStart + suffix.length,
      scope: normalizeStepParameterScope(quotedMatch[1]),
      query: quotedMatch[2].replace(/\\([\\\]])/g, "$1").toLowerCase()
    };
  }
  const match = text.slice(0, selectionStart).match(/(?:^|[^A-Za-z0-9_@])@([tsr])\.([A-Za-z0-9_-]*)$/i);
  if (!match) return null;
  const prefixLength = match[2].length + 3;
  const suffix = text.slice(selectionStart).match(/^(?:\[(?:\\.|[^\]\\\r\n])*\]|[A-Za-z0-9_-]*)/)?.[0] || "";
  return {
    start: selectionStart - prefixLength,
    end: selectionStart + suffix.length,
    scope: normalizeStepParameterScope(match[1]),
    query: match[2].toLowerCase()
  };
}

export function getStepParameterSuggestions(parameters: StepParameterDefinition[], query: StepParameterQuery | null) {
  if (!query) return [];
  return mergeStepParameterDefinitions(parameters)
    .filter((parameter) => parameter.scope === query.scope && (
      !query.query || parameter.rawName.toLowerCase().includes(query.query) || parameter.label.toLowerCase().includes(query.query)
    ))
    .sort((left, right) => Number(right.rawName.toLowerCase().startsWith(query.query)) - Number(left.rawName.toLowerCase().startsWith(query.query)) || left.label.localeCompare(right.label));
}

export function insertStepParameterReference(text: string, query: StepParameterQuery, parameter: Pick<StepParameterDefinition, "token">) {
  return {
    value: text.slice(0, query.start) + parameter.token + text.slice(query.end),
    caret: query.start + parameter.token.length
  };
}

export function mergeStepParameterDefinitions(
  ...definitionGroups: StepParameterDefinition[][]
): StepParameterDefinition[] {
  const merged = new Map<string, StepParameterDefinition>();

  definitionGroups.flat().forEach((definition) => {
    const current = merged.get(definition.name);

    if (!current) {
      merged.set(definition.name, {
        ...definition,
        stepIds: [...definition.stepIds]
      });
      return;
    }

    merged.set(definition.name, {
      ...current,
      label: current.occurrenceCount ? current.label : definition.label,
      stepIds: Array.from(new Set([...current.stepIds, ...definition.stepIds])),
      occurrenceCount: current.occurrenceCount + definition.occurrenceCount,
      source: current.source === "authoring" || current.occurrenceCount
        ? current.source || "authoring"
        : definition.source,
      sourceLabel: current.sourceLabel || definition.sourceLabel,
      sensitive: Boolean(current.sensitive || definition.sensitive)
    });
  });

  return Array.from(merged.values()).sort((left, right) => left.label.localeCompare(right.label));
}

export function mapStepParameterSegments(text?: string | null, values: Record<string, string> = {}): StepParameterSegment[] {
  const source = String(text || "");
  const normalizedValues = normalizeStepParameterValues(values);

  if (!source) {
    return [];
  }

  const segments: StepParameterSegment[] = [];
  let cursor = 0;

  extractStepParameterMatches(source).forEach((match) => {
    if (match.index > cursor) {
      segments.push({
        type: "text",
        value: source.slice(cursor, match.index)
      });
    }

    const resolvedValue = normalizedValues[match.name];

    segments.push({
      type: "token",
      token: match.token,
      name: match.name,
      label: match.label,
      resolvedValue: resolvedValue === undefined ? null : resolvedValue
    });

    cursor = match.index + match.token.length;
  });

  if (cursor < source.length) {
    segments.push({
      type: "text",
      value: source.slice(cursor)
    });
  }

  return segments;
}

export function resolveStepParameterText(text?: string | null, values: Record<string, string> = {}) {
  if (!text) {
    return "";
  }

  return mapStepParameterSegments(text, values)
    .map((segment) => (segment.type === "text" ? segment.value : segment.resolvedValue ?? segment.token))
    .join("");
}
