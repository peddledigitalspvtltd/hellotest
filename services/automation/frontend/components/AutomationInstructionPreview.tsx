import type { ReactNode } from "react";
import type { StepApiRequest } from "@hellotest/platform/frontend/src/types";

export function automationProgramLines(code: string) {
  return code.replace(/\r\n/g, "\n").split("\n")
    .filter((line) => !/^\s*\/\/\s*@hellotest-options\b/.test(line))
    .filter((line, index, lines) => line.trim() || (index > 0 && index < lines.length - 1));
}

export function AutomationInstructionPreview({ code, apiRequest, sectionName, emptyAction }: {
  code: string;
  apiRequest?: StepApiRequest | null;
  sectionName: string;
  emptyAction?: ReactNode;
}) {
  if (!code.trim() && apiRequest?.url?.trim()) return <div className="automation-instruction-source" aria-label={`${sectionName} API request`} role="region" tabIndex={0}>
    <div className="automation-instruction-line"><span className="automation-line-number" aria-hidden="true">1</span><code><span className="automation-instruction-keyword">{apiRequest.method || "GET"}</span> <span>{apiRequest.url}</span></code></div>
  </div>;
  const lines = automationProgramLines(code);
  if (!lines.some((line) => line.trim())) return <div className="automation-instruction-empty"><span className="automation-line-number" aria-hidden="true">1</span><span>No instructions yet</span>{emptyAction}</div>;
  return <div className="automation-instruction-source" aria-label={`${sectionName} implementation`} role="region" tabIndex={0}>
    {lines.map((line, index) => {
      const call = line.match(/^(\s*(?:await\s+)?)([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)(\s*\(.*)$/);
      return <div className={`automation-instruction-line${/^\s*\/\//.test(line) ? " is-comment" : ""}`} key={index}>
        <span className="automation-line-number" aria-hidden="true">{index + 1}</span>
        <code>{call ? <><span className="automation-instruction-await">{call[1]}</span><span className="automation-instruction-keyword">{call[2]}</span>{call[3]}</> : line || " "}</code>
      </div>;
    })}
  </div>;
}
