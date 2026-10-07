import { useEffect, useState, type ReactNode } from "react";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import "./FormattedText.css";

// Render a deliberately small Markdown vocabulary as React elements. Source
// content is always text: HTML and model-provided scripts are never evaluated.
export function knowledgeInlineText(value: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*)/g;
  let offset = 0;
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > offset) parts.push(value.slice(offset, index));
    const token = match[0];
    parts.push(token.startsWith("`") ? <code key={index}>{token.slice(1, -1)}</code>
      : token.startsWith("**") || token.startsWith("__") ? <strong key={index}>{token.slice(2, -2)}</strong>
        : <em key={index}>{token.slice(1, -1)}</em>);
    offset = index + token.length;
  }
  if (offset < value.length) parts.push(value.slice(offset));
  return parts;
}

const listItem = (line: string) => line.match(/^\s*(?:([-*+])|\d+[.)])\s+(.+)$/);
const tableCells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
const tableSeparator = (line: string) => line.includes("|") && tableCells(line).every((cell) => /^:?-{3,}:?$/.test(cell));

function KnowledgeCodeBlock({ code, language }: { code: string; language: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => { setState("idle"); }, [code]);
  useEffect(() => {
    if (state !== "copied") return;
    const timer = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(timer);
  }, [state]);
  return <div className="knowledge-code-artifact">
    <header><span>{language || "Code"}</span><button aria-label="Copy code block" onClick={async () => {
      try { await navigator.clipboard.writeText(code); setState("copied"); }
      catch { setState("failed"); }
    }} type="button">{state === "copied" ? <IconCheck aria-hidden="true" size={14} /> : <IconCopy aria-hidden="true" size={14} />}{state === "copied" ? "Copied" : "Copy"}</button></header>
    <pre><code>{code}</code></pre>
    {state === "failed" ? <span className="knowledge-code-copy-error" role="status">Copy unavailable. Select the code to copy it.</span> : null}
  </div>;
}

export function FormattedText({ text, className = "" }: { text: string; className?: string }) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index].trim();
    const key = index;
    if (!line) { index++; continue; }
    if (line.startsWith("```")) {
      const language = line.slice(3).trim().slice(0, 40);
      const code: string[] = [];
      index++;
      while (index < lines.length && !lines[index].trim().startsWith("```")) code.push(lines[index++]);
      if (index < lines.length) index++;
      blocks.push(<KnowledgeCodeBlock code={code.join("\n")} key={key} language={language} />);
      continue;
    }
    const heading = line.match(/^#{1,6}\s+(.+?)(?:\s+#+)?$/);
    if (heading) { blocks.push(<h4 key={key}>{knowledgeInlineText(heading[1])}</h4>); index++; continue; }
    if (index + 1 < lines.length && line.includes("|") && tableSeparator(lines[index + 1])) {
      const columns = tableCells(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].trim() && lines[index].includes("|")) rows.push(tableCells(lines[index++]));
      blocks.push(<div className="knowledge-answer-table-scroll" key={key} role="region" aria-label="Answer table" tabIndex={0}><table><thead><tr>{columns.map((cell, column) => <th key={column} scope="col">{knowledgeInlineText(cell)}</th>)}</tr></thead><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{columns.map((_, column) => <td key={column}>{knowledgeInlineText(row[column] || "")}</td>)}</tr>)}</tbody></table></div>);
      continue;
    }
    const firstItem = listItem(line);
    if (firstItem) {
      const ordered = !firstItem[1];
      const items: ReactNode[] = [];
      while (index < lines.length) {
        const item = listItem(lines[index]);
        if (!item || (!item[1]) !== ordered) break;
        items.push(<li key={index}>{knowledgeInlineText(item[2])}</li>);
        index++;
      }
      blocks.push(ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>);
      continue;
    }
    const paragraph: string[] = [lines[index++]];
    while (index < lines.length && lines[index].trim() && !/^\s*(?:#{1,6}\s|```)/.test(lines[index]) && !listItem(lines[index]) && !(index + 1 < lines.length && tableSeparator(lines[index + 1]))) paragraph.push(lines[index++]);
    blocks.push(<p key={key}>{paragraph.map((part, partIndex) => <span key={partIndex}>{partIndex > 0 ? <br /> : null}{knowledgeInlineText(part)}</span>)}</p>);
  }
  return <div className={`knowledge-formatted-text ${className}`.trim()}>{blocks}</div>;
}
