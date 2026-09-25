export type BehaviorKeyword = "Given" | "When" | "Then" | "And" | "But" | "*";
export type BehaviorStep = {
  keyword: BehaviorKeyword;
  text: string;
  followingLines?: string[];
  group?: { id: string; name: string };
};
export const BEHAVIOR_KEYWORDS: BehaviorKeyword[] = ["Given", "When", "Then", "And", "But", "*"];
const groupStart = /^\s*# Shared Step Group \[([^\]]+)\]:\s*(.*)$/;
const groupEnd = /^\s*# End Shared Step Group \[[^\]]+\]\s*$/;

/** Keep step arguments, comments and scenario tags attached during editing. */
export function parseBehaviorBlock(value: string) {
  const prefix: string[] = [];
  const steps: BehaviorStep[] = [];
  let activeGroup: BehaviorStep["group"];
  let docStringDelimiter = "";
  for (const line of value.split("\n")) {
    const delimiter = line.trim().match(/^("""|```)/)?.[1];
    if (delimiter) {
      docStringDelimiter = docStringDelimiter === delimiter ? "" : docStringDelimiter || delimiter;
      (steps.length ? steps[steps.length - 1].followingLines! : prefix).push(line);
      continue;
    }
    const start = !docStringDelimiter && line.match(groupStart);
    if (start) { activeGroup = { id: start[1], name: start[2] }; continue; }
    if (!docStringDelimiter && groupEnd.test(line)) { activeGroup = undefined; continue; }
    const match = !docStringDelimiter && line.match(/^\s*(Given|When|Then|And|But|\*)(?:[ \t]+(.*))?\s*$/i);
    if (match) {
      steps.push({ keyword: BEHAVIOR_KEYWORDS.find((keyword) => keyword.toLowerCase() === match[1].toLowerCase())!, text: match[2] || "", followingLines: [], ...(activeGroup ? { group: activeGroup } : {}) });
    } else {
      (steps.length ? steps[steps.length - 1].followingLines! : prefix).push(line);
    }
  }
  return { prefix, steps };
}

export function composeBehaviorBlock(value: string, headingLabel: string, heading: string, steps: BehaviorStep[]) {
  const { prefix } = parseBehaviorBlock(value);
  const headingIndex = prefix.findIndex((line) => /^\s*(?:Background|Scenario(?: Outline| Template)?)\s*:/i.test(line));
  const headingLine = `${headingLabel}: ${heading}`.trimEnd();
  if (headingIndex >= 0) prefix[headingIndex] = headingLine;
  else prefix.push(headingLine);
  const lines = [...prefix];
  steps.forEach((step, index) => {
    if (step.group && steps[index - 1]?.group?.id !== step.group.id) lines.push(`  # Shared Step Group [${step.group.id}]: ${step.group.name.replace(/[\r\n]+/g, " ")}`);
    lines.push(`  ${step.keyword} ${step.text}`.trimEnd(), ...(step.followingLines || []));
    if (step.group && steps[index + 1]?.group?.id !== step.group.id) lines.push(`  # End Shared Step Group [${step.group.id}]`);
  });
  return lines.join("\n");
}

/** Annotate each linked instance once, without changing its behavior text. */
export function annotateGherkinStepGroups(value: string, groups: Array<{ id: string; name: string; lines: string[] }>) {
  const lines = value.split("\n");
  let searchFrom = 0;
  for (const group of groups) {
    const behavior = group.lines.map((line) => line.trim()).filter(Boolean);
    if (!behavior.length) continue;
    const start = lines.findIndex((line, index) => index >= searchFrom && line.trim() === behavior[0]
      && behavior.every((expected, offset) => lines[index + offset]?.trim() === expected));
    if (start < 0) continue;
    lines.splice(start + behavior.length, 0, `    # End Shared Step Group [${group.id}]`);
    lines.splice(start, 0, `    # Shared Step Group [${group.id}]: ${group.name.replace(/[\r\n]+/g, " ")}`);
    searchFrom = start + behavior.length + 2;
  }
  return lines.join("\n");
}

/** Align group membership with the action/expected-result rows used by cases. */
export function collectBehaviorRowGroups(value: string) {
  const groups: Array<BehaviorStep["group"]> = [];
  let phase: "action" | "expected" = "action";
  for (const step of parseBehaviorBlock(value).steps) {
    if (!step.text.trim() && !step.followingLines?.some((line) => line.trim())) continue;
    if (step.keyword === "Then") phase = "expected";
    else if (step.keyword === "Given" || step.keyword === "When") phase = "action";
    if (phase === "action" || !groups.length) groups.push(step.group);
  }
  return groups;
}
