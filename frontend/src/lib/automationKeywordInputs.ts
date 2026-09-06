import type { AutomationLearningCacheEntry } from "../types";

export type AutomationKeywordInputSpec = {
  target: "repository" | "text" | "none";
  targetLabel: string;
  targetRequired?: boolean;
  showValue: boolean;
  valueLabel: string;
  valueRequired: boolean;
  valueTarget?: "repository";
};

const spec = (target: AutomationKeywordInputSpec["target"], targetLabel: string, valueLabel = "", valueRequired = false, valueTarget?: "repository", targetRequired = target !== "none"): AutomationKeywordInputSpec => ({
  target, targetLabel, targetRequired, showValue: Boolean(valueLabel), valueLabel, valueRequired, valueTarget
});

/** Match input controls to the arguments each executable keyword accepts. */
export function getAutomationKeywordInputSpec(keywordId: string, platform = "web"): AutomationKeywordInputSpec {
  const parts = keywordId.split(".");
  const keyword = parts.pop()!.toLowerCase();
  const mobile = /^(android|ios|mobile)$/i.test(parts[0] || platform);
  if (keyword === "codedjs") return spec("none", "");
  if (keyword === "aistep") return spec("repository", "Optional target", "Instruction", true, undefined, false);
  if (parts[0]?.toLowerCase() === "api") {
    if (keyword === "request") return spec("text", "Request URL", "Body");
    if (keyword === "expectstatus") return spec("text", "HTTP status");
    if (keyword === "expectjson") return spec("text", "JSON path", "Expected value", true);
    if (keyword === "capture") return spec("text", "JSON path", "Save to parameter", true);
  }
  if (keyword === "drag") return spec("repository", "Source object", "Destination object", true, "repository");
  if (mobile) {
    if (["hidekeyboard", "pressback", "screenshot"].includes(keyword)) return spec("none", "");
    if (["tappoint", "presskeycode", "backgroundapp", "activateapp", "terminateapp", "setorientation", "pause"].includes(keyword)) {
      return spec("text", ({ tappoint: "X,Y coordinates", presskeycode: "Key code", backgroundapp: "Seconds", activateapp: "App package", terminateapp: "App package", setorientation: "Orientation", pause: "Milliseconds" } as Record<string, string>)[keyword], "", false, undefined, keyword !== "backgroundapp");
    }
    if (keyword === "swipe") return spec("text", "Start X,Y", "End X,Y,duration", true);
    if (keyword === "tapbytext") return spec("text", "Visible text");
    if (["pushfile", "pushremotefile"].includes(keyword)) return spec("text", "Device path", keyword === "pushfile" ? "Local file path" : "File URL", true);
    if (keyword === "pullfile") return spec("text", "Device path");
    if (keyword === "installapp") return spec("text", "App path or URL");
    if (keyword === "removeapp") return spec("text", "App package");
    if (keyword === "startactivity") return spec("text", "App package", "Activity", true);
    if (["opendeeplink", "deeplink"].includes(keyword)) return spec("text", "URL", "App package", true);
    if (["type", "fill", "select", "press", "expecttext", "expectvalue"].includes(keyword)) return spec("repository", "Object Repository field", keyword === "press" ? "Key" : keyword.startsWith("expect") ? "Expected value" : "Value", true);
    if (["longpress", "waitfordisplayed", "waitforexist", "waitforenabled", "expectnotdisplayed"].includes(keyword)) return spec("repository", "Object Repository field", keyword === "longpress" ? "Duration (ms)" : "Timeout (ms)");
    if (keyword === "scrollintoview") return spec("repository", "Object or text", "Direction");
    if (["capturetext", "capturevalue"].includes(keyword)) return spec("repository", "Object Repository field", "Save to parameter", true);
    return spec("repository", "Object Repository field");
  }
  if (["goto", "opentab"].includes(keyword)) return spec("text", "URL or path", "", false, undefined, keyword === "goto");
  if (["switchtab", "closetab"].includes(keyword)) return spec("text", "Tab index, title, or URL", "", false, undefined, false);
  if (["reload", "goback", "goforward"].includes(keyword)) return spec("none", "");
  if (keyword === "waitforloadstate") return spec("none", "", "Load state");
  if (keyword === "wait") return spec("none", "", "Milliseconds", true);
  if (keyword === "scroll") return spec("text", "Direction (down, up, left, right)", "Pixels", true, undefined, false);
  if (keyword === "expecturl") return spec("none", "", "URL fragment", true);
  if (keyword === "screenshot") return spec("none", "");
  if (["fill", "type", "select", "expecttext", "expectvalue", "press"].includes(keyword)) return spec("repository", keyword === "press" || keyword === "expecttext" ? "Optional object" : "Object Repository field", keyword === "press" ? "Key" : keyword.startsWith("expect") ? "Expected value" : "Value", true, undefined, !["press", "expecttext"].includes(keyword));
  if (["uploadfile", "uploadlocalfile", "uploadremotefile"].includes(keyword)) return spec("repository", "File input", keyword === "uploadremotefile" ? "File URL" : "File path", true);
  if (["capturetext", "capturevalue"].includes(keyword)) return spec("repository", "Object Repository field", "Save to parameter", true);
  return spec("repository", "Object Repository field");
}

export function buildAutomationRepositoryFields(objectRepository: AutomationLearningCacheEntry[]) {
  return objectRepository.filter((entry) => Boolean(entry.locator) && entry.locator !== "__screen__" && entry.locator_intent !== "__screen__" && entry.metadata?.record_kind !== "screen" && entry.metadata?.object_name !== "__screen__")
    .map((entry) => {
      const metadata = entry.metadata || {};
      const screenName = String(metadata.screen_name || entry.page_key || "Screen").trim();
      const rawName = String(metadata.object_name || entry.locator_intent || entry.locator || "Field").trim();
      const objectName = rawName.startsWith(`${screenName}.`) ? rawName.slice(screenName.length + 1) || rawName : rawName;
      return { id: entry.id, reference: `${screenName}.${objectName}`, locator: entry.locator, screenName, objectName, htmlTag: String(metadata.object_role || entry.locator_kind || "locator"), pageUrl: String(metadata.page_url || metadata.url_pattern || entry.page_url || entry.page_key || "") };
    });
}

export function resolveAutomationRepositoryTarget(target: string, objectRepository: AutomationLearningCacheEntry[]) {
  return buildAutomationRepositoryFields(objectRepository).find((field) => field.reference === target)?.locator || target;
}

/** Keep numeric parameter references executable instead of replacing them with a default. */
export function automationParameterArgument(value: string): string | null {
  const source = value.trim();
  const parameter = source.match(/^@([tsr])\.(?:\[((?:\\.|[^\]\\])+)\]|([A-Za-z][A-Za-z0-9_-]*))$/i);
  if (parameter) {
    const name = `${parameter[1]}.${(parameter[2] || parameter[3]).replace(/\\([\\\]])/g, "$1")}`.toLowerCase();
    return `params[${JSON.stringify(name)}]`;
  }
  return null;
}

export function automationNumericArgument(value: string, fallback: number) {
  const source = value.trim();
  const parameter = automationParameterArgument(source);
  if (parameter) return `Number(${parameter})`;
  return String(source && Number.isFinite(Number(source)) ? Number(source) : fallback);
}

/** Read the first keyword call without treating quotes in later recorded calls as arguments. */
export function parseAutomationKeywordCall(code: string) {
  const match = code.match(/(?:await\s+)?((?:web|api|android|ios|mobile)\.\w+)\(/);
  if (!match) return null;
  const tail = code.slice((match.index || 0) + match[0].length);
  const args: string[] = [];
  let quote = "";
  let depth = 0;
  let start = 0;
  for (let index = 0; index < tail.length; index += 1) {
    const char = tail[index];
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === ")" && depth === 0) {
      if (index > start) args.push(tail.slice(start, index).trim());
      break;
    } else if ("([{".includes(char)) depth += 1;
    else if (")]}".includes(char)) depth -= 1;
    else if (char === "," && depth === 0) {
      args.push(tail.slice(start, index).trim());
      start = index + 1;
    }
  }
  const values = args.map((original) => {
    const negation = original.match(/^-\(([\s\S]+)\)$/);
    const arg = negation?.[1] || original;
    if (arg === "null" || arg === "undefined") return "";
    const numericParameter = arg.match(/^Number\(params\[("(?:\\.|[^"\\])*")\]\)$/);
    if (numericParameter) {
      try {
        const name = String(JSON.parse(numericParameter[1]));
        const match = name.match(/^([tsr])\.(.+)$/);
        if (match) return `${negation ? "-" : ""}@${match[1]}.${/^[A-Za-z][A-Za-z0-9_-]*$/.test(match[2]) ? match[2] : `[${match[2].replace(/\\/g, "\\\\").replace(/\]/g, "\\]")}]`}`;
      } catch { /* Preserve invalid expressions for the code editor. */ }
    }
    if (arg.startsWith('"')) {
      try { return String(JSON.parse(arg)); } catch { /* Preserve hand-written expressions. */ }
    }
    if ((arg[0] === "'" || arg[0] === "`") && arg[arg.length - 1] === arg[0]) return arg.slice(1, -1).replace(/\\([\\'"`])/g, "$1").replace(/\\n/g, "\n").replace(/\\t/g, "\t");
    return negation && Number.isFinite(Number(arg)) ? String(-Number(arg)) : original;
  });
  return { keyword: match[1], args: values };
}
