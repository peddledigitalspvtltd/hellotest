import { RichTextContent } from '@hellotest/platform/frontend/src/platform/components/RichTextEditor';
import { FormattedText } from '@hellotest/platform/frontend/src/shared/components/FormattedText';
import { agentOutputLabel, agentOutputRows, agentOutputText } from '../lib/agentOutputValue';
import './AgentStructuredValue.css';
import type { ReactNode } from 'react';

/** Bounded readable view. Raw JSON remains available through the caller's export. */
export function AgentStructuredValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  let remaining = 500;
  const visit = (item: unknown, level: number): ReactNode => {
    if (remaining-- <= 0) return <span>Display limit reached · export the full result.</span>;
    if (typeof item === 'string') return /^\s*<(?:p|div|h[1-6]|ul|ol|table|blockquote)(?:\s|>)/i.test(item) ? <RichTextContent value={item} /> : <FormattedText text={item} />;
    if (item === null || typeof item !== 'object' || level >= 5) return <span>{agentOutputText(item, level)}</span>;
    const table = agentOutputRows(item);
    if (table) {
      const rows: ReactNode[] = [];
      for (const [index, row] of table.rows.entries()) { if (remaining <= 0) break; rows.push(<tr key={index}>{table.columns.map(key => <td key={key}>{visit(row[key], level + 1)}</td>)}</tr>); }
      return <div className="agent-value-table"><table><thead><tr>{table.columns.map(key => <th key={key}>{agentOutputLabel(key)}</th>)}</tr></thead><tbody>{rows}</tbody></table>{((item as unknown[]).length > rows.length || remaining <= 0) && <p>Showing a bounded preview. Export the full result for all rows.</p>}</div>;
    }
    if (Array.isArray(item)) { const children: ReactNode[] = []; for (const [index, child] of item.slice(0, 100).entries()) { if (remaining <= 0) break; children.push(<li key={index}>{visit(child, level + 1)}</li>); } return item.length ? <ul className="agent-value-list">{children}{children.length < item.length && <li>Additional items are available in the full result.</li>}</ul> : <span>No items</span>; }
    const fields: ReactNode[] = []; for (const [key, child] of Object.entries(item).slice(0, 100)) { if (remaining <= 0) break; fields.push(<div key={key}><dt>{agentOutputLabel(key)}</dt><dd>{visit(child, level + 1)}</dd></div>); }
    return fields.length ? <dl className="agent-value-fields">{fields}{remaining <= 0 && <div><dt>Preview limit</dt><dd>Export the full result for additional fields.</dd></div>}</dl> : <span>No fields</span>;
  };
  return <>{visit(value, depth)}</>;
}

export type AgentReportSection = { title: string; body: string; citation_ids?: string[] };
export type AgentReportTable = { title: string; columns: string[]; rows: string[][]; citation_ids?: string[] };
export type AgentReportChart = { title: string; type: 'bar'; unit?: string; series: Array<{ label: string; value: number }>; citation_ids?: string[] };
export function AgentReportVisuals({ sections = [], tables = [], charts = [] }: { sections?: AgentReportSection[]; tables?: AgentReportTable[]; charts?: AgentReportChart[] }) {
  const sources = (ids?: string[]) => ids?.length ? <small>Sources: {ids.join(', ')}</small> : null;
  return <div className="agent-report-visuals">
    {sections.slice(0, 8).map((section, index) => <section key={`section-${index}`}><h4>{section.title}</h4><AgentStructuredValue value={section.body} />{sources(section.citation_ids)}</section>)}
    {tables.slice(0, 8).map((table, index) => <section key={`table-${index}`}><h4>{table.title}</h4><div className="agent-value-table"><table><caption className="sr-only">{table.title}</caption><thead><tr>{table.columns.slice(0, 8).map((column, i) => <th key={i}>{column}</th>)}</tr></thead><tbody>{table.rows.slice(0, 50).map((row, i) => <tr key={i}>{table.columns.slice(0, 8).map((_, j) => <td key={j}>{agentOutputText(row[j])}</td>)}</tr>)}</tbody></table></div>{sources(table.citation_ids)}</section>)}
    {charts.slice(0, 8).map((chart, index) => {
      const series = chart.series.filter(item => typeof item.label === 'string' && Number.isFinite(item.value)).slice(0, 20);
      const maximum = Math.max(...series.map(item => Math.abs(item.value)), 1);
      if (series.some(item => item.value < 0)) return <section key={`chart-${index}`}><h4>{chart.title}</h4><div className="agent-value-table"><table><caption className="sr-only">{chart.title}</caption><thead><tr><th>Measure</th><th>Value{chart.unit ? ` (${chart.unit})` : ''}</th></tr></thead><tbody>{series.map((item, i) => <tr key={i}><td>{item.label}</td><td>{item.value}</td></tr>)}</tbody></table></div>{sources(chart.citation_ids)}</section>;
      return <section key={`chart-${index}`}><h4>{chart.title}</h4><ul className="agent-report-bars" aria-label={chart.title}>{series.map((item, i) => <li key={i}><span>{item.label}</span><span className="agent-report-bar-track"><i style={{ width: `${Math.abs(item.value) / maximum * 100}%` }} /></span><strong>{item.value}{chart.unit ? ` ${chart.unit}` : ''}</strong></li>)}</ul>{sources(chart.citation_ids)}</section>;
    })}
  </div>;
}
