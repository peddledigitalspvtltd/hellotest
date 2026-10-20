import type { ReactNode } from "react";
import type { StepApiRequest } from "@hellotest/platform/frontend/src/types";
import { formatAutomationSourceLines, stripAutomationSettingsComments } from "../lib/automationInstructions";
import { buildReadableAutomationInstructions, readableApiInstructions, type AutomationReadableContext } from "../lib/automationReadableInstructions";

export function automationProgramLines(code: string) {
  return formatAutomationSourceLines(stripAutomationSettingsComments(code)).replace(/\r\n/g, "\n").split("\n")
    .filter((line, index, lines) => line.trim() || (index > 0 && index < lines.length - 1));
}

export function AutomationInstructionPreview({ code, apiRequest, sectionName, emptyAction, view = "source", renderArgument, context }: {
  code: string;
  apiRequest?: StepApiRequest | null;
  sectionName: string;
  emptyAction?: ReactNode;
  view?: "instructions" | "source";
  renderArgument?: (argument: string) => ReactNode;
  context?: AutomationReadableContext;
}) {
  const structuredApi = !code.trim() && apiRequest?.url?.trim();
  if (view === "instructions") {
    const instructions = structuredApi ? readableApiInstructions(apiRequest!) : buildReadableAutomationInstructions(code, context);
    if (!instructions.length) return <div className="automation-instruction-empty"><span className="automation-line-number" aria-hidden="true">1</span><span>No instructions yet</span>{emptyAction}</div>;
    return <div className="automation-instruction-source" aria-label={`${sectionName} ${structuredApi ? "API request" : "instructions"}`} role="region" tabIndex={0}>
      {instructions.map((instruction,index) => <div className="automation-instruction-line" data-instruction-kind={instruction.kind} key={index}>
        <span className="automation-line-number" aria-hidden="true">{index+1}</span><code className="automation-instruction-readable" style={{paddingInlineStart:12+instruction.depth*16}}><strong>{instruction.label}</strong>{instruction.args.map((argument,at)=><span key={at}>{renderArgument ? renderArgument(argument) : argument}</span>)}{instruction.detail ? <small className="automation-instruction-explanation">{instruction.detail}</small> : null}</code>
      </div>)}
    </div>;
  }
  const lines = structuredApi ? JSON.stringify(apiRequest || {}, null, 2).split("\n")
    : automationProgramLines(code);
  if (!lines.some((line) => line.trim())) return <div className="automation-instruction-empty"><span className="automation-line-number" aria-hidden="true">1</span><span>No instructions yet</span>{emptyAction}</div>;
  return <div className="automation-instruction-source" aria-label={`${sectionName} ${structuredApi ? "API request" : "implementation"}`} role="region" tabIndex={0}>
    {lines.map((line, index) => {
      const call = line.match(/^(\s*(?:await\s+)?)([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)(\s*\(.*)$/);
      return <div className={`automation-instruction-line${/^\s*\/\//.test(line) ? " is-comment" : ""}`} key={index}>
        <span className="automation-line-number" aria-hidden="true">{index + 1}</span>
        <code>{call ? <><span className="automation-instruction-await">{call[1]}</span><span className="automation-instruction-keyword">{call[2]}</span>{call[3]}</> : line || " "}</code>
      </div>;
    })}
  </div>;
}
