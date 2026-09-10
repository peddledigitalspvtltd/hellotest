import { useMemo, useState } from "react";
import { IconChevronDown, IconDownload, IconVariable } from "@tabler/icons-react";
import { downloadParameterCsvTemplate, resolveExecutionParameterContext } from "../lib/executionParameterContext";
import "./CaseRunParameterContext.css";

export function CaseRunParameterContext(props: Parameters<typeof resolveExecutionParameterContext>[0] & { collapsible?: boolean }) {
  const context = useMemo(() => resolveExecutionParameterContext(props), [props.execution, props.caseSnapshot, props.steps, props.caseTitle, props.dataSetRow, props.rowIndex, props.capturedValues]);
  const [expandedCaseKey, setExpandedCaseKey] = useState("");
  const [openCaseKey, setOpenCaseKey] = useState("");
  const caseKey = `${props.execution?.id || ""}:${props.caseSnapshot?.test_case_id || ""}`;
  const isOpen = !props.collapsible || openCaseKey === caseKey;
  const isExpanded = expandedCaseKey === caseKey;
  const visibleEntries = isExpanded ? context.entries : context.entries.slice(0, 6);
  if (!context.entries.length) return null;
  return <section className="case-run-parameter-context" aria-label="Effective test parameters">
    <header>
      {props.collapsible ? <button className="case-run-parameter-toggle" type="button" aria-expanded={isOpen} onClick={() => setOpenCaseKey(isOpen ? "" : caseKey)}><IconVariable aria-hidden="true" size={17} /><strong>Test parameters</strong><span>{context.entries.length}</span><IconChevronDown className={isOpen ? "is-expanded" : ""} aria-hidden="true" size={15} /></button> : <div><IconVariable aria-hidden="true" size={17} /><strong>Test parameters</strong><span>{context.entries.length}</span></div>}
      <button className="ghost-button" type="button" onClick={() => downloadParameterCsvTemplate(context.entries)}><IconDownload aria-hidden="true" size={15} />Download template</button>
    </header>
    {context.unresolved.length ? <p className="case-run-parameter-gap" role="status">{context.unresolved.length} declared parameter{context.unresolved.length === 1 ? " needs" : "s need"} a value.</p> : null}
    {isOpen ? <>
    <details className="case-run-parameter-policy"><summary>How values are chosen</summary><p>Later sources override earlier ones: case, suite, environment, configuration, run, selected data row, captured output. Explicit @t, @s and @r scopes stay separate. An empty string overrides a value; a missing field keeps the earlier value. Templates are frozen for this run.</p></details>
    <div className="case-run-parameter-entries">
      {visibleEntries.map((entry) => <article className={!entry.resolved ? "is-unresolved" : ""} key={entry.name}>
        <code>{entry.token}</code>
        <div className="case-run-parameter-value">{entry.sensitive ? <em>Hidden value</em> : !entry.resolved ? <em>Not supplied</em> : entry.value === "" ? <em>Empty string</em> : entry.value}
          {entry.template && entry.template !== entry.value ? <details><summary>Frozen template</summary><code>{entry.template}</code></details> : null}
        </div>
        <small>{entry.sourceLabel}</small>
      </article>)}
    </div>
    {context.entries.length > 6 ? <button className="ghost-button" type="button" aria-expanded={isExpanded} onClick={() => setExpandedCaseKey(isExpanded ? "" : caseKey)}>{isExpanded ? "Show fewer parameters" : `Show all ${context.entries.length} parameters`}</button> : null}
    </> : null}
  </section>;
}
